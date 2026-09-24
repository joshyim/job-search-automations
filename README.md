# Job Search Automation Plugin (`job-search-automations`)

Stop wasting hours browsing jobs. Automate your search with your AI assistant—conforming to the open **Agent Plugins specification** (`agent-plugins.org`) and **Model Context Protocol (MCP)**, compatible with **GitHub Copilot**, **Claude Code**, **OpenAI Codex / ChatGPT**, **Cursor**, **Windsurf**, and any standard agent harness.

You can direct how the search runs: 
- tell your agent which companies to track, which to avoid
- ask it to discover relevant job titles based on your skills
- find opportunities directly from the company websites

It goes beyond simple keyword searches to discover companies and roles matched to your actual skills, career history, and preferences.

Put your AI to work with flexible, user-directed loops:

- **Company Discovery**: Find target employers tailored to your profile. Track companies you want; filter out the ones you don't.
- **Title & Skill Discovery**: Go beyond rigid job titles. Uncover roles that match your real skills and experience, not just keywords.
- **Direct Job Crawler**: Search company career sites directly for fresh openings before aggregators post them.
- **Dedicated Web UI**: Local single-page dashboard to manage preferences, adjust your scoring rubric, and review candidates visually.

You set the rules. Your AI does the hunting.

---

## Prerequisites

- **Node.js**: Version 18 or higher.
- **Optional**: Neon PostgreSQL connection string (only if choosing Neon cloud mode; Local SQLite mode requires zero cloud services).

---

## Quickstart & Setup

Follow these 6 progressive steps to get your automated job search pipeline running with your AI assistant (GitHub Copilot, Claude Code, OpenAI Codex, Cursor, Windsurf, or any Agent Plugin standard harness).

> [!TIP]
> For the comprehensive technical reference, multi-harness guides (GitHub Copilot, Claude Code, Codex, ChatGPT), CLI flags, cloud mode setup, and detailed LLM intake instructions, see [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md).

### Step 1: Install the Plugin via `npx`

> [!TIP]
> **Expert Tip**: Create a dedicated new workspace for this (e.g., `mkdir job-search && cd job-search`). This keeps your search history, resume, and MCP configuration cleanly isolated from your regular coding projects.

The easiest and recommended way to install is simply to tell your AI assistant in chat:

> **Prompt for your AI Assistant:**
> ```text
> I want to install the job search automation plugin. Run 'npx -y github:joshyim/job-search-automations setup' in this workspace to set up the plugin.
> ```

Your AI assistant will automatically detect your host harness (Claude Code, GitHub Copilot, Codex, etc.) and run the appropriate setup.

#### Manual Installation (Terminal)
You can also run the zero-clone installer directly in your workspace terminal without cloning the repository or compiling from source (ships pre-built, ~1.1 MB download):

```bash
# Universal / All compliant harnesses (GitHub Copilot, Cursor, Windsurf, standard default):
npx -y github:joshyim/job-search-automations setup

# Or explicitly target your specific harness:
npx -y github:joshyim/job-search-automations setup --copilot
npx -y github:joshyim/job-search-automations setup --claude
npx -y github:joshyim/job-search-automations setup --codex
```

- **Standard & Copilot Scaffolding**: Configures universal `.mcp.json` (and `.vscode/mcp.json` for Copilot), installs the 6 declarative skills into `.agents/skills/`, and creates `AGENTS.md`.
- **Claude Scaffolding**: Installs plugin to `.claude/plugins/job-search-automations/`, configures `.mcp.json` and `.claude/launch.json`, and pre-grants routine permissions in `.claude/settings.json`.
- **Codex Scaffolding**: Configures project-scoped MCP in `.codex/config.toml` (`default_tools_approval_mode = "writes"`), installs skills into `.agents/skills/`, and creates `AGENTS.md`.
- **Private Data Scaffolding**: Scaffolds your private workspace in `.job-search/` with a local SQLite database (`job-search.sqlite`), schema, and default scoring rubric.

---

### Step 2: Restart / Reload Your Harness to Mount MCP & Skills
After installation completes, reload your agent harness so it mounts the new MCP server and skills:

