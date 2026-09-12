#!/usr/bin/env bash

# ==============================================================================
# tests/setup.test.sh - Automated Integration & Unit Tests for Setup Subsystem
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

assert_dir_exists() {
  local dir="$1"
  local test_name="$2"
  if [ -d "$dir" ]; then
    echo -e "  ${GREEN}✓${RESET} $test_name"
    TEST_PASSED=$((TEST_PASSED + 1))
  else
    echo -e "  ${RED}✗${RESET} $test_name (Directory not found: $dir)"
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
    echo -e "  ${RED}✗${RESET} $test_name (Substring not found: '$needle')"
    TEST_FAILED=$((TEST_FAILED + 1))
  fi
}

echo -e "${CYAN}${BOLD}=== Running Setup & Configuration Test Suite ===${RESET}\n"

# Create isolated test environment
TMP_TEST_DIR="$(mktemp -d -t job_search_test_XXXXXX)"
trap "rm -rf '$TMP_TEST_DIR'" EXIT

TMP_CONFIG_DIR="$TMP_TEST_DIR/config"
TMP_CONFIG_FILE="$TMP_CONFIG_DIR/config.json"
TMP_WDP="$TMP_TEST_DIR/share/job-search-automation"

FIXTURE_RESUME="$ROOT_DIR/tests/fixtures/sample-resume.pdf"
FIXTURE_RESUME_V2="$ROOT_DIR/tests/fixtures/sample-resume-v2.pdf"
FIXTURE_RESUME_TXT="$ROOT_DIR/tests/fixtures/sample-resume.txt"
FIXTURE_VAULT="$ROOT_DIR/tests/fixtures/legacy-vault"

# ------------------------------------------------------------------------------
# Test 1: Help flag
# ------------------------------------------------------------------------------
echo -e "${BOLD}[Test 1] setup.sh --help${RESET}"
HELP_OUTPUT="$("$ROOT_DIR/setup.sh" --help)"
assert_contains "$HELP_OUTPUT" "Usage: ./setup.sh" "Displays usage instructions"
assert_contains "$HELP_OUTPUT" "--update-resume" "Documents --update-resume flag"

# ------------------------------------------------------------------------------
# Test 2: Update resume when unconfigured fails cleanly
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 2] setup.sh --update-resume without prior setup${RESET}"
set +e
ERR_OUTPUT="$("$ROOT_DIR/setup.sh" --update-resume "$FIXTURE_RESUME" --config-path "$TMP_CONFIG_FILE" 2>&1)"
STATUS=$?
set -e
assert_equals "1" "$STATUS" "Exits with code 1 when config missing"
assert_contains "$ERR_OUTPUT" "Plugin configuration not found" "Emits clear configuration missing error"

# ------------------------------------------------------------------------------
# Test 3: Update resume with nonexistent source file fails cleanly
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 3] setup.sh --update-resume with missing file${RESET}"
set +e
ERR_OUTPUT="$("$ROOT_DIR/setup.sh" --update-resume "$TMP_TEST_DIR/nonexistent.pdf" --config-path "$TMP_CONFIG_FILE" 2>&1)"
STATUS=$?
set -e
assert_equals "1" "$STATUS" "Exits with code 1 when resume file missing"
assert_contains "$ERR_OUTPUT" "Resume file not found" "Emits clear file not found error"

# ------------------------------------------------------------------------------
# Test 4: Local Mode automated non-interactive setup
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 4] Non-interactive Local Mode Setup${RESET}"
SETUP_OUT="$("$ROOT_DIR/setup.sh" \
  --mode local \
  --resume "$FIXTURE_RESUME" \
  --workflow-data-path "$TMP_WDP" \
  --config-path "$TMP_CONFIG_FILE" \
  -y)"

assert_file_exists "$TMP_CONFIG_FILE" "Config file created"
assert_file_exists "$TMP_WDP/resume.pdf" "Resume copied to conventional location"

# Verify resume content matches v1
CMP_DIFF="$(diff "$FIXTURE_RESUME" "$TMP_WDP/resume.pdf" || true)"
assert_equals "" "$CMP_DIFF" "Resume contents identical to v1 fixture"

