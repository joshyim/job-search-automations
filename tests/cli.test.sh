#!/usr/bin/env bash

# ==============================================================================
# tests/cli.test.sh - Automated Integration Tests for CLI Subsystem (PRO-28)
#
# Validates:
#   - Zero symlinks created (strict Agent Plugins specification conformance)
#   - Self-contained .claude/plugins/job-search-automations directory
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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass "$test_name"
  else
    fail "$test_name (Substring unexpectedly found: '$needle')"
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
assert_contains "$HELP_OUT" "--harness" "Documents --harness option"
assert_contains "$HELP_OUT" "--codex" "Documents --codex flag"
assert_contains "$HELP_OUT" "--claude" "Documents --claude flag"

VER_OUT="$("$ROOT_DIR/bin/cli.js" --version)"
assert_equals "0.1.0" "$VER_OUT" "Reports correct version"

# ------------------------------------------------------------------------------
# Test 2: Clean Setup into Isolated Project Directory
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 2] Clean Setup into Isolated Project Workspace${RESET}"
PROJECT_DIR="$TMP_TEST_DIR/sample-project"
mkdir -p "$PROJECT_DIR"

SETUP_OUT="$("$ROOT_DIR/bin/cli.js" setup --claude --directory "$PROJECT_DIR" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$SETUP_OUT" "Setup Complete!" "Setup reported completion"

PLUGIN_DIR="$PROJECT_DIR/.claude/plugins/job-search-automations"
assert_dir_exists "$PLUGIN_DIR" "Plugin installed in .claude/plugins/job-search-automations"
assert_file_exists "$PLUGIN_DIR/plugin.json" "plugin.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/mcp.json" "mcp.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/.mcp.json" ".mcp.json exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/schema.sql" "schema.sql exists in installed plugin"
assert_file_exists "$PLUGIN_DIR/CLAUDE.md" "CLAUDE.md exists in installed plugin (PRO-31)"
assert_file_exists "$PLUGIN_DIR/installation-steps.md" "installation-steps.md exists in installed plugin"

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
assert_equals "./.claude/plugins/job-search-automations/packages/job-search-db/scripts/start.js" "$RELATIVE_MCP_ARG" ".mcp.json uses relative path to launcher"

# .claude/launch.json and settings.json verification (PRO-30)
LAUNCH_JSON="$PROJECT_DIR/.claude/launch.json"
assert_file_exists "$LAUNCH_JSON" ".claude/launch.json created for web preview"
CLI_LAUNCH_VALID="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$LAUNCH_JSON', 'utf-8'));
const entry = cfg.configurations && cfg.configurations.find(c => c.name === 'job-search-ui');
if (!entry) { console.log('MISSING_ENTRY'); process.exit(0); }
const hasStart = entry.runtimeArgs && entry.runtimeArgs.includes('start') && !entry.runtimeArgs.includes('dev');
const hasPrefix = entry.runtimeArgs && entry.runtimeArgs.includes('--prefix') && entry.runtimeArgs.some(a => a.includes('.claude/plugins/job-search-automations/packages/job-search-ui'));
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
assert_dir_exists "$PROJECT_DIR/.job-search/tmp" ".job-search/tmp/ directory created (PRO-32)"

CLI_SETTINGS="$(cat "$PROJECT_DIR/.claude/settings.json")"
assert_contains "$CLI_SETTINGS" '"defaultMode": "auto"' ".claude/settings.json contains permissions.defaultMode = auto"
assert_contains "$CLI_SETTINGS" "cleanup-tmp.js:*" ".claude/settings.json contains cleanup-tmp execution grant (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(mkdir -p .job-search/tmp*)" ".claude/settings.json omits wildcard mkdir permission (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(rm -rf ./.job-search/tmp*)" ".claude/settings.json omits wildcard rm -rf permission (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(rm -rf .job-search/tmp*)" ".claude/settings.json omits wildcard rm -rf permission (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(rm -f ./.job-search/tmp/*)" ".claude/settings.json omits wildcard rm -f permission (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(rm -f .job-search/tmp/*)" ".claude/settings.json omits wildcard rm -f permission (PRO-55)"

