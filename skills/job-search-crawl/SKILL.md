---
name: job-search-crawl
description: Crawl company job boards, match postings against target titles, and write matched results to the crawl queue. Supports single company crawling or batch crawling with per-company error isolation.
compatibility: Requires Node.js (v18+). Uses lightweight ATS APIs and HTTP fetch.
---

# Job Search - Crawl

Crawl company job boards, match postings against target titles via MCP, and append matched postings to the crawl queue via MCP.

This skill supports two execution modes:
1. **Single Company Mode**: Processes a single company passed via `$ARGUMENTS` (e.g. `Stripe https://stripe.com/jobs`).
2. **Batch Crawl Mode**: Selects a batch of companies via MCP tool `get_batch({ limit: 3 })` and processes each company with strict per-company error isolation.

## Arguments

- `$ARGUMENTS` - Optional: company name and job-board URL (e.g. `Stripe https://stripe.com/jobs`). If omitted, selects least-recently-searched companies via `get_batch({ limit: 3 })`.

## Execution Modes

### Mode A: Batch Crawl Mode (Multiple Companies)

When invoked for a scheduled run or batch without specific arguments:
1. Retrieve target companies: Call MCP tool `get_batch({ limit: 3, selected_directory: "<selected-directory>" })`.
2. Clean up any stale temporary files under `<selected-directory>/.job-search/tmp/`.
3. **Per-Company Error Isolation Loop**:
   For each company in the batch:
   - **TRY**: Execute Steps 1–4 below for this company.
   - **CATCH** on any failure (crawler exit code 1/2/3/4, `js_required` SPA, timeout, 404/500, network error):
     1. Clean up `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
     2. Record the crawl failure via MCP tool `update_company_crawl_status`:
        ```json
        {
          "company_name": "<company_name>",
          "status": "failed",
          "error_reason": "<error_type>: <error_message>"
        }
        ```
     3. Record failure telemetry via `log_run`:
        ```json
        {
          "companies_processed": ["<company_name>"],
          "urls_queued": 0,
          "candidates_scored": 0,
          "summary": "Crawl failed for <company_name>: <error_message>",
          "details": {
            "company": "<company_name>",
            "status": "failed",
            "error_type": "<error_type>",
            "error_message": "<error_message>",
            "needs_review": true
          }
        }
        ```
     4. **SKIP and CONTINUE**: Advance immediately to the next company. Never abort the remaining batch.
4. **Batch Completion**:
   Call `log_run` with the batch completion summary:
   ```json
   {
     "companies_processed": ["<company1>", "<company2>", ...],
     "urls_queued": <total_queued>,
     "candidates_scored": 0,
     "summary": "COMPLETED crawl batch: M/N succeeded, K failed",
     "details": {
       "succeeded": ["<company1>", ...],
       "failed": [
         { "company": "<company_name>", "reason": "<error_message>", "error_type": "<error_type>" }
       ]
     }
   }
   ```

### Mode B: Single Company Mode

When `$ARGUMENTS` provides a single company name and URL, execute Steps 1–4 directly for that company.

---

## Steps

### 1. Crawl the job board

Resolve the active workspace directory `<selected-directory>` (from user prompt/context, orchestrator call, or active workspace).

The lightweight crawl script outputs JSON directly to stdout when run with `--json`. Agents should parse the JSON output directly in memory without writing intermediate files to disk whenever possible.

If intermediate crawl data must be staged to disk, write strictly to `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`. Never create nested subdirectories or write temp files to the repository root or outside `.job-search/tmp/`.

Primary method - the shared lightweight crawl script:

```bash
# In installed project workspace:
# Codex:
node .codex/plugins/job-search-automations/scripts/crawl-job-board.js "<job-board-url>" --json
# Claude:
node .claude/plugins/job-search-automations/scripts/crawl-job-board.js "<job-board-url>" --json
# In plugin repository:
node scripts/crawl-job-board.js "<job-board-url>" --json
```

**Efficiency and Unattended Execution Rules:**
- Parse the JSON output directly in memory. Do not narrate intermediate parsing steps.
- If the lightweight crawler returns listings, **do NOT run redundant WebSearch queries**. Use the extracted listings directly.
- Only if the lightweight crawler fails or yields zero listings on custom non-ATS job boards, use your harness's native `WebSearch` / `WebFetch` as a fallback.
- **Search Fallback Query Pacing & Rate Limit Guardrails (PRO-64):**
  - **Query Budget**: Limit search fallback to at most **1 targeted query per company** (e.g. `"<company>" "jobs" site:<careers_domain>`). Never run search loops across individual title patterns.
  - **Batch Search Cap**: In batch mode, limit search fallback invocations to at most 2 total searches across the entire batch.
  - **Rate Limit Detection**: Explicitly detect rate limit error responses (e.g. `"DuckDuckGo is rate-limiting this machine..."`, HTTP 429, or HTTP 202).
  - **Zero-Retry Rule**: When a rate-limit error is encountered, **do NOT retry or rephrase** the search. Immediately record company crawl status as `failed` with `error_type: "rate_limited"`, record failure details via `log_run`, and advance immediately.
- **NEVER use interactive browser tools** (`Claude_Browser`, browser preview tabs, Puppeteer) during unattended or scheduled crawls.
- Fast failure: If a company careers board is unreachable or yields no matching postings, log the result and advance to the next company immediately. Do not explore alternative sub-pages or retry in loops.

**Upfront ATS Platform Checking & Strategy Selection (PRO-66):**
Inspect the company's pre-tagged `ats_platform` (from `get_batch` or `list_companies`, or detect via URL) before attempting fetch:
- **`ashby`**: **NEVER use `WebFetch`** (Ashby returns an empty JS SPA shell and wastes requests). Immediately use the unauthenticated public board API (`https://api.ashbyhq.com/posting-api/job-board/<boardSlug>`) or run `node scripts/crawl-job-board.js "<careers_url>" --json`. Never call `/posting-api/job/{id}`.
- **`greenhouse`**: Direct fetch (server-rendered HTML) or Greenhouse public API (`https://boards-api.greenhouse.io/v1/boards/<boardToken>/jobs`) or `scripts/crawl-job-board.js`.
- **`lever`**: Direct fetch or Lever public API (`https://api.lever.co/v0/postings/<boardToken>?mode=json`) or `scripts/crawl-job-board.js`.
- **`workday` / `smartrecruiters` / other ATS**: Run `node scripts/crawl-job-board.js "<careers_url>" --json`.
- **`custom` / undetermined**: Run `node scripts/crawl-job-board.js "<careers_url>" --json`. If exit code 3 (`js_required`), fast-fail immediately without retry. If 0 listings, at most 1 targeted search fallback.

