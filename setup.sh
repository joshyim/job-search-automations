#!/usr/bin/env bash

# ==============================================================================
# setup.sh - Job Search Plugin Setup & Configuration Orchestrator
#
# Supports:
#   - Selected-directory self-contained workspace initialization (<selected-dir>/.job-search/)
#   - Standalone instant resume updates: ./setup.sh --update-resume <path> [--directory <dir>]
#   - Zero-dependency Local Mode SQLite setup
#   - Neon Mode setup with macOS Keychain integration and DDL runner
#   - Interactive terminal prompts and non-interactive CLI flags
#   - Non-destructive legacy pipeline migration into SQLite
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# ANSI Color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

KEYCHAIN_SERVICE="job-search-automation"
KEYCHAIN_ACCOUNT="neon-connection-string"

# Operational flags & parameters
MODE=""
DIRECTORY=""
WORKFLOW_DATA_PATH=""
RESUME_PATH=""
UPDATE_RESUME_PATH=""
NEON_CONN_STR=""
MIGRATE_FROM=""
CONFIG_FILE=""
NON_INTERACTIVE=false
FORCE=false
MOCK_MODE=false

print_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================="
  echo "        Job Search Automation - Setup & Configuration         "
  echo "=============================================================="
  echo -e "${RESET}"
}

print_help() {
  echo -e "${BOLD}Usage: ./setup.sh [OPTIONS]${RESET}"
  echo ""
  echo -e "${BOLD}Fast-Path Resume Updater:${RESET}"
  echo "  --update-resume <path>       Instantly update resume.pdf in workspace .job-search/"
  echo "  --directory <path>, -d       Project directory containing .job-search/"
  echo ""
  echo -e "${BOLD}Setup Options:${RESET}"
  echo "  --directory <path>, -d       Project workspace directory to initialize (creates <dir>/.job-search/)"
  echo "  --resume <path>              Path to initial resume file to import"
  echo "  --mode <local|neon>          Storage mode ('local' or 'neon', default: local)"
  echo "  --neon-connection-string <s> Neon PostgreSQL connection string (Neon mode)"
  echo "  --migrate-from <path>        Directory containing existing markdown files to migrate"
  echo "  --config-path <path>         Custom path to config.json (for testing/isolation)"
  echo "  --workflow-data-path <path>  Target directory for workflow data (legacy compatibility)"
  echo "  --force                      Overwrite existing files during scaffolding"
  echo "  -y, --non-interactive        Run non-interactively using provided flags/defaults"
  echo "  --mock                       Run database & external operations in mock mode"
  echo "  -h, --help                   Show this help message and exit"
  echo ""
  echo -e "${BOLD}Examples:${RESET}"
  echo "  # Interactive setup:"
  echo "  ./setup.sh"
  echo ""
  echo "  # Fast-path resume update:"
  echo "  ./setup.sh --update-resume ~/Documents/resume.pdf --directory ."
  echo ""
  echo "  # Automated local setup:"
  echo "  ./setup.sh --directory . --resume ./fixtures/resume.pdf -y"
  echo ""
  echo "  # Automated Neon setup:"
  echo "  ./setup.sh --directory . --mode neon --resume ./fixtures/resume.pdf --neon-connection-string \"postgres://...\" -y"
}

expand_path() {
  local p="$1"
  if [[ "$p" == "~"* ]]; then
    p="${p/#\~/$HOME}"
  fi
  echo "$p"
}

read_config_value() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  grep "\"$key\"" "$file" 2>/dev/null | head -n 1 | sed -E "s/.*\"$key\":[[:space:]]*\"([^\"]+)\".*/\1/" || true
}

