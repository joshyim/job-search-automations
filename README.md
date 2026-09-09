# Job Search Automation Plugin (`job-search-automation`)

Find real opportunities before the crowd does. Stop wasting hours scrolling expired jobs on job boards.

This automated job search skills plugin runs inside Claude Code or ChatGPT co-work. You direct how the search runs: tell your agent which companies to track, which to avoid, and what matters to you. It goes beyond simple keyword searches to discover companies and roles matched to your actual skills, career history, and preferences.

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
├── setup.sh                    # Interactive & CLI setup orchestrator
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
│   └── migrate.js              # Markdown-to-Neon migration engine
├── templates/                  # Scaffolding templates & default rubric
├── web/                        # Local dashboard SPA & dev server
└── tests/                      # Packaging, skills, rubric, & setup test suites
```

---

## Prerequisites

- **Node.js**: Version 18 or higher.
- **Optional**: Neon PostgreSQL connection string (only if choosing Neon cloud mode; Local Markdown mode requires zero cloud services).

---

## Quickstart: Claude Desktop (Cowork Mode)

The simplest way to use this plugin is inside the **Claude Desktop App (Cowork mode)**:

1. Open your project folder in **Claude Desktop Cowork**.
2. Tell Claude:
   > *"Set up job search automation with my resume at /path/to/resume.pdf"*
3. Tell Claude what roles or companies to target:
   > *"Find companies hiring Staff Product Managers in San Francisco or Remote"*

> [!NOTE]
> **Zero-Configuration & Private**: Setup automatically installs required Node dependencies and compiles the local database server (`packages/job-search-db`). All pipeline data and your resume remain 100% private on your local computer (`~/.local/share/job-search-automation/`). No browser downloads or cloud databases required.

---

## Quickstart: Claude Code CLI

If you use the **Claude Code CLI**, install it directly via the plugin marketplace:

```text
/plugin marketplace add joshyim/job-search-automations
/plugin install job-search-automation@job-search-automations
```

Then tell Claude:
> *"Set up job search automation with my resume at /path/to/resume.pdf"*

---

## Manual / Scripted Installation

You can also run the setup orchestrator directly via terminal:

### Option A: Local Mode (Zero-Dependency Markdown Storage) [Recommended]
```bash
./setup.sh --mode local --resume /path/to/your/resume.pdf -y
```
- Stores data in `~/.local/share/job-search-automation/` as structured Markdown tables.
- Writes configuration to `~/.config/job-search-automation/config.json`.
- Automatically compiles the local database MCP server.

### Option B: Neon Mode (Cloud PostgreSQL)
```bash
./setup.sh --mode neon --resume /path/to/your/resume.pdf --neon-connection-string "postgres://..." -y
```
- Stores credentials securely in macOS Keychain under service `job-search-automation`.
- Automatically provisions tables and seeds the runtime scoring rubric.

### Interactive Mode
Run `./setup.sh` without arguments to step through guided interactive configuration in your terminal.

---

## Updating Your Resume

Update your active resume at any time:
```bash
./setup.sh --update-resume /path/to/new-resume.pdf
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

The bundled `job-search-db` MCP server provides uniform data access across both Local Markdown and Neon modes. Configured via `mcp.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "job-search-db": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${PLUGIN_ROOT}/packages/job-search-db/dist/index.js"
      ],
      "cwd": "${PLUGIN_ROOT}/packages/job-search-db"
    }
  }
}
```

---

## Local Web Dashboard

The plugin includes a local single-page dashboard for inspecting pipeline statistics, managing target companies, reviewing candidates, and customizing the scoring rubric:

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

Automate your job search on a recurring schedule using your agent harness's scheduling mechanism:

### Weekday Morning Pipeline Run
Run the lead generation orchestrator every weekday morning at 9:00 AM:
```text
/schedule CronExpression="0 9 * * 1-5" Prompt="Run job-search-lead-gen for a batch of 5 companies"
```

### Daily Pipeline Assessment Run
Process and score pending crawl queue postings daily at 6:00 PM:
```text
/schedule CronExpression="0 18 * * *" Prompt="Run job-search-assess for all pending crawl queue entries"
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

---

## Publishing & Monorepo Synchronization

This plugin is maintained inside the private `personal-automation` monorepo and published as a standalone public repository at [github.com/joshyim/job-search-automations](https://github.com/joshyim/job-search-automations).

To ensure that internal or experimental work in the monorepo is not published prematurely, synchronization is **strictly on-demand** and performed via `scripts/sync-public.sh`.

### How to Sync Updates to the Public Repository

1. **Commit your changes** in the monorepo.
2. **Preview what will be pushed** using dry-run mode:
   ```bash
   ./scripts/sync-public.sh --dry-run
   ```
3. **Execute the sync**:
   ```bash
   npm run sync:public
   # or
   ./scripts/sync-public.sh
   ```

### How the Sync Script Works
- **Clean Working Tree**: Confirms there are no uncommitted changes in `job-search-automation/` before pushing.
- **Commit Isolation (`git subtree`)**: Extracts only commits that touched files inside `job-search-automation/`. Commits from other monorepo directories (such as `gmail-ai-triage/` or `.agents/`) are completely omitted from the public git history.
- **Confirmation Prompt**: Previews the latest commits in `job-search-automation/` and asks for explicit confirmation before pushing.

