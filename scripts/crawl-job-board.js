#!/usr/bin/env node

// ==============================================================================
// crawl-job-board.js - Lightweight Job Board Crawler
//
// Crawls company career pages and ATS boards (Greenhouse, Lever, Ashby, etc.)
// using lightweight native HTTP fetch and public ATS APIs.
//
// Hardened against Server-Side Request Forgery (SSRF - PRO-58):
// - Enforces HTTP(S) protocol and validates destinations at connection time
// - Rejects loopback, private, link-local, and cloud metadata IPs (IPv4 & IPv6)
// - Validates redirect destinations at every hop
// - Strict ATS hostname matching based on parsed URLs
// - Filters extracted HTML links against non-public destinations
// - Optional --allow-private override flag for deliberate local test fixtures
//
// Hardened against Resource Exhaustion (PRO-60):
// - Hard request deadlines to prevent indefinite hangs / slowloris
// - Response size caps (default 5MB) to prevent buffer / OOM attacks
// - Max redirect hops enforcement (default 5)
// - Extracted records ceiling (default 250)
//
// Usage:
//   node crawl-job-board.js <url> [--keyword <term>] [--json] [--allow-private]
//                                [--max-time <sec>] [--max-bytes <bytes>]
//                                [--max-redirects <n>] [--max-records <n>]
//
// Options:
//   --keyword <term>       Filter listings to those containing <term> (case-insensitive)
//   --json                 Output as JSON array instead of TSV
//   --allow-private        Allow private/loopback destinations (for testing only)
//   --max-time <seconds>   Maximum time in seconds for HTTP request deadline (default: 15)
//   --max-bytes <bytes>    Maximum response size in bytes (default: 5242880 = 5MB)
//   --max-redirects <n>    Maximum number of redirects to follow (default: 5)
//   --max-records <n>      Maximum number of extracted job records (default: 250)
//
// Output (TSV, default):
//   title\turl
//
// Output (JSON):
//   [{"title": "...", "url": "..."}, ...]
//
// Exit codes:
//   0  Success
//   1  Usage error or missing arguments
//   2  Network, parsing, or resource limit error
// ==============================================================================

import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";

const DEFAULT_MAX_TIME_SEC = 15;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RECORDS = 250;

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error("Usage: node crawl-job-board.js <url> [--keyword <term>] [--json] [--allow-private] [--max-time <sec>] [--max-bytes <bytes>] [--max-redirects <n>] [--max-records <n>]");
  process.exit(1);
}

const targetUrl = args[0];
let keyword = null;
let jsonOutput = false;
let allowPrivate =
  process.env.CRAWLER_ALLOW_PRIVATE === "1" ||
  process.env.CRAWLER_ALLOW_PRIVATE === "true";

let maxTimeSeconds = process.env.CRAWLER_MAX_TIME
  ? parseInt(process.env.CRAWLER_MAX_TIME, 10)
  : DEFAULT_MAX_TIME_SEC;
let maxBytes = process.env.CRAWLER_MAX_BYTES
  ? parseInt(process.env.CRAWLER_MAX_BYTES, 10)
  : DEFAULT_MAX_BYTES;
let maxRedirects = process.env.CRAWLER_MAX_REDIRECTS
  ? parseInt(process.env.CRAWLER_MAX_REDIRECTS, 10)
  : DEFAULT_MAX_REDIRECTS;