# PRO-34 & PRO-55 permissions assertions
assert_contains "$CLI_SETTINGS" "scripts/crawl-job-board.js:*" ".claude/settings.json contains crawler execution grant (PRO-34)"
assert_not_contains "$CLI_SETTINGS" "Bash(mkdir -p $PROJECT_DIR/.job-search/tmp*)" ".claude/settings.json omits absolute tmp mkdir grant (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "Bash(rm -rf $PROJECT_DIR/.job-search/tmp*)" ".claude/settings.json omits absolute tmp rm grant (PRO-55)"
assert_contains "$CLI_SETTINGS" "Read($PROJECT_DIR/**)" ".claude/settings.json contains scoped workspace Read grant (PRO-34)"
assert_not_contains "$CLI_SETTINGS" "Write($PROJECT_DIR/**)" ".claude/settings.json omits overbroad workspace Write grant (PRO-55)"
assert_contains "$CLI_SETTINGS" "Read($PROJECT_DIR/.job-search/**)" ".claude/settings.json contains scoped .job-search Read grant (PRO-34)"
assert_contains "$CLI_SETTINGS" "Write($PROJECT_DIR/.job-search/**)" ".claude/settings.json contains scoped .job-search Write grant (PRO-34)"
assert_not_contains "$CLI_SETTINGS" "mcp__job-search-db__*" ".claude/settings.json omits overbroad mcp wildcard grant (PRO-55)"
assert_not_contains "$CLI_SETTINGS" "mcp__job-search-db__delete_rubric_dimension" ".claude/settings.json omits destructive delete_rubric_dimension (PRO-55)"
assert_contains "$CLI_SETTINGS" "mcp__job-search-db__get_pending_queue" ".claude/settings.json contains mcp queue grant (PRO-34)"
assert_contains "$CLI_SETTINGS" "mcp__job-search-db__list_companies" ".claude/settings.json contains mcp companies grant (PRO-34)"
assert_contains "$CLI_SETTINGS" "mcp__job-search-db__select_workspace" ".claude/settings.json contains mcp select_workspace grant (PRO-55)"
assert_contains "$CLI_SETTINGS" "WebSearch" ".claude/settings.json contains WebSearch grant (PRO-34)"
assert_contains "$CLI_SETTINGS" "WebFetch" ".claude/settings.json contains WebFetch grant (PRO-34)"

# PRO-34 post-install transparent permissions summary assertions
assert_contains "$SETUP_OUT" "Permissions:" "CLI outputs Permissions in summary (PRO-34)"
assert_contains "$SETUP_OUT" "Scoped Read/Write:" "CLI details Scoped Read/Write grant in summary (PRO-34)"
assert_contains "$SETUP_OUT" "Crawler Script:" "CLI details Crawler Script grant in summary (PRO-34)"
assert_contains "$SETUP_OUT" "Ephemeral Temp:" "CLI details Ephemeral Temp grant in summary (PRO-34)"
assert_contains "$SETUP_OUT" "MCP Database:" "CLI details MCP Database grant in summary (PRO-34)"
assert_contains "$SETUP_OUT" "Web Access:" "CLI details Web Access grant in summary (PRO-34)"

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
assert_file_exists "$CUSTOM_PLUGIN_DIR/installation-steps.md" "installation-steps.md exists in custom install dir"
assert_file_exists "$CUSTOM_PLUGIN_DIR/skills/job-search-assess/SKILL.md" "Skills exist in custom install dir"
assert_file_exists "$CUSTOM_PROJECT_DIR/.mcp.json" ".mcp.json configured in project dir"

