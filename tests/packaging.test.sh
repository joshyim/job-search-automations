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
assert_file_exists "$PLUGIN_ROOT/web/scripts/start.js" "web/ contains scripts/start.js launcher"
if [ -x "$PLUGIN_ROOT/web/scripts/start.js" ]; then
  pass "web/scripts/start.js is marked executable"
else
  fail "web/scripts/start.js is not executable"
fi

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/web/package.json', 'utf-8'));
if (pkg.scripts && pkg.scripts.start === 'node scripts/start.js') {
  process.exit(0);
} else {
  console.error('Expected start script to be node scripts/start.js, got: ' + (pkg.scripts && pkg.scripts.start));
  process.exit(1);
}
"
pass "web/package.json start script routes to node scripts/start.js"


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

# Check setup.sh job-search-ui build step
if grep -Fq "packages/job-search-ui" "$PLUGIN_ROOT/setup.sh"; then
  pass "setup.sh includes job-search-ui build step"
else
  fail "setup.sh missing job-search-ui build step"
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
# Story 7: Dashboard Build-on-First-Run (PRO-22)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 7] Dashboard Build-on-First-Run (PRO-22)${RESET}"

START_JS="$PLUGIN_ROOT/web/scripts/start.js"
if grep -Fq "Building dashboard for first run..." "$START_JS"; then
  pass "scripts/start.js defines clear first-run notification message"
else
  fail "scripts/start.js missing first-run notification message"
fi

# Functional test: when dist is absent, verify build occurs and emits message
UI_DIR="$PLUGIN_ROOT/packages/job-search-ui"
TEMP_BACKUP="$UI_DIR/dist.test-backup.$$"

if [ -d "$UI_DIR/dist" ]; then
  mv "$UI_DIR/dist" "$TEMP_BACKUP"
fi

FIRST_RUN_LOG="$PLUGIN_ROOT/tests/fixtures/first_run_$$.log"
node "$START_JS" --port 3987 > "$FIRST_RUN_LOG" 2>&1 &
FIRST_PID=$!

for _ in {1..30}; do
  if [ -f "$UI_DIR/dist/server.js" ] && grep -Fq "Job Search Web UI running" "$FIRST_RUN_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill -TERM "$FIRST_PID" 2>/dev/null || true
wait "$FIRST_PID" 2>/dev/null || true

if [ -f "$UI_DIR/dist/server.js" ]; then
  pass "First-run build successfully created dist/server.js"
else
  fail "First-run build failed to create dist/server.js"
fi

if grep -Fq "Building dashboard for first run..." "$FIRST_RUN_LOG" 2>/dev/null; then
  pass "First-run execution printed 'Building dashboard for first run...'"
else
  fail "First-run execution did not print expected message"
fi
rm -f "$FIRST_RUN_LOG"

# Functional test: subsequent run should skip build step
SUBSEQUENT_LOG="$PLUGIN_ROOT/tests/fixtures/subsequent_$$.log"
node "$START_JS" --port 3986 > "$SUBSEQUENT_LOG" 2>&1 &
SUB_PID=$!

for _ in {1..20}; do
  if grep -Fq "Job Search Web UI running" "$SUBSEQUENT_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill -TERM "$SUB_PID" 2>/dev/null || true
wait "$SUB_PID" 2>/dev/null || true

if grep -Fq "Building dashboard for first run..." "$SUBSEQUENT_LOG" 2>/dev/null; then
  fail "Subsequent run unexpectedly triggered build step"
else
  pass "Subsequent run skipped build step as dist/ already exists"
fi
rm -f "$SUBSEQUENT_LOG"

# Clean up backup
if [ -d "$TEMP_BACKUP" ]; then
  rm -rf "$TEMP_BACKUP"
fi

# ------------------------------------------------------------------------------
# Story 8: Port-Conflict Handling & Dynamic Fallback (PRO-23)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 8] Port-Conflict Handling & Dynamic Fallback (PRO-23)${RESET}"

# Test 1: Occupy port 3970 with a mock server, start dashboard on 3970, verify fallback to 3971
MOCK_LOG="$PLUGIN_ROOT/tests/fixtures/mock_server_$$.log"
node -e '
  const http = require("http");
  const server = http.createServer((req, res) => res.end("mock"));
  server.listen(3970, "127.0.0.1", () => {
    console.log("MOCK_READY");
  });
' > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!

# Wait for mock server to be ready
for _ in {1..20}; do
  if grep -Fq "MOCK_READY" "$MOCK_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

CONFLICT_LOG="$PLUGIN_ROOT/tests/fixtures/conflict_$$.log"
node "$START_JS" --port 3970 > "$CONFLICT_LOG" 2>&1 &
CONFLICT_PID=$!

for _ in {1..30}; do
  if grep -Fq "Dashboard running at http://localhost:3971" "$CONFLICT_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if grep -Fq "Port 3970 is in use, trying port 3971..." "$CONFLICT_LOG" 2>/dev/null; then
  pass "UI server detected port 3970 conflict and attempted next port"
else
  fail "UI server failed to log port conflict detection"
fi

if grep -Fq "Dashboard running at http://localhost:3971" "$CONFLICT_LOG" 2>/dev/null; then
  pass "UI server bound to next available port 3971 and printed Dashboard running URL"
else
  fail "UI server did not print bound Dashboard running URL for port 3971"
fi

if grep -Fq "Job Search Web UI running at: http://localhost:3971" "$CONFLICT_LOG" 2>/dev/null; then
  pass "UI server printed canonical Job Search Web UI running URL banner"
else
  fail "UI server missing Job Search Web UI running URL banner"
fi

# Verify /api/health reports the dynamically bound port
HEALTH_RES=$(curl -s http://127.0.0.1:3971/api/health 2>/dev/null || true)
if [[ "$HEALTH_RES" =~ \"port\":3971 ]] && [[ "$HEALTH_RES" =~ \"status\":\"ok\" ]]; then
  pass "/api/health reports status ok and dynamically resolved port 3971"
else
  fail "/api/health failed to report expected port: $HEALTH_RES"
fi

# Clean up conflict test processes
kill -TERM "$CONFLICT_PID" 2>/dev/null || true
wait "$CONFLICT_PID" 2>/dev/null || true
kill -TERM "$MOCK_PID" 2>/dev/null || true
wait "$MOCK_PID" 2>/dev/null || true
rm -f "$MOCK_LOG" "$CONFLICT_LOG"

# Test 2: PORT environment variable override
ENV_LOG="$PLUGIN_ROOT/tests/fixtures/env_port_$$.log"
PORT=3975 node "$START_JS" > "$ENV_LOG" 2>&1 &
ENV_PID=$!

for _ in {1..30}; do
  if grep -Fq "Dashboard running at http://localhost:3975" "$ENV_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill -TERM "$ENV_PID" 2>/dev/null || true
wait "$ENV_PID" 2>/dev/null || true

if grep -Fq "Dashboard running at http://localhost:3975" "$ENV_LOG" 2>/dev/null; then
  pass "UI server respected PORT environment variable (3975)"
else
  fail "UI server failed to respect PORT environment variable"
fi
rm -f "$ENV_LOG"

# Test 3: --port=<val> syntax override
SYNTAX_LOG="$PLUGIN_ROOT/tests/fixtures/syntax_port_$$.log"
node "$START_JS" --port=3976 > "$SYNTAX_LOG" 2>&1 &
SYNTAX_PID=$!

for _ in {1..30}; do
  if grep -Fq "Dashboard running at http://localhost:3976" "$SYNTAX_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

kill -TERM "$SYNTAX_PID" 2>/dev/null || true
wait "$SYNTAX_PID" 2>/dev/null || true

if grep -Fq "Dashboard running at http://localhost:3976" "$SYNTAX_LOG" 2>/dev/null; then
  pass "UI server respected --port=<value> command line argument (3976)"
else
  fail "UI server failed to respect --port=<value> syntax"
fi
rm -f "$SYNTAX_LOG"


# ------------------------------------------------------------------------------
# Story 9: MCP Server Build-on-First-Run & Connection Resiliency (PRO-24)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}[Story 9] MCP Server Build-on-First-Run & Connection Resiliency (PRO-24)${RESET}"

DB_START_JS="$PLUGIN_ROOT/packages/job-search-db/scripts/start.js"
assert_file_exists "$DB_START_JS" "packages/job-search-db/scripts/start.js launcher exists"

if [ -x "$DB_START_JS" ]; then
  pass "packages/job-search-db/scripts/start.js is marked executable"
else
  fail "packages/job-search-db/scripts/start.js is not executable"
fi

# Verify mcp.json and .mcp.json use scripts/start.js
node -e "
const fs = require('fs');
const mcp = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/mcp.json', 'utf-8'));
const claudeMcp = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/.mcp.json', 'utf-8'));

const mcpArg = mcp.mcpServers['job-search-db'].args[0];
const claudeMcpArg = claudeMcp.mcpServers['job-search-db'].args[0];

if (!mcpArg.endsWith('scripts/start.js')) {
  console.error('mcp.json arg does not end with scripts/start.js: ' + mcpArg);
  process.exit(1);
}
if (!claudeMcpArg.endsWith('scripts/start.js')) {
  console.error('.mcp.json arg does not end with scripts/start.js: ' + claudeMcpArg);
  process.exit(1);
}
"
pass "mcp.json and .mcp.json route job-search-db through scripts/start.js"

# Verify packages/job-search-db/package.json start script
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PLUGIN_ROOT/packages/job-search-db/package.json', 'utf-8'));
if (pkg.scripts && pkg.scripts.start === 'node scripts/start.js') {
  process.exit(0);
} else {
  console.error('Expected start script to be node scripts/start.js, got: ' + (pkg.scripts && pkg.scripts.start));
  process.exit(1);
}
"
pass "packages/job-search-db/package.json start script routes to node scripts/start.js"

# Functional test: when dist is absent, verify build occurs and emits diagnostic to stderr only
DB_PKG_DIR="$PLUGIN_ROOT/packages/job-search-db"
DB_TEMP_BACKUP="$DB_PKG_DIR/dist.test-backup.$$"

if [ -d "$DB_PKG_DIR/dist" ]; then
  mv "$DB_PKG_DIR/dist" "$DB_TEMP_BACKUP"
fi

DB_FIRST_RUN_STDOUT="$PLUGIN_ROOT/tests/fixtures/db_first_stdout_$$.log"
DB_FIRST_RUN_STDERR="$PLUGIN_ROOT/tests/fixtures/db_first_stderr_$$.log"

# Run start.js via stdio sending initialize request
node -e "
const { spawn } = require('child_process');
const fs = require('fs');

const child = spawn(process.execPath, ['$DB_START_JS'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const stdoutStream = fs.createWriteStream('$DB_FIRST_RUN_STDOUT');
const stderrStream = fs.createWriteStream('$DB_FIRST_RUN_STDERR');

child.stdout.pipe(stdoutStream);
child.stderr.pipe(stderrStream);

const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-harness', version: '1.0.0' }
  }
}) + '\n';

child.stdin.write(initReq);

setTimeout(() => {
  child.kill('SIGTERM');
}, 6000);
" || true

if [ -f "$DB_PKG_DIR/dist/index.js" ]; then
  pass "First-run build successfully compiled job-search-db dist/index.js"
else
  fail "First-run build failed to compile job-search-db dist/index.js"
fi

if grep -Fq "Building job-search-db MCP server for first run..." "$DB_FIRST_RUN_STDERR" 2>/dev/null; then
  pass "First-run build notification printed to stderr"
else
  fail "First-run build notification missing from stderr"
fi

# Verify stdout received valid JSON-RPC and zero non-JSON build logs (no stdout pollution)
node -e "
const fs = require('fs');
const content = fs.readFileSync('$DB_FIRST_RUN_STDOUT', 'utf-8').trim();
if (!content) {
  console.error('Empty stdout from MCP server');
  process.exit(1);
}
const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
for (const line of lines) {
  try {
    const json = JSON.parse(line);
    if (!json.jsonrpc || json.jsonrpc !== '2.0') {
      console.error('Non-JSONRPC line on stdout: ' + line);
      process.exit(1);
    }
  } catch (err) {
    console.error('Non-JSON build pollution detected on stdout: ' + line);
    process.exit(1);
  }
}
"
pass "stdout is strictly valid JSON-RPC with zero build-log pollution"

rm -f "$DB_FIRST_RUN_STDOUT" "$DB_FIRST_RUN_STDERR"

# Functional test: subsequent run should skip build step
DB_SUBSEQUENT_STDERR="$PLUGIN_ROOT/tests/fixtures/db_subsequent_stderr_$$.log"

node -e "
const { spawn } = require('child_process');
const fs = require('fs');

const child = spawn(process.execPath, ['$DB_START_JS'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const stderrStream = fs.createWriteStream('$DB_SUBSEQUENT_STDERR');
child.stderr.pipe(stderrStream);

const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-harness', version: '1.0.0' }
  }
}) + '\n';

child.stdin.write(initReq);

setTimeout(() => {
  child.kill('SIGTERM');
}, 3000);
" || true

if grep -Fq "Building job-search-db MCP server for first run..." "$DB_SUBSEQUENT_STDERR" 2>/dev/null; then
  fail "Subsequent MCP start unexpectedly triggered build step"
else
  pass "Subsequent MCP start skipped build step as dist/ already exists"
fi
rm -f "$DB_SUBSEQUENT_STDERR"

# Clean up backup
if [ -d "$DB_TEMP_BACKUP" ]; then
  rm -rf "$DB_TEMP_BACKUP"
fi

# Functional test: MCP tools availability test via stdio protocol
node -e "
const { spawn } = require('child_process');

const child = spawn(process.execPath, ['$DB_START_JS'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdoutData = '';
let foundTools = false;

child.stdout.on('data', (chunk) => {
  stdoutData += chunk.toString();
  const lines = stdoutData.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line.trim());
      if (msg.id === 2 && msg.result && Array.isArray(msg.result.tools)) {
        const toolNames = msg.result.tools.map(t => t.name);
        const expected = [
          'get_candidates',
          'add_candidate',
          'update_candidate_status',
          'list_companies',
          'add_company',
          'update_company',
          'exclude_company',
          'get_batch',
          'get_scoring_rubric',
          'update_rubric_dimension',
          'list_queue',
          'add_to_queue',
          'get_pending_queue',
          'update_queue_status',
          'list_skills',
          'add_skill',
          'list_title_patterns',
          'add_title_pattern',
          'log_run',
          'get_recent_runs'
        ];
        const missing = expected.filter(e => !toolNames.includes(e));
        if (missing.length === 0) {
          foundTools = true;
          child.kill('SIGTERM');
        } else {
          console.error('Missing expected tools: ' + missing.join(', '));
          process.exit(1);
        }
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
    clientInfo: { name: 'test-harness', version: '1.0.0' }
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
    console.error('Failed to receive complete tools list from MCP server');
    process.exit(1);
  }
});

setTimeout(() => {
  child.kill('SIGKILL');
}, 6000);
"
pass "MCP stdio server connected and responded with all expected tools"

# Functional test: Zero-config first-run resilience (missing config file auto-initializes without crash)
ISOLATED_HOME="$PLUGIN_ROOT/tests/fixtures/isolated_home_$$"
mkdir -p "$ISOLATED_HOME"

node -e "
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const child = spawn(process.execPath, ['$DB_START_JS'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    HOME: '$ISOLATED_HOME',
    USERPROFILE: '$ISOLATED_HOME'
  }
});

let stdoutData = '';
let initializedOk = false;

child.stdout.on('data', (chunk) => {
  stdoutData += chunk.toString();
  if (stdoutData.includes('\"get_candidates\"')) {
    initializedOk = true;
    child.kill('SIGTERM');
  }
});

const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'zero-config-test', version: '1.0.0' }
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
  const autoCfg = path.join('$ISOLATED_HOME', '.config', 'job-search-automation', 'config.json');
  if (initializedOk && fs.existsSync(autoCfg)) {
    process.exit(0);
  } else {
    console.error('Zero-config initialization failed. Output:', stdoutData);
    process.exit(1);
  }
});

setTimeout(() => {
  child.kill('SIGKILL');
}, 6000);
"
pass "MCP server gracefully auto-initializes default local config on fresh zero-config start"
rm -rf "$ISOLATED_HOME"


# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}==============================================================${RESET}"
echo -e "${BOLD}Results: ${GREEN}$PASSED passed${RESET}, ${RED}$FAILED failed${RESET}"
echo -e "${CYAN}==============================================================${RESET}"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
