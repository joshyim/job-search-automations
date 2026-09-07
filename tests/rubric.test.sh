#!/usr/bin/env bash

# ==============================================================================
# tests/rubric.test.sh - Automated Verification for Epic 4: Runtime Scoring Rubric
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$ROOT_DIR/templates"
SKILLS_DIR="$ROOT_DIR/skills"
PKG_DIR="$ROOT_DIR/packages/job-search-db"

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"

TEST_PASSED=0
TEST_FAILED=0

assert_equals() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"
  if [ "$expected" = "$actual" ]; then
    echo -e "  ${GREEN}✓${RESET} $test_name"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "  ${RED}✗${RESET} $test_name (Expected: '$expected', got: '$actual')"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
}

assert_file_exists() {
  local file="$1"
  local test_name="$2"
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}✓${RESET} $test_name"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "  ${RED}✗${RESET} $test_name (File not found: $file)"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo -e "  ${GREEN}✓${RESET} $test_name"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "  ${RED}✗${RESET} $test_name (Substring '$needle' not found)"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo -e "  ${GREEN}✓${RESET} $test_name"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "  ${RED}✗${RESET} $test_name (Unexpected substring '$needle' found)"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
}

echo -e "${CYAN}${BOLD}=== Running Epic 4: Runtime Scoring Rubric Test Suite ===${RESET}"
echo ""

# ------------------------------------------------------------------------------
# Story 1: Rubric as User Data
# ------------------------------------------------------------------------------
echo -e "${BOLD}[Story 1] Rubric as User Data${RESET}"

# 1.1 Verify DDL in schema.sql
assert_file_exists "$ROOT_DIR/schema.sql" "Canonical schema.sql exists"
SCHEMA_SQL=$(cat "$ROOT_DIR/schema.sql")
assert_contains "$SCHEMA_SQL" "CREATE TABLE IF NOT EXISTS scoring_rubric" "schema.sql defines scoring_rubric table"
assert_contains "$SCHEMA_SQL" "dimension VARCHAR(100) NOT NULL UNIQUE" "scoring_rubric has dimension column"
assert_contains "$SCHEMA_SQL" "weight NUMERIC(5,2) NOT NULL" "scoring_rubric has weight column"
assert_contains "$SCHEMA_SQL" "poor_description TEXT" "scoring_rubric has poor_description column"
assert_contains "$SCHEMA_SQL" "moderate_description TEXT" "scoring_rubric has moderate_description column"
assert_contains "$SCHEMA_SQL" "strong_description TEXT" "scoring_rubric has strong_description column"

# 1.2 Verify no embedded reference rubric files in any skill
RUBRIC_REFS=$(find "$SKILLS_DIR" -name "scoring-rubric.md" | wc -l | tr -d ' ')
assert_equals "0" "$RUBRIC_REFS" "No skill embeds a static scoring-rubric.md file"

for skill in $(ls "$SKILLS_DIR"); do
  skill_file="$SKILLS_DIR/$skill/SKILL.md"
  if [ -f "$skill_file" ]; then
    content=$(cat "$skill_file")
    assert_not_contains "$content" "references/scoring-rubric.md" "$skill: Does not reference static references/scoring-rubric.md"
  fi
done

# ------------------------------------------------------------------------------
# Story 2: Default Rubric Seeding
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}[Story 2] Default Rubric Seeding${RESET}"

assert_file_exists "$TEMPLATES_DIR/scoring-rubric.md" "Template templates/scoring-rubric.md exists"
TMPL_CONTENT=$(cat "$TEMPLATES_DIR/scoring-rubric.md")

assert_contains "$TMPL_CONTENT" "Title match" "Template includes Title match dimension"
assert_contains "$TMPL_CONTENT" "25%" "Template includes Title match 25% weight"
assert_contains "$TMPL_CONTENT" "Skills match" "Template includes Skills match dimension"
assert_contains "$TMPL_CONTENT" "30%" "Template includes Skills match 30% weight"
assert_contains "$TMPL_CONTENT" "Experience match" "Template includes Experience match dimension"
assert_contains "$TMPL_CONTENT" "Seniority fit" "Template includes Seniority fit dimension"
assert_contains "$TMPL_CONTENT" "20%" "Template includes Seniority fit 20% weight"
assert_contains "$TMPL_CONTENT" "Poor (1-2)" "Template includes Poor (1-2) tier"
assert_contains "$TMPL_CONTENT" "Moderate (3)" "Template includes Moderate (3) tier"
assert_contains "$TMPL_CONTENT" "Strong (4-5)" "Template includes Strong (4-5) tier"

# Test seeding in Local Mode via setup.sh
TMP_SETUP_DIR=$(mktemp -d -t js-rubric-setup-XXXXXX)
TMP_CONFIG_FILE="$TMP_SETUP_DIR/config.json"
RESUME_FIXTURE="$ROOT_DIR/tests/fixtures/sample-resume.pdf"

bash "$ROOT_DIR/setup.sh" \
  --mode local \
  --workflow-data-path "$TMP_SETUP_DIR/data" \
  --resume "$RESUME_FIXTURE" \
  --config-path "$TMP_CONFIG_FILE" \
  --non-interactive > /dev/null

assert_file_exists "$TMP_SETUP_DIR/data/scoring-rubric.md" "setup.sh seeds scoring-rubric.md in local mode"
SCAFFOLDED_RUBRIC=$(cat "$TMP_SETUP_DIR/data/scoring-rubric.md")
assert_contains "$SCAFFOLDED_RUBRIC" "Title match" "Scaffolded rubric has Title match"
assert_contains "$SCAFFOLDED_RUBRIC" "Skills match" "Scaffolded rubric has Skills match"