let maxRecords = process.env.CRAWLER_MAX_RECORDS
  ? parseInt(process.env.CRAWLER_MAX_RECORDS, 10)
  : DEFAULT_MAX_RECORDS;

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--keyword" && args[i + 1]) {
    keyword = args[++i].toLowerCase();
  } else if (arg.startsWith("--keyword=")) {
    keyword = arg.slice("--keyword=".length).toLowerCase();
  } else if (arg === "--json") {
    jsonOutput = true;
  } else if (arg === "--allow-private" || arg === "--allow-local") {
    allowPrivate = true;
  } else if ((arg === "--max-time" || arg === "--timeout") && args[i + 1]) {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val) && val > 0) maxTimeSeconds = val;
  } else if (arg.startsWith("--max-time=") || arg.startsWith("--timeout=")) {
    const val = parseInt(arg.split("=")[1], 10);
    if (!isNaN(val) && val > 0) maxTimeSeconds = val;
  } else if (arg === "--max-bytes" && args[i + 1]) {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val) && val > 0) maxBytes = val;
  } else if (arg.startsWith("--max-bytes=")) {
    const val = parseInt(arg.slice("--max-bytes=".length), 10);
    if (!isNaN(val) && val > 0) maxBytes = val;
  } else if (arg === "--max-redirects" && args[i + 1]) {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val) && val >= 0) maxRedirects = val;
  } else if (arg.startsWith("--max-redirects=")) {
    const val = parseInt(arg.slice("--max-redirects=".length), 10);
    if (!isNaN(val) && val >= 0) maxRedirects = val;
  } else if (arg === "--max-records" && args[i + 1]) {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val) && val > 0) maxRecords = val;
  } else if (arg.startsWith("--max-records=")) {
    const val = parseInt(arg.slice("--max-records=".length), 10);
    if (!isNaN(val) && val > 0) maxRecords = val;
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Parses IPv4 string into a 32-bit unsigned integer, or null if invalid.
 */
function parseIpv4(ipStr) {
  if (net.isIPv4(ipStr)) {
    const parts = ipStr.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
      return (
        ((parts[0] << 24) >>> 0) +
        ((parts[1] << 16) >>> 0) +
        ((parts[2] << 8) >>> 0) +
        (parts[3] >>> 0)
      );
    }
  }
  return null;
}

/**
 * Checks if an IPv4 integer is within a CIDR range.
 */
function inCidrV4(ipInt, cidrIp, prefixLen) {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  const netInt = parseIpv4(cidrIp);
  return (ipInt & mask) === (netInt & mask);
}

/**
 * Checks if IPv4 address is in any private, loopback, link-local, or reserved range.
 */
function isPrivateIpv4(ipStr) {
  const ipInt = parseIpv4(ipStr);
  if (ipInt === null) return false;

  return (
    inCidrV4(ipInt, "0.0.0.0", 8) || // Current network / this host
    inCidrV4(ipInt, "10.0.0.0", 8) || // Private-Use (RFC 1918)
    inCidrV4(ipInt, "100.64.0.0", 10) || // Shared Address Space / CGNAT (RFC 6598)
    inCidrV4(ipInt, "127.0.0.0", 8) || // Loopback (RFC 1122)
    inCidrV4(ipInt, "169.254.0.0", 16) || // Link Local (RFC 3927) / Cloud Metadata
    inCidrV4(ipInt, "172.16.0.0", 12) || // Private-Use (RFC 1918)
    inCidrV4(ipInt, "192.0.0.0", 24) || // IETF Protocol Assignments (RFC 6890)
    inCidrV4(ipInt, "192.0.2.0", 24) || // TEST-NET-1 (RFC 5737)
    inCidrV4(ipInt, "192.88.99.0", 24) || // 6to4 Relay Anycast (RFC 3068 / RFC 7526)
    inCidrV4(ipInt, "192.168.0.0", 16) || // Private-Use (RFC 1918)
    inCidrV4(ipInt, "198.18.0.0", 15) || // Benchmarking (RFC 2544)
    inCidrV4(ipInt, "198.51.100.0", 24) || // TEST-NET-2 (RFC 5737)
    inCidrV4(ipInt, "203.0.113.0", 24) || // TEST-NET-3 (RFC 5737)
    inCidrV4(ipInt, "224.0.0.0", 4) || // Multicast (RFC 5771)
    inCidrV4(ipInt, "240.0.0.0", 4) || // Reserved for future use (RFC 1112)
    ipInt === 0xffffffff // Broadcast (RFC 919)
  );
}

/**
 * Parses IPv6 string into an array of 8 16-bit integers.
 */
