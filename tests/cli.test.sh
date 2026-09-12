#!/usr/bin/env bash

# ==============================================================================
# tests/cli.test.sh - Automated Integration Tests for CLI Subsystem (PRO-28)
#
# Validates:
#   - Zero symlinks created (strict Agent Plugins specification conformance)
#   - Self-contained .claude/plugins/job-search-automation directory
#   - Relative MCP configuration in .mcp.json
#   - Clean separation of user data in .job-search/
#   - Repeat setup / reinstall data preservation
#   - Fast-path resume updater
#   - Clean uninstallation
#   - setup.sh --install-to integration
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

pass() {
  echo -e "  ${GREEN}✓${RESET} $1"
  TEST_PASSED=$((TEST_PASSED + 1))
}

fail() {
  echo -e "  ${RED}✗${RESET} $1"
  TEST_FAILED=$((TEST_FAILED + 1))
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$test_name"
  else
    fail "$test_name (Expected: '$expected', got: '$actual')"
  fi
}

assert_file_exists() {
  local file="$1"
  local test_name="$2"
  if [ -f "$file" ]; then
    pass "$test_name"
  else
    fail "$test_name (File not found: $file)"
  fi
}

assert_dir_exists() {
  local dir="$1"
  local test_name="$2"
  if [ -d "$dir" ]; then
    pass "$test_name"
  else
    fail "$test_name (Directory not found: $dir)"
  fi
}

assert_file_not_exists() {
  local file="$1"
  local test_name="$2"
  if [ ! -e "$file" ]; then
    pass "$test_name"
  else
    fail "$test_name (Path unexpectedly exists: $file)"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$test_name"
  else
    fail "$test_name (Substring not found: '$needle')"
  fi
}

echo -e "${CYAN}${BOLD}=== Running CLI & Self-Contained Plugin Test Suite (PRO-28) ===${RESET}\n"

TMP_TEST_DIR="$(mktemp -d -t cli_plugin_test_XXXXXX)"
trap "rm -rf '$TMP_TEST_DIR'" EXIT

FIXTURE_RESUME="$ROOT_DIR/tests/fixtures/sample-resume.pdf"
FIXTURE_RESUME_V2="$ROOT_DIR/tests/fixtures/sample-resume-v2.pdf"

# ------------------------------------------------------------------------------
# Test 1: CLI Help and Version
# ------------------------------------------------------------------------------
echo -e "${BOLD}[Test 1] CLI invocation, --help, and --version${RESET}"
HELP_OUT="$("$ROOT_DIR/bin/cli.js" --help)"
assert_contains "$HELP_OUT" "Job Search Automation CLI" "Displays CLI banner"
assert_contains "$HELP_OUT" "setup" "Documents setup subcommand"
assert_contains "$HELP_OUT" "update-resume" "Documents update-resume subcommand"
assert_contains "$HELP_OUT" "uninstall" "Documents uninstall subcommand"

VER_OUT="$("$ROOT_DIR/bin/cli.js" --version)"
assert_equals "0.1.0" "$VER_OUT" "Reports correct version"

# ------------------------------------------------------------------------------
# Test 2: Clean Setup into Isolated Project Directory
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 2] Clean Setup into Isolated Project Workspace${RESET}"
PROJECT_DIR="$TMP_TEST_DIR/sample-project"
mkdir -p "$PROJECT_DIR"

SETUP_OUT="$("$ROOT_DIR/bin/cli.js" setup --directory "$PROJECT_DIR" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$SETUP_OUT" "Setup Complete!" "Setup reported completion"

PLUGIN_DIR="$PROJECT_DIR/.claude/plugins/job-search-automation"
assert_dir_exists "$PLUGIN_DIR" "Plugin installed in .claude/plugins/job-search-automation"
assert_file_exists "$PLUGIN_DIR/plugin.json" "plugin.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/mcp.json" "mcp.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/.mcp.json" ".mcp.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/schema.sql" "schema.sql exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/CLAUDE.md" "CLAUDE.md exists in installed plugin (PRO-31)"