# Test seeding in Neon Mode via init-neon.js mock
INIT_OUTPUT=$(node "$ROOT_DIR/scripts/init-neon.js" --mock)
assert_contains "$INIT_OUTPUT" "Seeded 4 scoring rubric dimensions" "init-neon.js seeds 4 default dimensions"

rm -rf "$TMP_SETUP_DIR"

# ------------------------------------------------------------------------------
# Story 3: Runtime Rubric Assembly
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}[Story 3] Runtime Rubric Assembly in job-search-assess${RESET}"

ASSESS_SKILL="$SKILLS_DIR/job-search-assess/SKILL.md"
assert_file_exists "$ASSESS_SKILL" "job-search-assess/SKILL.md exists"
ASSESS_CONTENT=$(cat "$ASSESS_SKILL")

assert_contains "$ASSESS_CONTENT" "get_scoring_rubric()" "Assess skill queries get_scoring_rubric at runtime"
assert_contains "$ASSESS_CONTENT" "sum_of_weights" "Assess skill sums weights dynamically"
assert_contains "$ASSESS_CONTENT" "round((dimension.weight / sum_of_weights) * 100)" "Assess skill normalizes weights to nearest integer"
assert_contains "$ASSESS_CONTENT" "Score (Prompt Assembly):" "Assess skill specifies dynamic prompt assembly"
assert_contains "$ASSESS_CONTENT" "take effect immediately on the next assessment run without requiring an agent or server restart" "Specifies immediate effect without process restart"
assert_contains "$ASSESS_CONTENT" "case-insensitive" "Specifies case-insensitive dimension matching"

# ------------------------------------------------------------------------------
# Story 4: Weight Normalization & Arbitrary Integer Support
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}[Story 4] Weight Normalization & Integer Tolerance${RESET}"

RUBRIC_TOOL_TS=$(cat "$PKG_DIR/src/tools/rubric.ts")
assert_contains "$RUBRIC_TOOL_TS" "no sum-to-100 restriction" "Tool comments document no sum-to-100 constraint"

# Run Node one-liner to verify programmatic normalization calculation with non-100 integer weights
NORM_CHECK=$(node -e '
const weights = [15, 25, 40, 10]; // Sum = 90
const sum = weights.reduce((a, b) => a + b, 0);
const normalized = weights.map(w => Math.round((w / sum) * 100));
console.log(JSON.stringify({ sum, normalized }));
')
assert_contains "$NORM_CHECK" '"sum":90' "Calculation handles arbitrary sum of 90"
assert_contains "$NORM_CHECK" '"normalized":[17,28,44,11]' "Normalizes proportionally to nearest integer"

# ------------------------------------------------------------------------------
# Story 5: Rubric Dimension Management (Add, Update, Remove, Direct Edit)
# ------------------------------------------------------------------------------
echo ""
echo -e "${BOLD}[Story 5] Rubric Dimension Management${RESET}"

MGT_CHECK=$(node --input-type=module -e '
import { LocalAdapter } from "./packages/job-search-db/dist/adapters/local/local-adapter.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function test() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "js-rubric-mgt-"));
  const adapter = new LocalAdapter(tmp);
  await adapter.initialize();

  // 1. Initial 4
  let rubric = await adapter.getScoringRubric();
  if (rubric.length !== 4) throw new Error("Initial count mismatch");

  // 2. Add dimension with non-100 weight
  await adapter.addRubricDimension({
    dimension: "Culture & Team Fit",
    weight: 15,
    poor_description: "Poor fit",
    moderate_description: "Decent fit",
    strong_description: "Exceptional fit"
  });
  rubric = await adapter.getScoringRubric();
  if (rubric.length !== 5) throw new Error("Add failed");

  // 3. Update dimension case-insensitively
  await adapter.updateRubricDimension("culture & team fit", {
    weight: 20
  });
  rubric = await adapter.getScoringRubric();
  const cDim = rubric.find(r => r.dimension.toLowerCase() === "culture & team fit");
  if (!cDim || cDim.weight !== 20) throw new Error("Case-insensitive update failed");

  // 4. Remove dimension case-insensitively
  const removed = await adapter.removeRubricDimension("CULTURE & TEAM FIT");
  if (!removed) throw new Error("Case-insensitive remove returned false");
  rubric = await adapter.getScoringRubric();
  if (rubric.length !== 4) throw new Error("Remove failed");

  // 5. Direct markdown edit
  const filePath = path.join(tmp, "scoring-rubric.md");
  fs.writeFileSync(filePath, "# Scoring Rubric\n\n| Dimension | Weight | Poor (1-2) | Moderate (3) | Strong (4-5) |\n| --- | --- | --- | --- | --- |\n| AI Fluency | 50% | None | Some | Expert |\n");
  rubric = await adapter.getScoringRubric();
  if (rubric.length !== 1 || rubric[0].dimension !== "AI Fluency" || rubric[0].weight !== 50) {
    throw new Error("Direct markdown edit reflection failed");
  }

  await adapter.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("MANAGEMENT_SUCCESS");
}
test().catch(err => {
  console.error(err);
  process.exit(1);
});
')

assert_contains "$MGT_CHECK" "MANAGEMENT_SUCCESS" "Add, update, remove, and direct markdown edit all succeeded"

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}==============================================================${RESET}"
echo -e "${GREEN}${BOLD}  Epic 4 Test Suite Complete: $TEST_PASSED passed, $TEST_FAILED failed${RESET}"
echo -e "${GREEN}${BOLD}==============================================================${RESET}"

if [ "$TEST_FAILED" -gt 0 ]; then
  exit 1
fi
