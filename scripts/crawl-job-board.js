#!/usr/bin/env node

// Usage: node crawl-job-board.js <url> [--keyword <term>] [--json]
//
// Launches a headless browser, navigates to a job board URL, waits for
// JS-rendered content, and extracts all job listing links with titles.
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
//   2  Navigation or browser error

const { chromium } = require("playwright");

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.error(
    "Usage: node crawl-job-board.js <url> [--keyword <term>] [--json]"
  );
  process.exit(1);
}

const url = args[0];
let keyword = null;
let jsonOutput = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--keyword" && args[i + 1]) {
    keyword = args[++i].toLowerCase();
  } else if (args[i] === "--json") {
    jsonOutput = true;
  }
}

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(2000);

    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      const links = document.querySelectorAll("a[href]");
      for (const link of links) {
        const href = link.href;
        const text = (link.textContent || "").trim().replace(/\s+/g, " ");

        if (!text || text.length < 3 || text.length > 200) continue;
        if (seen.has(href)) continue;

        const isJobLink =
          /\/(jobs?|positions?|openings?|careers?|posting)s?\//i.test(href) ||
          /\/(jobs?|positions?|openings?|posting)[?#]/i.test(href) ||
          /ashbyhq\.com/.test(href) ||
          /greenhouse\.io/.test(href) ||
          /lever\.co/.test(href) ||
          /workday\.com/.test(href) ||
          /smartrecruiters\.com/.test(href) ||
          /icims\.com/.test(href) ||
          /myworkdayjobs\.com/.test(href);

        if (!isJobLink) continue;

        const skipPatterns =
          /\/(apply|login|sign-?in|register|privacy|terms|about|blog|faq)\b/i;
        if (skipPatterns.test(href)) continue;

        seen.add(href);
        results.push({ title: text, url: href });
      }

      return results;
    });

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
        `No listings found${keyword ? ` matching "${keyword}"` : ""} at ${url}`
      );
    } else {
      console.error(`Found ${filtered.length} listing(s)`);
    }
  } catch (err) {
    console.error(`Error crawling ${url}: ${err.message}`);
    process.exit(2);
  } finally {
    if (browser) await browser.close();
  }
})();