function parseIpv6(ipStr) {
  if (!net.isIPv6(ipStr)) return null;
  let str = ipStr.toLowerCase();
  const lastColon = str.lastIndexOf(":");
  const possibleIpv4 = str.substring(lastColon + 1);
  if (net.isIPv4(possibleIpv4)) {
    const parts = possibleIpv4.split(".").map(Number);
    const hex1 = ((parts[0] << 8) | parts[1]).toString(16);
    const hex2 = ((parts[2] << 8) | parts[3]).toString(16);
    str = str.substring(0, lastColon) + ":" + hex1 + ":" + hex2;
  }
  const doubleColonIndex = str.indexOf("::");
  let left = [];
  let right = [];
  if (doubleColonIndex !== -1) {
    const leftStr = str.substring(0, doubleColonIndex);
    const rightStr = str.substring(doubleColonIndex + 2);
    if (leftStr) left = leftStr.split(":").map((h) => parseInt(h, 16));
    if (rightStr) right = rightStr.split(":").map((h) => parseInt(h, 16));
    const missing = 8 - (left.length + right.length);
    const zeros = new Array(missing).fill(0);
    return [...left, ...zeros, ...right];
  } else {
    return str.split(":").map((h) => parseInt(h, 16));
  }
}

/**
 * Checks if IPv6 address is in any private, loopback, link-local, or reserved range.
 */