CUSTOM_MCP_ARG="$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CUSTOM_PROJECT_DIR/.mcp.json', 'utf-8'));
console.log(cfg.mcpServers['job-search-db'].args[0]);
")"
assert_contains "$CUSTOM_MCP_ARG" "custom-plugin-dir" ".mcp.json correctly targets custom-plugin-dir"

# ------------------------------------------------------------------------------
# Test 8: Codex Harness Setup (--codex) (PRO-49)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 8] Codex Harness Setup (--codex) (PRO-49)${RESET}"
CODEX_PROJECT_DIR="$TMP_TEST_DIR/codex-project"
mkdir -p "$CODEX_PROJECT_DIR"

CODEX_SETUP_OUT="$("$ROOT_DIR/bin/cli.js" setup --directory "$CODEX_PROJECT_DIR" --resume "$FIXTURE_RESUME" --codex -y)"
assert_contains "$CODEX_SETUP_OUT" "Setup Complete!" "Codex setup reported completion"
assert_contains "$CODEX_SETUP_OUT" "Codex Config:" "Codex config displayed in summary"
assert_contains "$CODEX_SETUP_OUT" ".codex/config.toml" "Codex summary reports .codex/config.toml"
assert_contains "$CODEX_SETUP_OUT" "Luna-class" "Codex summary recommends Luna-class models"
assert_contains "$CODEX_SETUP_OUT" 'default_tools_approval_mode = "writes"' "Codex summary states approval mode"
assert_contains "$CODEX_SETUP_OUT" "/mcp" "Codex summary directs inspecting /mcp"

# Ensure Claude-specific messaging is not in Codex summary
if [[ "$CODEX_SETUP_OUT" == *"Claude Desktop"* ]] || [[ "$CODEX_SETUP_OUT" == *"Claude Code"* ]]; then
  fail "Codex setup output contains Claude mentions in next steps"
else
  pass "Codex setup output is free from Claude-only next steps"
fi

CODEX_PLUGIN_DIR="$CODEX_PROJECT_DIR/.codex/plugins/job-search-automations"
assert_dir_exists "$CODEX_PLUGIN_DIR" "Plugin installed in .codex/plugins/job-search-automations"
assert_file_exists "$CODEX_PROJECT_DIR/.codex/config.toml" ".codex/config.toml created"

# Verify .codex/config.toml contents
CODEX_CONFIG_CONTENT="$(cat "$CODEX_PROJECT_DIR/.codex/config.toml")"
assert_contains "$CODEX_CONFIG_CONTENT" "[mcp_servers.job-search-db]" ".codex/config.toml has job-search-db section"
assert_contains "$CODEX_CONFIG_CONTENT" 'default_tools_approval_mode = "writes"' ".codex/config.toml has default_tools_approval_mode = writes"
assert_contains "$CODEX_CONFIG_CONTENT" "./.codex/plugins/job-search-automations/packages/job-search-db/scripts/start.js" ".codex/config.toml uses plugin-relative launcher path"

# Verify native skills copied to .agents/skills/
assert_dir_exists "$CODEX_PROJECT_DIR/.agents/skills" ".agents/skills/ directory created for Codex"
for skill in "${EXPECTED_SKILLS[@]}"; do
  assert_file_exists "$CODEX_PROJECT_DIR/.agents/skills/$skill/SKILL.md" "Codex skill '$skill/SKILL.md' installed"
done
assert_file_exists "$CODEX_PROJECT_DIR/.agents/skills/job-search-crawl/scripts/crawl-job-board.js" "Crawler script copied into job-search-crawl skill"

# Verify AGENTS.md copied to root
assert_file_exists "$CODEX_PROJECT_DIR/AGENTS.md" "AGENTS.md copied to workspace root"

# Verify Claude-specific files were NOT created
assert_file_not_exists "$CODEX_PROJECT_DIR/.claude" ".claude/ directory was NOT created in Codex setup"
assert_file_not_exists "$CODEX_PROJECT_DIR/.mcp.json" ".mcp.json was NOT created in Codex setup"

