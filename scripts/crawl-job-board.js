#!/usr/bin/env node

// ==============================================================================
// crawl-job-board.js - Lightweight Job Board Crawler
//
// Crawls company career pages and ATS boards (Greenhouse, Lever, Ashby, etc.)
// using lightweight native HTTP fetch and public ATS APIs.
//
// Zero-browser: runs cleanly in constrained sandbox environments
// using native HTTP fetch and ATS endpoints (no Chromium or Playwright required).
//
// Usage:
//   node crawl-job-board.js <url> [--keyword <term>] [--json]
//
// Options:
//   --keyword <term>   Filter listings to those containing <term> (case-insensitive)
//   --json             Output as JSON array instead of TSV
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
//   2  Network or parsing error
// ==============================================================================

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error("Usage: node crawl-job-board.js <url> [--keyword <term>] [--json]");
  process.exit(1);
}

const targetUrl = args[0];
let keyword = null;
let jsonOutput = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--keyword" && args[i + 1]) {
    keyword = args[++i].toLowerCase();
  } else if (args[i] === "--json") {
    jsonOutput = true;
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
 * Attempt direct crawl via Greenhouse public API.
 */
async function crawlGreenhouse(url) {
  const match = url.match(/greenhouse\.io\/(?:embed\/job_board\/|)([a-zA-Z0-9_\-]+)/i);
  if (!match) return null;
  const boardToken = match[1];
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`;

  try {
    const res = await fetch(apiUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return null;

    return data.jobs.map((job) => ({
      title: job.title.trim(),
      url: job.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${job.id}`,
    }));
  } catch {
    return null;
  }
}

/**
 * Attempt direct crawl via Lever public API.
 */
async function crawlLever(url) {
  const match = url.match(/jobs\.lever\.co\/([a-zA-Z0-9_\-]+)/i);
  if (!match) return null;
  const boardToken = match[1];
  const apiUrl = `https://api.lever.co/v0/postings/${boardToken}?mode=json`;

  try {
    const res = await fetch(apiUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const postings = await res.json();
    if (!Array.isArray(postings)) return null;

    return postings.map((job) => ({
      title: (job.text || job.title || "").trim(),
      url: job.hostedUrl || `https://jobs.lever.co/${boardToken}/${job.id}`,
    }));
  } catch {
    return null;
  }
}

/**
 * Attempt direct crawl via Ashby public API.
 */
async function crawlAshby(url) {
  const match = url.match(/jobs\.ashbyhq\.com\/([a-zA-Z0-9_\-]+)/i);
  if (!match) return null;
  const boardToken = match[1];
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${boardToken}`;

  try {
    const res = await fetch(apiUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return null;

    return data.jobs.map((job) => ({
      title: job.title.trim(),
      url: job.jobUrl || `https://jobs.ashbyhq.com/${boardToken}/${job.id}`,
    }));
  } catch {
    return null;
  }
}

/**
 * Generic lightweight HTML crawler via standard HTTP fetch.
 */
async function crawlHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const baseUrl = new URL(url);
  const results = [];
  const seen = new Set();

  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
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

    const isJobLink =
      /\/(jobs?|positions?|openings?|careers?|posting)s?\//i.test(absoluteUrl) ||
      /\/(jobs?|positions?|openings?|posting)[?#]/i.test(absoluteUrl) ||
      /ashbyhq\.com/.test(absoluteUrl) ||
      /greenhouse\.io/.test(absoluteUrl) ||
      /lever\.co/.test(absoluteUrl) ||
      /workday\.com/.test(absoluteUrl) ||
      /smartrecruiters\.com/.test(absoluteUrl) ||
      /icims\.com/.test(absoluteUrl) ||
      /myworkdayjobs\.com/.test(absoluteUrl);

    if (!isJobLink) continue;

    const skipPatterns =
      /\/(apply|login|sign-?in|register|privacy|terms|about|blog|faq)\b/i;
    if (skipPatterns.test(absoluteUrl)) continue;

    seen.add(absoluteUrl);
    results.push({ title: text, url: absoluteUrl });
  }

  return results;
}

(async () => {
  try {
    let listings = null;

    // 1. Check specialized ATS endpoints first
    if (/greenhouse\.io/i.test(targetUrl)) {
      listings = await crawlGreenhouse(targetUrl);
    } else if (/lever\.co/i.test(targetUrl)) {
      listings = await crawlLever(targetUrl);
    } else if (/ashbyhq\.com/i.test(targetUrl)) {
      listings = await crawlAshby(targetUrl);
    }

    // 2. Generic HTTP fetch if not ATS or ATS returned null
    if (!listings || listings.length === 0) {
      try {
        const htmlResults = await crawlHtml(targetUrl);
        if (htmlResults && htmlResults.length > 0) {
          listings = htmlResults;
        }
      } catch (err) {
        // Fall through to report empty results
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
    process.exit(0);
  } catch (err) {
    console.error(`Error crawling ${targetUrl}: ${err.message}`);
    process.exit(2);
  }
})();
