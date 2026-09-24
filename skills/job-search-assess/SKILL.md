---
name: job-search-assess
description: Validate and score pending crawl-queue postings for a single company, then write qualifying results to the pipeline tracker. Designed to be invoked by the job-search-lead-gen orchestrator per company.
compatibility: Requires Node.js (v18+). Harness-agnostic.
---

# Job Search - Assess (Single Company)

Process pending crawl-queue postings for one company via MCP. Validate each posting, score against the candidate's resume and dynamic rubric, and write qualifying results to the candidate tracker via MCP.

This skill processes pending queue entries for the company passed via `$ARGUMENTS`.

## Arguments

- `$ARGUMENTS` - Required: the company name to assess (e.g., `Stripe`).

## Workspace & Resume Resolution

Before processing:
1. Determine the active workspace directory `<selected-directory>` (from user prompt/context, or active workspace).
2. Initialize or select workspace: Call `select_workspace({ directory: "<selected-directory>" })` or pass `selected_directory: "<selected-directory>"` to MCP tool invocations.
3. Verify `<selected-directory>/.job-search/resume.pdf` exists.
4. If `<selected-directory>/.job-search/resume.pdf` does not exist, halt immediately with the error:
   ```
   Error: Resume file not found at <selected-directory>/.job-search/resume.pdf.
   Please place your resume at this location or run:
     npx -y github:joshyim/job-search-automations update-resume /path/to/your/resume.pdf --directory "<selected-directory>"
   ```

## Steps

### 1. Collect pending entries via MCP

1. **Check for staged crawl results:** If `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json` exists from a preceding crawl run, inspect or cross-reference its staged postings with the queue.
2. **Fetch pending entries:** Call MCP tool `get_pending_queue({ company_name: "$ARGUMENTS" })`.
   Filter to entries where status is `pending`. Note that returned entries include `ats_platform` (e.g. `ashby`, `greenhouse`, `lever`, `workday`, `custom`, or `null`). If no entries are returned, delete any remaining staged crawl file for this company in `<selected-directory>/.job-search/tmp/`, report "nothing to assess", and return.
3. **Enforce bounded batch limit:**
   - To keep scheduled and unattended runs bounded in time and token cost, **assess at most 5 pending postings per run** (or up to 10 if explicitly specified).
   - If more pending postings exist, process the first 5 in queue order. The remaining postings remain `pending` for the next scheduled run.
4. For any pending URL that has already been recorded, call `update_queue_status({ url, status: "assessed", notes: "Already assessed" })`.

### 2. Fetch runtime rubric and skills via MCP

1. Call MCP tool `get_scoring_rubric()` to retrieve the dynamic rubric dimensions, weights, and descriptions.
   - Example dimensions: Title match, Skills match, Experience match, Seniority fit.
   - Any dimension modifications or additions in the data layer take effect immediately on the next assessment run without requiring an agent or server restart.
   - Normalize weights dynamically at runtime to the nearest integer:
     ```
     sum_of_weights = sum(dimension.weight for dimension in rubric)
     normalized_weight = round((dimension.weight / sum_of_weights) * 100)
     ```
   - Format the rubric into a runtime markdown table:
     ```markdown
     | Dimension | Raw Weight | Normalized Weight | Poor (1-2) | Moderate (3) | Strong (4-5) |
     | --- | --- | --- | --- | --- | --- |
     | Title match | 25 | 25% | Little to no title relevance | Partial title keyword overlap | Exact title match or target senior/lead level |
     ...
     ```
2. Call MCP tool `list_skills()` to retrieve target candidate skills (P1 and P2 priority skills, categories, notes).
3. Read `<selected-directory>/.job-search/resume.pdf` to ground experience and skills.

### 3. Process each posting individually

For each pending posting in the bounded batch, in queue order:

**Upfront ATS Platform Strategy Dispatch (PRO-66):**
Inspect `entry.ats_platform` on the pending posting before fetching:
- **`ats_platform === "ashby"`**:
  - **CRITICAL**: **NEVER use `WebFetch`**. Ashby pages are JavaScript-rendered SPA shells that return empty HTML, wasting requests and risking loop detector circuit breakers.
  - Immediately invoke `node scripts/crawl-job-board.js "<posting_url>" --posting --json` or query the unauthenticated public board API (`/posting-api/job-board/<boardSlug>`).
  - **NEVER** call `https://api.ashbyhq.com/posting-api/job/{id}` directly (requires customer authentication and returns 401).
- **`ats_platform === "greenhouse"` or `"lever"`**:
  - Use `node scripts/crawl-job-board.js "<posting_url>" --posting --json` or direct public ATS API.
- **`ats_platform === "workday"` or other ATS**:
  - Use `node scripts/crawl-job-board.js "<posting_url>" --posting --json`.
- **`ats_platform === "custom"` or `null`**:
  - Use `node scripts/crawl-job-board.js "<posting_url>" --posting --json` or direct HTTP fetch.
  - If exit code 3 (`js_required`) occurs, do not retry. Immediately mark skipped.

