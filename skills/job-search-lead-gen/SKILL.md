---
name: job-search-lead-gen
description: Orchestrate the job search pipeline - select a batch of companies, then crawl and assess each one sequentially. Use when scanning for new job postings or running the daily job search pipeline.
compatibility: Requires Node.js (v18+). Harness-agnostic.
---

# Job Search - Lead Gen (Orchestrator)

Select a batch of companies via MCP, then for each company: crawl its job board and immediately assess the results before moving to the next company.

## Arguments

- `$ARGUMENTS` - Optional: company names (space-separated). Bypasses batch selection.

## Workspace & Resume Resolution

Before beginning, resolve the workspace directory and candidate resume:
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

### 1. Select batch

If `$ARGUMENTS` is provided, use those companies only (each with its known job-board URL or look up via `list_companies`).

Otherwise, query the data layer via MCP:
- Call `get_batch({ limit: 3, selected_directory: "<selected-directory>" })`.
- This returns the least-recently-searched active target companies (excluding companies marked as excluded).
- If no companies are returned or all active companies have already been searched today, log "cycle complete" and exit.

Clean up any stale temporary files under `<selected-directory>/.job-search/tmp/`.

### 2. Per-company loop

For each company in the batch, execute both phases completely before moving to the next:

**Phase A - Crawl:**
Read and follow `skills/job-search-crawl/SKILL.md` for this company. Pass the company name, careers URL, and workspace directory.
The crawl skill uses `scripts/crawl-job-board.js`, matches postings against title patterns via `list_title_patterns`, deduplicates via `check_url_exists`, and writes pending roles via `add_to_queue`. For ATS boards (Ashby, Greenhouse, Lever), it leverages known public ATS APIs—specifically Ashby's unauthenticated public board API (`/posting-api/job-board/<boardSlug>`), avoiding the authenticated `/posting-api/job/{id}` endpoint.

**Phase B - Assess:**
Read and follow `skills/job-search-assess/SKILL.md` for this company. Pass the company name and workspace directory.
The assess skill retrieves pending roles via `get_pending_queue`, dynamically fetches the rubric via `get_scoring_rubric` and skills via `list_skills`, scores against `<selected-directory>/.job-search/resume.pdf`, records scored roles via `add_candidate` with `status: "new"` (disposition is reserved for the user), and updates queue status via `update_queue_status`.

**Phase C - Log and clean up:**
- **On Success:**
  Record the run outcome for this company using MCP tool `log_run`:
  ```json
  {
    "companies_processed": ["<company_name>"],
    "urls_queued": <number_of_new_urls_queued>,
    "candidates_scored": <number_of_candidates_scored>,
    "summary": "Completed crawl and assessment for <company_name>",
    "details": {
      "company": "<company_name>",
      "found": <count>,
      "matched": <count>,
      "added": <count>,
      "skipped": <count>,
      "status": "success"
    }
  }
  ```
  Optionally update company crawl status:
  `update_company_crawl_status({ company_name: "<company_name>", status: "success" })`.
  Then remove any temporary files for this company under `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.

- **Per-Company Error Isolation Boundary (On Failure):**
  If ANY error occurs during a company's crawl or assessment (e.g., crawler exit code 1/2/3/4, `js_required` SPA placeholder, network timeout, HTTP 404/500, Cloudflare block, search provider `rate_limited` block, or JSON parse error):
  1. **Clean up ephemeral files**: Remove `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json` immediately.
  2. **Update company record**: Call `update_company_crawl_status` to stamp the failure reason into the database for manual review:
     ```json
     {
       "company_name": "<company_name>",
       "status": "failed",
       "error_reason": "<error_type>: <error_message>"
     }
     ```
  3. **Record failure telemetry via `log_run`**:
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
         "careers_url": "<careers_url>",
         "needs_review": true,
         "retryable": true
       }
     }
     ```
  4. **SKIP and CONTINUE**: Advance immediately to the next company in the batch.
  5. **CRITICAL GUARDRAIL**: A single company's failure must NEVER abort the batch run. Never repeat `WebFetch` calls across postings when an error or SPA shell is encountered to prevent tripping harness circuit breakers (7 repeated calls).
  6. **BATCH SEARCH CIRCUIT BREAKER (PRO-64)**: If any company triggers a `rate_limited` search failure (e.g. DuckDuckGo rate limiting), immediately disable the search fallback path for all subsequent companies in the batch. Remaining companies in the batch must proceed using direct page/ATS crawling only. Do not invoke web search again during the current batch run.

### 3. Sort pipeline tracker

After all companies are processed, retrieve the candidate pipeline via MCP tool `get_candidates`:
- Call `get_candidates({ sort_by: "score", sort_order: "desc" })`.
- Filter or organize by status (`new`, `applied`, `interviewing`, `rejected`, `offer`).

### 4. Complete

Call `log_run` with the batch completion summary:
```json
{
  "companies_processed": ["<company1>", "<company2>", ...],
  "urls_queued": <total_queued>,
  "candidates_scored": <total_scored>,
  "summary": "COMPLETED batch: M/N succeeded, K failed",
  "details": {
    "succeeded": ["<company1>", ...],
    "failed": [
      {
        "company": "<company_name>",
        "reason": "<error_message>",
        "error_type": "<error_type>",
        "careers_url": "<url>"
      }
    ],
    "per_company": [...]
  }
}
```

Output the execution summary to the user:
- Total postings found across boards
- Assessed and scored candidate roles
- Roles added to pipeline
- Skipped / invalid postings
- Per-company breakdown

## Resume Behavior

- **Killed after N companies:** Processed companies have updated search timestamps in the data backend. The next invocation of `get_batch` automatically selects the remaining companies.
- **Killed mid-company:** URL deduplication via `check_url_exists` prevents re-queuing or double-processing already discovered postings.
- **Board failures:** Logged via `log_run`; cursor advances naturally.

## Rules

- Complete both crawl and assess for one company before starting the next.
- Do not apply to any roles. Discovery and scoring only.
- Record every company run outcome using `log_run`.
- Do not perform direct file I/O for pipeline state. All data operations MUST go through MCP tools (`get_batch`, `log_run`, `get_candidates`).
- All temporary files (JSON extracts, helper scripts) MUST be written inside `<selected-directory>/.job-search/tmp/` (as flat files e.g. `<company-slug>-crawl.json`) and cleaned up in Phase C. Never create nested subdirectories.
- **Candidate disposition is strictly a user decision**: Candidates are always recorded in `status: "new"`. Never auto-disposition candidates (such as setting `not_pursuing` or `rejected`) based on score thresholds or subjective evaluation; disposition is strictly reserved for the human user.
- **Budget and unattended execution:** Aim to complete batch runs within 40–50 messages. Maintain bounded batch sizes (`limit: 3` via `get_batch`), avoid open-ended exploration, and never use interactive browser automation (`Claude_Browser`) during unattended runs.