write_config_json() {
  local cfg_file="$1"
  local mode="$2"
  local db_path="$3"
  local resume_path="$4"
  local wdp="$5"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local cfg_dir
  cfg_dir="$(dirname "$cfg_file")"

  mkdir -p "$cfg_dir"
  chmod 700 "$cfg_dir" 2>/dev/null || true

  local tmp_cfg="${cfg_file}.tmp.$$"
  if [ -n "$wdp" ]; then
    cat << EOF > "$tmp_cfg"
{
  "\$schema": "https://json-schema.org/draft-07/schema#",
  "version": "1.0.0",
  "mode": "${mode}",
  "databasePath": "${db_path}",
  "resumePath": "${resume_path}",
  "workflowDataPath": "${wdp}",
  "updatedAt": "${timestamp}"
}
EOF
  else
    cat << EOF > "$tmp_cfg"
{
  "\$schema": "https://json-schema.org/draft-07/schema#",
  "version": "1.0.0",
  "mode": "${mode}",
  "databasePath": "${db_path}",
  "resumePath": "${resume_path}",
  "updatedAt": "${timestamp}"
}
EOF
  fi
  chmod 600 "$tmp_cfg"
  mv "$tmp_cfg" "$cfg_file"
}

# --- Fast-Path Resume Updater ---
handle_update_resume() {
  local new_resume="$1"
  local cfg_file="$2"
  local dir="$3"

  if [ -z "$new_resume" ]; then
    echo -e "${RED}[ERROR] Resume path missing. Usage: ./setup.sh --update-resume <path>${RESET}" >&2
    exit 1
  fi

  local expanded_resume
  expanded_resume="$(expand_path "$new_resume")"

  if [ ! -f "$expanded_resume" ]; then
    echo -e "${RED}[ERROR] Resume file not found: $expanded_resume${RESET}" >&2
    exit 1
  fi

  # Resolve config file location
  if [ -z "$cfg_file" ]; then
    if [ -n "$dir" ]; then
      local exp_dir
      exp_dir="$(expand_path "$dir")"
      if [[ "$exp_dir" == *".job-search" ]]; then
        cfg_file="$exp_dir/config.json"
      else
        cfg_file="$exp_dir/.job-search/config.json"
      fi
    else
      # Check current directory
      if [ -f "$(pwd)/.job-search/config.json" ]; then
        cfg_file="$(pwd)/.job-search/config.json"
      elif [ -f "$HOME/.config/job-search-automation/config.json" ]; then
        cfg_file="$HOME/.config/job-search-automation/config.json"
      fi
    fi
  fi

  if [ -z "$cfg_file" ] || [ ! -f "$cfg_file" ]; then
    echo -e "${RED}[ERROR] Plugin configuration not found at: ${cfg_file:-<unspecified>}${RESET}" >&2
    echo -e "Please run ${BOLD}./setup.sh --directory <dir> --resume <path>${RESET} first to initialize the workspace." >&2
    exit 1
  fi

  local cfg_dir
  cfg_dir="$(dirname "$cfg_file")"
  local target_resume="$cfg_dir/resume.pdf"

  # Also check if workflowDataPath was configured
  local wdp
  wdp="$(read_config_value "$cfg_file" "workflowDataPath")"
  if [ -n "$wdp" ]; then
    target_resume="$wdp/resume.pdf"
    mkdir -p "$wdp"
  fi

  # Warn if not PDF extension
  if [[ "$expanded_resume" != *.[pP][dD][fF] ]]; then
    echo -e "${YELLOW}[WARNING] Source file does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}"
  fi

  # Atomic copy
  local tmp_target="${target_resume}.tmp.$$"
  cp "$expanded_resume" "$tmp_target"
  chmod 644 "$tmp_target"
  mv "$tmp_target" "$target_resume"

  # If cfg_dir/resume.pdf differs from target_resume, also copy there
  if [ "$target_resume" != "$cfg_dir/resume.pdf" ]; then
    cp "$expanded_resume" "$cfg_dir/resume.pdf"
    chmod 644 "$cfg_dir/resume.pdf"
  fi

  # Update config updatedAt
  local current_mode
  current_mode="$(read_config_value "$cfg_file" "mode")"
  current_mode="${current_mode:-local}"
  write_config_json "$cfg_file" "$current_mode" "./job-search.sqlite" "./resume.pdf" "$wdp"

  echo -e "${GREEN}${BOLD}[SUCCESS] Resume successfully updated at:${RESET} $target_resume"
  exit 0
}