- **GitHub Copilot / VS Code**: Press `Cmd+Shift+P` (or `Ctrl+Shift+P`) → select **Developer: Reload Window**.
- **Claude Desktop**: Restart Claude Desktop or reopen the project workspace folder.
- **Claude Code CLI**: Exit (`Ctrl+C` or `/exit`) and restart `claude`.
- **Codex / ChatGPT**: Reload your Codex workspace window or inspect `/mcp` (or run `codex mcp list`) to verify that `job-search-db` is connected.
- **Skills**: Verified via `.agents/skills/` (Copilot/Codex/Standard) or `.claude/plugins/.../skills` (Claude).

> **Prompt for your AI Assistant:**
> ```text
> Check that the job-search-db MCP tools and skills are loaded, and verify the workspace database connection using select_workspace.
> ```

---

### Step 3: Activate Routines & Configure Auto Permissions
Open your harness's routine manager (Claude Desktop sidebar under **Scheduled**, `claude.ai/code/routines`, or using `/schedule`), activate the 4 canonical routines, and ensure they have **Auto** approval permissions so they run unattended without stalling:

1. **Daily Company Search** (`company-search` at 8:00 PM)
2. **Daily Job Title Search** (`title-discovery` at 9:00 PM)
3. **Daily Job Crawl** (`job-search-crawl` at 6:00 AM)
4. **Daily Job Evaluation** (`job-search-assess` at 7:00 AM)

*Model Recommendation*: Configure routines with **Sonnet-class** (Claude Code / Desktop), **Luna-class** (OpenAI / Codex), or **GPT-4o-mini / balanced tier** (GitHub Copilot) models for optimal cost and performance.

> **Prompt for your AI Assistant:**
> ```text
> Help me activate the 4 canonical job search routines. Make sure they are scheduled with Auto approval mode and use Sonnet-class or Luna-class models so they run unattended without stalling.
> ```

---

### Step 4: Complete Initial Profile Setup & Intake
Finish setup by providing your resume and having your AI assistant guide you through your initial preferences:

- **Resume**: Provide the file path to your resume PDF or copy it to `.job-search/resume.pdf`.
- **Target Companies**: Specify companies you want to track, and any companies or agencies to exclude.
- **Job Titles**: Specify role titles to search for, along with negative patterns to exclude (e.g., exclude "Junior", "Sales", or "Intern").
- **Core Skills**: Identify your core skills and categorize them into must-haves (P1) vs. nice-to-haves (P2).
- **Scoring Rubric**: Review the default rubric dimensions and customize criteria weights to match your search priorities.

> **Prompt for your AI Assistant:**
> ```text
> Here is my resume at [path/to/resume.pdf]. Please ingest it, and guide me through the initial job search setup: target companies, job titles to search/exclude, core skills, and scoring rubric preferences.
> ```

---

### Step 5: Manually Run the Pipeline & Verify Settings
Before letting recurring routines run unattended overnight, perform a manual test run in chat to verify that the crawler, scoring engine, and database communicate cleanly:

- **Permission Settings (Claude Code)**: Change your permission level to **auto** (run with auto approvals or configure `permissionMode: "auto"`) so Claude Code can execute the crawler script and database operations without halting on interactive confirmation prompts.
- **Permission Settings (GitHub Copilot / Codex)**: Ensure tool execution permissions allow read and write access for the `job-search-db` MCP server and crawler.
- **Verify Settings**: Check that target companies are registered, positive/negative title filters are saved, and the scoring rubric reflects your priorities.

> **Prompt for your AI Assistant:**
> ```text
> Run job-search-lead-gen for 1 target company to test the pipeline end-to-end and confirm our settings.
> ```

---

### Step 6: Check the Initial Run (Local Web Dashboard)

The plugin includes a local single-page dashboard for inspecting pipeline statistics, managing target companies, reviewing candidates, and customizing the scoring rubric.

#### Launching the Dashboard

The easiest and recommended way to launch the dashboard is simply to **ask your AI assistant** in chat:

> *"Launch the job search dashboard"* or *"Start the local UI"*

Your agent will run the launcher in the background and provide the direct URL (defaults to `http://localhost:3847`).

#### What to Check on the Initial Run
- **Review Candidates**: Check scored matches under the **Candidates** table, reviewing overall match percentages and rubric dimension breakdowns.
- **Inspect Crawl Activity**: Review company crawl status, queue timestamps, and execution logs under **Activity**.
- **Fine-Tune Rubric Sliders**: Adjust weights and scoring criteria dynamically on the **Configuration** tab if the initial ratings need recalibration.

