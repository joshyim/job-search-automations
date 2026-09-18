# Job Search Automation Plugin (`job-search-automation`)

Find real opportunities before the crowd does. Stop wasting hours scrolling expired jobs on job boards.

This automated job search skills plugin runs inside Claude Code (Desktop & CLI) or ChatGPT. You direct how the search runs: tell your agent which companies to track, which to avoid, and what matters to you. It goes beyond simple keyword searches to discover companies and roles matched to your actual skills, career history, and preferences.

Put your AI to work with flexible, user-directed loops:

- **Company Discovery**: Find target employers tailored to your profile. Track companies you want; filter out the ones you don't.
- **Title & Skill Discovery**: Go beyond rigid job titles. Uncover roles that match your real skills and experience, not just keywords.
- **Direct Job Crawler**: Search company career sites directly for fresh openings before aggregators post them.
- **Dedicated Web UI**: Launch a local dashboard straight from your Claude Code or ChatGPT session to manage preferences, adjust your scoring rubric, and review candidates visually.

You set the rules. Your AI does the hunting.

---

## Architecture Overview

```
job-search-automation/
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
├── web/                        # Local dashboard SPA & dev server
└── tests/                      # Packaging, skills, rubric, & setup test suites
```

---

## Prerequisites

- **Node.js**: Version 18 or higher.
- **Optional**: Neon PostgreSQL connection string (only if choosing Neon cloud mode; Local SQLite mode requires zero cloud services).

---

## Quickstart & Setup

Follow these 4 high-level steps to get your automated job search pipeline running with your AI assistant (Claude Code, Claude Desktop, or Codex).

> [!TIP]
> For the comprehensive technical reference, multi-harness guides (Claude Code, Codex, ChatGPT), CLI flags, cloud mode setup, and detailed LLM intake instructions, see [installation-steps.md](file:///Users/joshyim/projects/personal-automation/job-search-automation/installation-steps.md).

### Step 1: Install the Plugin via `npx`
Run the zero-clone installer directly in your workspace terminal without cloning the repository or polluting your project directory:

```bash
npx -y github:joshyim/job-search-automations setup
```

- Fetches directly from GitHub into a temporary cache and installs the pre-compiled plugin into `<selected-directory>/.claude/plugins/job-search-automation/`.
- Scaffolds your private workspace in `<selected-directory>/.job-search/` with a local SQLite database (`job-search.sqlite`), schema, and default scoring rubric.
- Configures `<selected-directory>/.mcp.json` and `<selected-directory>/.claude/launch.json`.
- Pre-grants permissions in `<selected-directory>/.claude/settings.json` (`permissionMode: "auto"`) so routine crawlers run unattended.

> **Prompt for your LLM:**
> ```text
> I want to install the job search automation plugin. Run 'npx -y github:joshyim/job-search-automations setup' in this workspace to set up the plugin, database, and routine permissions.
> ```

---

### Step 2: Restart Your Harness to Mount MCP & Skills
After installation completes, restart your agent harness (Claude Desktop, Claude Code CLI, or Codex) so it reloads its environment and mounts the new MCP server and skills.

- Launches the `job-search-db` stdio MCP server for database operations.
- Registers the 6 declarative job search skills (`company-search`, `title-discovery`, `job-search-crawl`, `job-search-assess`, `job-search-lead-gen`, `pipeline-diagram`).

> **Prompt for your LLM:**
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

*Model Recommendation*: Configure routines with **Sonnet-class** (Claude Code / Desktop) or **Luna-class** (OpenAI / Codex) models for optimal cost and performance.

> **Prompt for your LLM:**
> ```text
> Help me activate the 4 canonical job search routines. Make sure they are scheduled with Auto approval mode and use Sonnet-class or Luna-class models so they run unattended without stalling.
> ```

---

### Step 4: Complete Initial Profile Setup & Intake
Finish setup by providing your resume and having your AI assistant guide you through your initial preferences:

- **Resume**: Provide the file path to your resume PDF or copy it to `<selected-directory>/.job-search/resume.pdf`.
- **Target Companies**: Specify companies you want to track, and any companies or agencies to exclude.
- **Job Titles**: Specify role titles to search for, along with negative patterns to exclude (e.g., exclude "Junior", "Sales", or "Intern").
- **Core Skills**: Identify your core skills and categorize them into must-haves (P1) vs. nice-to-haves (P2).
- **Scoring Rubric**: Review the default rubric dimensions and customize criteria weights to match your search priorities.

> **Prompt for your LLM:**
> ```text
> Here is my resume at [path/to/resume.pdf]. Please ingest it, and guide me through the initial job search setup: target companies, job titles to search/exclude, core skills, and scoring rubric preferences.
> ```

---

#### Cloud Mode (Neon PostgreSQL)
To use cloud storage instead of local SQLite:
```bash
npx -y github:joshyim/job-search-automations setup --mode neon --resume /path/to/your/resume.pdf --neon-connection-string "postgres://..." -y
```

---

## Updating Your Resume

Update your active resume at any time without re-running full setup:

```bash
npx -y github:joshyim/job-search-automations update-resume /path/to/new-resume.pdf --directory /path/to/your/workspace
```

---

## Uninstalling the Plugin

To remove the plugin code while preserving your search history and `.job-search/` database:

```bash
npx -y github:joshyim/job-search-automations uninstall --directory /path/to/your/workspace
```


---

## Skills Inventory

Each skill is located in `skills/<skill-name>/SKILL.md` and exposes clean declarative orchestration over MCP:

1. **`job-search-lead-gen`**: Pipeline orchestrator. Selects a batch of target companies, crawls each career page, and scores matches.
2. **`job-search-crawl`**: Runs `scripts/crawl-job-board.js` to scrape postings and push matching titles into the crawl queue.
3. **`job-search-assess`**: Evaluates pending crawl queue postings against your resume and the runtime scoring rubric, recording qualified candidates.
4. **`company-search`**: Discovers new hiring companies across YC, BuiltIn, Wellfound, and LinkedIn, adding qualified targets.
5. **`title-discovery`**: Analyzes market postings against your resume to uncover target job titles and keywords.
6. **`pipeline-diagram`**: Introspects skills, tools, and storage to generate comprehensive Mermaid architecture diagrams.

---

## Model Context Protocol (MCP) Server

The bundled `job-search-db` MCP server provides uniform data access across both Local SQLite and Neon modes. The plugin supports both portable Agent Plugins hosts and Claude Code.

### Portable Agent Plugins (`mcp.json`)

Used by Codex and conforming Agent Plugins v1 hosts:

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

### Claude Code (`.mcp.json`)

Used natively by Claude Code (Desktop & CLI):

```json
{
  "mcpServers": {
    "job-search-db": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/packages/job-search-db/scripts/start.js"
      ]
    }
  }
}
```

---

## Local Web Dashboard

The plugin includes a local single-page dashboard for inspecting pipeline statistics, managing target companies, reviewing candidates, and customizing the scoring rubric.

### In an Installed Project Workspace
- **Claude Desktop**: Launch via the built-in web preview using the pre-configured `job-search-ui` entry in `.claude/launch.json`.
- **Terminal**: Run the start script via npm prefix:
  ```bash
  npm run start --prefix ./.claude/plugins/job-search-automation/packages/job-search-ui
  ```
  Or run the launcher directly:
  ```bash
  node ./.claude/plugins/job-search-automation/packages/job-search-ui/scripts/start.js
  ```

### In the Source Repository (Development)
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

## Recurring Pipeline Scheduling (via `/schedule`)

Automate your job search on a recurring schedule using your agent harness's scheduling mechanism (e.g. Claude Code's `/schedule` command or cloud routines). Scheduled tasks run unattended, so prompts should include an explicit message budget and batch limit.