# --- CLI Flag Parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-resume)
      UPDATE_RESUME_PATH="$2"
      shift 2
      ;;
    -d|--directory)
      DIRECTORY="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --workflow-data-path)
      WORKFLOW_DATA_PATH="$2"
      shift 2
      ;;
    --resume)
      RESUME_PATH="$2"
      shift 2
      ;;
    --neon-connection-string)
      NEON_CONN_STR="$2"
      shift 2
      ;;
    --migrate-from)
      MIGRATE_FROM="$2"
      shift 2
      ;;
    --config-path)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -y|--non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --mock)
      MOCK_MODE=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo -e "${RED}[ERROR] Unknown option: $1${RESET}" >&2
      print_help
      exit 1
      ;;
  esac
done

# Check if this is a standalone resume update request
if [ -n "$UPDATE_RESUME_PATH" ]; then
  handle_update_resume "$UPDATE_RESUME_PATH" "$CONFIG_FILE" "$DIRECTORY"
fi

# --- Interactive Prompts ---
if [ "$NON_INTERACTIVE" = false ]; then
  print_banner

  # 1. Directory selection
  if [ -z "$DIRECTORY" ] && [ -z "$CONFIG_FILE" ]; then
    read -r -p "Enter project workspace directory [$(pwd)]: " user_dir
    DIRECTORY="${user_dir:-$(pwd)}"
    echo ""
  fi

  # 2. Mode selection
  if [ -z "$MODE" ]; then
    echo -e "${BOLD}Select Storage Backend:${RESET}"
    echo "  1) Local Mode (SQLite database in .job-search/) [default]"
    echo "  2) Neon Mode (Cloud PostgreSQL + macOS Keychain)"
    read -r -p "Enter choice [1]: " mode_choice
    case "$mode_choice" in
      2|neon|Neon)
        MODE="neon"
        ;;
      *)
        MODE="local"
        ;;
    esac
    echo ""
  fi

  # 3. Resume Path
  if [ -z "$RESUME_PATH" ]; then
    while true; do
      read -r -p "Enter path to your resume file: " user_resume
      if [ -n "$user_resume" ]; then
        expanded_user_resume="$(expand_path "$user_resume")"
        if [ -f "$expanded_user_resume" ]; then
          RESUME_PATH="$user_resume"
          break
        else
          echo -e "${RED}[ERROR] File does not exist: $expanded_user_resume${RESET}"
        fi
      else
        echo -e "${YELLOW}[WARNING] Resume path cannot be empty. Downstream skills require a resume.${RESET}"
      fi
    done
    echo ""
  fi

  # 4. Neon Connection String (if neon mode)
  if [ "$MODE" = "neon" ] && [ -z "$NEON_CONN_STR" ]; then
    echo -e "${BOLD}Enter Neon PostgreSQL Connection String:${RESET}"
    read -r -s -p "(Password/URL will be hidden): " user_conn
    echo ""
    NEON_CONN_STR="$user_conn"
    if [ -z "$NEON_CONN_STR" ]; then
      echo -e "${RED}[ERROR] Neon connection string cannot be empty in Neon mode.${RESET}" >&2
      exit 1
    fi
    echo ""
  fi

  # 5. Migration (optional)
  if [ -z "$MIGRATE_FROM" ]; then
    read -r -p "Do you have existing markdown pipeline files to migrate? [y/N]: " migrate_choice
    case "$migrate_choice" in
      y|Y|yes|Yes)
        read -r -p "Enter directory containing existing markdown files: " user_source
        MIGRATE_FROM="$user_source"
        ;;
    esac
    echo ""
  fi
fi

# --- Non-Interactive Validation & Defaults ---
MODE="${MODE:-local}"
if [ "$MODE" != "local" ] && [ "$MODE" != "neon" ]; then
  echo -e "${RED}[ERROR] Invalid mode: '$MODE'. Must be 'local' or 'neon'.${RESET}" >&2
  exit 1
fi

