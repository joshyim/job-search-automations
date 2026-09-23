#!/usr/bin/env bash

# ==============================================================================
# tests/cleanup.test.sh - Security & Regression Tests for cleanup-tmp.js
#
# Validates:
# - Valid targeted file cleanup
# - Valid --all cleanup
# - Path containment: Sibling rejection (cannot delete sibling files/dirs)
# - Path containment: Parent traversal rejection (cannot escape via ../)
# - Symlink safety: Symlink escape containment (unlinks link, does NOT touch target)
# - Argument safety: Extra / unstructured argument rejection
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$ROOT_DIR/scripts/cleanup-tmp.js"

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

pass() {
  echo -e "  ${GREEN}✓${RESET} $1"
}

fail() {
  echo -e "  ${RED}✗${RESET} $1"
  exit 1
}

assert_file_exists() {
  if [ -e "$1" ]; then
    pass "$2"
  else
    fail "$2 (Expected file to exist: $1)"
  fi
}

assert_file_not_exists() {
  if [ ! -e "$1" ] && [ ! -L "$1" ]; then
    pass "$2"
  else
    fail "$2 (File should not exist: $1)"
  fi
}

echo -e "\n${CYAN}${BOLD}=== Running cleanup-tmp.js Security Test Suite ===${RESET}\n"

TMP_WORKSPACE="$(mktemp -d -t cleanup_test_XXXXXX)"
trap "rm -rf '$TMP_WORKSPACE'" EXIT

mkdir -p "$TMP_WORKSPACE/.job-search/tmp"
mkdir -p "$TMP_WORKSPACE/.job-search/tmp-sibling"

# Test 1: --ensure-dir
echo -e "${BOLD}[Test 1] --ensure-dir functionality${RESET}"
EMPTY_WORKSPACE="$(mktemp -d -t cleanup_empty_XXXXXX)"
node "$CLEANUP_SCRIPT" --workspace "$EMPTY_WORKSPACE" --ensure-dir
assert_file_exists "$EMPTY_WORKSPACE/.job-search/tmp" ".job-search/tmp created by --ensure-dir"
rm -rf "$EMPTY_WORKSPACE"

# Test 2: Targeted file deletion inside tmp
echo -e "\n${BOLD}[Test 2] Targeted single file cleanup${RESET}"
echo "sample crawl data" > "$TMP_WORKSPACE/.job-search/tmp/acme-crawl.json"
echo "other crawl data" > "$TMP_WORKSPACE/.job-search/tmp/beta-crawl.json"
node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "acme-crawl.json"
assert_file_not_exists "$TMP_WORKSPACE/.job-search/tmp/acme-crawl.json" "Targeted crawl file removed"
assert_file_exists "$TMP_WORKSPACE/.job-search/tmp/beta-crawl.json" "Other crawl file preserved"

# Test 3: --all cleanup
echo -e "\n${BOLD}[Test 3] --all cleanup${RESET}"
echo "file 1" > "$TMP_WORKSPACE/.job-search/tmp/file1.json"
echo "file 2" > "$TMP_WORKSPACE/.job-search/tmp/file2.json"
node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --all
assert_file_not_exists "$TMP_WORKSPACE/.job-search/tmp/file1.json" "file1.json removed"
assert_file_not_exists "$TMP_WORKSPACE/.job-search/tmp/file2.json" "file2.json removed"
assert_file_exists "$TMP_WORKSPACE/.job-search/tmp" "tmp directory itself remains intact"

# Test 4: Sibling target rejection
echo -e "\n${BOLD}[Test 4] Sibling target rejection${RESET}"
echo "critical resume" > "$TMP_WORKSPACE/.job-search/resume.pdf"
echo "sibling data" > "$TMP_WORKSPACE/.job-search/tmp-sibling/data.json"

# Try targeting sibling file
set +e
ERR_OUT=$(node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "../resume.pdf" 2>&1)
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  pass "Rejects relative path targeting sibling (.job-search/resume.pdf)"
else
  fail "Failed to reject path targeting sibling"
fi
assert_file_exists "$TMP_WORKSPACE/.job-search/resume.pdf" "resume.pdf untouched"

# Try targeting sibling with prefix name (tmp-sibling)
set +e
ERR_OUT=$(node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "../tmp-sibling/data.json" 2>&1)
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  pass "Rejects sibling directory starting with tmp (tmp-sibling)"
else
  fail "Failed to reject sibling directory starting with tmp"
fi
assert_file_exists "$TMP_WORKSPACE/.job-search/tmp-sibling/data.json" "tmp-sibling/data.json untouched"

# Test 5: Directory traversal rejection
echo -e "\n${BOLD}[Test 5] Directory traversal (../../) rejection${RESET}"
echo "root secret" > "$TMP_WORKSPACE/secret.txt"
set +e
ERR_OUT=$(node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "../../secret.txt" 2>&1)
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  pass "Rejects directory traversal to workspace root"
else
  fail "Failed to reject directory traversal"
fi
assert_file_exists "$TMP_WORKSPACE/secret.txt" "secret.txt untouched"

# Test 6: Symlink escape protection
echo -e "\n${BOLD}[Test 6] Symlink escape protection${RESET}"
echo "external important file" > "$TMP_WORKSPACE/important.txt"
ln -s "$TMP_WORKSPACE/important.txt" "$TMP_WORKSPACE/.job-search/tmp/link-to-important"
assert_file_exists "$TMP_WORKSPACE/.job-search/tmp/link-to-important" "Symlink created in tmp"

# Deleting the symlink must delete ONLY the link, NOT important.txt
node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "link-to-important"
assert_file_not_exists "$TMP_WORKSPACE/.job-search/tmp/link-to-important" "Symlink itself removed"
assert_file_exists "$TMP_WORKSPACE/important.txt" "External target of symlink is untouched"

# Test 7: Unexpected extra arguments rejection
echo -e "\n${BOLD}[Test 7] Unexpected extra argument rejection${RESET}"
set +e
ERR_OUT=$(node "$CLEANUP_SCRIPT" --workspace "$TMP_WORKSPACE" --file "valid.json" "unexpected_arg" 2>&1)
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  pass "Rejects extra positional arguments"
else
  fail "Failed to reject extra positional arguments"
fi

echo -e "\n${GREEN}${BOLD}ALL CLEANUP-TMP SECURITY TESTS PASSED!${RESET}\n"
