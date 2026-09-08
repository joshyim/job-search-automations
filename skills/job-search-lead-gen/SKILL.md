---
name: job-search-lead-gen
description: Orchestrate the job search pipeline - select a batch of companies, then crawl and assess each one sequentially. Use when scanning for new job postings or running the daily job search pipeline.
compatibility: Requires Node.js and Playwright (npx playwright install chromium).
---

# Job Search - Lead Gen (Orchestrator)

Select a batch of companies via MCP, then for each company: crawl its job board and immediately assess the results before moving to the next company.

## Arguments

- `$ARGUMENTS` - Optional: company names (space-separated). Bypasses batch selection.

## Resume Resolution

Before beginning, resolve and verify the candidate resume:
1. Determine `workflowDataPath`: Read `~/.config/job-search-automation/config.json` for `workflowDataPath` (default: `~/.local/share/job-search-automation`).
2. Verify `workflowDataPath/resume.pdf` exists.
3. If `workflowDataPath/resume.pdf` does not exist, halt immediately with the error:
   ```
   Error: Resume file not found at workflowDataPath/resume.pdf.
   Please place your resume at this location or run:
     ./setup.sh --update-resume /path/to/your/resume.pdf
   ```

## Steps

### 1. Select batch

If `$ARGUMENTS` is provided, use those companies only (each with its known job-board URL or look up via `list_companies`).

Otherwise, query the data layer via MCP:
- Call `get_batch({ limit: 3 })`.
- This returns the least-recently-searched active target companies (excluding companies marked as excluded).
- If no companies are returned or all active companies have already been searched today, log "cycle complete" and exit.

Clean up any stale temporary files under `<workflowDataPath>/tmp/`.

### 2. Per-company loop

For each company in the batch, execute both phases completely before moving to the next:

**Phase A - Crawl:**
Read and follow `skills/job-search-crawl/SKILL.md` for this company. Pass the company name and careers URL.
The crawl skill uses `scripts/crawl-job-board.js`, matches postings against title patterns via `list_title_patterns`, deduplicates via `check_url_exists`, and writes pending roles via `add_to_queue`.

**Phase B - Assess:**
Read and follow `skills/job-search-assess/SKILL.md` for this company. Pass the company name.
The assess skill retrieves pending roles via `get_pending_queue`, dynamically fetches the rubric via `get_scoring_rubric` and skills via `list_skills`, scores against `<workflowDataPath>/resume.pdf`, records qualified roles via `add_candidate`, and updates status via `update_queue_status`.

**Phase C - Log and clean up:**
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
Then remove this company's temporary directory under `<workflowDataPath>/tmp/<company-slug>/`.

On failure at any point: call `log_run` with the failure details, clean up the company's temp directory, then continue to the next company.

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
  "summary": "COMPLETED batch: N/N companies processed",
  "details": {
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
- Do not perform direct markdown file I/O for pipeline state. All data operations MUST go through MCP tools (`get_batch`, `log_run`, `get_candidates`).
- All temporary files (JSON extracts, helper scripts) MUST be written inside `<workflowDataPath>/tmp/<company-slug>/` and cleaned up in Phase C.
