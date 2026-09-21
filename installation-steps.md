# Job Search Automation: Installation, Configuration & LLM Onboarding Guide

Comprehensive, harness-agnostic guide for installing, configuring, and running the Job Search Automation plugin. This guide serves both human users and AI agent assistants (**Claude Desktop & Code**, **Codex**, **ChatGPT**, and all **Agent Plugins v1** compliant harnesses), providing detailed technical references and step-by-step onboarding interview protocols.

---

## 1. Prerequisites

- **Node.js**: Version 18 or higher (`node -v`).
- **Resume**: A PDF copy of your resume (e.g. `~/Documents/resume.pdf`).
- **Storage Mode**:
  - **Local SQLite (Default, Recommended)**: Zero-dependency, 100% private, runs entirely on your local machine.
  - **Neon PostgreSQL (Optional)**: Cloud-hosted PostgreSQL. Requires a Neon connection string.

---

## Step 1: Universal Zero-Clone Installation via `npx`

The plugin installs directly from GitHub into a temporary cache without cloning source code or git history into your workspace:

```bash
npx -y github:joshyim/job-search-automations setup
```

Run this command inside your target project workspace. It initializes the `.job-search/` workspace, pre-compiles and installs the plugin into `.claude/plugins/job-search-automations/`, configures `.mcp.json` and `.claude/launch.json`, and pre-grants unattended permissions in `.claude/settings.json`.

### Setup Options & Flags

All flags are optional when running inside your target workspace:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-d, --directory <path>` | Target workspace directory | Current working directory |
| `--harness <claude\|codex\|both>` | Target agent harness (`claude`, `codex`, or `both`) | Auto-detect (fallback: `claude`) |
| `--codex` | Shorthand for `--harness codex` | `false` |
| `--claude` | Shorthand for `--harness claude` | `false` |
| `--both` | Shorthand for `--harness both` | `false` |
| `--resume <path>` | Path to resume PDF (auto-detects local `resume.pdf` if omitted) | Optional (prompted or updated later) |
| `--mode <local\|neon>` | Storage backend mode | `local` |
| `--neon-connection-string <s>` | Neon PostgreSQL connection string (Neon mode only) | None |
| `--install-to <path>` | Custom plugin installation directory | `<workspace>/.claude/plugins/job-search-automations` (Claude) or `<workspace>/.codex/plugins/job-search-automations` (Codex) |
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

1. **Persistent Workspace Data (`<workspace>/.job-search/`)** *(Both Claude & Codex)*:
   - `job-search.sqlite`: Local SQLite database (initialized with schema, indices, and default scoring rubric).
   - `resume.pdf`: Verified copy of the candidate resume.
   - `config.json`: Runtime configuration pointing to active storage mode.
   - `tmp/`: Flat temporary directory for staging lightweight crawler outputs (auto-cleaned after runs).
2. **Read-Only Plugin Assets**:
   - **Claude**: Installed in `<workspace>/.claude/plugins/job-search-automations/`.
   - **Codex**: Installed in `<workspace>/.codex/plugins/job-search-automations/`.
   - Contains pre-compiled packages (`packages/job-search-db`, `packages/job-search-ui`), `skills/`, `scripts/crawl-job-board.js`, and manifests.
3. **MCP Server Integration**:
   - **Claude**: Configured in `<workspace>/.mcp.json` (and `mcp.json`) pointing to `packages/job-search-db/scripts/start.js`.
   - **Codex**: Configured in `<workspace>/.codex/config.toml` with `[mcp_servers.job-search-db]` using plugin-relative path and `default_tools_approval_mode = "writes"`.
4. **Skills & Agent Guidelines**:
   - **Claude**: Skills discovered from `.claude/plugins/job-search-automations/skills/` and guided by `CLAUDE.md`.
   - **Codex**: Skills mirrored into `<workspace>/.agents/skills/` (with crawler script) for native discovery and guided by `<workspace>/AGENTS.md`.
5. **Desktop & Agent Configuration (Claude Only)**:
   - `<workspace>/.claude/launch.json`: Claude Desktop web preview entry for the local UI dashboard.
   - `<workspace>/.claude/settings.json`: Pre-configures `"defaultMode": "auto"` and pre-grants permissions for unattended runs. *(Omitted in Codex-only setups in favor of least-privilege approval).*

> **LLM Execution Directive:**
> When asked to install the plugin, detect or confirm the target harness:
> - For **Claude**: execute `npx -y github:joshyim/job-search-automations setup --claude` in the workspace.
> - For **Codex**: execute `npx -y github:joshyim/job-search-automations setup --codex` in the workspace.
> Confirm scaffolded assets and inform the user of the harness-specific reload step.

---

## Step 2: Harness Restart & System Verification

### Why a Restart is Required
Agent harnesses parse configuration files (`.mcp.json` for Claude, `.codex/config.toml` for Codex) and register skills during session initialization. After running the installation command, the host session must be reloaded or restarted so that:
- The stdio connection to `packages/job-search-db/scripts/start.js` is established.
- The 6 specification-conformant skills in `skills/` (or `.agents/skills/` in Codex) are indexed into the agent's available toolset.

### Restart Instructions by Harness
- **Claude Desktop**: Restart the Claude Desktop application or reopen the project workspace folder.
- **Claude Code CLI**: Exit your current session (`Ctrl+C` or `/exit`) and re-launch `claude` in your workspace directory.
- **Codex**: Reload the workspace window or run `/mcp` in chat to inspect and reload active MCP servers.

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
> When creating or scheduling routines, select or suggest the appropriate model class instead of leaving it unspecified.

### The 4 Canonical Routines

| Routine # | Routine Name | Target Skill | Recommended Cadence | Recommended Model Class | Unattended Limits |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Daily Company Search** | `company-search` | Daily 8:00 PM (`0 20 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) | Max 3–5 new qualified companies; budget 30–40 messages |
| **2** | **Daily Job Title Search** | `title-discovery` | Daily 9:00 PM (`0 21 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) | Max 1–3 new patterns; budget 25–35 messages |
| **3** | **Daily Job Crawl** | `job-search-crawl` / `job-search-lead-gen` | Daily 6:00 AM (`0 6 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) | Batch 2–3 companies (`get_batch({ limit: 3 })`); budget 40–50 messages |
| **4** | **Daily Job Evaluation** | `job-search-assess` | Daily 7:00 AM (`0 7 * * *`) | Sonnet-class (Claude) / Luna-class (OAI) | Batch 5 pending postings (`get_pending_queue`); budget 40–50 messages |