# Verify workspace data created
assert_dir_exists "$CODEX_PROJECT_DIR/.job-search" ".job-search/ directory created in Codex workspace"
assert_file_exists "$CODEX_PROJECT_DIR/.job-search/job-search.sqlite" "SQLite database created in Codex workspace"

# ------------------------------------------------------------------------------
# Test 9: Codex Harness Auto-detection (PRO-49)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 9] Codex Auto-Detection via Directory & Environment (PRO-49)${RESET}"

# Case A: Auto-detect via existing .codex directory
AUTO_CODEX_DIR="$TMP_TEST_DIR/auto-codex-project"
mkdir -p "$AUTO_CODEX_DIR/.codex"

AUTO_SETUP_OUT="$("$ROOT_DIR/bin/cli.js" setup --directory "$AUTO_CODEX_DIR" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$AUTO_SETUP_OUT" "Codex Config:" "Auto-detected Codex harness via existing .codex directory"
assert_file_exists "$AUTO_CODEX_DIR/.codex/config.toml" "Auto-detected setup created .codex/config.toml"
assert_file_exists "$AUTO_CODEX_DIR/AGENTS.md" "Auto-detected setup created AGENTS.md"
assert_file_not_exists "$AUTO_CODEX_DIR/.claude" "Auto-detected Codex did not create .claude directory"

# Case B: Auto-detect via CODEX=1 environment variable
ENV_CODEX_DIR="$TMP_TEST_DIR/env-codex-project"
mkdir -p "$ENV_CODEX_DIR"

ENV_SETUP_OUT="$(CODEX=1 "$ROOT_DIR/bin/cli.js" setup --directory "$ENV_CODEX_DIR" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$ENV_SETUP_OUT" "Codex Config:" "Auto-detected Codex harness via CODEX=1 environment variable"
assert_file_exists "$ENV_CODEX_DIR/.codex/config.toml" "CODEX=1 setup created .codex/config.toml"

# ------------------------------------------------------------------------------
# Test 10: Uninstallation in Codex Workspace (PRO-49)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 10] Uninstallation in Codex Workspace (PRO-49)${RESET}"
CODEX_UNINSTALL_OUT="$("$ROOT_DIR/bin/cli.js" uninstall --directory "$CODEX_PROJECT_DIR")"
assert_contains "$CODEX_UNINSTALL_OUT" "Uninstall complete" "Codex uninstall reported completion"

assert_file_not_exists "$CODEX_PLUGIN_DIR" "Codex plugin directory removed"
assert_file_not_exists "$CODEX_PROJECT_DIR/.agents/skills" "Codex .agents/skills removed"
assert_file_not_exists "$CODEX_PROJECT_DIR/AGENTS.md" "Codex AGENTS.md removed"

# Verify .codex/config.toml cleaned up
if [ -f "$CODEX_PROJECT_DIR/.codex/config.toml" ]; then
  CLEANED_TOML="$(cat "$CODEX_PROJECT_DIR/.codex/config.toml")"
  if [[ "$CLEANED_TOML" == *"[mcp_servers.job-search-db]"* ]]; then
    fail "job-search-db section was not removed from .codex/config.toml"
  else
    pass "job-search-db section was removed from .codex/config.toml"
  fi
else
  pass ".codex/config.toml removed because it became empty"
fi

assert_file_exists "$CODEX_PROJECT_DIR/.job-search/job-search.sqlite" "User SQLite database preserved after Codex uninstall"
assert_file_exists "$CODEX_PROJECT_DIR/.job-search/resume.pdf" "User resume preserved after Codex uninstall"