**Known ATS-Specific Public API Patterns:**
When encountering major ATS-hosted company boards or resolving postings, prefer lightweight direct ATS endpoints or the crawler script (`scripts/crawl-job-board.js`):
- **Ashby** (`jobs.ashbyhq.com/<boardSlug>` or `<boardSlug>.ashbyhq.com`):
  - **Public Board API (No Auth)**: `https://api.ashbyhq.com/posting-api/job-board/<boardSlug>` (returns all active jobs with full descriptions, departments, and metadata).
  - **Single Posting Resolution**: Query the public board API above and match by `job.id` or `job.jobUrl`, or invoke `node scripts/crawl-job-board.js "<posting_url>" --posting --json`.
  - **CRITICAL ANTI-PATTERN**: **NEVER** call `https://api.ashbyhq.com/posting-api/job/{id}` directly. That REST endpoint requires partner/customer API authentication and will fail with `HTTP 401 Unauthorized`. Always prefer the unauthenticated public board API (`/posting-api/job-board/<boardSlug>`).
- **Greenhouse** (`boards.greenhouse.io/<boardToken>`):
  - **Public Board API (No Auth)**: `https://boards-api.greenhouse.io/v1/boards/<boardToken>/jobs`
  - **Single Posting API (No Auth)**: `https://boards-api.greenhouse.io/v1/boards/<boardToken>/jobs/<jobId>`
- **Lever** (`jobs.lever.co/<boardToken>`):
  - **Public Board API (No Auth)**: `https://api.lever.co/v0/postings/<boardToken>?mode=json`
  - **Single Posting API (No Auth)**: `https://api.lever.co/v0/postings/<boardToken>/<jobId>`

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

For each matched, non-duplicate posting, append it to the crawl queue via MCP tool `add_to_queue` (passing `ats_platform` from the crawler output or detected from posting URL):
```json
{
  "url": "<posting_url>",
  "company_name": "<company_name>",
  "ats_platform": "<ats_platform>",
  "notes": "Matched title pattern: <matched_pattern> | Source: crawl/websearch"
}
```

Each call adds the posting with status `pending`.

### 4. Cleanup and Report

1. **Clean up intermediate files:**
   - Delete any intermediate crawl file created during this run: `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
   - Ensure `<selected-directory>/.job-search/tmp/` remains clean.

2. **Return a structured summary:**
   - Company name
   - Total postings found on board / search
   - Postings matched against title patterns
   - Postings added to crawl queue
   - Postings skipped (already exist in queue/candidates)
   - Any errors or warnings encountered

## Gotchas

- Many ATS platforms (Ashby, Greenhouse, Lever) have direct API adapters in `scripts/crawl-job-board.js`.
- **Ashby Public API vs Authenticated Endpoint**: Ashby career boards (`jobs.ashbyhq.com/<boardSlug>`) and postings are client-rendered SPAs that return empty shells to raw `WebFetch`. Ashby exposes an unauthenticated public job board API at `https://api.ashbyhq.com/posting-api/job-board/<boardSlug>` which provides complete plain-text and HTML job descriptions. Always crawl Ashby boards and postings via `scripts/crawl-job-board.js` or query `/posting-api/job-board/<boardSlug>`. Never attempt Ashby's per-posting REST endpoint (`/posting-api/job/{id}`), as it requires API authentication and returns `HTTP 401 Unauthorized`.
- If a custom careers site yields no listings or returns an SPA JavaScript placeholder, do not burn repeated fetch attempts. Fast-fail and proceed to the next target.
- Crawl output may concatenate title/department/location. Parse the title as text before the first department label.