function isPrivateIpv6(ipStr) {
  const w = parseIpv6(ipStr);
  if (!w) return false;
  // ::/128 Unspecified
  if (w.every((x) => x === 0)) return true;
  // ::1/128 Loopback
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true;
  // ::ffff:0:0/96 IPv4-mapped
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    const ipv4 =
      ((w[6] >> 8) & 0xff) +
      "." +
      (w[6] & 0xff) +
      "." +
      ((w[7] >> 8) & 0xff) +
      "." +
      (w[7] & 0xff);
    return isPrivateIpv4(ipv4);
  }
  // 64:ff9b::/96 IPv4/IPv6 translation
  if (w[0] === 0x0064 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
    const ipv4 =
      ((w[6] >> 8) & 0xff) +
      "." +
      (w[6] & 0xff) +
      "." +
      ((w[7] >> 8) & 0xff) +
      "." +
      (w[7] & 0xff);
    return isPrivateIpv4(ipv4);
  }
  // 100::/64 Discard-Only prefix
  if (w[0] === 0x0100 && w.slice(1, 4).every((x) => x === 0)) return true;
  // 2001:db8::/32 Documentation
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;
  // 2002::/16 6to4 prefix with embedded IPv4
  if (w[0] === 0x2002) {
    const ipv4 =
      ((w[1] >> 8) & 0xff) +
      "." +
      (w[1] & 0xff) +
      "." +
      ((w[2] >> 8) & 0xff) +
      "." +
      (w[2] & 0xff);
    return isPrivateIpv4(ipv4);
  }
  // fc00::/7 Unique Local Address (ULA)
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 Link-Local
  if ((w[0] & 0xffc0) === 0xfe80) return true;
  // ff00::/8 Multicast
  if ((w[0] & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * Checks if an IP string (IPv4 or IPv6) is in private or non-public ranges.
 */
function isPrivateIp(ipStr) {
  if (net.isIPv4(ipStr)) return isPrivateIpv4(ipStr);
  if (net.isIPv6(ipStr)) return isPrivateIpv6(ipStr);
  return false;
}

/**
 * Checks if hostname is a forbidden local or internal name.
 */
function isForbiddenHostname(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host === "internal" || host.endsWith(".internal")) return true;
  if (host === "lan" || host.endsWith(".lan")) return true;
  if (host === "home.arpa" || host.endsWith(".home.arpa")) return true;
  if (host === "example" || host.endsWith(".example")) return true;
  if (host === "test" || host.endsWith(".test")) return true;
  if (host === "invalid" || host.endsWith(".invalid")) return true;
  return false;
}

/**
 * Safe HTTP fetch that prevents SSRF:
 * - Accepts only http: and https: schemes
 * - Resolves DNS and validates all resolved addresses against private/reserved ranges
 * - Pins socket connection to the validated address at connection time (prevents DNS rebinding / TOCTOU)
 * - Manually validates every redirect destination (up to maxRedirects)
 * - Returns { status, ok, headers, text(), json() }
 */
async function safeFetch(urlStr, options = {}) {
  const currentMaxRedirects = options.maxRedirects ?? maxRedirects;
  const isAllowPrivate = options.allowPrivate ?? allowPrivate;
  const currentMaxBytes = options.maxBytes ?? maxBytes;
  const timeoutMs = (options.maxTime || options.timeout ? (options.maxTime || options.timeout) * 1000 : maxTimeSeconds * 1000);
  let currentUrlStr = urlStr;
  let redirectCount = 0;

  while (true) {
    let url;
    try {
      url = new URL(currentUrlStr);
    } catch {
      throw new Error(`Invalid URL: ${currentUrlStr}`);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `Forbidden protocol: ${url.protocol}. Only http: and https: are allowed.`
      );
    }

    const isHttps = url.protocol === "https:";
    const port = url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80;
    const hostname = url.hostname;
    const unbracketedHost = hostname.replace(/^\[|\]$/g, "");

    // Check if hostname is an IP literal
    const isLiteralIp = Boolean(net.isIP(unbracketedHost));
    if (isLiteralIp) {
      if (!isAllowPrivate && isPrivateIp(unbracketedHost)) {
        throw new Error(`Access to non-public/private IP (${unbracketedHost}) is forbidden`);
      }
    } else {
      if (!isAllowPrivate && isForbiddenHostname(hostname)) {
        throw new Error(`Access to private/local domain (${hostname}) is forbidden`);
      }
    }

    // Custom lookup function that enforces destination IP at connection time
    const safeLookup = (lookupHost, lookupOpts, callback) => {
      dns.lookup(lookupHost, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!addresses || addresses.length === 0) {
          return callback(new Error(`DNS resolution returned no addresses for ${lookupHost}`));
        }

        if (!isAllowPrivate) {
          for (const addr of addresses) {
            if (isPrivateIp(addr.address)) {
              return callback(
                new Error(
                  `Access to non-public/private IP (${addr.address}) resolved for ${lookupHost} is forbidden`
                )
              );
            }
          }
        }

        // Pin connection to the first verified address
        if (lookupOpts && lookupOpts.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      });
    };

    const response = await new Promise((resolve, reject) => {
      let completed = false;
      const deadlineTimer = setTimeout(() => {
        if (!completed) {
          completed = true;
          const err = new Error(`Request deadline exceeded (${timeoutMs}ms)`);
          req.destroy(err);
          reject(err);
        }
      }, timeoutMs);

      const transport = isHttps ? https : http;
      const requestOptions = {
        protocol: url.protocol,
        hostname: unbracketedHost,
        port: port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: {
          "User-Agent": options.userAgent || USER_AGENT,
          ...options.headers,
        },
        lookup: isLiteralIp ? undefined : safeLookup,
        servername: isHttps && !isLiteralIp ? hostname : undefined,
      };

      const req = transport.request(requestOptions, (res) => {
        // Content-Length check
        const contentLengthHeader = res.headers["content-length"];
        if (contentLengthHeader) {
          const contentLength = parseInt(contentLengthHeader, 10);
          if (!isNaN(contentLength) && contentLength > currentMaxBytes) {
            completed = true;
            clearTimeout(deadlineTimer);
            res.destroy();
            req.destroy();
            return reject(
              new Error(
                `Response size (${contentLength} bytes) exceeds limit of ${currentMaxBytes} bytes`
              )
            );
          }
        }

        const chunks = [];
        let bytesReceived = 0;

        res.on("data", (chunk) => {
          if (completed) return;
          bytesReceived += chunk.length;
          if (bytesReceived > currentMaxBytes) {
            completed = true;
            clearTimeout(deadlineTimer);
            res.destroy();
            req.destroy();
            return reject(
              new Error(
                `Response size exceeded limit of ${currentMaxBytes} bytes`
              )
            );
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (completed) return;
          completed = true;
          clearTimeout(deadlineTimer);
          const bodyBuffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: res.headers,
            text: async () => bodyBuffer.toString("utf8"),
            json: async () => JSON.parse(bodyBuffer.toString("utf8")),
          });
        });

        res.on("error", (err) => {
          if (completed) return;
          completed = true;
          clearTimeout(deadlineTimer);
          reject(err);
        });
      });

      req.on("timeout", () => {
        if (!completed) {
          completed = true;
          clearTimeout(deadlineTimer);
          const err = new Error(`Request timed out after ${timeoutMs}ms`);
          req.destroy(err);
          reject(err);
        }
      });
      req.on("error", (err) => {
        if (completed) return;
        completed = true;
        clearTimeout(deadlineTimer);
        reject(err);
      });
      req.end();
    });

    // Check for redirects
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers["location"];
      if (!location) {
        return response;
      }
      redirectCount++;
      if (redirectCount > currentMaxRedirects) {
        throw new Error(`Maximum redirect limit (${currentMaxRedirects}) exceeded`);
      }
      currentUrlStr = new URL(location, currentUrlStr).href;
      continue;
    }

    return response;
  }
}