# Skills verification (per Agent Plugins spec §6.1, §7.1)
assert_dir_exists "$PLUGIN_DIR/skills" "skills/ directory exists in installed plugin"
EXPECTED_SKILLS=("job-search-lead-gen" "job-search-crawl" "job-search-assess" "company-search" "title-discovery" "pipeline-diagram")
for skill in "${EXPECTED_SKILLS[@]}"; do
  assert_file_exists "$PLUGIN_DIR/skills/$skill/SKILL.md" "Skill '$skill/SKILL.md' exists in plugin"
done

# ZERO SYMLINKS Assertion
SKILLS_DIR="$PROJECT_DIR/.claude/skills"
if [ -d "$SKILLS_DIR" ]; then
  SYMLINK_COUNT=$(find "$SKILLS_DIR" -type l | wc -l | tr -d ' ')
  assert_equals "0" "$SYMLINK_COUNT" "ZERO symlinks created in .claude/skills/ (Agent Plugins spec)"
else
  pass "ZERO symlinks created (.claude/skills/ was not polluted with symlinks)"
fi

# Built packages verification
assert_file_exists "$PLUGIN_DIR/packages/job-search-db/dist/index.js" "job-search-db dist/index.js installed"
assert_file_exists "$PLUGIN_DIR/packages/job-search-db/scripts/start.js" "job-search-db scripts/start.js installed"
assert_file_exists "$PLUGIN_DIR/packages/job-search-ui/dist/server.js" "job-search-ui dist/server.js installed"
assert_file_exists "$PLUGIN_DIR/scripts/crawl-job-board.js" "Shared crawler installed"

# Exclusions verification (no development/git assets)
assert_file_not_exists "$PLUGIN_DIR/.git" "No .git directory copied"
assert_file_not_exists "$PLUGIN_DIR/tests" "No tests directory copied"
assert_file_not_exists "$PLUGIN_DIR/scripts/sync-public.sh" "No sync-public.sh copied"

# .mcp.json configuration verification
MCP_JSON="$PROJECT_DIR/.mcp.json"
assert_file_exists "$MCP_JSON" ".mcp.json created at project root"

RELATIVE_MCP_ARG="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$MCP_JSON', 'utf-8'));
console.log(cfg.mcpServers['job-search-db'].args[0]);
")"
assert_equals "./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js" "$RELATIVE_MCP_ARG" ".mcp.json uses relative path to launcher"

# .claude/launch.json and settings.json verification (PRO-30)
LAUNCH_JSON="$PROJECT_DIR/.claude/launch.json"
assert_file_exists "$LAUNCH_JSON" ".claude/launch.json created for web preview"
CLI_LAUNCH_VALID="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$LAUNCH_JSON', 'utf-8'));
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
assert_equals "VALID" "$CLI_LAUNCH_VALID" ".claude/launch.json uses start script and relative prefix"
assert_file_exists "$PROJECT_DIR/.claude/settings.json" ".claude/settings.json created for unattended runs"

# .job-search/ workspace verification
assert_dir_exists "$PROJECT_DIR/.job-search" ".job-search/ workspace created"
assert_file_exists "$PROJECT_DIR/.job-search/job-search.sqlite" "job-search.sqlite created"
assert_file_exists "$PROJECT_DIR/.job-search/resume.pdf" "resume.pdf installed"
assert_file_exists "$PROJECT_DIR/.job-search/config.json" "config.json created"
assert_file_exists "$PROJECT_DIR/.job-search/.gitignore" ".job-search/.gitignore created"

CONFIG_PERM="$(stat -f "%Lp" "$PROJECT_DIR/.job-search/config.json" 2>/dev/null || stat -c "%a" "$PROJECT_DIR/.job-search/config.json" 2>/dev/null)"
assert_equals "600" "$CONFIG_PERM" "config.json permissions are 0600"

