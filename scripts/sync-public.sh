#!/usr/bin/env bash
# ==============================================================================
# sync-public.sh - Synchronize job-search-automation to public standalone repo
#
# Pushes the job-search-automation directory from the monorepo to the public
# github.com/joshyim/job-search-automations repository using git subtree.
# ==============================================================================

set -eo pipefail

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

# Remote configuration
REMOTE_NAME="public-automations"
PUBLIC_REPO_URL="https://github.com/joshyim/job-search-automations.git"
BRANCH="main"
SUBPREFIX="job-search-automation"

# Flags
DRY_RUN=false
AUTO_CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    -y|--yes)
      AUTO_CONFIRM=true
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [-y|--yes]"
      echo ""
      echo "Options:"
      echo "  --dry-run    Preview commits and remote configuration without pushing"
      echo "  -y, --yes    Skip confirmation prompt and push immediately"
      echo "  -h, --help   Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown argument: $arg${RESET}"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

# Verify we are inside a Git repository
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo -e "${RED}Error: Not inside a Git repository.${RESET}"
  exit 1
fi

cd "$REPO_ROOT"

# Check if we are in the monorepo
if [ ! -d "$REPO_ROOT/$SUBPREFIX" ]; then
  echo -e "${YELLOW}Notice: '$SUBPREFIX' directory not found at root ($REPO_ROOT).${RESET}"
  echo "If you are in the standalone public repository, run standard 'git push' instead."
  exit 0
fi

echo -e "${CYAN}${BOLD}=== Job Search Automation Public Sync ===${RESET}\n"

# Check for uncommitted changes in the monorepo
DIRTY_CHANGES=$(git status --porcelain "$SUBPREFIX" 2>/dev/null || true)
if [ -n "$DIRTY_CHANGES" ]; then
  echo -e "${YELLOW}${BOLD}Warning: You have uncommitted changes in '$SUBPREFIX':${RESET}"
  git status -s "$SUBPREFIX"
  echo ""
  if [ "$AUTO_CONFIRM" = false ]; then
    read -rp "Uncommitted changes will NOT be included in the sync. Continue anyway? [y/N] " CONFIRM_DIRTY
    if [[ ! "$CONFIRM_DIRTY" =~ ^[Yy]$ ]]; then
      echo -e "${RED}Sync aborted. Please commit or stash your changes first.${RESET}"
      exit 1
    fi
  fi
fi

# Ensure remote exists and is configured properly
EXISTING_REMOTE_URL=$(git remote get-url "$REMOTE_NAME" 2>/dev/null || true)
if [ -z "$EXISTING_REMOTE_URL" ]; then
  echo -e "Configuring remote '${BOLD}$REMOTE_NAME${RESET}' -> $PUBLIC_REPO_URL"
  git remote add "$REMOTE_NAME" "$PUBLIC_REPO_URL"
else
  echo -e "Using remote '${BOLD}$REMOTE_NAME${RESET}' ($EXISTING_REMOTE_URL)"
fi

echo -e "\n${BOLD}Latest commits in $SUBPREFIX:${RESET}"
git log -n 5 --oneline -- "$SUBPREFIX"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[DRY RUN] Would execute:${RESET}"
  echo "  git subtree push --prefix=$SUBPREFIX $REMOTE_NAME $BRANCH"
  echo -e "${GREEN}Dry run complete. No changes were pushed.${RESET}"
  exit 0
fi

if [ "$AUTO_CONFIRM" = false ]; then
  read -rp "Push the latest $SUBPREFIX commits to $PUBLIC_REPO_URL ($BRANCH)? [y/N] " CONFIRM_PUSH
  if [[ ! "$CONFIRM_PUSH" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Sync cancelled by user.${RESET}"
    exit 0
  fi
fi

echo -e "\n${CYAN}Splitting subtree and pushing to $REMOTE_NAME ($BRANCH)...${RESET}"
git subtree push --prefix="$SUBPREFIX" "$REMOTE_NAME" "$BRANCH"

echo -e "\n${GREEN}${BOLD}✓ Public repository successfully synchronized!${RESET}"
echo -e "View release at: ${CYAN}https://github.com/joshyim/job-search-automations${RESET}\n"