/**
 * Strip HTML tags and normalize whitespace.
 */
function cleanText(html) {
  if (!html) return "";
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Attempt direct crawl via Greenhouse public API using parsed hostname.
 */
async function crawlGreenhouse(parsedUrl, options = {}) {
  let boardToken = null;
  if (parsedUrl.searchParams.has("for")) {
    const forVal = parsedUrl.searchParams.get("for");
    if (/^[a-zA-Z0-9_\-]+$/.test(forVal)) boardToken = forVal;
  }
  if (!boardToken) {
    const match = parsedUrl.pathname.match(
      /(?:embed\/job_board\/|^[\/]?)([a-zA-Z0-9_\-]+)/i
    );
    if (match && match[1]) boardToken = match[1];
  }
  if (!boardToken) return null;

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`;
  const effectiveMaxRecords = options.maxRecords || maxRecords;

  try {
    const res = await safeFetch(apiUrl, {
      userAgent: USER_AGENT,
      allowPrivate: options.allowPrivate ?? allowPrivate,
      maxBytes: options.maxBytes ?? maxBytes,
      timeout: options.maxTime || options.timeout,
      maxRedirects: options.maxRedirects ?? maxRedirects,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return null;

    const jobs = data.jobs.slice(0, effectiveMaxRecords);
    return jobs.map((job) => ({
      title: job.title.trim(),
      url:
        job.absolute_url ||
        `https://boards.greenhouse.io/${boardToken}/jobs/${job.id}`,
    }));
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("forbidden") ||
        err.message.includes("Forbidden") ||
        err.message.includes("Invalid") ||
        err.message.includes("exceeded") ||
        err.message.includes("limit") ||
        err.message.includes("timed out") ||
        err.message.includes("deadline"))
    ) {
      throw err;
    }
    return null;
  }
}

/**
 * Attempt direct crawl via Lever public API using parsed hostname.
 */
async function crawlLever(parsedUrl, options = {}) {
  const match = parsedUrl.pathname.match(/^\/([a-zA-Z0-9_\-]+)/i);
  if (!match || !match[1]) return null;
  const boardToken = match[1];
  const apiUrl = `https://api.lever.co/v0/postings/${boardToken}?mode=json`;
  const effectiveMaxRecords = options.maxRecords || maxRecords;

  try {
    const res = await safeFetch(apiUrl, {
      userAgent: USER_AGENT,
      allowPrivate: options.allowPrivate ?? allowPrivate,
      maxBytes: options.maxBytes ?? maxBytes,
      timeout: options.maxTime || options.timeout,
      maxRedirects: options.maxRedirects ?? maxRedirects,
    });
    if (!res.ok) return null;
    const postings = await res.json();
    if (!Array.isArray(postings)) return null;

    const sliced = postings.slice(0, effectiveMaxRecords);
    return sliced.map((job) => ({
      title: (job.text || job.title || "").trim(),
      url: job.hostedUrl || `https://jobs.lever.co/${boardToken}/${job.id}`,
    }));
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("forbidden") ||
        err.message.includes("Forbidden") ||
        err.message.includes("Invalid") ||
        err.message.includes("exceeded") ||
        err.message.includes("limit") ||
        err.message.includes("timed out") ||
        err.message.includes("deadline"))
    ) {
      throw err;
    }
    return null;
  }
}

