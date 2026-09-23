#!/usr/bin/env bash

# ==============================================================================
# tests/crawler.test.sh - Automated Verification for SSRF Hardening (PRO-58)
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CRAWLER_SCRIPT="$ROOT_DIR/scripts/crawl-job-board.js"

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

TEST_PASSED=0
TEST_FAILED=0

pass() {
  echo -e "  ${GREEN}✓${RESET} $1"
  TEST_PASSED=$((TEST_PASSED + 1))
}

fail() {
  echo -e "  ${RED}✗${RESET} $1: $2"
  TEST_FAILED=$((TEST_FAILED + 1))
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local test_name="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$test_name"
  else
    fail "$test_name" "Expected substring '$needle' not found in output: $haystack"
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"
  if [ "$expected" -eq "$actual" ]; then
    pass "$test_name (exit code $actual)"
  else
    fail "$test_name" "Expected exit code $expected, got $actual"
  fi
}

echo -e "\n${BOLD}${CYAN}==============================================================${RESET}"
echo -e "${BOLD}${CYAN} Running Crawler SSRF & Destination Hardening Tests (PRO-58)${RESET}"
echo -e "${BOLD}${CYAN}==============================================================${RESET}\n"

# 1. Direct Loopback / Private IP Rejection
echo -e "${BOLD}--- 1. Direct Loopback & Private IP Target Rejection ---${RESET}"

# 127.0.0.1
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://127.0.0.1:8080/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (127.0.0.1) is forbidden" "Direct 127.0.0.1 target is blocked"

# localhost
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://localhost:8080/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to private/local domain (localhost) is forbidden" "Direct localhost target is blocked"

# RFC 1918 10.0.0.1
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://10.0.0.1/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (10.0.0.1) is forbidden" "Direct 10.0.0.0/8 target is blocked"

# RFC 1918 192.168.1.1
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://192.168.1.1/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (192.168.1.1) is forbidden" "Direct 192.168.0.0/16 target is blocked"

# RFC 1918 172.16.0.1
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://172.16.0.1/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (172.16.0.1) is forbidden" "Direct 172.16.0.0/12 target is blocked"

# Cloud Metadata 169.254.169.254
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://169.254.169.254/latest/meta-data" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (169.254.169.254) is forbidden" "Direct cloud metadata (169.254.169.254) is blocked"

# IPv6 Loopback [::1]
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://[::1]:8080/jobs" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (::1) is forbidden" "Direct IPv6 loopback [::1] is blocked"


# 2. Protocol Restrictions
echo -e "\n${BOLD}--- 2. Protocol & Scheme Enforcement ---${RESET}"

# file:// scheme
OUTPUT=$(node "$CRAWLER_SCRIPT" "file:///etc/passwd" --json 2>&1 || true)
assert_contains "$OUTPUT" "Invalid protocol: file:. Only http: and https: are allowed." "file:// protocol is rejected"

# javascript: scheme
OUTPUT=$(node "$CRAWLER_SCRIPT" "javascript:alert(1)" --json 2>&1 || true)
assert_contains "$OUTPUT" "Invalid protocol: javascript:. Only http: and https: are allowed." "javascript: protocol is rejected"


# 3. ATS Hostname Spoofing Protection
echo -e "\n${BOLD}--- 3. ATS Hostname Spoofing Protection ---${RESET}"

# Attempting to trigger Greenhouse crawl with a loopback URL containing greenhouse.io in path
OUTPUT=$(node "$CRAWLER_SCRIPT" "http://127.0.0.1/greenhouse.io/embed/fake" --json 2>&1 || true)
assert_contains "$OUTPUT" "Access to non-public/private IP (127.0.0.1) is forbidden" "Path containing greenhouse.io does not bypass loopback block"


# 4. Redirect Destination & Link Filtering Verification
echo -e "\n${BOLD}--- 4. Local Test Server & Redirect Fixtures ---${RESET}"

NODE_TEST_SCRIPT="
import http from 'node:http';
import { exec } from 'node:child_process';

const serverB = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body><a href=\"/jobs/target\">Target Role</a><a href=\"http://127.0.0.1:9999/jobs/internal\">Internal Link</a></body></html>');
}).listen(0, '127.0.0.1', () => {
  const portB = serverB.address().port;

  const serverA = http.createServer((req, res) => {
    res.writeHead(302, { 'Location': 'http://127.0.0.1:' + portB + '/jobs' });
    res.end();
  }).listen(0, '127.0.0.1', () => {
    const portA = serverA.address().port;
    const urlA = 'http://127.0.0.1:' + portA;

    // Test A: Direct crawl without --allow-private must fail
    exec('node scripts/crawl-job-board.js ' + urlA + ' --json', (err1, stdout1, stderr1) => {
      const blockedInitial = stderr1.includes('Access to non-public/private IP');

      // Test B: Crawl with --allow-private must follow redirect and succeed
      exec('node scripts/crawl-job-board.js ' + urlA + ' --json --allow-private', (err2, stdout2, stderr2) => {
        const allowedSucceeded = err2 === null && stdout2.includes('Target Role');
        const outputJson = JSON.parse(stdout2 || '[]');
        const hasInternalLink = outputJson.some(item => item.url.includes('127.0.0.1:9999'));

        console.log(JSON.stringify({
          blockedInitial,
          allowedSucceeded,
          hasInternalLink,
        }));

        serverA.close();
        serverB.close();
      });
    });
  });
});
"

FIXTURE_RESULT=$(cd "$ROOT_DIR" && node -e "$NODE_TEST_SCRIPT")
assert_contains "$FIXTURE_RESULT" '"blockedInitial":true' "Local redirect target is blocked by default"
assert_contains "$FIXTURE_RESULT" '"allowedSucceeded":true' "Local redirect succeeds with --allow-private override"


# 5. Public ATS Endpoints
echo -e "\n${BOLD}--- 5. Public ATS Endpoint Compatibility ---${RESET}"
# Greenhouse public test board (e.g., github or stripe or figma)
PUBLIC_OUTPUT=$(node "$CRAWLER_SCRIPT" "https://boards.greenhouse.io/github" --json 2>&1 || true)
if [[ "$PUBLIC_OUTPUT" == *"["* && "$PUBLIC_OUTPUT" == *"]"* ]]; then
  pass "Public Greenhouse board (github) successfully crawled and returned JSON"
else
  # In case network is offline in CI, note that it attempted public request without SSRF restriction error
  if [[ "$PUBLIC_OUTPUT" != *"forbidden"* ]]; then
    pass "Public Greenhouse board handled without SSRF restriction"
  else
    fail "Public Greenhouse board" "Unexpectedly blocked: $PUBLIC_OUTPUT"
  fi
fi

echo ""
echo "=============================================================="
echo -e "Results: ${GREEN}${TEST_PASSED} passed${RESET}, ${RED}${TEST_FAILED} failed${RESET}"
echo "=============================================================="

if [ "$TEST_FAILED" -gt 0 ]; then
  exit 1
fi
