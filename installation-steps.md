# Job Search Automation: Installation, Configuration & LLM Onboarding Guide

Comprehensive, harness-agnostic guide for installing, configuring, and running the Job Search Automation plugin. This guide serves both human users and AI agent assistants (**GitHub Copilot**, **Claude Desktop & Code**, **OpenAI Codex**, **ChatGPT**, **Cursor**, **Windsurf**, and all **Agent Plugins v1** and **MCP** compliant harnesses), providing detailed technical references and step-by-step onboarding interview protocols.

---

## 1. Prerequisites

- **Node.js**: Version 18 or higher (`node -v`).
- **Resume**: A PDF copy of your resume (e.g. `~/Documents/resume.pdf`).
- **Storage Mode**:
  - **Local SQLite (Default, Recommended)**: Zero-dependency, 100% private, runs entirely on your local machine.
  - **Neon PostgreSQL (Optional)**: Cloud-hosted PostgreSQL. Requires a Neon connection string.

---

## Step 1: Universal Zero-Clone Installation via `npx`

> [!TIP]
> **Expert Tip**: Create a dedicated new workspace directory (e.g., `mkdir job-search && cd job-search`) before installing. This keeps your job search database, resume, and MCP configuration cleanly isolated from other coding projects.

The plugin installs directly from GitHub into a temporary cache without cloning source code or git history into your workspace:

```bash
# Universal / Standard installation (GitHub Copilot, Cursor, Windsurf, standard default):
npx -y github:joshyim/job-search-automations setup

# Or explicitly targeting your active harness:
npx -y github:joshyim/job-search-automations setup --copilot
npx -y github:joshyim/job-search-automations setup --claude
npx -y github:joshyim/job-search-automations setup --codex
```

Run this command inside your target project workspace. It initializes the `.job-search/` workspace, installs pre-built artifacts directly with zero client-side compilation, configures MCP stdio access, mounts skills, and sets up harness integration.

> [!NOTE]
> **Container & Sandbox Environments**: The package ships pre-built and requires zero client-side compilation or development tooling (~1.1 MB download). If your container or cloud environment encounters an `EACCES` permission error due to root-owned cache files in `~/.npm`, fix cache ownership by running:
> ```bash
> sudo chown -R "$(whoami)" ~/.npm
> ```

### Setup Options & Flags

All flags are optional when running inside your target workspace:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-d, --directory <path>` | Target workspace directory | Current working directory |
| `--harness <standard\|copilot\|claude\|codex\|both>` | Target agent harness | Auto-detect (fallback: `standard`) |
| `--standard` | Target standard Agent Plugins / MCP harness | `true` (if no harness detected) |
| `--copilot` | Target GitHub Copilot / VS Code harness | `false` |
| `--codex` | Target OpenAI Codex / ChatGPT desktop harness | `false` |
| `--claude` | Target Claude Code / Claude Desktop harness | `false` |
| `--both` | Target both Claude and Codex harnesses | `false` |
| `--resume <path>` | Path to resume PDF (auto-detects local `resume.pdf` if omitted) | Optional (prompted or updated later) |
| `--mode <local\|neon>` | Storage backend mode | `local` |
| `--neon-connection-string <s>` | Neon PostgreSQL connection string (Neon mode only) | None |
| `--install-to <path>` | Custom plugin installation directory | Auto-resolved by harness |
| `--force` | Overwrite existing configurations during scaffolding | `false` |
| `-y, --non-interactive` | Run non-interactively using supplied flags | Interactive if missing flags |
| `--mock` | Mock mode for testing without database credentials | `false` |

### Cloud Mode (Neon PostgreSQL) Example

```bash
npx -y github:joshyim/job-search-automations setup \
  --directory "<path-to-workspace>" \
  --resume "<path-to-resume.pdf>" \
  --mode neon \
  --neon-connection-string "postgres://user:password@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  -y
