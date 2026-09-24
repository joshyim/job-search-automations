#!/usr/bin/env bash

# ==============================================================================
# skills.test.sh - Automated Verification for Epic 3: Skill Data Access Migration
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$PLUGIN_ROOT/skills"
SCRIPTS_DIR="$PLUGIN_ROOT/scripts"
TEMPLATES_DIR="$PLUGIN_ROOT/templates"

PASSED=0
FAILED=0

pass() {
  echo "  [PASS] $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  [FAIL] $1"
  FAILED=$((FAILED + 1))
}

echo "=== Running Epic 3 Skills Migration Test Suite ==="

# 1. Verify existence of all 6 skills
EXPECTED_SKILLS=(
  "job-search-lead-gen"
  "job-search-crawl"
  "job-search-assess"
  "company-search"
  "title-discovery"
  "pipeline-diagram"
)

echo ""
echo "--- 1. Verifying Skill Directories and SKILL.md ---"
for skill in "${EXPECTED_SKILLS[@]}"; do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ -f "$skill_file" ]; then
    pass "Skill '$skill' exists with SKILL.md"
  else
    fail "Skill '$skill' missing SKILL.md at $skill_file"
  fi
done

echo ""
echo "--- 2. Validating Agent Skills Specification Conformance ---"
for skill in "${EXPECTED_SKILLS[@]}"; do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ ! -f "$skill_file" ]; then
    continue
  fi

  # Frontmatter check
  if head -n 1 "$skill_file" | grep -q "^---$"; then
    pass "$skill: Has YAML frontmatter opening delimiter"
  else
    fail "$skill: Missing opening YAML delimiter '---'"
  fi

  # Name matches directory
  if grep -q "^name: $skill$" "$skill_file"; then
    pass "$skill: Frontmatter name matches directory name"
  else
    fail "$skill: Frontmatter name does not match '$skill'"
  fi

  # Description check
  if grep -q "^description: .*" "$skill_file"; then
    pass "$skill: Frontmatter contains description"
  else
    fail "$skill: Missing frontmatter description"
  fi
done

echo ""
echo "--- 3. Verifying Absence of Legacy Direct Markdown I/O and Paths ---"
LEGACY_PATTERNS=(
  "Job Search/Resume/"
  "Job Search/pipeline/"
  "target-companies.md"
  "target-job-titles-and-skills.md"
  "references/scoring-rubric.md"
  "job-candidates.md"
)

for skill in "${EXPECTED_SKILLS[@]}"; do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ ! -f "$skill_file" ]; then
    continue
  fi

  # We allow pipeline-diagram to mention templates or historical docs in introspection text,
  # but operational skills should not reference direct markdown file paths for their data I/O.
  if [ "$skill" != "pipeline-diagram" ]; then
    has_legacy=0
    for pat in "${LEGACY_PATTERNS[@]}"; do
      if grep -Fq "$pat" "$skill_file"; then
        fail "$skill: Contains legacy reference '$pat'"
        has_legacy=1
      fi
    done
    if [ $has_legacy -eq 0 ]; then
      pass "$skill: Clean of legacy file paths"
    fi
  fi
done

echo ""
echo "--- 4. Verifying MCP Tool Wiring ---"

# lead-gen: get_batch, log_run, get_candidates
if grep -q "get_batch" "$SKILLS_DIR/job-search-lead-gen/SKILL.md" && \
   grep -q "log_run" "$SKILLS_DIR/job-search-lead-gen/SKILL.md" && \
   grep -q "get_candidates" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Wires get_batch, log_run, get_candidates"
else
  fail "job-search-lead-gen: Missing expected MCP tools"
fi

# crawl: list_title_patterns, check_url_exists, add_to_queue
if grep -q "list_title_patterns" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -q "check_url_exists" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -q "add_to_queue" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Wires list_title_patterns, check_url_exists, add_to_queue"
else
  fail "job-search-crawl: Missing expected MCP tools"
fi

# assess: get_scoring_rubric, get_pending_queue, add_candidate, update_queue_status, list_skills
if grep -q "get_scoring_rubric" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -q "get_pending_queue" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -q "add_candidate" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -q "update_queue_status" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -q "list_skills" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Wires get_scoring_rubric, get_pending_queue, add_candidate, update_queue_status, list_skills"
else
  fail "job-search-assess: Missing expected MCP tools"
fi