# ------------------------------------------------------------------------------
# Test 11: Preserve Pre-existing permissions.defaultMode in CLI (PRO-55)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 11] Preserve Pre-existing permissions.defaultMode in CLI (PRO-55)${RESET}"
CLI_PREEXIST_DIR="$TMP_TEST_DIR/cli-preexist-permissions"
mkdir -p "$CLI_PREEXIST_DIR/.claude"
cat << 'EOF' > "$CLI_PREEXIST_DIR/.claude/settings.json"
{
  "permissions": {
    "defaultMode": "manual"
  }
}
EOF
"$ROOT_DIR/bin/cli.js" setup --claude --directory "$CLI_PREEXIST_DIR" --resume "$FIXTURE_RESUME" -y >/dev/null
CLI_PREEXIST_CONTENT="$(cat "$CLI_PREEXIST_DIR/.claude/settings.json")"
assert_contains "$CLI_PREEXIST_CONTENT" '"defaultMode": "manual"' "Existing defaultMode: manual preserved across CLI setup"

# ------------------------------------------------------------------------------
# Test 12: Routine Reconciliation Isolation in CLI (PRO-55)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 12] Routine Reconciliation Isolation in CLI (PRO-55)${RESET}"
CLI_FAKE_HOME="$TMP_TEST_DIR/cli_fake_home"
CLI_TASKS_DIR="$CLI_FAKE_HOME/Library/Application Support/Claude/claude-code-sessions/test-acc/test-org"
mkdir -p "$CLI_TASKS_DIR"
CLI_ROUTINE_PROJECT="$TMP_TEST_DIR/cli-routine-proj"
mkdir -p "$CLI_ROUTINE_PROJECT"
cat << EOF > "$CLI_TASKS_DIR/scheduled-tasks.json"
{
  "scheduledTasks": [
    {
      "id": "job-search-crawl",
      "cwd": "$CLI_ROUTINE_PROJECT",
      "permissionMode": "default"
    },
    {
      "id": "unrelated-task",
      "cwd": "$CLI_ROUTINE_PROJECT",
      "permissionMode": "default"
    },
    {
      "id": "job-search-crawl",
      "cwd": "/some/other/workspace",
      "permissionMode": "default"
    }
  ]
}
EOF
HOME="$CLI_FAKE_HOME" "$ROOT_DIR/bin/cli.js" setup --claude --directory "$CLI_ROUTINE_PROJECT" --resume "$FIXTURE_RESUME" -y >/dev/null

CLI_RECON_DATA="$(cat "$CLI_TASKS_DIR/scheduled-tasks.json")"
CLI_TASK1_MODE="$(node -e "const d = JSON.parse(process.argv[1]); console.log(d.scheduledTasks[0].permissionMode);" "$CLI_RECON_DATA")"
CLI_TASK2_MODE="$(node -e "const d = JSON.parse(process.argv[1]); console.log(d.scheduledTasks[1].permissionMode);" "$CLI_RECON_DATA")"
CLI_TASK3_MODE="$(node -e "const d = JSON.parse(process.argv[1]); console.log(d.scheduledTasks[2].permissionMode);" "$CLI_RECON_DATA")"

assert_equals "auto" "$CLI_TASK1_MODE" "Target workspace job-search task reconciled to auto mode via CLI"
assert_equals "default" "$CLI_TASK2_MODE" "Unrelated task in same workspace remains default mode via CLI"
assert_equals "default" "$CLI_TASK3_MODE" "Job-search task in other workspace remains default mode via CLI"

# ------------------------------------------------------------------------------
# Test 13: Neon Setup Shell Injection Resistance & Safe Argument Passing (PRO-56)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 13] Neon Setup Shell Injection Resistance & Safe Argument Passing (PRO-56)${RESET}"

TMP_NEON_TEST_DIR="$TMP_TEST_DIR/neon-injection-test"
mkdir -p "$TMP_NEON_TEST_DIR"
TMP_MARKER="$TMP_NEON_TEST_DIR/marker-injected.txt"
TMP_MARKER2="$TMP_NEON_TEST_DIR/marker-injected-2.txt"
TMP_STUB_DIR="$TMP_NEON_TEST_DIR/stubs"
mkdir -p "$TMP_STUB_DIR"

