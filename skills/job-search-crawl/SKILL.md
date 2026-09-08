---
name: job-search-crawl
description: Crawl a single company's job board, match postings against target titles, and write matched results to the crawl queue. Designed to be invoked by the job-search-lead-gen orchestrator per company.
compatibility: Requires Node.js and Playwright (npx playwright install chromium).
---

# Job Search - Crawl (Single Company)

Crawl one company's job board, match postings against target titles via MCP, and append matched postings to the crawl queue via MCP.

This skill processes the single company passed via `$ARGUMENTS`. It expects the company name and careers URL.

## Arguments

- `$ARGUMENTS` - Required: the company name and job-board URL, e.g. `Stripe https://stripe.com/jobs`.

## Steps

### 1. Crawl the job board

Resolve `workflowDataPath` from `~/.config/job-search-automation/config.json` (default: `~/.local/share/job-search-automation`).
Write ALL intermediate files to `<workflowDataPath>/tmp/<company-slug>/`. Create the directory if it does not exist. Never write temp files to the repository root or outside this directory.

Primary method - the shared browser crawl script:

```bash
node scripts/crawl-job-board.js "<job-board-url>" --json
```

If zero results, try appending `?q=product+manager` or use WebSearch with `site:{career-domain} "product manager"`.

Always cross-reference with WebSearch regardless: `{company} "product manager" site:{career-domain}`. Merge any additional posting URLs.

### 2. Match and dedup via MCP

1. Fetch target title patterns via MCP:
   - Call `list_title_patterns()`.
   - Extract include patterns and exclude patterns.
2. Filter postings matching any **include pattern** (case-insensitive wildcard `*`). A posting matches if its title fits any include pattern.
3. Exclude any posting whose title matches an **exclude pattern**, even if it matched an include pattern.
4. Deduplicate candidate URLs via MCP:
   - For each matched posting URL, call `check_url_exists({ url: "<posting_url>" })`.
   - If `exists: true`, skip this URL.

### 3. Append to crawl queue via MCP

For each matched, non-duplicate posting, append it to the crawl queue via MCP tool `add_to_queue`:
```json
{
  "url": "<posting_url>",
  "company_name": "<company_name>",
  "notes": "Matched title pattern: <matched_pattern> | Source: crawl/websearch"
}
```

Each call adds the posting with status `pending`.

### 4. Report

Return a structured summary:
- Company name
- Total postings found on board / search
- Postings matched against title patterns
- Postings added to crawl queue
- Postings skipped (already exist in queue/candidates)
- Any errors or warnings encountered

## Gotchas

- Most ATS platforms (Ashby, Greenhouse, Lever, Workday) are SPAs. Always use the shared browser crawl script (`scripts/crawl-job-board.js`).
- Ashby API often truncates. Never rely on it as sole source.
- Crawl output may concatenate title/department/location. Parse the title as text before the first department label.