# Resolve Directory and Paths
if [ -n "$DIRECTORY" ]; then
  DIRECTORY="$(expand_path "$DIRECTORY")"
  if [[ "$DIRECTORY" == *".job-search" ]]; then
    JOB_SEARCH_DIR="$DIRECTORY"
    PROJECT_DIR="$(dirname "$DIRECTORY")"
  else
    JOB_SEARCH_DIR="$DIRECTORY/.job-search"
    PROJECT_DIR="$DIRECTORY"
  fi
  CONFIG_FILE="${CONFIG_FILE:-$JOB_SEARCH_DIR/config.json}"
elif [ -n "$CONFIG_FILE" ]; then
  CONFIG_FILE="$(expand_path "$CONFIG_FILE")"
  JOB_SEARCH_DIR="$(dirname "$CONFIG_FILE")"
  PROJECT_DIR="$(dirname "$JOB_SEARCH_DIR")"
elif [ -n "$WORKFLOW_DATA_PATH" ]; then
  WORKFLOW_DATA_PATH="$(expand_path "$WORKFLOW_DATA_PATH")"
  JOB_SEARCH_DIR="$WORKFLOW_DATA_PATH"
  PROJECT_DIR="$(dirname "$WORKFLOW_DATA_PATH")"
  CONFIG_FILE="${CONFIG_FILE:-$JOB_SEARCH_DIR/config.json}"
else
  # Default to current working directory
  PROJECT_DIR="$(pwd)"
  JOB_SEARCH_DIR="$PROJECT_DIR/.job-search"
  CONFIG_FILE="$JOB_SEARCH_DIR/config.json"
fi

if [ -z "$RESUME_PATH" ]; then
  echo -e "${RED}[ERROR] Resume path is required. Specify via --resume <path>${RESET}" >&2
  exit 1
fi

RESUME_PATH="$(expand_path "$RESUME_PATH")"
if [ ! -f "$RESUME_PATH" ]; then
  echo -e "${RED}[ERROR] Resume file not found at: $RESUME_PATH${RESET}" >&2
  exit 1
fi

if [ "$MODE" = "neon" ] && [ -z "$NEON_CONN_STR" ] && [ "$MOCK_MODE" = false ]; then
  # Check if already in Keychain or environment
  if ! security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w >/dev/null 2>&1 && [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}[ERROR] Neon connection string required in Neon mode. Provide via --neon-connection-string or interactive prompt.${RESET}" >&2
    exit 1
  fi
fi

# --- Execute Setup ---
echo -e "${CYAN}[*] Initializing Job Search Plugin (${BOLD}${MODE} mode${RESET}${CYAN})...${RESET}"

# 1. Prepare Workspace .job-search Directory
mkdir -p "$JOB_SEARCH_DIR"
echo -e "${GREEN}[+] Workspace directory ready:${RESET} $JOB_SEARCH_DIR"

# 2. Copy Resume to conventional path
TARGET_RESUME="$JOB_SEARCH_DIR/resume.pdf"
if [[ "$RESUME_PATH" != *.[pP][dD][fF] ]]; then
  echo -e "${YELLOW}[WARNING] Resume does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}"
fi

cp "$RESUME_PATH" "$TARGET_RESUME.tmp.$$"
chmod 644 "$TARGET_RESUME.tmp.$$"
mv "$TARGET_RESUME.tmp.$$" "$TARGET_RESUME"
echo -e "${GREEN}[+] Resume installed to:${RESET} $TARGET_RESUME"

# If legacy WORKFLOW_DATA_PATH was specified, also place resume there
if [ -n "$WORKFLOW_DATA_PATH" ] && [ "$WORKFLOW_DATA_PATH" != "$JOB_SEARCH_DIR" ]; then
  mkdir -p "$WORKFLOW_DATA_PATH"
  cp "$RESUME_PATH" "$WORKFLOW_DATA_PATH/resume.pdf"
fi

# 3. Mode-Specific Setup
TARGET_SQLITE="$JOB_SEARCH_DIR/job-search.sqlite"