# Verify all 6 markdown templates scaffolded
TEMPLATES=(
  "target-companies.md"
  "target-job-titles-and-skills.md"
  "scoring-rubric.md"
  "crawl-queue.md"
  "job-candidates.md"
  "logs.md"
)
for t in "${TEMPLATES[@]}"; do
  assert_file_exists "$TMP_WDP/$t" "Template $t scaffolded"
done

# Verify file permissions
CONFIG_PERM="$(stat -f "%Lp" "$TMP_CONFIG_FILE" 2>/dev/null || stat -c "%a" "$TMP_CONFIG_FILE" 2>/dev/null)"
assert_equals "600" "$CONFIG_PERM" "Config file permissions are 0600 (rw-------)"

# Verify JSON contents
CFG_MODE="$(grep '"mode"' "$TMP_CONFIG_FILE" | sed -E 's/.*"mode":[[:space:]]*"([^"]+)".*/\1/')"
CFG_WDP="$(grep '"workflowDataPath"' "$TMP_CONFIG_FILE" | sed -E 's/.*"workflowDataPath":[[:space:]]*"([^"]+)".*/\1/')"
assert_equals "local" "$CFG_MODE" "Config mode is local"
assert_equals "$TMP_WDP" "$CFG_WDP" "Config workflowDataPath matches"

# ------------------------------------------------------------------------------
# Test 5: Fast-Path Resume Updater
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 5] Fast-Path Resume Updater (--update-resume)${RESET}"
OLD_TIMESTAMP="$(grep '"updatedAt"' "$TMP_CONFIG_FILE" | sed -E 's/.*"updatedAt":[[:space:]]*"([^"]+)".*/\1/')"
sleep 1
UPDATE_OUT="$("$ROOT_DIR/setup.sh" --update-resume "$FIXTURE_RESUME_V2" --config-path "$TMP_CONFIG_FILE")"

assert_contains "$UPDATE_OUT" "Resume successfully updated" "Update output confirms success"
CMP_V2_DIFF="$(diff "$FIXTURE_RESUME_V2" "$TMP_WDP/resume.pdf" || true)"
assert_equals "" "$CMP_V2_DIFF" "Resume contents identical to v2 fixture"

NEW_TIMESTAMP="$(grep '"updatedAt"' "$TMP_CONFIG_FILE" | sed -E 's/.*"updatedAt":[[:space:]]*"([^"]+)".*/\1/')"
if [ "$OLD_TIMESTAMP" != "$NEW_TIMESTAMP" ]; then
  echo -e "  ${GREEN}✓${RESET} Config updatedAt was refreshed on resume update"
  TEST_PASSED=$((TEST_PASSED + 1))
else
  echo -e "  ${RED}✗${RESET} Config updatedAt was not refreshed"
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ------------------------------------------------------------------------------
# Test 6: Non-PDF resume warning
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 6] Non-PDF Resume Warning Handling${RESET}"
WARN_OUT="$("$ROOT_DIR/setup.sh" --update-resume "$FIXTURE_RESUME_TXT" --config-path "$TMP_CONFIG_FILE")"
assert_contains "$WARN_OUT" "WARNING" "Outputs warning for non-PDF resume"
assert_contains "$WARN_OUT" "Resume successfully updated" "Allows copy to resume.pdf despite non-PDF extension"

# ------------------------------------------------------------------------------
# Test 7: Neon Mode Setup (Mocked verification)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 7] Neon Mode Automated Setup (Mock Mode)${RESET}"
TMP_NEON_CONFIG="$TMP_CONFIG_DIR/neon-config.json"
TMP_NEON_WDP="$TMP_TEST_DIR/neon-share"
NEON_OUT="$("$ROOT_DIR/setup.sh" \
  --mode neon \
  --resume "$FIXTURE_RESUME" \
  --workflow-data-path "$TMP_NEON_WDP" \
  --config-path "$TMP_NEON_CONFIG" \
  --mock \
  -y)"

assert_file_exists "$TMP_NEON_CONFIG" "Neon config file created"
NEON_MODE="$(grep '"mode"' "$TMP_NEON_CONFIG" | sed -E 's/.*"mode":[[:space:]]*"([^"]+)".*/\1/')"
assert_equals "neon" "$NEON_MODE" "Config mode is neon"
assert_contains "$NEON_OUT" "Neon database initialized and seeded successfully" "Neon init script ran and seeded rubric"

# ------------------------------------------------------------------------------
# Test 8: Legacy Markdown Migration Utility
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 8] Legacy Markdown Migration Engine${RESET}"
MIGRATION_TARGET="$TMP_TEST_DIR/migration-target"
MIGRATE_OUT="$(node "$ROOT_DIR/scripts/migrate.js" \
  --source "$FIXTURE_VAULT" \
  --mode local \
  --workflow-data-path "$MIGRATION_TARGET")"

assert_contains "$MIGRATE_OUT" "=== Migration Summary ===" "Outputs formatted migration summary table"
assert_contains "$MIGRATE_OUT" "Companies" "Migrated companies"
assert_contains "$MIGRATE_OUT" "Title Patterns" "Migrated title patterns"
assert_contains "$MIGRATE_OUT" "Skills" "Migrated skills"
assert_contains "$MIGRATE_OUT" "Rubric Dimensions" "Migrated rubric dimensions"
assert_contains "$MIGRATE_OUT" "Crawl Queue" "Migrated crawl queue"
assert_contains "$MIGRATE_OUT" "Candidates" "Migrated candidates"
assert_contains "$MIGRATE_OUT" "Run Logs" "Migrated run logs"

# Check target company file was populated
assert_file_exists "$MIGRATION_TARGET/target-companies.md" "Target companies markdown created"
assert_contains "$(cat "$MIGRATION_TARGET/target-companies.md")" "Stripe" "Migrated Stripe into target companies"
assert_contains "$(cat "$MIGRATION_TARGET/target-companies.md")" "OpenAI" "Migrated OpenAI into target companies"

# Check candidates file was populated
assert_file_exists "$MIGRATION_TARGET/job-candidates.md" "Target candidates markdown created"
assert_contains "$(cat "$MIGRATION_TARGET/job-candidates.md")" "Staff Backend Engineer" "Migrated candidate into candidates file"

# ------------------------------------------------------------------------------
# Test 9: Selected-Directory .job-search/ SQLite Setup & Fast-Path Update (PRO-27)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 9] Selected-Directory .job-search/ SQLite Setup (PRO-27)${RESET}"
PROJECT_DIR="$TMP_TEST_DIR/project-workspace"
mkdir -p "$PROJECT_DIR"

SETUP_DIR_OUT="$("$ROOT_DIR/setup.sh" \
  --directory "$PROJECT_DIR" \
  --resume "$FIXTURE_RESUME" \
  -y)"

assert_file_exists "$PROJECT_DIR/.job-search/config.json" ".job-search/config.json created in project directory"
assert_file_exists "$PROJECT_DIR/.job-search/job-search.sqlite" ".job-search/job-search.sqlite created"
assert_file_exists "$PROJECT_DIR/.job-search/resume.pdf" ".job-search/resume.pdf created"
assert_file_exists "$PROJECT_DIR/.job-search/.gitignore" ".job-search/.gitignore created"
assert_dir_exists "$PROJECT_DIR/.job-search/tmp" ".job-search/tmp directory created (PRO-32)"
assert_file_exists "$PROJECT_DIR/.claude/plugins/job-search-automation/CLAUDE.md" "CLAUDE.md installed in plugin directory (PRO-31)"

# Verify .claude/launch.json and .claude/settings.json created (PRO-30, PRO-32)
assert_file_exists "$PROJECT_DIR/.claude/launch.json" ".claude/launch.json created in project directory"
LAUNCH_JSON_VALID="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$PROJECT_DIR/.claude/launch.json', 'utf-8'));
const entry = cfg.configurations && cfg.configurations.find(c => c.name === 'job-search-ui');
if (!entry) { console.log('MISSING_ENTRY'); process.exit(0); }
const hasStart = entry.runtimeArgs && entry.runtimeArgs.includes('start') && !entry.runtimeArgs.includes('dev');
const hasPrefix = entry.runtimeArgs && entry.runtimeArgs.includes('--prefix') && entry.runtimeArgs.some(a => a.includes('.claude/plugins/job-search-automation/packages/job-search-ui'));
const portMatch = entry.port === 3847;
if (hasStart && hasPrefix && portMatch) {
  console.log('VALID');
} else {
  console.log('INVALID: ' + JSON.stringify(entry));
}
")"
assert_equals "VALID" "$LAUNCH_JSON_VALID" ".claude/launch.json contains job-search-ui configuration with start script and port 3847"

assert_file_exists "$PROJECT_DIR/.claude/settings.json" ".claude/settings.json created with permissions"
SETTINGS_CONTENT="$(cat "$PROJECT_DIR/.claude/settings.json")"
assert_contains "$SETTINGS_CONTENT" "Bash(mkdir -p .job-search/tmp*)" ".claude/settings.json contains mkdir .job-search/tmp* permission (PRO-32)"
assert_contains "$SETTINGS_CONTENT" "Bash(rm -rf ./.job-search/tmp*)" ".claude/settings.json contains rm -rf ./.job-search/tmp* permission (PRO-32)"
assert_contains "$SETTINGS_CONTENT" "Bash(rm -rf .job-search/tmp*)" ".claude/settings.json contains rm -rf .job-search/tmp* permission (PRO-32)"
assert_contains "$SETTINGS_CONTENT" "Bash(rm -f ./.job-search/tmp/*)" ".claude/settings.json contains rm -f ./.job-search/tmp/* permission (PRO-32)"
assert_contains "$SETTINGS_CONTENT" "Bash(rm -f .job-search/tmp/*)" ".claude/settings.json contains rm -f .job-search/tmp/* permission (PRO-32)"

# Verify relative path configuration
CFG_DB_PATH="$(grep '"databasePath"' "$PROJECT_DIR/.job-search/config.json" | sed -E 's/.*"databasePath":[[:space:]]*"([^"]+)".*/\1/')"
CFG_RES_PATH="$(grep '"resumePath"' "$PROJECT_DIR/.job-search/config.json" | sed -E 's/.*"resumePath":[[:space:]]*"([^"]+)".*/\1/')"
assert_equals "./job-search.sqlite" "$CFG_DB_PATH" "config.json stores relative databasePath"
assert_equals "./resume.pdf" "$CFG_RES_PATH" "config.json stores relative resumePath"

# Verify SQLite database has seeded rubric
RUBRIC_COUNT="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PROJECT_DIR/.job-search/job-search.sqlite');
const count = db.prepare('SELECT COUNT(*) as count FROM scoring_rubric').get().count;
console.log(count);
db.close();
")"
assert_equals "4" "$RUBRIC_COUNT" "job-search.sqlite contains 4 seeded rubric dimensions"

# Test Fast-Path Resume Update using --directory
UPDATE_DIR_OUT="$("$ROOT_DIR/setup.sh" --update-resume "$FIXTURE_RESUME_V2" --directory "$PROJECT_DIR")"
assert_contains "$UPDATE_DIR_OUT" "Resume successfully updated" "Fast-path update succeeds with --directory"
CMP_DIR_RES_DIFF="$(diff "$FIXTURE_RESUME_V2" "$PROJECT_DIR/.job-search/resume.pdf" || true)"
assert_equals "" "$CMP_DIR_RES_DIFF" "Resume contents in .job-search/ updated to v2"

# Test SQLite migration into project workspace
MIGRATE_SQLITE_OUT="$(node "$ROOT_DIR/scripts/migrate.js" \
  --source "$FIXTURE_VAULT" \
  --directory "$PROJECT_DIR")"
assert_contains "$MIGRATE_SQLITE_OUT" "=== Migration Summary ===" "Outputs migration summary for SQLite target"

COMPANY_COUNT="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PROJECT_DIR/.job-search/job-search.sqlite');
const count = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
console.log(count);
db.close();
")"
if [ "$COMPANY_COUNT" -gt 0 ]; then
  echo -e "  ${GREEN}✓${RESET} Companies migrated directly into SQLite ($COMPANY_COUNT found)"
  TEST_PASSED=$((TEST_PASSED + 1))
else
  echo -e "  ${RED}✗${RESET} No companies migrated into SQLite"
  TEST_FAILED=$((TEST_FAILED + 1))
fi

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n=============================================================="
if [ "$TEST_FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}ALL TESTS PASSED! (${TEST_PASSED}/${TEST_PASSED})${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}TESTS FAILED: ${TEST_FAILED} failure(s), ${TEST_PASSED} passed.${RESET}"
  exit 1
fi
