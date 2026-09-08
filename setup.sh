#!/usr/bin/env bash

# ==============================================================================
# setup.sh - Job Search Plugin Setup & Configuration Orchestrator
#
# Supports:
#   - Standalone instant resume updates: ./setup.sh --update-resume <path>
#   - Zero-dependency Local Mode setup (pure native Bash)
#   - Neon Mode setup with macOS Keychain integration and DDL runner
#   - Interactive terminal prompts and non-interactive CLI flags
#   - Legacy markdown pipeline migration
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

# Default configuration settings
DEFAULT_CONFIG_DIR="$HOME/.config/job-search-automation"
DEFAULT_CONFIG_FILE="$DEFAULT_CONFIG_DIR/config.json"
DEFAULT_WDP="$HOME/.local/share/job-search-automation"

KEYCHAIN_SERVICE="job-search-automation"
KEYCHAIN_ACCOUNT="neon-connection-string"

# Operational flags & parameters
MODE=""
WORKFLOW_DATA_PATH=""
RESUME_PATH=""
UPDATE_RESUME_PATH=""
NEON_CONN_STR=""
MIGRATE_FROM=""
CONFIG_FILE="$DEFAULT_CONFIG_FILE"
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
  echo "  --update-resume <path>       Instantly update resume.pdf in workflowDataPath"
  echo ""
  echo -e "${BOLD}Setup Options:${RESET}"
  echo "  --mode <local|neon>          Storage mode ('local' or 'neon')"
  echo "  --workflow-data-path <path>  Target directory for workflow data and resume"
  echo "                               (default: ~/.local/share/job-search-automation/)"
  echo "  --resume <path>              Path to initial resume file to import"
  echo "  --neon-connection-string <s> Neon PostgreSQL connection string (Neon mode)"
  echo "  --migrate-from <path>        Directory containing existing markdown files to migrate"
  echo "  --config-path <path>         Custom path to config.json (for testing/isolation)"
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
  echo "  ./setup.sh --update-resume ~/Documents/resume.pdf"
  echo ""
  echo "  # Automated local setup:"
  echo "  ./setup.sh --mode local --resume ./fixtures/resume.pdf -y"
  echo ""
  echo "  # Automated Neon setup:"
  echo "  ./setup.sh --mode neon --resume ./fixtures/resume.pdf --neon-connection-string \"postgres://...\" -y"
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
  local wdp="$3"
  local resume_path="$4"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local cfg_dir
  cfg_dir="$(dirname "$cfg_file")"

  mkdir -p "$cfg_dir"
  chmod 700 "$cfg_dir" 2>/dev/null || true

  local tmp_cfg="${cfg_file}.tmp.$$"
  cat << EOF > "$tmp_cfg"
{
  "\$schema": "https://json-schema.org/draft-07/schema#",
  "version": "1.0.0",
  "mode": "${mode}",
  "workflowDataPath": "${wdp}",
  "resumePath": "${resume_path}",
  "updatedAt": "${timestamp}"
}
EOF
  chmod 600 "$tmp_cfg"
  mv "$tmp_cfg" "$cfg_file"
}