**Validate & Fetch Posting Details:**
- **Primary method for ATS URLs:** For Ashby, Greenhouse, or Lever postings, use the lightweight crawler in posting mode:
  ```bash
  # In installed workspace:
  node .claude/plugins/job-search-automations/scripts/crawl-job-board.js "<posting_url>" --posting --json
  # In plugin repository:
  node scripts/crawl-job-board.js "<posting_url>" --posting --json
  ```
  This resolves complete job details (title, description, location) via public ATS APIs (such as Ashby's unauthenticated public job board API `https://api.ashbyhq.com/posting-api/job-board/<boardSlug>`) with zero browser overhead.
  - **Ashby 401 Prevention**: For Ashby-hosted postings, **never** call `api.ashbyhq.com/posting-api/job/{id}` directly. That REST endpoint requires customer API authentication and fails with `HTTP 401 Unauthorized`. Always prefer the unauthenticated public board API (`/posting-api/job-board/<boardSlug>`) or the crawler `--posting` mode.
- **When using native `WebFetch` or direct HTTP fetch:**
  - **Early SPA Placeholder Detection & Circuit Breaker Prevention**:
    - If a page returns `"You need to enable JavaScript to run this app."`, an empty `<noscript>` JavaScript requirement, or an empty SPA skeleton, **detect this on the very first attempt**.
    - **CRITICAL**: Never repeat `WebFetch` calls across remaining postings from the same host or company when an SPA placeholder is detected. Repeating identical `WebFetch` calls trips harness loop detectors (circuit breaker abort after 7 calls).
    - If the URL is Ashby-hosted (`jobs.ashbyhq.com/...`), immediately switch to `node scripts/crawl-job-board.js "<posting_url>" --posting --json` (or query `/posting-api/job-board/<boardSlug>`).
    - If the site is a custom unsupported SPA with no ATS API, immediately call `update_queue_status({ url: "<posting_url>", status: "skipped", notes: "SPA page requires JavaScript rendering; no ATS API available" })` and skip all remaining postings for that company to advance the batch cleanly.
- **Fast failure:** If the URL returns 404/410, redirects to a generic careers board/homepage, or fails to fetch:
  - Immediately call MCP tool `update_queue_status({ url: "<posting_url>", status: "skipped", notes: "Page unavailable or redirected to generic careers board" })`.
  - Proceed directly to the next posting without retrying.
- **Strict browser prohibition:** **NEVER use interactive browser tools** (`Claude_Browser`, browser preview tabs, Puppeteer) during unattended assessment runs.
- Confirm role is open (page has job title + application form/button). Mark closed only if the page states "no longer accepting applications", "position filled", or returns 404/410.
- Confirm location: accept Remote (US), Seattle / Kirkland WA, SF Bay Area, or hybrid in those locations.
- Exclude hard domain mismatches (e.g. cybersecurity, defense/government, child safety, pure hardware engineering).
- If invalid: update queue status via MCP tool `update_queue_status`:
  ```json
  {
    "url": "<posting_url>",
    "status": "skipped",
    "notes": "<reason_for_skipping>"
  }
  ```
  Then proceed to the next posting.

**Score (Prompt Assembly):**
Assemble the assessment prompt dynamically:
1. Inject `<selected-directory>/.job-search/resume.pdf` contents and target skills from `list_skills`.
2. Inject the runtime-formatted rubric table (with normalized integer weights and tier criteria).
3. Inject the fetched job posting text.

Prompt evaluation criteria:
- Evaluate posting against candidate resume and the dynamically injected rubric table.
- Dimension matching is strictly case-insensitive (`.trim().toLowerCase()`).
- Score each dimension from 1.0 to 5.0 (poor: 1-2, moderate: 3, strong: 4-5) according to the rubric tier descriptions.
- Calculate final weighted score:
  `weighted_score = sum(dimension_score * (normalized_weight / 100))` rounded to one decimal place.
- Generate a 1-2 sentence role synopsis summarizing fit, focus area, and standout requirements.

**Record Candidate:**
- Call MCP tool `add_candidate`:
  ```json
  {
    "company_name": "<company_name>",
    "job_title": "<job_title>",
    "url": "<posting_url>",
    "location": "<location>",
    "score": <weighted_score>,
    "breakdown": {
      "<dimension_1>": <score_1>,
      "<dimension_2>": <score_2>
    },
    "status": "new",
    "notes": "<role_synopsis>"
  }
  ```
  - **Important**: Always record new candidates with `"status": "new"`. Never auto-disposition or set `status` to `not_pursuing`, `rejected`, `closed`, or any other status based on low scores or rubric thresholds. Candidate disposition is strictly reserved for human review.
- Update queue status via MCP tool `update_queue_status`:
  ```json
  {
    "url": "<posting_url>",
    "status": "assessed",
    "notes": "Scored <weighted_score>"
  }
  ```

Each MCP call commits a durable checkpoint.

### 4. Cleanup and Report

1. **Clean up intermediate files:**
   - Delete any intermediate crawl file for this company: `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
   - Ensure `<selected-directory>/.job-search/tmp/` remains clean.

2. **Return a summary for the company:**
   - Company name
   - Pending postings processed
   - Added to candidate pipeline (with titles and scores)
   - Skipped postings (with reasons)
   - Errors or network issues encountered

## Rules

- Write one candidate at a time through `add_candidate`. Each write is durable.
- **Candidate disposition is strictly a user decision**: Never set `status` to anything other than `"new"` when recording a new candidate. Do not auto-dispose or assign `not_pursuing`, `rejected`, or `closed` based on score thresholds, low match scores, or agent judgment. All scored candidates must be recorded with `status: "new"` for human review.
- Do not perform direct file I/O on markdown tables. All queue and candidate updates must go through MCP tools.
- Do not apply to any roles. Assessment and scoring only.
- Clean up any ephemeral files in `<selected-directory>/.job-search/tmp/` upon completion.
- On validation or fetch failure for an individual posting, mark it `skipped` in the queue via `update_queue_status` and continue.
