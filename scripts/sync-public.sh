#!/usr/bin/env bash
# ==============================================================================
# sync-public.sh - Synchronize job-search-automations to public standalone repo
#
# Pushes the job-search-automations directory to github.com/joshyim/job-search-automations.
# Synthesizes pre-built dist/ artifacts and strips the prepare script exclusively
# for the public standalone release, keeping the monorepo 100% clean and enabling
# instant, zero-devDependency npx installations for end users.
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
SUBPREFIX="job-search-automations"

# Flags
DRY_RUN=false
AUTO_CONFIRM=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    -y|--yes)
      AUTO_CONFIRM=true
      ;;
    -f|--force)
      FORCE=true
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [-y|--yes] [-f|--force]"
      echo ""
      echo "Options:"
      echo "  --dry-run    Preview commits and remote configuration without pushing"
      echo "  -y, --yes    Skip confirmation prompt and push immediately"
      echo "  -f, --force  Force push subtree if upstream history diverged"
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

# Ensure packages are pre-built locally for inclusion in public release
echo -e "${CYAN}${BOLD}[1/4] Building packages in $SUBPREFIX...${RESET}"
(cd "$REPO_ROOT/$SUBPREFIX" && npm run build --silent)

DB_DIST="$REPO_ROOT/$SUBPREFIX/packages/job-search-db/dist/index.js"
UI_DIST="$REPO_ROOT/$SUBPREFIX/packages/job-search-ui/dist/server.js"
if [ ! -f "$DB_DIST" ] || [ ! -f "$UI_DIST" ]; then
  echo -e "${RED}Error: Build outputs missing (expected $DB_DIST and $UI_DIST).${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Packages successfully built.${RESET}"

# Fetch latest public remote branch
echo -e "\n${CYAN}${BOLD}[2/4] Fetching remote '$REMOTE_NAME/$BRANCH'...${RESET}"
git fetch "$REMOTE_NAME" "$BRANCH" --quiet 2>/dev/null || true
PUBLIC_HEAD="$(git rev-parse "$REMOTE_NAME/$BRANCH" 2>/dev/null || true)"

# Split subtree from monorepo commits
echo -e "\n${CYAN}${BOLD}[3/4] Splitting subtree for $SUBPREFIX...${RESET}"
SPLIT_REV="$(git subtree split --prefix="$SUBPREFIX")"

# Synthesize public release tree with pre-built dist/ and prepare script stripped
echo -e "${CYAN}Synthesizing zero-compile public release artifacts...${RESET}"
TMP_WORKTREE="$(mktemp -d -t public-sync-worktree.XXXXXX)"
cleanup_worktree() {
  if [ -d "$TMP_WORKTREE" ]; then
    git worktree remove --force "$TMP_WORKTREE" 2>/dev/null || true
    rm -rf "$TMP_WORKTREE" 2>/dev/null || true
  fi
}
trap cleanup_worktree EXIT

git worktree add --detach "$TMP_WORKTREE" "$SPLIT_REV" --quiet
mkdir -p "$TMP_WORKTREE/packages/job-search-db" "$TMP_WORKTREE/packages/job-search-ui"
cp -R "$REPO_ROOT/$SUBPREFIX/packages/job-search-db/dist" "$TMP_WORKTREE/packages/job-search-db/"
cp -R "$REPO_ROOT/$SUBPREFIX/packages/job-search-ui/dist" "$TMP_WORKTREE/packages/job-search-ui/"

# Strip prepare script from package.json for zero-compile npx installs
node -e '
  const fs = require("fs");
  const file = process.argv[1] + "/package.json";
  if (fs.existsSync(file)) {
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    if (p.scripts && p.scripts.prepare) {
      delete p.scripts.prepare;
      fs.writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
    }
  }
' "$TMP_WORKTREE"

# Unignore dist/ in .gitignore for public release
node -e '
  const fs = require("fs");
  const file = process.argv[1] + "/.gitignore";
  if (fs.existsSync(file)) {
    let g = fs.readFileSync(file, "utf8");
    g = g.replace(/^dist\/$/m, "# dist/ (shipped in release)");
    fs.writeFileSync(file, g);
  }
' "$TMP_WORKTREE"

git -C "$TMP_WORKTREE" add -f packages/job-search-db/dist packages/job-search-ui/dist package.json .gitignore
TARGET_TREE="$(git -C "$TMP_WORKTREE" write-tree)"
git worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || rm -rf "$TMP_WORKTREE"
trap - EXIT

# Check if public repository is already up to date
if [ -n "$PUBLIC_HEAD" ]; then
  PUBLIC_TREE="$(git rev-parse "$PUBLIC_HEAD^{tree}" 2>/dev/null || true)"
  if [ "$TARGET_TREE" = "$PUBLIC_TREE" ]; then
    echo -e "\n${GREEN}${BOLD}✓ Public repository is already up to date with pre-built artifacts!${RESET}"
    echo -e "Latest release commit: ${CYAN}$PUBLIC_HEAD${RESET}\n"
    exit 0
  fi
fi

# Formulate commit message from latest subtree commit
LATEST_MSG="$(git log -1 --pretty=%B "$SPLIT_REV" 2>/dev/null || echo "chore(release): update public standalone distribution")"
RELEASE_MSG="$LATEST_MSG"$'\n\n'"Release: Include pre-built dist artifacts for zero-compile npx install"

if [ "$FORCE" = true ] || [ -z "$PUBLIC_HEAD" ]; then
  RELEASE_COMMIT="$(git commit-tree "$TARGET_TREE" -p "$SPLIT_REV" -m "$RELEASE_MSG")"
else
  RELEASE_COMMIT="$(git commit-tree "$TARGET_TREE" -p "$PUBLIC_HEAD" -m "$RELEASE_MSG")"
fi

echo -e "${GREEN}✓ Release tree prepared ($RELEASE_COMMIT)${RESET}"

if [ "$DRY_RUN" = true ]; then
  echo -e "\n${YELLOW}[DRY RUN] Would execute:${RESET}"
  echo "  Subtree split:  $SPLIT_REV"
  echo "  Target tree:    $TARGET_TREE"
  echo "  Release commit: $RELEASE_COMMIT"
  if [ "$FORCE" = true ] || [ -z "$PUBLIC_HEAD" ]; then
    echo "  Command:        git push $REMOTE_NAME $RELEASE_COMMIT:refs/heads/$BRANCH --force"
  else
    echo "  Command:        git push $REMOTE_NAME $RELEASE_COMMIT:refs/heads/$BRANCH"
  fi
  echo -e "${GREEN}Dry run complete. No changes were pushed.${RESET}"
  exit 0
fi

if [ "$AUTO_CONFIRM" = false ]; then
  read -rp "Push public release commit to $PUBLIC_REPO_URL ($BRANCH)? [y/N] " CONFIRM_PUSH
  if [[ ! "$CONFIRM_PUSH" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Sync cancelled by user.${RESET}"
    exit 0
  fi
fi

echo -e "\n${CYAN}${BOLD}[4/4] Pushing release commit to $REMOTE_NAME ($BRANCH)...${RESET}"
if [ "$FORCE" = true ] || [ -z "$PUBLIC_HEAD" ]; then
  git push "$REMOTE_NAME" "$RELEASE_COMMIT:refs/heads/$BRANCH" --force
else
  git push "$REMOTE_NAME" "$RELEASE_COMMIT:refs/heads/$BRANCH"
fi

echo -e "\n${GREEN}${BOLD}✓ Public repository successfully synchronized with pre-built artifacts!${RESET}"
echo -e "View release at: ${CYAN}https://github.com/joshyim/job-search-automations${RESET}\n"
