# Job Search Automation Plugin (`job-search-automation`)

An automated job search pipeline conforming to the [Agent Plugins specification v1.0.0](https://github.com/agentplugins/agent-plugins-spec) and [Agent Skills specification](https://agentskills.io/specification). Features dual-mode storage (Local Markdown and Neon PostgreSQL), a standard Model Context Protocol (MCP) data server, an interactive browser crawler, runtime scoring rubric normalization, and a bundled local web dashboard.

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
│   ├── crawl-job-board.js      # Playwright browser job board scraper
│   ├── init-neon.js            # Neon schema & default rubric seeder
│   └── migrate.js              # Markdown-to-Neon migration engine
├── templates/                  # Scaffolding templates & default rubric
├── web/                        # Local dashboard SPA & dev server
└── tests/                      # Packaging, skills, rubric, & setup test suites
```

---

## Prerequisites

- **Node.js**: Version 18 or higher.
- **Playwright Chromium**: For job board scraping:
  ```bash
  npx playwright install chromium
  ```
- **Optional**: Neon PostgreSQL connection string (if running in Neon mode).

---

## Installation & Setup

Install and configure the plugin in a single step using `setup.sh`:

### Option A: Local Mode (Zero-Dependency Markdown Storage)
```bash
./setup.sh --mode local --resume /path/to/your/resume.pdf -y
```
- Stores data in `~/.local/share/job-search-automation/` as structured Markdown tables.
- Writes configuration to `~/.config/job-search-automation/config.json`.

### Option B: Neon Mode (Cloud PostgreSQL)
```bash
./setup.sh --mode neon --resume /path/to/your/resume.pdf --neon-connection-string "postgres://..." -y
```
- Stores credentials securely in macOS Keychain under service `job-search-automation`.
- Automatically provisions tables and seeds the runtime scoring rubric.

### Interactive Mode
Run `./setup.sh` without arguments to step through guided interactive configuration.

---

## Updating Your Resume

Update your active resume at any time without re-running setup:
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
# Build and start the dashboard dev server:
npm run ui

# Or launch development mode:
npm run ui:dev
```
Access the dashboard at `http://localhost:3000`.

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