#### Alternative Launch Options
- **Claude Desktop**: Open via the built-in web preview using the pre-configured `job-search-ui` entry in `.claude/launch.json`.
- **Manual Launch (Installed Project Workspace)**:
  ```bash
  # Standard / Copilot layout:
  node .agents/plugins/job-search-automations/packages/job-search-ui/scripts/start.js

  # Claude layout:
  node .claude/plugins/job-search-automations/packages/job-search-ui/scripts/start.js

  # Codex layout:
  node .codex/plugins/job-search-automations/packages/job-search-ui/scripts/start.js
  ```
- **Manual Launch (Source Repository / Development)**:
  ```bash
  # Build and start the dashboard server (default port 3847):
  npm run ui

  # Or launch development mode:
  npm run ui:dev

  # Specify a custom port via CLI flag or environment variable:
  npm run ui -- --port 3850
  PORT=3850 npm run ui
  ```

Access the dashboard at `http://localhost:3847`. If port `3847` is already in use by another process, the server automatically detects the conflict, increments to the next available free port (e.g., `3848`), and prints the bound URL to stdout.

---

## Deep Dive & Technical Reference

### Architecture Overview

```
job-search-automations/
├── plugin.json                 # Agent Plugins v1.0.0 manifest
├── mcp.json                    # MCP stdio server configuration
├── schema.sql                  # Canonical PostgreSQL DDL (Neon)
├── bin/cli.js                  # Zero-clone CLI orchestrator (setup, update-resume, uninstall)
├── README.md                   # Plugin documentation & quickstart
├── package.json                # Root automation scripts (npm run ui)
├── skills/                     # 6 specification-conformant agent skills
│   ├── job-search-lead-gen/    # Lead gen orchestrator
│   ├── job-search-crawl/       # Single-company job board crawler
│   ├── job-search-assess/      # Single-company posting assessor
│   ├── company-search/         # Company discovery across job platforms
│   ├── title-discovery/        # Target title & pattern discovery
│   └── pipeline-diagram/       # Mermaid pipeline diagram generator
├── scripts/                    # Shared operational utilities
│   ├── crawl-job-board.js      # Lightweight ATS API & HTTP job board scraper
│   ├── init-neon.js            # Neon schema & default rubric seeder
│   └── migrate.js              # Markdown-to-SQLite/Neon migration engine
├── templates/                  # Scaffolding templates & default rubric
├── packages/                   # Core packages
│   ├── job-search-db/          # Database layer & MCP stdio server
│   └── job-search-ui/          # Local dashboard SPA & dev server
└── tests/                      # Packaging, skills, rubric, & setup test suites
```

---

### Skills Inventory

Each skill is located in `skills/<skill-name>/SKILL.md` and exposes clean declarative orchestration over MCP:

1. **`job-search-lead-gen`**: Pipeline orchestrator. Selects a batch of target companies, crawls each career page, and scores matches.
2. **`job-search-crawl`**: Runs `scripts/crawl-job-board.js` to scrape postings and push matching titles into the crawl queue.
3. **`job-search-assess`**: Evaluates pending crawl queue postings against your resume and the runtime scoring rubric, recording qualified candidates.
4. **`company-search`**: Discovers new hiring companies across YC, BuiltIn, Wellfound, and LinkedIn, adding qualified targets.
5. **`title-discovery`**: Analyzes market postings against your resume to uncover target job titles and keywords.
6. **`pipeline-diagram`**: Introspects skills, tools, and storage to generate comprehensive Mermaid architecture diagrams.

---

### Model Context Protocol (MCP) Server

The bundled `job-search-db` MCP server provides uniform data access across both Local SQLite and Neon modes.

#### VS Code & GitHub Copilot (`.vscode/mcp.json`)

Used natively by VS Code with the GitHub Copilot Chat MCP integration:

```json
{
  "mcpServers": {
    "job-search-db": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./.agents/plugins/job-search-automations/packages/job-search-db/scripts/start.js"
      ]
    }
  }
}
```

#### OpenAI Codex & ChatGPT (`.codex/config.toml`)

Codex configures MCP servers via project-scoped TOML configuration:

```toml
[mcp_servers.job-search-db]
command = "node"
args = [".codex/plugins/job-search-automations/packages/job-search-db/scripts/start.js"]
cwd = "/path/to/your/workspace"
default_tools_approval_mode = "writes"
```

