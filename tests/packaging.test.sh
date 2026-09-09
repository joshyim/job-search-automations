#!/usr/bin/env bash

# ==============================================================================
# packaging.test.sh - Harness-Agnostic Packaging & Spec Compliance Test Suite
#
# Validates Agent Plugins specification v1.0.0 and Agent Skills specification
# conformance for job-search-automation.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ANSI Color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

PASSED=0
FAILED=0

pass() {
  echo -e "  ${GREEN}✓${RESET} $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo -e "  ${RED}✗${RESET} $1"
  FAILED=$((FAILED + 1))
}

assert_file_exists() {
  if [ -f "$1" ]; then
    pass "$2"
  else
    fail "$2 (Missing file: $1)"
  fi
}

assert_dir_exists() {
  if [ -d "$1" ]; then
    pass "$2"
  else
    fail "$2 (Missing directory: $1)"
  fi
}

echo -e "${CYAN}${BOLD}=== Running Harness-Agnostic Packaging Compliance Test Suite ===${RESET}\n"

# ------------------------------------------------------------------------------
# Story 1: Plugin Manifest Conformance (Agent Plugins spec v1.0.0)
# ------------------------------------------------------------------------------
echo -e "${BOLD}[Story 1] Plugin Manifest Conformance (plugin.json)${RESET}"

PLUGIN_JSON="$PLUGIN_ROOT/plugin.json"
assert_file_exists "$PLUGIN_JSON" "plugin.json exists at plugin root"

node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('$PLUGIN_JSON', 'utf-8'));

if (manifest['\$schema'] !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') {
  console.error('Invalid \$schema URL: ' + manifest['\$schema']);
  process.exit(1);
}
if (manifest.name !== 'job-search-automation') {
  console.error('Expected name to be job-search-automation, got: ' + manifest.name);
  process.exit(1);
}
if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
  console.error('Invalid semver version: ' + manifest.version);
  process.exit(1);
}
if (typeof manifest.description !== 'string' || manifest.description.length < 5) {
  console.error('Missing or invalid description');
  process.exit(1);
}
if (!manifest.author || typeof manifest.author.name !== 'string') {
  console.error('Missing or invalid author.name');
  process.exit(1);
}
if (!manifest.repository || typeof manifest.repository !== 'string') {
  console.error('Missing or invalid repository');
  process.exit(1);
}
if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) {
  console.error('Missing or invalid keywords array');
  process.exit(1);
}
"
pass "plugin.json matches Agent Plugins v1.0.0 schema URL"
pass "plugin.json contains required name: 'job-search-automation'"
pass "plugin.json defines valid semver version"
pass "plugin.json defines description and author object"
pass "plugin.json defines repository URL and keywords array"

# ------------------------------------------------------------------------------
# Story 2: Plugin Directory Structure Completeness
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 2] Plugin Directory Structure Completeness${RESET}"

assert_dir_exists "$PLUGIN_ROOT/skills" "skills/ directory exists"
EXPECTED_SKILLS=(
  "job-search-lead-gen"
  "job-search-crawl"
  "job-search-assess"
  "company-search"
  "title-discovery"
  "pipeline-diagram"
)
for skill in "${EXPECTED_SKILLS[@]}"; do
  assert_file_exists "$PLUGIN_ROOT/skills/$skill/SKILL.md" "Skill '$skill' folder and SKILL.md exist"
done

assert_file_exists "$PLUGIN_ROOT/scripts/crawl-job-board.js" "Single shared crawler exists at scripts/crawl-job-board.js"
DUP_CRAWLERS=$(find "$PLUGIN_ROOT/skills" -name "crawl-job-board.js" | wc -l | tr -d ' ')
if [ "$DUP_CRAWLERS" -eq 0 ]; then
  pass "No duplicate crawler scripts exist in skills directory"
else
  fail "Found $DUP_CRAWLERS duplicate crawler scripts in skills/"
fi