# company-search: list_companies, add_company, list_title_patterns
if grep -q "list_companies" "$SKILLS_DIR/company-search/SKILL.md" && \
   grep -q "add_company" "$SKILLS_DIR/company-search/SKILL.md" && \
   grep -q "list_title_patterns" "$SKILLS_DIR/company-search/SKILL.md"; then
  pass "company-search: Wires list_companies, add_company, list_title_patterns"
else
  fail "company-search: Missing expected MCP tools"
fi

# title-discovery: list_title_patterns, add_title_pattern, list_skills
if grep -q "list_title_patterns" "$SKILLS_DIR/title-discovery/SKILL.md" && \
   grep -q "add_title_pattern" "$SKILLS_DIR/title-discovery/SKILL.md" && \
   grep -q "list_skills" "$SKILLS_DIR/title-discovery/SKILL.md"; then
  pass "title-discovery: Wires list_title_patterns, add_title_pattern, list_skills"
else
  fail "title-discovery: Missing expected MCP tools"
fi

echo ""
echo "--- 5. Verifying Crawler Script Deduplication ---"
if [ -f "$SCRIPTS_DIR/crawl-job-board.js" ]; then
  pass "Shared crawler exists at scripts/crawl-job-board.js"
else
  fail "Missing scripts/crawl-job-board.js"
fi

# Ensure no duplicates in skills directory
DUP_COUNT=$(find "$SKILLS_DIR" -name "crawl-job-board.js" | wc -l | tr -d ' ')
if [ "$DUP_COUNT" -eq 0 ]; then
  pass "No duplicate crawler scripts in skills directory"
else
  fail "Found $DUP_COUNT duplicate crawler scripts in skills directory"
fi

# Verify crawler reference in crawl skill
if grep -q "scripts/crawl-job-board.js" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl references shared scripts/crawl-job-board.js"
else
  fail "job-search-crawl does not reference shared crawler path"
fi

echo ""
echo "--- 6. Verifying Conventional Resume Path & Error Handling ---"
RESUME_SKILLS=("job-search-lead-gen" "job-search-assess" "company-search" "title-discovery")
for skill in "${RESUME_SKILLS[@]}"; do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if grep -q "\.job-search/resume\.pdf" "$skill_file"; then
    pass "$skill: References conventional .job-search/resume.pdf"
  else
    fail "$skill: Missing conventional .job-search/resume.pdf reference"
  fi

  if grep -qi "resume file not found" "$skill_file"; then
    pass "$skill: Defines clear error message when resume is missing"
  else
    fail "$skill: Missing diagnostic error message for missing resume"
  fi
done

echo ""
echo "--- 7. Verifying Pipeline Overview Diagram Template ---"
TEMPLATE_FILE="$TEMPLATES_DIR/pipeline-overview.md"
if [ -f "$TEMPLATE_FILE" ]; then
  pass "Template templates/pipeline-overview.md exists"
else
  fail "Missing templates/pipeline-overview.md"
fi

MERMAID_COUNT=$(grep -c '```mermaid' "$TEMPLATE_FILE" || true)
if [ "$MERMAID_COUNT" -ge 5 ]; then
  pass "pipeline-overview.md contains all required Mermaid diagrams ($MERMAID_COUNT found)"
else
  fail "pipeline-overview.md contains only $MERMAID_COUNT Mermaid diagrams (expected >= 5)"
fi

echo ""
echo "--- 8. Verifying Flat Intermediate Storage and Cleanup (PRO-32) ---"

# crawl: references .job-search/tmp/, avoids nested company-slug subdirectories, documents cleanup
if grep -q "\.job-search/tmp" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: References .job-search/tmp"
else
  fail "job-search-crawl: Missing .job-search/tmp reference"
fi

if ! grep -q "\.job-search/tmp/<company-slug>/" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Uses flat .job-search/tmp without nested subdirectories"
else
  fail "job-search-crawl: Contains nested .job-search/tmp/<company-slug>/ reference"
fi

if grep -qi "clean up" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Defines intermediate file cleanup"
else
  fail "job-search-crawl: Missing intermediate file cleanup directive"
fi

# assess: references .job-search/tmp/, avoids nested company-slug subdirectories, documents cleanup
if grep -q "\.job-search/tmp" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: References .job-search/tmp"
else
  fail "job-search-assess: Missing .job-search/tmp reference"
fi

if ! grep -q "\.job-search/tmp/<company-slug>/" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Uses flat .job-search/tmp without nested subdirectories"
else
  fail "job-search-assess: Contains nested .job-search/tmp/<company-slug>/ reference"