### Routine Configuration & Prompts

#### Routine 1: Daily Company Search (`company-search`)
Discovers new companies actively hiring for target roles across YC, BuiltIn, Wellfound, and LinkedIn, adding qualified targets via MCP.
- **Cadence**: Daily at 8:00 PM (`0 20 * * *`)
- **Prompt**:
  ```text
  /schedule CronExpression="0 20 * * *" Prompt="Run company-search to discover new hiring companies matching candidate target roles across YC, BuiltIn, Wellfound, and LinkedIn. Add at most 3-5 newly qualified companies via add_company. Complete within 35 messages. Never use browser automation."
  ```

#### Routine 2: Daily Job Title Search (`title-discovery`)
Discovers emerging title patterns and function variants matching candidate skills and resume, adding validated include/exclude patterns via MCP.
- **Cadence**: Daily at 9:00 PM (`0 21 * * *`)
- **Prompt**:
  ```text
  /schedule CronExpression="0 21 * * *" Prompt="Run title-discovery to inspect current job listings for title variants matching candidate P1/P2 skills. Add at most 1-3 new validated include or exclude patterns via add_title_pattern. Complete within 30 messages."
  ```

#### Routine 3: Daily Job Crawl (`job-search-crawl` / `job-search-lead-gen`)
Scrapes careers pages of target companies, matches openings against title patterns, and appends matched listings to the crawl queue.
- **Cadence**: Daily at 6:00 AM (`0 6 * * *`)
- **Prompt**:
  ```text
  /schedule CronExpression="0 6 * * *" Prompt="Run job-search-crawl across least-recently-searched companies using get_batch({ limit: 3 }). Match postings against title patterns and enqueue matched roles via add_to_queue. Complete within 45 messages. Fast-fail unreachable URLs."
  ```

#### Routine 4: Daily Job Evaluation (`job-search-assess`)
Pulls pending listings from the crawl queue, validates active status, scores against resume and dynamic rubric, and records candidates.
- **Cadence**: Daily at 7:00 AM (`0 7 * * *`)
- **Prompt**:
  ```text
  /schedule CronExpression="0 7 * * *" Prompt="Run job-search-assess for up to 5 pending postings from get_pending_queue. Score against candidate resume and scoring rubric, and record each scored candidate via add_candidate with status 'new'. Complete within 45 messages."
  ```

### Managing & Verifying Routines
- **Auto Approval Verification**: In Claude Desktop under **Scheduled** or at [claude.ai/code/routines](https://claude.ai/code/routines), verify that every routine displays `· Auto`. If any routine displays `· Manual`, open its settings and switch it to **Auto**.
- **Model Class Verification**: Check that each routine uses **Sonnet** (Claude) or **Luna** (OpenAI).
- **Remediation**: If an existing setup contains a "Weekly digest" routine, delete it immediately.

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

### 6. Launch Web Dashboard for Visual Review
Inform the user that they can visually inspect and modify their target companies, title rules, and rubric sliders via the local dashboard:
```bash
node .claude/plugins/job-search-automations/packages/job-search-ui/scripts/start.js
```
The dashboard binds to `http://localhost:3847` (with automatic port-increment fallback if 3847 is busy). In Claude Desktop, users can also open the `job-search-ui` entry via the web preview launcher.

---

## Step 5: Ongoing Maintenance

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

- Removes `<workspace>/.claude/plugins/job-search-automations/` and/or `<workspace>/.codex/plugins/job-search-automations/`.
- Cleans up `job-search-db` from `<workspace>/.mcp.json` and/or `<workspace>/.codex/config.toml`.
- Removes `job-search-ui` from `<workspace>/.claude/launch.json` (Claude).
- Removes `.agents/skills/` and `AGENTS.md` (Codex).
- Preserves `<workspace>/.job-search/` (pass `--purge-data` if you wish to delete user data as well).