assert_dir_exists "$PLUGIN_ROOT/templates" "templates/ directory exists"
assert_file_exists "$PLUGIN_ROOT/templates/scoring-rubric.md" "templates/scoring-rubric.md exists"
assert_file_exists "$PLUGIN_ROOT/templates/pipeline-overview.md" "templates/pipeline-overview.md exists"
assert_file_exists "$PLUGIN_ROOT/templates/crawl-queue.md" "templates/crawl-queue.md scaffold exists"
assert_file_exists "$PLUGIN_ROOT/templates/target-companies.md" "templates/target-companies.md scaffold exists"

assert_dir_exists "$PLUGIN_ROOT/web" "web/ directory exists at plugin root"
assert_file_exists "$PLUGIN_ROOT/web/public/index.html" "web/ contains SPA source (public/index.html)"
assert_file_exists "$PLUGIN_ROOT/web/public/styles.css" "web/ contains CSS styles (public/styles.css)"
assert_file_exists "$PLUGIN_ROOT/web/public/app.js" "web/ contains client application (public/app.js)"
assert_file_exists "$PLUGIN_ROOT/web/package.json" "web/ contains local server package.json"

assert_file_exists "$PLUGIN_ROOT/schema.sql" "schema.sql canonical DDL exists at plugin root"
assert_file_exists "$PLUGIN_ROOT/setup.sh" "setup.sh orchestrator exists at plugin root"
if [ -x "$PLUGIN_ROOT/setup.sh" ]; then
  pass "setup.sh is marked executable"
else
  fail "setup.sh is not executable"
fi

# ------------------------------------------------------------------------------
# Story 3: MCP Server Manifest Conformance (mcp.json)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 3] MCP Server Manifest Conformance (mcp.json)${RESET}"

MCP_JSON="$PLUGIN_ROOT/mcp.json"
assert_file_exists "$MCP_JSON" "mcp.json exists at plugin root"

node -e "
const fs = require('fs');
const mcp = JSON.parse(fs.readFileSync('$MCP_JSON', 'utf-8'));

if (mcp['\$schema'] !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json') {
  console.error('Invalid mcp \$schema URL: ' + mcp['\$schema']);
  process.exit(1);
}
if (!mcp.mcpServers || !mcp.mcpServers['job-search-db']) {
  console.error('Missing job-search-db in mcpServers');
  process.exit(1);
}
const srv = mcp.mcpServers['job-search-db'];
if (srv.type !== 'stdio') {
  console.error('Expected transport stdio, got: ' + srv.type);
  process.exit(1);
}
if (srv.command !== 'node') {
  console.error('Expected command node, got: ' + srv.command);
  process.exit(1);
}
if (!Array.isArray(srv.args) || !srv.args.some(a => a.includes('\${PLUGIN_ROOT}'))) {
  console.error('args does not use \${PLUGIN_ROOT} placeholder: ' + JSON.stringify(srv.args));
  process.exit(1);
}
"
pass "mcp.json matches Agent Plugins MCP schema URL"
pass "mcp.json registers 'job-search-db' with stdio transport"
pass "mcp.json uses \${PLUGIN_ROOT} placeholder in args for portable launch"

# ------------------------------------------------------------------------------
# Story 4: Skills Compatibility Frontmatter & Cron /schedule Documentation
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 4] Skills Compatibility Frontmatter & Scheduling Documentation${RESET}"