fi

if grep -qi "clean up" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Defines intermediate file cleanup"
else
  fail "job-search-assess: Missing intermediate file cleanup directive"
fi

# lead-gen: avoids nested company-slug subdirectories in tmp
if ! grep -q "\.job-search/tmp/<company-slug>/" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Uses flat .job-search/tmp without nested subdirectories"
else
  fail "job-search-lead-gen: Contains nested .job-search/tmp/<company-slug>/ reference"
fi

# CLAUDE.md: documents intermediate crawl data rules
if grep -q "\.job-search/tmp" "$PLUGIN_ROOT/CLAUDE.md" && grep -qi "Intermediate Crawl Data" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents intermediate crawl data rules and .job-search/tmp/ usage"
else
  fail "CLAUDE.md: Missing intermediate crawl data guidance"
fi

echo ""
echo "--- 9. Verifying Scheduled Task Bounded Scoping & Cost Control (PRO-33) ---"

# crawl: eliminates mandatory websearch cross-referencing and forbids browser automation
if ! grep -qi "always cross-reference with websearch regardless" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Eliminates mandatory redundant WebSearch cross-referencing"
else
  fail "job-search-crawl: Still contains mandatory WebSearch cross-referencing"
fi

if grep -qi "NEVER use interactive browser tools" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Forbids interactive browser tools during unattended crawls"
else
  fail "job-search-crawl: Missing interactive browser prohibition"
fi

# assess: enforces bounded pending queue batch size and fast failure without browser tools
if grep -qi "at most 5 pending postings" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Caps pending queue assessment batch size"
else
  fail "job-search-assess: Missing pending queue batch cap"
fi

if grep -qi "NEVER use interactive browser tools" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Forbids interactive browser tools during unattended assessments"
else
  fail "job-search-assess: Missing interactive browser prohibition"
fi

if grep -qi "Fast failure" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Defines fast failure on unreachable or redirected URLs"
else
  fail "job-search-assess: Missing fast failure directive"
fi

# lead-gen: specifies message budget and bounded batch execution
if grep -qi "40–50 messages" "$SKILLS_DIR/job-search-lead-gen/SKILL.md" || grep -qi "40-50 messages" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Documents message budget for batch runs"
else
  fail "job-search-lead-gen: Missing message budget in rules"
fi

# CLAUDE.md: documents scheduled & unattended execution guidelines
if grep -qi "Scheduled & Unattended Execution Guidelines" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents Scheduled & Unattended Execution Guidelines"
else
  fail "CLAUDE.md: Missing Scheduled & Unattended Execution Guidelines section"
fi

# --- 10. Verifying Candidate Status Ownership & Disposition Guardrails (PRO-38) ---
echo -e "\n--- 10. Verifying Candidate Status Ownership & Disposition Guardrails (PRO-38) ---"

# job-search-assess: forbids auto-disposition and designates disposition as user decision
if grep -qi "Candidate disposition is strictly a user decision" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Explicitly designates candidate disposition as a user decision"
else
  fail "job-search-assess: Missing candidate disposition user decision rule"
fi

if grep -qiE 'Never set (`status`|status) to anything other than' "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Forbids setting status to anything other than new"
else
  fail "job-search-assess: Missing rule forbidding status other than new"
fi

# job-search-lead-gen: clarifies candidate status ownership
if grep -qi "Candidate disposition is strictly a user decision" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Reinforces candidate disposition as user decision"
else
  fail "job-search-lead-gen: Missing candidate disposition rule"
fi

# CLAUDE.md: documents candidate status ownership
if grep -qi "Candidate Status Ownership & Human-in-the-Loop Disposition" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents Candidate Status Ownership & Human-in-the-Loop Disposition"
else
  fail "CLAUDE.md: Missing Candidate Status Ownership rule in CLAUDE.md"
fi

echo ""
echo "--- 11. Verifying SPA Placeholder Early Detection & Circuit Breaker Prevention (PRO-62) ---"

# job-search-assess: verifies circuit breaker prevention directive
if grep -qi "Never repeat \`WebFetch\` calls" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Contains circuit breaker prevention directive"
else
  fail "job-search-assess: Missing circuit breaker prevention directive"
fi

# job-search-assess: documents --posting flag for crawler
if grep -qi "\-\-posting" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Documents crawler --posting flag"
else
  fail "job-search-assess: Missing --posting flag in assessment skill"
fi