> [!NOTE]
> For complete routine configurations, prompt templates, and cloud routine management steps, see [installation-steps.md](file:///Users/joshyim/projects/personal-automation/job-search-automation/installation-steps.md). Note: there is **no Weekly Digest routine** in this repository.
>
> **Recommended Model Classes**: Configure routines with **Sonnet-class** (Claude Code / Desktop) or **Luna-class** (OpenAI / Codex) models. Avoid defaulting unattended recurring tasks to expensive flagship/frontier models (Opus).

### 1. Daily Company Search Run (`company-search`)
Discover new target companies hiring for candidate roles across YC, BuiltIn, Wellfound, and LinkedIn (Daily 8:00 PM):
```text
/schedule CronExpression="0 20 * * *" Prompt="Run company-search to discover new hiring companies matching candidate target roles across YC, BuiltIn, Wellfound, and LinkedIn. Add at most 3-5 newly qualified companies via add_company. Complete within 35 messages."
```

### 2. Daily Job Title Search Run (`title-discovery`)
Discover emerging titles and keyword patterns matching candidate skills (Daily 9:00 PM):
```text
/schedule CronExpression="0 21 * * *" Prompt="Run title-discovery to inspect current job listings for title variants matching candidate P1/P2 skills. Add at most 1-3 new validated include or exclude patterns via add_title_pattern. Complete within 30 messages."
```

### 3. Daily Morning Crawl Run (`job-search-crawl` / `job-search-lead-gen`)
Crawl target company career boards and enqueue matching openings (Daily 6:00 AM):
```text
/schedule CronExpression="0 6 * * *" Prompt="Run job-search-crawl across least-recently-searched companies using get_batch({ limit: 3 }). Match postings against title patterns and enqueue matched roles via add_to_queue. Complete within 45 messages."
```

### 4. Daily Morning Assessment Run (`job-search-assess`)
Process and score pending crawl queue postings against resume and dynamic rubric (Daily 7:00 AM):
```text
/schedule CronExpression="0 7 * * *" Prompt="Run job-search-assess for up to 5 pending postings from get_pending_queue. Score against candidate resume and scoring rubric, and record each scored candidate via add_candidate with status 'new'. Complete within 45 messages."
```


---

## Verification & Testing

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