```

### What Setup Scaffolds

Setup automatically establishes a clean, self-contained architecture inside your workspace tailored to the targeted harness:

1. **Persistent Workspace Data (`<workspace>/.job-search/`)** *(All Harnesses)*:
   - `job-search.sqlite`: Local SQLite database (initialized with schema, indices, and default scoring rubric).
   - `resume.pdf`: Verified copy of the candidate resume.
   - `config.json`: Runtime configuration pointing to active storage mode.
   - `tmp/`: Flat temporary directory for staging lightweight crawler outputs (auto-cleaned after runs).
2. **Read-Only Plugin Assets**:
   - **Standard & Copilot**: Installed in `<workspace>/.agents/plugins/job-search-automations/`.
   - **Claude**: Installed in `<workspace>/.claude/plugins/job-search-automations/`.
   - **Codex**: Installed in `<workspace>/.codex/plugins/job-search-automations/`.
   - Contains pre-compiled packages (`packages/job-search-db`, `packages/job-search-ui`), `skills/`, `scripts/crawl-job-board.js`, and manifests.
3. **MCP Server Integration**:
   - **Standard**: Configured in `<workspace>/.mcp.json` pointing to `packages/job-search-db/scripts/start.js`.
   - **GitHub Copilot**: Configured in `<workspace>/.vscode/mcp.json` (and `.mcp.json`) for native VS Code Copilot Chat MCP integration.
   - **Claude**: Configured in `<workspace>/.mcp.json` (and `mcp.json`) pointing to `packages/job-search-db/scripts/start.js`.
   - **Codex**: Configured in `<workspace>/.codex/config.toml` with `[mcp_servers.job-search-db]` using plugin-relative path and `default_tools_approval_mode = "writes"`.
4. **Skills & Agent Guidelines**:
   - **Standard, Copilot & Codex**: Skills mirrored into `<workspace>/.agents/skills/` (with crawler script) for native discovery and guided by `<workspace>/AGENTS.md`.
   - **Claude**: Skills discovered from `.claude/plugins/job-search-automations/skills/` and guided by `CLAUDE.md`.
5. **Desktop & Agent Configuration (Claude Only)**:
   - `<workspace>/.claude/launch.json`: Claude Desktop web preview entry for the local UI dashboard.
   - `<workspace>/.claude/settings.json`: Pre-configures `"defaultMode": "auto"` and pre-grants permissions for unattended runs.

> **LLM Execution Directive:**
> When the user asks to install the plugin, detect your active host harness:
> - If running in **Claude Code** or **Claude Desktop**: execute `npx -y github:joshyim/job-search-automations setup --claude` in the workspace.
> - If running in **OpenAI Codex** or **ChatGPT**: execute `npx -y github:joshyim/job-search-automations setup --codex` in the workspace.
> - If running in **GitHub Copilot** or **VS Code**: execute `npx -y github:joshyim/job-search-automations setup --copilot` in the workspace.
> - For all other harnesses or standard Agent Plugin environments: run `npx -y github:joshyim/job-search-automations setup`.
> Confirm scaffolded assets and inform the user of the quick reload step.

---

## Step 2: Harness Restart & System Verification

### Why a Restart is Required
Agent harnesses parse configuration files (`.vscode/mcp.json`, `.mcp.json`, or `.codex/config.toml`) and register skills during session initialization. After running the installation command, the host session must be reloaded or restarted so that:
- The stdio connection to `packages/job-search-db/scripts/start.js` is established.
- The 6 specification-conformant skills in `skills/` (or `.agents/skills/`) are indexed into the agent's available toolset.

### Restart Instructions by Harness
- **GitHub Copilot / VS Code**: Press `Cmd+Shift+P` (or `Ctrl+Shift+P`) → select **Developer: Reload Window**.
- **Claude Desktop**: Restart the Claude Desktop application or reopen the project workspace folder.
- **Claude Code CLI**: Exit your current session (`Ctrl+C` or `/exit`) and re-launch `claude` in your workspace directory.
- **Codex / ChatGPT**: Reload the workspace window or run `/mcp` (or `codex mcp list`) in chat to inspect and reload active MCP servers.
- **Standard Harnesses**: Reconnect MCP stdio server or restart agent session.

### MCP Tools Verification
Verify that the `job-search-db` MCP server is active by calling `select_workspace` or listing available tools:

| MCP Tool | Category | Operational Purpose |
| :--- | :--- | :--- |
| `select_workspace` | Workspace | Validates directory path, detects mode, and verifies database connectivity |
| `list_companies` | Companies | Lists all tracked target employers and crawl statuses |
| `add_company` | Companies | Inserts a new hiring employer with its careers page URL |
| `upsert_company` | Companies | Updates or adds company records and exclusion flags |
| `update_company_crawl_status` | Companies | Updates timestamp and status of last crawl pass |
| `list_title_patterns` | Titles | Lists positive include and negative exclude title filters |
| `add_title_pattern` | Titles | Adds a title matching or exclusion pattern |
| `list_skills` | Skills | Lists tracked candidate skills and weighting |
| `set_skill_weight` | Skills | Configures skill priority (P1 must-have vs P2 preferred) |
| `get_scoring_rubric` | Rubric | Retrieves current rubric dimensions and weight breakdown |
| `upsert_rubric_dimension` | Rubric | Updates or creates a scoring rubric evaluation dimension |
| `get_batch` | Pipeline | Pulls least-recently-searched companies for crawl runs |
| `get_pending_queue` | Pipeline | Pulls enqueued job postings awaiting assessment |
| `update_queue_status` | Pipeline | Marks postings as evaluated, skipped, or failed |
| `add_candidate` | Candidates | Records scored job match (always default to status `'new'`) |
| `list_candidates` | Candidates | Lists scored matches with rubric breakdowns |
| `log_run` & `get_run_logs` | Telemetry | Records operational logs and metrics across routine runs |

### Skills Verification
Verify that the 6 skills are registered:
1. `company-search`: Discovers hiring companies across YC, BuiltIn, Wellfound, and LinkedIn.
2. `title-discovery`: Uncovers title variants and patterns matching candidate skills.
3. `job-search-crawl`: Crawls company career pages and queues matching postings.
4. `job-search-assess`: Scores pending postings against resume and rubric.
5. `job-search-lead-gen`: End-to-end orchestrator combining crawl and assessment.
6. `pipeline-diagram`: Generates Mermaid pipeline architecture diagrams.

---

## Step 3: Canonical Routines Activation & Auto Permissions

Recurring routines automate discovery, crawling, and assessment on an unattended daily cadence.

> [!CRITICAL]
> **Strict Anti-Hallucination Guardrail: No "Weekly Digest" Routine**
> There is **NO Weekly Digest routine** in this repository. Agents must never create, suggest, or schedule a weekly digest. Only configure the 4 canonical routines defined below.

> [!IMPORTANT]
> **Mandatory Auto Approval for Canonical Routines**
> All 4 canonical routines run unattended in the background. They must always be configured with **Auto** approval (`permissionMode: "auto"`). In Claude Desktop under **Scheduled**, routines should display as `[Schedule] · Auto` (e.g., `6:00 AM every day · Auto`). Never leave them in "Manual" approval mode, as unapproved prompts will stall unattended execution.

> [!TIP]
> **Recommended Model Classes for Routines**
> Recurring unattended routines run daily and execute high volumes of tool calls, web searches, and scraping passes. To optimize token costs and preserve quota, configure routines to use balanced, cost-effective model classes rather than defaulting to expensive flagship/frontier models (like Opus):
> - **Claude Code / Desktop**: Recommend **Sonnet-class** (e.g., latest Sonnet).
> - **OpenAI / Codex**: Recommend **Luna-class** (or latest lightweight/balanced model).
> - **GitHub Copilot**: Recommend **Claude 3.5 Sonnet** or **GPT-4o-mini**.

### The 4 Canonical Routines

| Routine # | Routine Name | Target Skill | Recommended Cadence | Recommended Model Class | Unattended Limits |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Daily Company Search** | `company-search` | Daily 8:00 PM (`0 20 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) / GPT-4o-mini (Copilot) | Max 3–5 new qualified companies; budget 30–40 messages |
| **2** | **Daily Job Title Search** | `title-discovery` | Daily 9:00 PM (`0 21 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) / GPT-4o-mini (Copilot) | Max 1–3 new patterns; budget 25–35 messages |
| **3** | **Daily Job Crawl** | `job-search-crawl` / `job-search-lead-gen` | Daily 6:00 AM (`0 6 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) / GPT-4o-mini (Copilot) | Batch 2–3 companies (`get_batch({ limit: 3 })`); budget 40–50 messages |
| **4** | **Daily Job Evaluation** | `job-search-assess` | Daily 7:00 AM (`0 7 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) / GPT-4o-mini (Copilot) | Batch 5 pending postings (`get_pending_queue`); budget 40–50 messages |

### Routine Prompts

#### Routine 1: Daily Company Search (`company-search`)
```text
/schedule CronExpression="0 20 * * *" Prompt="Run company-search to discover new hiring companies matching candidate target roles across YC, BuiltIn, Wellfound, and LinkedIn. Add at most 3-5 newly qualified companies via add_company. Complete within 35 messages. Never use browser automation."
```

#### Routine 2: Daily Job Title Search (`title-discovery`)
```text
/schedule CronExpression="0 21 * * *" Prompt="Run title-discovery to inspect current job listings for title variants matching candidate P1/P2 skills. Add at most 1-3 new validated include or exclude patterns via add_title_pattern. Complete within 30 messages."
```

#### Routine 3: Daily Job Crawl (`job-search-crawl` / `job-search-lead-gen`)
```text
/schedule CronExpression="0 6 * * *" Prompt="Run job-search-crawl across least-recently-searched companies using get_batch({ limit: 3 }). Match postings against title patterns and enqueue matched roles via add_to_queue. Complete within 45 messages. Fast-fail unreachable URLs."
```

#### Routine 4: Daily Job Evaluation (`job-search-assess`)
```text
/schedule CronExpression="0 7 * * *" Prompt="Run job-search-assess for up to 5 pending postings from get_pending_queue. Score against candidate resume and scoring rubric, and record each scored candidate via add_candidate with status 'new'. Complete within 45 messages."
```

---

## Step 4: LLM Operational Guide: Conversational Profile Intake & Initial Setup

This section outlines the exact conversational workflow and operational protocol that the AI assistant (LLM) must follow to onboard the user after installation and restart.

### 1. Resume Ingestion & Background Extraction
1. **Prompt the User**:
   > *"Please provide the path to your resume PDF (e.g., `~/Documents/resume.pdf` or drag-and-drop it into the chat)."*
2. **Execute Ingestion**:
   - If a path is provided, copy the file to `<workspace>/.job-search/resume.pdf` or run:
     ```bash
     npx -y github:joshyim/job-search-automations update-resume "<path-to-resume>" --directory "<path-to-workspace>"
     ```
3. **Candidate Profile Extraction**:
   - Extract key candidate attributes: seniority level (e.g., Staff, Principal, Senior), domain specialties (e.g., Fintech, Developer Tools, Distributed Systems), and core technical skills.

### 2. Target Companies & Exclusions Setup
1. **Prompt the User**:
   > *"What target companies would you like to track first? Are there any specific companies, staffing agencies, or industries you would like to exclude or avoid?"*
2. **Register Target Companies**:
   - For each target company, locate the official careers page URL (e.g. Greenhouse, Lever, Ashby, or company careers site).
   - Call MCP tool `add_company`:
     ```json
     {
       "name": "Stripe",
       "careers_url": "https://stripe.com/jobs"
     }
     ```
3. **Register Excluded Companies**:
   - For excluded companies or staffing agencies, insert them with `is_excluded: 1` or add notes so they are skipped by `company-search` and crawler routines.

### 3. Job Title Patterns: Inclusions & Exclusions
1. **Propose Positive Patterns**:
   - Based on candidate seniority and resume, suggest 3–5 positive title patterns:
     > *"Based on your background, I suggest tracking titles like: `Staff Product Manager`, `Principal Product Manager`, and `Lead Product Manager`. Do these match what you're targeting?"*
   - Register confirmed positive patterns via `add_title_pattern`:
     ```json
     {
       "pattern": "Staff Product Manager",
       "pattern_type": "include"
     }
     ```
2. **Identify Exclusion Patterns**:
   - Ask the user for negative keywords or roles outside their interest (e.g., `Junior`, `Associate`, `Sales Engineer`, `Intern`):
     > *"Are there any titles or keywords you want to strictly filter out (for example: `Junior`, `Contract`, `Sales Engineer`)?"*
   - Register negative patterns via `add_title_pattern`:
     ```json
     {
       "pattern": "Junior",
       "pattern_type": "exclude"
     }
     ```

### 4. Core Skills Prioritization (P1 vs. P2)
1. **Identify Key Skills**:
   - Highlight candidate's top 5–8 skills identified from the resume.
2. **Prioritize with User**:
   - Ask user to classify them into:
     - **P1 (Must-Have)**: Critical skills where a posting without them should score low or fail assessment.
     - **P2 (Preferred/Bonus)**: Nice-to-have skills that boost score but are not strictly required.
3. **Register Weights**:
   - Use `set_skill_weight` to assign priority levels (`P1` or `P2`).

### 5. Scoring Rubric Alignment
1. **Retrieve Current Rubric**:
   - Call `get_scoring_rubric` to inspect default dimensions and weights (e.g., Domain Fit: 30%, Technical Scope: 30%, Leadership: 20%, Growth: 20%).
2. **Consult the User**:
   > *"Here is your initial candidate scoring rubric:
   > - Domain Fit (30%)
   > - Technical Depth & Architecture (30%)
   > - Leadership & Strategic Scope (20%)
   > - Career Trajectory (20%)
   > Would you like to adjust these weights or add any specific criteria (e.g. remote work flexibility, startup stage)?"*
3. **Update Rubric Dimensions**:
   - Call `upsert_rubric_dimension` to save any customized dimension weights or scoring criteria.

---

## Step 5: Execute Initial Manual Run & Verify Settings

Before letting unattended recurring routines take over, the AI assistant should conduct an initial test crawl and evaluation pass:

1. **Permission Check**:
   - **Claude Code**: Ensure permission mode is set to **auto** (`permissionMode: "auto"` or run `/permissions`) so the crawler script and MCP database tools execute smoothly without waiting for confirmation on every single step.
   - **GitHub Copilot / Codex**: Confirm tool approvals are granted for database queries and crawling.
2. **Run Pipeline Pass**:
   - Trigger a bounded test crawl for 1 target company using `job-search-lead-gen`:
     > *"Running an initial test crawl for [Company Name] to verify that postings are discovered, enqueued, and evaluated against your rubric."*
3. **Verify Settings Output**:
   - Confirm candidate matches are recorded in SQLite (`job-search.sqlite`) with status `'new'`.
   - Confirm run logs are written via `log_run`.

---

## Step 6: Check the Initial Run & Launch Local Web Dashboard

The plugin includes a local single-page dashboard for inspecting pipeline statistics, managing target companies, reviewing candidates, and customizing the scoring rubric.

### Launching the Dashboard

The easiest and recommended way to launch the dashboard is simply to **ask your AI assistant** in chat:

> *"Launch the job search dashboard"* or *"Start the local UI"*

Your agent will run the launcher in the background and provide the direct URL (defaults to `http://localhost:3847`).

### Visual Review Checklist
1. **Review Candidates**: Open the **Candidates** view to review overall match percentages and per-dimension scores from the Step 5 test run.
2. **Inspect Pipeline Telemetry**: Inspect crawl statuses, enqueued postings, and execution logs under **Activity**.
3. **Adjust Rubric Weights**: If candidate scores need tuning, adjust dimension weights or criteria directly on the **Configuration** tab.

### Alternative Manual Launch
```bash
# Standard & Copilot:
node .agents/plugins/job-search-automations/packages/job-search-ui/scripts/start.js

# Claude:
node .claude/plugins/job-search-automations/packages/job-search-ui/scripts/start.js

# Codex:
node .codex/plugins/job-search-automations/packages/job-search-ui/scripts/start.js
```
The dashboard automatically detects port conflicts on `3847` and increments to the next available free port (e.g., `3848`).

---

## Step 7: Ongoing Maintenance & Uninstallation

### Updating Your Resume
When you update your resume, you do not need to re-run full setup. Use the fast-path `update-resume` command:

```bash
npx -y github:joshyim/job-search-automations update-resume "<path-to-new-resume.pdf>" --directory "<path-to-workspace>"
```

- Atomically replaces `<workspace>/.job-search/resume.pdf`.
- Updates the `updatedAt` timestamp in `<workspace>/.job-search/config.json`.
- Subsequent evaluation runs immediately score postings against the updated resume.

### Clean Uninstallation
To remove the installed plugin code while preserving your historical search data, candidate scores, and SQLite database:

```bash
npx -y github:joshyim/job-search-automations uninstall --directory "<path-to-workspace>"
```

- Removes `<workspace>/.agents/plugins/job-search-automations/`, `<workspace>/.claude/plugins/job-search-automations/`, and/or `<workspace>/.codex/plugins/job-search-automations/`.
- Cleans up `job-search-db` from `<workspace>/.mcp.json`, `<workspace>/.vscode/mcp.json`, and/or `<workspace>/.codex/config.toml`.
- Removes `job-search-ui` from `<workspace>/.claude/launch.json` (Claude).
- Preserves `<workspace>/.job-search/` (pass `--purge-data` if you wish to delete user data as well).