# --- Fast-Path Resume Updater ---
handle_update_resume() {
  local new_resume="$1"
  local cfg_file="$2"

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

  if [ ! -f "$cfg_file" ]; then
    echo -e "${RED}[ERROR] Plugin configuration not found at: $cfg_file${RESET}" >&2
    echo -e "Please run ${BOLD}./setup.sh${RESET} first to initialize the plugin." >&2
    exit 1
  fi

  local wdp
  wdp="$(read_config_value "$cfg_file" "workflowDataPath")"
  if [ -z "$wdp" ]; then
    echo -e "${RED}[ERROR] workflowDataPath not found in config: $cfg_file${RESET}" >&2
    exit 1
  fi

  local target_resume="$wdp/resume.pdf"
  mkdir -p "$wdp"

  # Warn if not PDF extension
  if [[ "$expanded_resume" != *.[pP][dD][fF] ]]; then
    echo -e "${YELLOW}[WARNING] Source file does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}"
  fi

  # Atomic copy
  local tmp_target="${target_resume}.tmp.$$"
  cp "$expanded_resume" "$tmp_target"
  chmod 644 "$tmp_target"
  mv "$tmp_target" "$target_resume"

  # Update config updatedAt
  local current_mode
  current_mode="$(read_config_value "$cfg_file" "mode")"
  current_mode="${current_mode:-local}"
  write_config_json "$cfg_file" "$current_mode" "$wdp" "$target_resume"

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
  handle_update_resume "$UPDATE_RESUME_PATH" "$CONFIG_FILE"
fi

# --- Interactive Prompts ---
if [ "$NON_INTERACTIVE" = false ]; then
  print_banner

  # 1. Mode selection
  if [ -z "$MODE" ]; then
    echo -e "${BOLD}Select Storage Backend:${RESET}"
    echo "  1) Local Mode (Markdown files in workflowDataPath) [default]"
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

  # 2. Workflow Data Path
  if [ -z "$WORKFLOW_DATA_PATH" ]; then
    read -r -p "Enter workflow data directory [~/.local/share/job-search-automation]: " user_wdp
    WORKFLOW_DATA_PATH="${user_wdp:-$DEFAULT_WDP}"
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

WORKFLOW_DATA_PATH="${WORKFLOW_DATA_PATH:-$DEFAULT_WDP}"
WORKFLOW_DATA_PATH="$(expand_path "$WORKFLOW_DATA_PATH")"

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

# 1. Prepare Workflow Data Directory
mkdir -p "$WORKFLOW_DATA_PATH"
echo -e "${GREEN}[+] Workflow data directory ready:${RESET} $WORKFLOW_DATA_PATH"

# 2. Copy Resume to conventional path
TARGET_RESUME="$WORKFLOW_DATA_PATH/resume.pdf"
if [[ "$RESUME_PATH" != *.[pP][dD][fF] ]]; then
  echo -e "${YELLOW}[WARNING] Resume does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}"
fi

cp "$RESUME_PATH" "$TARGET_RESUME.tmp.$$"
chmod 644 "$TARGET_RESUME.tmp.$$"
mv "$TARGET_RESUME.tmp.$$" "$TARGET_RESUME"
echo -e "${GREEN}[+] Resume installed to conventional path:${RESET} $TARGET_RESUME"

# 3. Mode-Specific Setup
if [ "$MODE" = "local" ]; then
  echo -e "${CYAN}[*] Scaffolding canonical markdown templates into $WORKFLOW_DATA_PATH...${RESET}"
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
    if [ ! -f "$src_file" ]; then
      echo -e "${RED}[ERROR] Template file missing: $src_file${RESET}" >&2
      exit 1
    fi
    if [ -f "$dest_file" ] && [ "$FORCE" = false ]; then
      echo -e "    ${YELLOW}~ Skipping existing file:${RESET} $tmpl (use --force to overwrite)"
    else
      cp "$src_file" "$dest_file"
      chmod 644 "$dest_file"
      echo -e "    ${GREEN}+ Scaffolding:${RESET} $tmpl"
    fi
  done

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
write_config_json "$CONFIG_FILE" "$MODE" "$WORKFLOW_DATA_PATH" "$TARGET_RESUME"
echo -e "${GREEN}[+] Configuration written to:${RESET} $CONFIG_FILE"

# 5. Run Migration if requested
if [ -n "$MIGRATE_FROM" ]; then
  EXPANDED_MIGRATE="$(expand_path "$MIGRATE_FROM")"
  if [ -d "$EXPANDED_MIGRATE" ]; then
    echo -e "${CYAN}[*] Executing migration from $EXPANDED_MIGRATE...${RESET}"
    MIGRATE_ARGS=("--source" "$EXPANDED_MIGRATE" "--mode" "$MODE" "--workflow-data-path" "$WORKFLOW_DATA_PATH" "--config-path" "$CONFIG_FILE")
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
echo -e "  Data Directory:    ${BOLD}$WORKFLOW_DATA_PATH${RESET}"
echo -e "  Resume:            ${BOLD}$TARGET_RESUME${RESET}"
echo -e "  Configuration:     ${BOLD}$CONFIG_FILE${RESET}"
echo ""
echo -e "To update your resume in the future, simply run:"
echo -e "  ${BOLD}./setup.sh --update-resume <path-to-new-resume.pdf>${RESET}"
echo ""
echo -e "${CYAN}${BOLD}Recurring Pipeline Runs:${RESET}"
echo "  Use the /schedule command to run the lead-gen orchestrator automatically:"
echo "  /schedule CronExpression=\"0 9 * * 1-5\" Prompt=\"Run job-search-lead-gen for a batch of 5 companies\""
echo ""
