---
name: job-search-assess
description: Validate and score pending crawl-queue postings for a single company, then write qualifying results to the pipeline tracker. Designed to be invoked by the job-search-lead-gen orchestrator per company.
compatibility: Requires Node.js. Designed for Claude Code.
---

# Job Search - Assess (Single Company)

Process pending crawl-queue postings for one company via MCP. Validate each posting, score against the candidate's resume and dynamic rubric, and write qualifying results to the candidate tracker via MCP.

This skill processes pending queue entries for the company passed via `$ARGUMENTS`.

## Arguments

- `$ARGUMENTS` - Required: the company name to assess (e.g., `Stripe`).

## Resume Resolution

Before processing:
1. Determine `workflowDataPath`: Read `~/.config/job-search-plugin/config.json` for `workflowDataPath` (default: `~/.local/share/job-search-plugin`).
2. Verify `workflowDataPath/resume.pdf` exists.
3. If `workflowDataPath/resume.pdf` does not exist, halt immediately with the error:
   ```
   Error: Resume file not found at workflowDataPath/resume.pdf.
   Please place your resume at this location or run:
     ./setup.sh --update-resume /path/to/your/resume.pdf
   ```

## Steps

### 1. Collect pending entries via MCP

Call MCP tool `get_pending_queue({ company_name: "$ARGUMENTS" })`.
Filter to entries where status is `pending`. If no entries are returned, report "nothing to assess" and return.

For any pending URL that has already been recorded, call `update_queue_status({ url, status: "assessed", notes: "Already assessed" })`.

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
3. Read `<workflowDataPath>/resume.pdf` to ground experience and skills.

### 3. Process each posting individually

For each pending posting, in queue order:

**Validate:** Fetch the posting URL content.
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
1. Inject `<workflowDataPath>/resume.pdf` contents and target skills from `list_skills`.
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
- Update queue status via MCP tool `update_queue_status`:
  ```json
  {
    "url": "<posting_url>",
    "status": "assessed",
    "notes": "Scored <weighted_score>"
  }
  ```

Each MCP call commits a durable checkpoint.

### 4. Report

Return a summary for the company:
- Company name
- Pending postings processed
- Added to candidate pipeline (with titles and scores)
- Skipped postings (with reasons)
- Errors or network issues encountered

## Rules

- Write one candidate at a time through `add_candidate`. Each write is durable.
- Do not perform direct file I/O on markdown tables. All queue and candidate updates must go through MCP tools.
- Do not apply to any roles. Assessment and scoring only.
- On validation or fetch failure for an individual posting, mark it `skipped` in the queue via `update_queue_status` and continue.