# 1. Verify --mode neon --mock runs cleanly without errors and initializes config
TMP_NEON_MOCK_PROJ="$TMP_NEON_TEST_DIR/mock-project"
mkdir -p "$TMP_NEON_MOCK_PROJ"
NEON_MOCK_OUT="$("$ROOT_DIR/bin/cli.js" setup --mode neon --mock --directory "$TMP_NEON_MOCK_PROJ" --resume "$FIXTURE_RESUME" -y)"
assert_contains "$NEON_MOCK_OUT" "Neon database initialized and seeded successfully (mock mode)" "Neon --mock setup initializes correctly"
assert_file_exists "$TMP_NEON_MOCK_PROJ/.job-search/config.json" "Neon config.json created in mock mode"
NEON_MODE_VAL="$(grep '"mode"' "$TMP_NEON_MOCK_PROJ/.job-search/config.json" | sed -E 's/.*"mode":[[:space:]]*"([^"]+)".*/\1/')"
assert_equals "neon" "$NEON_MODE_VAL" "Config mode is neon"

# 2. Fabricated connection string with shell injection payloads:
# Contains spaces, quotes, $(touch ...), backticks, and URI query separators '&'
CRAFTED_CONN_STR="postgresql://user:p\"ass@host:5432/db?sslmode=require&channel=prefer&inject=\$(touch \"$TMP_MARKER\")\`touch \"$TMP_MARKER2\"\`"

# Create a stub 'security' tool in TMP_STUB_DIR that captures the literal arguments
STUB_RECORD_FILE="$TMP_NEON_TEST_DIR/security-args.txt"
STUB_PW_FILE="$TMP_NEON_TEST_DIR/security-pw.txt"
cat << 'EOF' > "$TMP_STUB_DIR/security"
#!/usr/bin/env bash
echo "$@" >> "$STUB_RECORD_FILE"
while [[ $# -gt 0 ]]; do
  if [ "$1" = "-w" ]; then
    printf "%s" "$2" > "$STUB_PW_FILE"
    shift 2
  else
    shift
  fi
done
if [ -n "$STUB_FAIL_SECURITY" ]; then
  echo "Simulated security command error" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$TMP_STUB_DIR/security"

TMP_STUB_PROJ="$TMP_NEON_TEST_DIR/stub-project"
mkdir -p "$TMP_STUB_PROJ"
DUMPED_CONN_STR_FILE="$TMP_NEON_TEST_DIR/dumped-conn-str.txt"

# Run setup with PATH prepended with stub dir and MOCK_NEON_INIT=1
PATH="$TMP_STUB_DIR:$PATH" STUB_RECORD_FILE="$STUB_RECORD_FILE" STUB_PW_FILE="$STUB_PW_FILE" \
  MOCK_NEON_INIT=1 DUMP_RESOLVED_CONN_STR="$DUMPED_CONN_STR_FILE" \
  "$ROOT_DIR/bin/cli.js" setup --mode neon --neon-connection-string "$CRAFTED_CONN_STR" \
  --directory "$TMP_STUB_PROJ" --resume "$FIXTURE_RESUME" -y >/dev/null

# Assert no shell injection occurred!
assert_file_not_exists "$TMP_MARKER" "Shell injection marker file was NOT created via \$()"
assert_file_not_exists "$TMP_MARKER2" "Shell injection marker file was NOT created via backticks"

# Assert raw arguments reached child security command literally without boundary alteration
RECORDED_PW="$(cat "$STUB_PW_FILE")"
assert_equals "$CRAFTED_CONN_STR" "$RECORDED_PW" "Crafted string reached security stub with spaces, quotes, and metacharacters intact"

# Assert connection string reached init-neon via environment variable channel
DUMPED_CONN="$(cat "$DUMPED_CONN_STR_FILE")"
assert_equals "$CRAFTED_CONN_STR" "$DUMPED_CONN" "Crafted string reached init-neon via controlled DATABASE_URL env channel"

# 3. Assert Keychain storage failure fails visibly
TMP_FAIL_PROJ="$TMP_NEON_TEST_DIR/fail-project"
mkdir -p "$TMP_FAIL_PROJ"
FAIL_OUTPUT="$(PATH="$TMP_STUB_DIR:$PATH" STUB_RECORD_FILE="$STUB_RECORD_FILE" STUB_PW_FILE="$STUB_PW_FILE" \
  STUB_FAIL_SECURITY=1 MOCK_NEON_INIT=1 \
  "$ROOT_DIR/bin/cli.js" setup --mode neon --neon-connection-string "$CRAFTED_CONN_STR" \
  --directory "$TMP_FAIL_PROJ" --resume "$FIXTURE_RESUME" -y 2>&1 || true)"

assert_contains "$FAIL_OUTPUT" "Failed to store Neon connection string in macOS Keychain" "CLI visibly fails on Keychain credential storage error"

# ------------------------------------------------------------------------------
# Test 14: Private Workspace Protection & Git Isolation (PRO-57)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Test 14] Private Workspace Protection & Git Isolation (PRO-57)${RESET}"

TMP_SEC_DIR="$TMP_TEST_DIR/security-isolation-cli"
mkdir -p "$TMP_SEC_DIR"

# 1. Local Mode Setup inside Git Repository
TMP_GIT_LOCAL="$TMP_SEC_DIR/git-local-proj"
mkdir -p "$TMP_GIT_LOCAL"
git -C "$TMP_GIT_LOCAL" init -q

"$ROOT_DIR/bin/cli.js" setup --directory "$TMP_GIT_LOCAL" --resume "$FIXTURE_RESUME" -y >/dev/null

# Assert permissions
JS_DIR_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search" 2>/dev/null)"
JS_TMP_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/tmp" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/tmp" 2>/dev/null)"
RESUME_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/resume.pdf" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/resume.pdf" 2>/dev/null)"
SQLITE_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/job-search.sqlite" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/job-search.sqlite" 2>/dev/null)"
CFG_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/config.json" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/config.json" 2>/dev/null)"
GI_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/.gitignore" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/.gitignore" 2>/dev/null)"