for skill in "${EXPECTED_SKILLS[@]}"; do
  SKILL_FILE="$PLUGIN_ROOT/skills/$skill/SKILL.md"
  
  # Check YAML frontmatter opening
  if head -n 1 "$SKILL_FILE" | grep -q "^---$"; then
    pass "$skill: Has YAML frontmatter"
  else
    fail "$skill: Missing YAML frontmatter"
  fi

  # Check name matches directory
  if grep -q "^name: $skill$" "$SKILL_FILE"; then
    pass "$skill: Name matches directory name"
  else
    fail "$skill: Name does not match directory name"
  fi

  # Check compatibility frontmatter contains Node.js
  COMPAT_LINE=$(grep "^compatibility:" "$SKILL_FILE" || true)
  if echo "$COMPAT_LINE" | grep -qi "node"; then
    pass "$skill: Compatibility notes Node.js requirement"
  else
    fail "$skill: Compatibility missing Node.js (found: '$COMPAT_LINE')"
  fi

  # Ensure compatibility does not hardcode a single harness (must be harness-agnostic)
  if echo "$COMPAT_LINE" | grep -qi "Claude Code"; then
    fail "$skill: Compatibility is not harness-agnostic (contains Claude Code)"
  else
    pass "$skill: Compatibility is harness-agnostic"
  fi
done

# Check setup.sh post-install cron output
if grep -Fq "/schedule" "$PLUGIN_ROOT/setup.sh"; then
  pass "setup.sh post-install banner references recurring runs via /schedule"
else
  fail "setup.sh missing /schedule post-install instructions"
fi

# Check README.md post-install cron documentation
if grep -Fq "/schedule" "$PLUGIN_ROOT/README.md"; then
  pass "README.md documents recurring runs via /schedule"
else
  fail "README.md missing /schedule documentation"
fi

# ------------------------------------------------------------------------------
# Story 5: Claude Code & Cowork Manifests Conformance
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 5] Claude Code & Cowork Manifests Conformance${RESET}"

assert_file_exists "$PLUGIN_ROOT/CLAUDE.md" "CLAUDE.md exists for Claude Cowork / Code guidance"
assert_file_exists "$PLUGIN_ROOT/.claude-plugin/marketplace.json" ".claude-plugin/marketplace.json exists"
assert_file_exists "$PLUGIN_ROOT/.claude-plugin/plugin.json" ".claude-plugin/plugin.json exists"
assert_file_exists "$PLUGIN_ROOT/.mcp.json" ".mcp.json exists at plugin root"

node -e "
const fs = require('fs');
const mp = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/.claude-plugin/marketplace.json', 'utf-8'));
if (!mp.name || !Array.isArray(mp.plugins) || mp.plugins.length === 0) {
  console.error('Invalid marketplace.json structure');
  process.exit(1);
}
const pl = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/.claude-plugin/plugin.json', 'utf-8'));
if (pl.name !== 'job-search-automation' || !pl.version) {
  console.error('Invalid .claude-plugin/plugin.json');
  process.exit(1);
}
const mcp = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/.mcp.json', 'utf-8'));
if (!mcp.mcpServers || !mcp.mcpServers['job-search-db']) {
  console.error('Invalid .mcp.json structure');
  process.exit(1);
}
"
pass ".claude-plugin/marketplace.json defines valid marketplace"
pass ".claude-plugin/plugin.json defines valid plugin manifest"
pass ".mcp.json correctly defines job-search-db server"


# ------------------------------------------------------------------------------
# Story 6: Security & Zero Committed Credentials
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 6] Security & Zero Committed Credentials${RESET}"

FORBIDDEN_PATTERNS=(
  "client_secret"
  "refresh_token"
  "access_token"
  "AIzaSy"
  "op://"
  "postgres://.*:.*@"
)

CLEAN_CREDENTIALS=1
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  MATCHES=$(grep -E -r "$pattern" "$PLUGIN_ROOT/plugin.json" "$PLUGIN_ROOT/mcp.json" "$PLUGIN_ROOT/skills" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    fail "Found forbidden secret pattern '$pattern': $MATCHES"
    CLEAN_CREDENTIALS=0
  fi
done

if [ $CLEAN_CREDENTIALS -eq 1 ]; then
  pass "Zero credentials or secrets detected in plugin manifests and skills"
fi

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}==============================================================${RESET}"
echo -e "${BOLD}Results: ${GREEN}$PASSED passed${RESET}, ${RED}$FAILED failed${RESET}"
echo -e "${CYAN}==============================================================${RESET}"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