/**
 * Attempt direct crawl via Ashby public API using parsed hostname.
 */
async function crawlAshby(parsedUrl, options = {}) {
  const match = parsedUrl.pathname.match(/^\/([a-zA-Z0-9_\-]+)/i);
  if (!match || !match[1]) return null;
  const boardToken = match[1];
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${boardToken}`;
  const effectiveMaxRecords = options.maxRecords || maxRecords;

  try {
    const res = await safeFetch(apiUrl, {
      userAgent: USER_AGENT,
      allowPrivate: options.allowPrivate ?? allowPrivate,
      maxBytes: options.maxBytes ?? maxBytes,
      timeout: options.maxTime || options.timeout,
      maxRedirects: options.maxRedirects ?? maxRedirects,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return null;

    const jobs = data.jobs.slice(0, effectiveMaxRecords);
    return jobs.map((job) => ({
      title: job.title.trim(),
      url: job.jobUrl || `https://jobs.ashbyhq.com/${boardToken}/${job.id}`,
    }));
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("forbidden") ||
        err.message.includes("Forbidden") ||
        err.message.includes("Invalid") ||
        err.message.includes("exceeded") ||
        err.message.includes("limit") ||
        err.message.includes("timed out") ||
        err.message.includes("deadline"))
    ) {
      throw err;
    }
    return null;
  }
}

/**
 * Generic lightweight HTML crawler via safe HTTP fetch.
 */