assert_equals "700" "$JS_DIR_PERM" ".job-search/ directory has mode 0700"
assert_equals "700" "$JS_TMP_PERM" ".job-search/tmp/ directory has mode 0700"
assert_equals "600" "$RESUME_PERM" ".job-search/resume.pdf has mode 0600"
assert_equals "600" "$SQLITE_PERM" ".job-search/job-search.sqlite has mode 0600"
assert_equals "600" "$CFG_PERM" ".job-search/config.json has mode 0600"
assert_equals "600" "$GI_PERM" ".job-search/.gitignore has mode 0600"

# Assert inner .gitignore contents
INNER_GI_CONTENT="$(cat "$TMP_GIT_LOCAL/.job-search/.gitignore")"
assert_contains "$INNER_GI_CONTENT" "*" "Inner .gitignore contains wildcard *"
assert_contains "$INNER_GI_CONTENT" "!.gitignore" "Inner .gitignore exempts .gitignore"

# Assert project-level .gitignore
assert_file_exists "$TMP_GIT_LOCAL/.gitignore" "Project-level .gitignore created in Git workspace"
PROJ_GI_CONTENT="$(cat "$TMP_GIT_LOCAL/.gitignore")"
assert_contains "$PROJ_GI_CONTENT" ".job-search/" "Project-level .gitignore includes .job-search/"

