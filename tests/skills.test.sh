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
  if grep -q "workflowDataPath/resume.pdf" "$skill_file"; then
    pass "$skill: References conventional workflowDataPath/resume.pdf"
  else
    fail "$skill: Missing conventional workflowDataPath/resume.pdf reference"
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
echo "=================================================="
echo "Results: $PASSED passed, $FAILED failed"
echo "=================================================="

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