RUBRIC_COUNT="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PROJECT_DIR/.job-search/job-search.sqlite');
console.log(db.prepare('SELECT COUNT(*) as cnt FROM scoring_rubric').get().cnt);
db.close();
")"
assert_equals "4" "$RUBRIC_COUNT" "Default scoring rubric initialized with 4 dimensions"

# ------------------------------------------------------------------------------
# Test 3: MCP Server Execution via Installed .mcp.json
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 3] MCP Server Execution via Installed Launcher${RESET}"
MCP_STDOUT="$TMP_TEST_DIR/mcp_stdout.log"
node -e "
const fs = require('fs');
const { spawn } = require('child_process');
const mcp = JSON.parse(fs.readFileSync('$MCP_JSON', 'utf-8'));
const srv = mcp.mcpServers['job-search-db'];

const child = spawn(srv.command, srv.args, {
  cwd: '$PROJECT_DIR',
  stdio: ['pipe', 'pipe', 'pipe']
});

let foundTools = false;
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line.trim());
      if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
        foundTools = true;
        child.kill('SIGTERM');
      }
    } catch {}
  }
});

const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'cli-test-client', version: '1.0.0' }
  }
}) + '\n';

const notifyReq = JSON.stringify({
  jsonrpc: '2.0',
  method: 'notifications/initialized'
}) + '\n';

const toolsReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
}) + '\n';

child.stdin.write(initReq);
child.stdin.write(notifyReq);
child.stdin.write(toolsReq);

child.on('exit', () => {
  if (foundTools) {
    process.exit(0);
  } else {
    console.error('Failed to list tools. Output:', buffer);
    process.exit(1);
  }
});

setTimeout(() => {
  child.kill('SIGKILL');
  process.exit(1);
}, 6000);
"
pass "Installed MCP server launches via relative path in .mcp.json and lists tools"

# ------------------------------------------------------------------------------
# Test 4: Repeat Setup / Reinstall Semantics (Preserve Existing Data)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 4] Repeat Setup / Reinstall Semantics${RESET}"
# Insert dummy company to verify data is NOT wiped
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PROJECT_DIR/.job-search/job-search.sqlite');
db.prepare('INSERT INTO companies (name, careers_url) VALUES (?, ?)').run('Anthropic', 'https://jobs.anthropic.com');
db.close();
"

# Re-run setup without --force
REINSTALL_OUT="$("$ROOT_DIR/bin/cli.js" setup --directory "$PROJECT_DIR" -y)"
assert_contains "$REINSTALL_OUT" "Existing SQLite database preserved" "Reinstall detected and preserved SQLite DB"
assert_contains "$REINSTALL_OUT" "Existing resume preserved" "Reinstall preserved existing resume"

COMPANY_FOUND="$(node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$PROJECT_DIR/.job-search/job-search.sqlite');
const res = db.prepare('SELECT name FROM companies WHERE name = ?').get('Anthropic');
console.log(res ? res.name : 'NONE');
db.close();
")"
assert_equals "Anthropic" "$COMPANY_FOUND" "Existing database records survived reinstall"

# ------------------------------------------------------------------------------
# Test 5: Fast-Path Resume Updater
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 5] Fast-Path Resume Updater (update-resume)${RESET}"
OLD_TS="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_DIR/.job-search/config.json')).updatedAt)")"
sleep 1

UPDATE_OUT="$("$ROOT_DIR/bin/cli.js" update-resume "$FIXTURE_RESUME_V2" --directory "$PROJECT_DIR")"
assert_contains "$UPDATE_OUT" "Resume successfully updated" "update-resume reported success"

DIFF_V2="$(diff "$FIXTURE_RESUME_V2" "$PROJECT_DIR/.job-search/resume.pdf" || true)"
assert_equals "" "$DIFF_V2" "resume.pdf contents updated to v2 fixture"