if [ "$MODE" = "local" ]; then
  echo -e "${CYAN}[*] Initializing SQLite database at $TARGET_SQLITE...${RESET}"

  node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('$TARGET_SQLITE');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(\`
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        careers_url TEXT NOT NULL,
        is_excluded INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        last_searched_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_companies_last_searched ON companies(last_searched_at ASC) WHERE is_excluded = 0;

    CREATE TABLE IF NOT EXISTS title_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('include', 'exclude')),
        level TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT uq_pattern_type UNIQUE (pattern, type)
    );

    CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT,
        importance TEXT DEFAULT 'preferred',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scoring_rubric (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dimension TEXT NOT NULL UNIQUE,
        weight REAL NOT NULL,
        poor_description TEXT,
        moderate_description TEXT,
        strong_description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crawl_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        company_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assessed', 'skipped')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_queue_company_status ON crawl_queue(company_name, status);

    CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        location TEXT,
        score REAL,
        breakdown TEXT,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer')),
        notes TEXT,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
    CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

    CREATE TABLE IF NOT EXISTS run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        mode TEXT NOT NULL,
        companies_processed TEXT NOT NULL DEFAULT '[]',
        urls_queued INTEGER NOT NULL DEFAULT 0,
        candidates_scored INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        details TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_run_logs_timestamp ON run_logs(timestamp DESC);
  \`);

  const cnt = db.prepare('SELECT COUNT(*) as count FROM scoring_rubric').get().count;
  if (cnt === 0) {
    const ins = db.prepare('INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description) VALUES (?, ?, ?, ?, ?)');
    ins.run('Title match', 25, 'Little to no title relevance', 'Partial title keyword overlap', 'Exact title match or target senior/lead level');
    ins.run('Skills match', 30, 'Missing required core stack', 'Has some core skills, missing others', 'Full alignment with required and preferred stack');
    ins.run('Experience match', 25, 'Insufficient domain/system scale', 'Relevant domain, minor gaps in scale', 'Proven track record in equivalent problem domain');
    ins.run('Seniority fit', 20, 'Misaligned seniority level', 'Adjacent seniority level', 'Matches target Staff/Principal IC level');
  }
  db.close();
  "
  echo -e "${GREEN}[+] SQLite schema initialized and seeded.${RESET}"

  # Also scaffold markdown templates if legacy WORKFLOW_DATA_PATH was specified
  if [ -n "$WORKFLOW_DATA_PATH" ]; then
    templates=(
      "target-companies.md"
      "target-job-titles-and-skills.md"
      "scoring-rubric.md"
      "crawl-queue.md"
      "job-candidates.md"
      "logs.md"
    )
    for tmpl in "${templates[@]}"; do
      src_file="$TEMPLATES_DIR/$tmpl"
      dest_file="$WORKFLOW_DATA_PATH/$tmpl"
      if [ -f "$src_file" ]; then
        if [ ! -f "$dest_file" ] || [ "$FORCE" = true ]; then
          cp "$src_file" "$dest_file"
          chmod 644 "$dest_file"
        fi
      fi
    done
  fi

  # Generate .gitignore inside .job-search/
  cat << 'EOF' > "$JOB_SEARCH_DIR/.gitignore"
# Local SQLite database and journal files
job-search.sqlite*
tmp/
EOF
  chmod 644 "$JOB_SEARCH_DIR/.gitignore"

elif [ "$MODE" = "neon" ]; then
  # Store in Keychain if provided
  if [ -n "$NEON_CONN_STR" ]; then
    echo -e "${CYAN}[*] Securing Neon connection string in macOS Keychain...${RESET}"
    if [ "$MOCK_MODE" = false ]; then
      security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$NEON_CONN_STR" -U
      echo -e "${GREEN}[+] Connection string stored in Keychain (service: $KEYCHAIN_SERVICE, account: $KEYCHAIN_ACCOUNT)${RESET}"
    else
      echo -e "${YELLOW}[*] Mock mode: Skipped macOS Keychain storage.${RESET}"
    fi
  fi

  # Run init-neon.js
  echo -e "${CYAN}[*] Running Neon initialization and rubric seeding...${RESET}"
  INIT_ARGS=()
  if [ "$MOCK_MODE" = true ]; then
    INIT_ARGS+=("--mock")
  elif [ -n "$NEON_CONN_STR" ]; then
    INIT_ARGS+=("--connection-string" "$NEON_CONN_STR")
  fi

  node "$SCRIPT_DIR/scripts/init-neon.js" "${INIT_ARGS[@]}"
fi

# 4. Write config.json
CONFIG_FILE="$(expand_path "$CONFIG_FILE")"
write_config_json "$CONFIG_FILE" "$MODE" "./job-search.sqlite" "./resume.pdf" "$WORKFLOW_DATA_PATH"
echo -e "${GREEN}[+] Configuration written to:${RESET} $CONFIG_FILE"

# 4.1 Build MCP Database Server if dist is missing
DB_DIR="$SCRIPT_DIR/packages/job-search-db"
if [ -d "$DB_DIR" ] && [ ! -f "$DB_DIR/dist/index.js" ]; then
  echo -e "${CYAN}[*] Notice: Installing dependencies and compiling job-search-db MCP server...${RESET}"
  if [ ! -d "$DB_DIR/node_modules" ]; then
    npm install --prefix "$DB_DIR" --silent
  fi
  npm run build --prefix "$DB_DIR" --silent
  echo -e "${GREEN}[+] job-search-db MCP server successfully built.${RESET}"
fi

# 4.2 Build UI Dashboard if dist is missing
UI_DIR="$SCRIPT_DIR/packages/job-search-ui"
if [ -d "$UI_DIR" ] && [ ! -f "$UI_DIR/dist/server.js" ]; then
  echo -e "${CYAN}[*] Notice: Installing dependencies and compiling job-search-ui dashboard...${RESET}"
  if [ ! -d "$UI_DIR/node_modules" ]; then
    npm install --prefix "$UI_DIR" --silent
  fi
  npm run build --prefix "$UI_DIR" --silent
  echo -e "${GREEN}[+] job-search-ui dashboard successfully built.${RESET}"
fi

# 5. Run Migration if requested
if [ -n "$MIGRATE_FROM" ]; then
  EXPANDED_MIGRATE="$(expand_path "$MIGRATE_FROM")"
  if [ -d "$EXPANDED_MIGRATE" ]; then
    echo -e "${CYAN}[*] Executing migration from $EXPANDED_MIGRATE...${RESET}"
    MIGRATE_ARGS=("--source" "$EXPANDED_MIGRATE" "--mode" "$MODE" "--database" "$TARGET_SQLITE" "--config-path" "$CONFIG_FILE")
    if [ -n "$WORKFLOW_DATA_PATH" ]; then
      MIGRATE_ARGS+=("--workflow-data-path" "$WORKFLOW_DATA_PATH")
    fi
    if [ "$MOCK_MODE" = true ]; then
      MIGRATE_ARGS+=("--mock")
    fi
    node "$SCRIPT_DIR/scripts/migrate.js" "${MIGRATE_ARGS[@]}"
  else
    echo -e "${RED}[ERROR] Migration source directory not found: $EXPANDED_MIGRATE${RESET}" >&2
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}==============================================================${RESET}"
echo -e "${GREEN}${BOLD}  Setup Complete! Job Search Automation is ready to use.      ${RESET}"
echo -e "${GREEN}${BOLD}==============================================================${RESET}"
echo -e "  Mode:              ${BOLD}$MODE${RESET}"
echo -e "  Workspace Dir:     ${BOLD}$JOB_SEARCH_DIR${RESET}"
echo -e "  Database:          ${BOLD}$TARGET_SQLITE${RESET}"
echo -e "  Resume:            ${BOLD}$TARGET_RESUME${RESET}"
echo -e "  Configuration:     ${BOLD}$CONFIG_FILE${RESET}"
echo ""
echo -e "To update your resume in the future, run:"
echo -e "  ${BOLD}./setup.sh --update-resume <path-to-new-resume.pdf> --directory \"$PROJECT_DIR\"${RESET}"
echo ""
echo -e "${CYAN}${BOLD}Recurring Pipeline Runs:${RESET}"
echo "  Use the /schedule command to run the lead-gen orchestrator automatically:"
echo "  /schedule CronExpression=\"0 9 * * 1-5\" Prompt=\"Run job-search-lead-gen for a batch of 5 companies in directory '$PROJECT_DIR'\""
echo ""