> [!NOTE]
> Codex does not parse `.mcp.json`, `.claude/settings.json`, or `.claude/launch.json`. In Codex, tool approval policy is set per-server via `default_tools_approval_mode = "writes"`, keeping database writes subject to your approval while allowing uninterrupted read-only queries.

#### Claude Code (`.mcp.json`)

Used natively by Claude Code (Desktop & CLI):

```json
{
  "mcpServers": {
    "job-search-db": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./.claude/plugins/job-search-automations/packages/job-search-db/scripts/start.js"
      ]
    }
  }
}
```

#### Portable Agent Plugins (`mcp.json`)

Included inside the plugin package per the Agent Plugins specification:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "job-search-db": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${PLUGIN_ROOT}/packages/job-search-db/scripts/start.js"
      ]
    }
  }
}
```

---

### Recurring Pipeline Scheduling (via `/schedule`)

Automate your job search on a recurring schedule using your agent harness's scheduling mechanism (e.g. Claude Code's `/schedule` command or cloud routines). Scheduled tasks run unattended, so prompts should include an explicit message budget and batch limit.

> [!NOTE]
> For complete routine configurations, prompt templates, and cloud routine management steps, see [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md). Note: there is **no Weekly Digest routine** in this repository.
>
> **Recommended Model Classes**: Configure routines with **Sonnet-class** (Claude Code / Desktop), **Luna-class** (OpenAI / Codex), or **GPT-4o-mini / balanced tier** (GitHub Copilot) models. Avoid defaulting unattended recurring tasks to expensive flagship/frontier models (Opus).

#### 1. Daily Company Search Run (`company-search`)
Discover new target companies hiring for candidate roles across YC, BuiltIn, Wellfound, and LinkedIn (Daily 8:00 PM):
```text
/schedule CronExpression="0 20 * * *" Prompt="Run company-search to discover new hiring companies matching candidate target roles across YC, BuiltIn, Wellfound, and LinkedIn. Add at most 3-5 newly qualified companies via add_company. Complete within 35 messages."
```

#### 2. Daily Job Title Search Run (`title-discovery`)
Discover emerging titles and keyword patterns matching candidate skills (Daily 9:00 PM):
```text
/schedule CronExpression="0 21 * * *" Prompt="Run title-discovery to inspect current job listings for title variants matching candidate P1/P2 skills. Add at most 1-3 new validated include or exclude patterns via add_title_pattern. Complete within 30 messages."
```

#### 3. Daily Morning Crawl Run (`job-search-crawl` / `job-search-lead-gen`)
Crawl target company career boards and enqueue matching openings (Daily 6:00 AM):
```text
/schedule CronExpression="0 6 * * *" Prompt="Run job-search-crawl across least-recently-searched companies using get_batch({ limit: 3 }). Match postings against title patterns and enqueue matched roles via add_to_queue. Complete within 45 messages."
```

#### 4. Daily Morning Assessment Run (`job-search-assess`)
Process and score pending crawl queue postings against resume and dynamic rubric (Daily 7:00 AM):
```text
/schedule CronExpression="0 7 * * *" Prompt="Run job-search-assess for up to 5 pending postings from get_pending_queue. Score against candidate resume and scoring rubric, and record each scored candidate via add_candidate with status 'new'. Complete within 45 messages."
```

---

### Updating Your Resume

Update your active resume at any time without re-running full setup:

```bash
npx -y github:joshyim/job-search-automations update-resume /path/to/new-resume.pdf --directory /path/to/your/workspace
```

---

### Cloud Mode (Neon PostgreSQL)

To use cloud storage instead of local SQLite:
```bash
npx -y github:joshyim/job-search-automations setup --mode neon --resume /path/to/your/resume.pdf --neon-connection-string "postgres://..." -y
```

---

### Verification & Testing

Run the automated test suites to ensure specification compliance:
```bash
# Packaging and specification compliance
./tests/packaging.test.sh

# Skills specification conformance & MCP tool wiring
./tests/skills.test.sh

# Setup orchestrator and migration tests
./tests/setup.test.sh

# Runtime scoring rubric test suite
./tests/rubric.test.sh

# MCP Server unit tests
npm test --prefix packages/job-search-db
```

---

## Uninstalling the Plugin

To remove the plugin code while preserving your search history and `.job-search/` database:

```bash
npx -y github:joshyim/job-search-automations uninstall --directory /path/to/your/workspace
```