NEW_TS="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_DIR/.job-search/config.json')).updatedAt)")"
if [ "$OLD_TS" != "$NEW_TS" ]; then
  pass "config.json updatedAt refreshed on update-resume"
else
  fail "config.json updatedAt was not refreshed"
fi

# ------------------------------------------------------------------------------
# Test 6: Uninstallation
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 6] Plugin Uninstallation${RESET}"
UNINSTALL_OUT="$("$ROOT_DIR/bin/cli.js" uninstall --directory "$PROJECT_DIR")"
assert_contains "$UNINSTALL_OUT" "Uninstall complete" "Uninstall reported completion"

assert_file_not_exists "$PLUGIN_DIR" "Plugin directory removed"
assert_file_exists "$PROJECT_DIR/.job-search/job-search.sqlite" "User SQLite database preserved"
assert_file_exists "$PROJECT_DIR/.job-search/resume.pdf" "User resume preserved"

# Verify .mcp.json cleaned up
if [ -f "$MCP_JSON" ]; then
  HAS_MCP_SERVER="$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$MCP_JSON'));
  console.log(cfg.mcpServers && cfg.mcpServers['job-search-db'] ? 'YES' : 'NO');
  ")"
  assert_equals "NO" "$HAS_MCP_SERVER" "job-search-db removed from .mcp.json"
else
  pass ".mcp.json cleanly deleted as it was empty"
fi

# Verify .claude/launch.json cleaned up
if [ -f "$LAUNCH_JSON" ]; then
  HAS_LAUNCH_ENTRY="$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$LAUNCH_JSON'));
  console.log(cfg.configurations && cfg.configurations.some(c => c.name === 'job-search-ui') ? 'YES' : 'NO');
  ")"
  assert_equals "NO" "$HAS_LAUNCH_ENTRY" "job-search-ui removed from .claude/launch.json"
else
  pass ".claude/launch.json cleanly deleted as it was empty"
fi

# ------------------------------------------------------------------------------
# Test 7: setup.sh --install-to Integration
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 7] setup.sh --install-to Integration${RESET}"
CUSTOM_PLUGIN_DIR="$TMP_TEST_DIR/custom-plugin-dir"
CUSTOM_PROJECT_DIR="$TMP_TEST_DIR/custom-project"
mkdir -p "$CUSTOM_PROJECT_DIR"

SETUP_SH_OUT="$("$ROOT_DIR/setup.sh" --install-to "$CUSTOM_PLUGIN_DIR" --directory "$CUSTOM_PROJECT_DIR" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$SETUP_SH_OUT" "Setup Complete!" "setup.sh reported completion"
assert_dir_exists "$CUSTOM_PLUGIN_DIR" "Plugin installed to custom --install-to path"
assert_file_exists "$CUSTOM_PLUGIN_DIR/plugin.json" "plugin.json exists in custom install dir"
assert_file_exists "$CUSTOM_PLUGIN_DIR/CLAUDE.md" "CLAUDE.md exists in custom install dir (PRO-31)"
assert_file_exists "$CUSTOM_PLUGIN_DIR/skills/job-search-assess/SKILL.md" "Skills exist in custom install dir"
assert_file_exists "$CUSTOM_PROJECT_DIR/.mcp.json" ".mcp.json configured in project dir"

CUSTOM_MCP_ARG="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CUSTOM_PROJECT_DIR/.mcp.json', 'utf-8'));
console.log(cfg.mcpServers['job-search-db'].args[0]);
")"
assert_contains "$CUSTOM_MCP_ARG" "custom-plugin-dir" ".mcp.json correctly targets custom-plugin-dir"

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}==============================================================${RESET}"
if [ "$TEST_FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}ALL CLI TESTS PASSED! (${TEST_PASSED}/${TEST_PASSED})${RESET}"
else
  echo -e "${RED}${BOLD}CLI TESTS FAILED: ${TEST_FAILED} failure(s), ${TEST_PASSED} passed.${RESET}"
  exit 1
fi