# Assert Git staging isolation in local mode
GIT_STATUS="$(git -C "$TMP_GIT_LOCAL" status --porcelain)"
assert_not_contains "$GIT_STATUS" ".job-search" "git status omits .job-search/ files"
git -C "$TMP_GIT_LOCAL" add .
GIT_STAGED="$(git -C "$TMP_GIT_LOCAL" status --porcelain)"
assert_not_contains "$GIT_STAGED" ".job-search" "git add . does NOT stage any .job-search/ files in local mode"

# 2. Neon Mode Setup inside Git Repository
TMP_GIT_NEON="$TMP_SEC_DIR/git-neon-proj"
mkdir -p "$TMP_GIT_NEON"
git -C "$TMP_GIT_NEON" init -q

"$ROOT_DIR/bin/cli.js" setup --mode neon --mock --directory "$TMP_GIT_NEON" --resume "$FIXTURE_RESUME" -y >/dev/null

assert_file_exists "$TMP_GIT_NEON/.job-search/.gitignore" "Neon mode generates inner .job-search/.gitignore"
NEON_INNER_GI="$(cat "$TMP_GIT_NEON/.job-search/.gitignore")"
assert_contains "$NEON_INNER_GI" "*" "Neon inner .gitignore contains wildcard *"
assert_file_exists "$TMP_GIT_NEON/.gitignore" "Neon mode creates project-level .gitignore"
NEON_PROJ_GI="$(cat "$TMP_GIT_NEON/.gitignore")"
assert_contains "$NEON_PROJ_GI" ".job-search/" "Neon project-level .gitignore includes .job-search/"

git -C "$TMP_GIT_NEON" add .
NEON_GIT_STAGED="$(git -C "$TMP_GIT_NEON" status --porcelain)"
assert_not_contains "$NEON_GIT_STAGED" ".job-search" "git add . does NOT stage .job-search/ files in Neon mode"

# 3. Preservation on update-resume
"$ROOT_DIR/bin/cli.js" update-resume "$FIXTURE_RESUME_V2" --directory "$TMP_GIT_LOCAL" >/dev/null
UPDATED_RESUME_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/resume.pdf" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/resume.pdf" 2>/dev/null)"
UPDATED_DIR_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search" 2>/dev/null)"
UPDATED_CFG_PERM="$(stat -f "%Lp" "$TMP_GIT_LOCAL/.job-search/config.json" 2>/dev/null || stat -c "%a" "$TMP_GIT_LOCAL/.job-search/config.json" 2>/dev/null)"

assert_equals "600" "$UPDATED_RESUME_PERM" "update-resume preserves 0600 on resume.pdf"
assert_equals "700" "$UPDATED_DIR_PERM" "update-resume preserves 0700 on .job-search/ directory"
assert_equals "600" "$UPDATED_CFG_PERM" "update-resume preserves 0600 on config.json"

# 4. Check warning when workspace files are already tracked in Git
TMP_TRACKED_PROJ="$TMP_SEC_DIR/already-tracked-proj"
mkdir -p "$TMP_TRACKED_PROJ/.job-search"
git -C "$TMP_TRACKED_PROJ" init -q
echo "fake resume" > "$TMP_TRACKED_PROJ/.job-search/resume.pdf"
git -C "$TMP_TRACKED_PROJ" add -f ".job-search/resume.pdf"
git -C "$TMP_TRACKED_PROJ" -c user.name="Test" -c user.email="test@example.com" commit -q -m "Accidental commit of resume"

SETUP_WARN_OUT="$("$ROOT_DIR/bin/cli.js" setup --directory "$TMP_TRACKED_PROJ" --resume "$FIXTURE_RESUME" -y 2>&1 || true)"
assert_contains "$SETUP_WARN_OUT" "already tracked by Git" "CLI warns when files in .job-search/ are already tracked"
assert_contains "$SETUP_WARN_OUT" "git rm --cached" "CLI provides git rm --cached remediation command"

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