# job-search-crawl: documents Ashby public API
if grep -qi "posting-api/job-board" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Documents Ashby public API endpoint"
else
  fail "job-search-crawl: Missing Ashby public API endpoint documentation"
fi

# CLAUDE.md: documents circuit breaker prevention and ATS fallback
if grep -qi "Circuit Breaker Prevention" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents circuit breaker prevention"
else
  fail "CLAUDE.md: Missing circuit breaker prevention in CLAUDE.md"
fi

echo ""
echo "--- 12. Verifying Per-Company Error Isolation & Batch Resilience (PRO-63) ---"

# lead-gen: per-company error isolation boundary
if grep -qi "Per-Company Error Isolation Boundary" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Defines Per-Company Error Isolation Boundary"
else
  fail "job-search-lead-gen: Missing Per-Company Error Isolation Boundary"
fi

# lead-gen: wires update_company_crawl_status on failure
if grep -qi "update_company_crawl_status" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Wires update_company_crawl_status for failure tracking"
else
  fail "job-search-lead-gen: Missing update_company_crawl_status in lead-gen skill"
fi

# lead-gen: batch completion summary records succeeded and failed breakdowns
if grep -qi "M/N succeeded, K failed" "$SKILLS_DIR/job-search-lead-gen/SKILL.md" && \
   grep -qi "\"failed\":" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Summarizes succeeded and failed breakdowns on completion"
else
  fail "job-search-lead-gen: Missing succeeded and failed breakdown in batch summary"
fi

# crawl: documents batch crawl mode with per-company error isolation
if grep -qi "Batch Crawl Mode" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Documents Batch Crawl Mode"
else
  fail "job-search-crawl: Missing Batch Crawl Mode in crawl skill"
fi

# crawl: wires update_company_crawl_status on failure
if grep -qi "update_company_crawl_status" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Wires update_company_crawl_status for batch error logging"
else
  fail "job-search-crawl: Missing update_company_crawl_status in crawl skill"
fi

# CLAUDE.md: documents per-company error isolation & batch resilience
if grep -qi "Per-Company Error Isolation & Batch Resilience" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents Per-Company Error Isolation & Batch Resilience"
else
  fail "CLAUDE.md: Missing Per-Company Error Isolation & Batch Resilience in CLAUDE.md"
fi

# AGENTS.md: documents per-company error isolation & batch resilience
if grep -qi "Per-Company Error Isolation & Batch Resilience" "$PLUGIN_ROOT/AGENTS.md"; then
  pass "AGENTS.md: Documents Per-Company Error Isolation & Batch Resilience"
else
  fail "AGENTS.md: Missing Per-Company Error Isolation & Batch Resilience in AGENTS.md"
fi

echo ""
echo "--- 13. Verifying Search Fallback Rate Limiting & Query Pacing (PRO-64) ---"

# crawl: verifies search fallback query budget
if grep -qi "Search Fallback Query Pacing & Rate Limit Guardrails" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "Query Budget" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "1 targeted query per company" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Defines search fallback query budget (max 1 per company)"
else
  fail "job-search-crawl: Missing search fallback query budget"
fi

# crawl: verifies rate limit detection and anti-retry rule
if grep -qi "DuckDuckGo is rate-limiting this machine" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "Zero-Retry Rule" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Contains rate limit detection and zero-retry rule"
else
  fail "job-search-crawl: Missing rate limit detection or zero-retry rule"
fi

# lead-gen: verifies batch search circuit breaker
if grep -qi "BATCH SEARCH CIRCUIT BREAKER" "$SKILLS_DIR/job-search-lead-gen/SKILL.md" && \
   grep -qi "disable the search fallback path" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Defines Batch Search Circuit Breaker"
else
  fail "job-search-lead-gen: Missing Batch Search Circuit Breaker"
fi

# CLAUDE.md: includes rate_limited in failure taxonomy
if grep -qi "rate_limited" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Includes rate_limited in failure taxonomy"
else
  fail "CLAUDE.md: Missing rate_limited in failure taxonomy"
fi

# AGENTS.md: includes rate_limited in failure taxonomy
if grep -qi "rate_limited" "$PLUGIN_ROOT/AGENTS.md"; then
  pass "AGENTS.md: Includes rate_limited in failure taxonomy"
else
  fail "AGENTS.md: Missing rate_limited in failure taxonomy"
fi

echo ""
echo "--- 14. Verifying Known ATS Public API Patterns & Ashby 401 Prevention (PRO-65) ---"