async function crawlHtml(url, options = {}) {
  const isAllowPrivate = options.allowPrivate ?? allowPrivate;
  const effectiveMaxRecords = options.maxRecords || maxRecords;
  const res = await safeFetch(url, {
    userAgent: USER_AGENT,
    allowPrivate: isAllowPrivate,
    maxBytes: options.maxBytes ?? maxBytes,
    timeout: options.maxTime || options.timeout,
    maxRedirects: options.maxRedirects ?? maxRedirects,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText || res.status}`);
  }

  const html = await res.text();
  const baseUrl = new URL(url);
  const results = [];
  const seen = new Set();

  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    if (results.length >= effectiveMaxRecords) {
      break;
    }
    const rawHref = match[1];
    const innerHtml = match[2];
    const text = cleanText(innerHtml);

    if (!text || text.length < 3 || text.length > 200) continue;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(absoluteUrl)) continue;

    // Validate extracted link: must be http or https
    let parsedLink;
    try {
      parsedLink = new URL(absoluteUrl);
    } catch {
      continue;
    }
    if (parsedLink.protocol !== "http:" && parsedLink.protocol !== "https:") {
      continue;
    }

    // Strip credentials
    parsedLink.username = "";
    parsedLink.password = "";

    // Reject non-public destination in extracted links unless allowPrivate
    if (!isAllowPrivate) {
      const linkHost = parsedLink.hostname.replace(/^\[|\]$/g, "");
      if (net.isIP(linkHost)) {
        if (isPrivateIp(linkHost)) continue;
      } else {
        if (isForbiddenHostname(parsedLink.hostname)) continue;
      }
    }

    const cleanAbsoluteUrl = parsedLink.href;

    const isJobLink =
      /\/(jobs?|positions?|openings?|careers?|posting)s?\//i.test(cleanAbsoluteUrl) ||
      /\/(jobs?|positions?|openings?|posting)[?#]/i.test(cleanAbsoluteUrl) ||
      /ashbyhq\.com/.test(cleanAbsoluteUrl) ||
      /greenhouse\.io/.test(cleanAbsoluteUrl) ||
      /lever\.co/.test(cleanAbsoluteUrl) ||
      /workday\.com/.test(cleanAbsoluteUrl) ||
      /smartrecruiters\.com/.test(cleanAbsoluteUrl) ||
      /icims\.com/.test(cleanAbsoluteUrl) ||
      /myworkdayjobs\.com/.test(cleanAbsoluteUrl);

    if (!isJobLink) continue;

    const skipPatterns =
      /\/(apply|login|sign-?in|register|privacy|terms|about|blog|faq)\b/i;
    if (skipPatterns.test(cleanAbsoluteUrl)) continue;

    seen.add(cleanAbsoluteUrl);
    results.push({ title: text, url: cleanAbsoluteUrl });
  }

  return results;
}

(async () => {
  const overallTimeoutMs = Math.max(maxTimeSeconds * 2000, 30000); // at least 30s overall
  const overallTimer = setTimeout(() => {
    console.error(`Error: Crawler overall execution timeout exceeded (${Math.round(overallTimeoutMs / 1000)}s)`);
    process.exit(2);
  }, overallTimeoutMs);
  overallTimer.unref();

  try {
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      console.error(`Error: Invalid URL: ${targetUrl}`);
      process.exit(1);
    }

    if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
      console.error(
        `Error: Invalid protocol: ${parsedTarget.protocol}. Only http: and https: are allowed.`
      );
      process.exit(1);
    }

    let listings = null;
    const targetHost = parsedTarget.hostname.toLowerCase();

    const crawlOpts = {
      allowPrivate,
      maxBytes,
      maxTime: maxTimeSeconds,
      maxRedirects,
      maxRecords,
    };

    // 1. Check specialized ATS endpoints using parsed hostname
    if (targetHost === "greenhouse.io" || targetHost.endsWith(".greenhouse.io")) {
      listings = await crawlGreenhouse(parsedTarget, crawlOpts);
    } else if (targetHost === "lever.co" || targetHost.endsWith(".lever.co")) {
      listings = await crawlLever(parsedTarget, crawlOpts);
    } else if (targetHost === "ashbyhq.com" || targetHost.endsWith(".ashbyhq.com")) {
      listings = await crawlAshby(parsedTarget, crawlOpts);
    }

    // 2. Generic HTTP fetch if not ATS or ATS returned null
    if (!listings || listings.length === 0) {
      try {
        const htmlResults = await crawlHtml(targetUrl, crawlOpts);
        if (htmlResults && htmlResults.length > 0) {
          listings = htmlResults;
        }
      } catch (err) {
        // If an SSRF, security restriction, or resource limit occurred, rethrow so it fails visibly
        if (
          err.message &&
          (err.message.includes("forbidden") ||
            err.message.includes("Forbidden") ||
            err.message.includes("Invalid") ||
            err.message.includes("exceeded") ||
            err.message.includes("limit") ||
            err.message.includes("timed out") ||
            err.message.includes("deadline"))
        ) {
          throw err;
        }
        // Fall through to report empty results for standard 404/not found errors
      }
    }

    listings = listings || [];

    // Filter by keyword if provided
    let filtered = listings;
    if (keyword) {
      filtered = listings.filter((l) =>
        l.title.toLowerCase().includes(keyword)
      );
    }

    // Apply maxRecords ceiling to final output
    if (filtered.length > maxRecords) {
      filtered = filtered.slice(0, maxRecords);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      for (const item of filtered) {
        console.log(`${item.title}\t${item.url}`);
      }
    }

    if (filtered.length === 0) {
      console.error(
        `No listings found${keyword ? ` matching "${keyword}"` : ""} at ${targetUrl}`
      );
    } else {
      console.error(`Found ${filtered.length} listing(s)`);
    }
    clearTimeout(overallTimer);
    process.exit(0);
  } catch (err) {
    clearTimeout(overallTimer);
    console.error(`Error crawling ${targetUrl}: ${err.message}`);
    process.exit(2);
  }
})();