# crawl: documents Ashby public board API and warns against authenticated /posting-api/job/ 401
if grep -qi "posting-api/job-board" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "posting-api/job/" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "401 Unauthorized" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Documents Ashby public board API and warns against /posting-api/job/ 401"
else
  fail "job-search-crawl: Missing Ashby public board API or 401 warning in crawl skill"
fi

# crawl: documents known ATS-specific public API patterns upfront
if grep -qi "Known ATS-Specific Public API Patterns" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "boards-api.greenhouse.io" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -qi "api.lever.co" "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Documents known ATS public API patterns (Ashby, Greenhouse, Lever)"
else
  fail "job-search-crawl: Missing known ATS public API patterns in crawl skill"
fi

# assess: warns against Ashby /posting-api/job/ 401
if grep -qi "posting-api/job/" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -qi "401 Unauthorized" "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Documents Ashby 401 Unauthorized prevention"
else
  fail "job-search-assess: Missing Ashby 401 Unauthorized prevention in assess skill"
fi

# CLAUDE.md: documents Ashby public board API and warns against 401
if grep -qi "posting-api/job-board" "$PLUGIN_ROOT/CLAUDE.md" && \
   grep -qi "401 Unauthorized" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents Ashby public board API and 401 Unauthorized warning"
else
  fail "CLAUDE.md: Missing Ashby public board API or 401 warning in CLAUDE.md"
fi

# AGENTS.md: documents Ashby public board API and warns against 401
if grep -qi "posting-api/job-board" "$PLUGIN_ROOT/AGENTS.md" && \
   grep -qi "401 Unauthorized" "$PLUGIN_ROOT/AGENTS.md"; then
  pass "AGENTS.md: Documents Ashby public board API and 401 Unauthorized warning"
else
  fail "AGENTS.md: Missing Ashby public board API or 401 warning in AGENTS.md"
fi

echo ""
echo "--- 16. Verifying ATS Platform Pre-Tagging Documentation (PRO-66) ---"

# crawl: documents upfront ats_platform checking and add_to_queue ats_platform parameter
if grep -qi "ats_platform" "$SKILLS_DIR/job-search-crawl/SKILL.md" && \
   grep -q '"ats_platform":' "$SKILLS_DIR/job-search-crawl/SKILL.md"; then
  pass "job-search-crawl: Documents upfront ats_platform checking and add_to_queue parameter"
else
  fail "job-search-crawl: Missing ats_platform documentation in crawl skill"
fi

# assess: documents upfront ats_platform inspection before fetch
if grep -qi "ats_platform" "$SKILLS_DIR/job-search-assess/SKILL.md" && \
   grep -qi 'ats_platform === "ashby"' "$SKILLS_DIR/job-search-assess/SKILL.md"; then
  pass "job-search-assess: Documents upfront ats_platform strategy dispatch"
else
  fail "job-search-assess: Missing ats_platform strategy dispatch in assess skill"
fi

# company-search: documents ats_platform in add_company
if grep -qi "ats_platform" "$SKILLS_DIR/company-search/SKILL.md"; then
  pass "company-search: Documents ats_platform in add_company"
else
  fail "company-search: Missing ats_platform in company-search skill"
fi

# lead-gen: documents ats_platform in crawl and assess phases
if grep -qi "ats_platform" "$SKILLS_DIR/job-search-lead-gen/SKILL.md"; then
  pass "job-search-lead-gen: Documents ats_platform in orchestrator phases"
else
  fail "job-search-lead-gen: Missing ats_platform in lead-gen skill"
fi

# CLAUDE.md & AGENTS.md: document ATS Platform Pre-Tagging Architecture
if grep -qi "ATS Platform Pre-Tagging Architecture (PRO-66)" "$PLUGIN_ROOT/CLAUDE.md"; then
  pass "CLAUDE.md: Documents ATS Platform Pre-Tagging Architecture"
else
  fail "CLAUDE.md: Missing ATS Platform Pre-Tagging Architecture"
fi

if grep -qi "ATS Platform Pre-Tagging Architecture (PRO-66)" "$PLUGIN_ROOT/AGENTS.md"; then
  pass "AGENTS.md: Documents ATS Platform Pre-Tagging Architecture"
else
  fail "AGENTS.md: Missing ATS Platform Pre-Tagging Architecture"
fi

echo ""
echo "=================================================="
echo "Results: $PASSED passed, $FAILED failed"
echo "=================================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
