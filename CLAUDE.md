# Claude Code Agent Guidelines: Job Search Automation

This repository provides an automated, skill-based job search pipeline with local SQLite storage (and optional Neon Cloud PostgreSQL) and an MCP server.

## Installation & First-Time Setup (Claude Desktop / CLI)

When a user in Claude Desktop (Claude Code mode) or Claude Code CLI asks to install, set up, or get started with Job Search Automation:

1. **Keep it simple and frictionless**:
   - Do **NOT** debate marketplace mechanisms vs. local scripts.
   - Do **NOT** warn about ephemeral cloud sandboxes. Claude Code connects directly to the user's workspace, and data persists permanently in `<selected-directory>/.job-search/` (containing `job-search.sqlite`, `resume.pdf`, and `config.json`).
   - Do **NOT** ask about Neon database strings or storage modes unless the user explicitly requests Neon cloud mode. Local SQLite mode is the default zero-dependency mode.
   - Do **NOT** attempt to install Playwright or Chromium. The crawler runs zero-browser lightweight fetch with ATS APIs.

2. **Resume Path & Workspace Collection**:
   - If the user hasn't provided a resume path, ask:
     > *"To set up your job search pipeline, please provide the path to your resume PDF (for example: `~/Documents/resume.pdf` or drag-and-drop it here)."*

3. **Execute Setup**:
   - Run the automated setup specifying the target directory (via npx or local script):
     ```bash
     npx @personal-automation/job-search-automation setup --directory "<path-to-workspace>" --resume "<path-to-resume.pdf>"
     ```
     Or using the local shell script:
     ```bash
     ./setup.sh --directory "<path-to-workspace>" --resume "<path-to-resume.pdf>" -y
     ```
   - Setup will:
     - Pre-compile packages and install the self-contained plugin into `<selected-directory>/.claude/plugins/job-search-automation/`
     - Configure `<selected-directory>/.mcp.json` to launch the database MCP server via plugin-relative path
     - Configure `<selected-directory>/.claude/launch.json` for web preview of the UI dashboard
     - Pre-grant permissions in `<selected-directory>/.claude/settings.json` for unattended crawler runs
     - Scaffold the `<selected-directory>/.job-search/` workspace with SQLite database, configuration, and default scoring rubric

4. **Conversational Next Step**:
   - Once setup reports completion, ask the user:
     > *"Your job search pipeline is ready! What job titles, locations, or target companies would you like to start with?"*
   - Save their preferences and offer to run their first search using `company-search` or `job-search-lead-gen`.

## Post-Install Runtime Environment & Agent Directives

> [!CRITICAL]
> **NEVER assume the source repository or repo-root `packages/` exist at runtime.**

In a user's project workspace after installation, the source repository is **not present**. Only the following files and directories exist:
- `<selected-directory>/.claude/plugins/job-search-automation/`: The self-contained plugin package containing:
  - Built packages (`packages/job-search-db` and `packages/job-search-ui`) with pre-compiled `dist/`, `public/`, and `scripts/start.js`
  - Skills in `skills/`
  - Lightweight crawler in `scripts/crawl-job-board.js`
  - Plugin manifests (`plugin.json`, `mcp.json`) and `schema.sql`
- `<selected-directory>/.job-search/`: Persistent workspace data (`job-search.sqlite`, `resume.pdf`, `config.json`, and ephemeral `tmp/`)
- `<selected-directory>/.mcp.json`: MCP server configuration pointing to `./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js`
- `<selected-directory>/.claude/launch.json`: Claude Desktop web preview configuration for the UI dashboard
- `<selected-directory>/.claude/settings.json`: Pre-granted permissions for unattended runs

### Mandatory Agent Rules

1. **Never reference source repository paths**:
   Paths like `packages/job-search-ui/` or `packages/job-search-db/` **do not exist** at the project root. Never run commands like `npm install`, `npm test`, or `cd` targeting repo-relative package directories.
2. **Always reference installed plugin paths**:
   All package assets and scripts live under `.claude/plugins/job-search-automation/`. For example:
   - Crawler: `node .claude/plugins/job-search-automation/scripts/crawl-job-board.js "<url>" --json`
   - UI Dashboard: `npm run start --prefix ./.claude/plugins/job-search-automation/packages/job-search-ui`
   - Database MCP: Handled automatically via `.mcp.json` (`./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js`)
3. **Use `start`, NEVER `dev`**:
   The plugin installation ships pre-compiled production bundles (`dist/` and `public/`). The TypeScript source directory `src/` is intentionally excluded from the plugin distribution. Running `npm run dev` or `tsx src/server.ts` will fail. Always use `npm run start` (or execute `scripts/start.js`).
4. **Never run `npm install` in the project root or package directories**:
   Dependencies are already bundled or resolved within `.claude/plugins/job-search-automation/packages/`. Running `npm install` at the project root or against deleted repo paths will fail.

## Launching the Web UI Dashboard

The local Web UI dashboard provides a visual interface for reviewing scored candidates, exploring target companies, and adjusting the scoring rubric.

- **Claude Desktop**: Open the dashboard via Claude Desktop's built-in web preview using the pre-configured `job-search-ui` entry in `.claude/launch.json`.
- **Command Line**: Start the dashboard server using the plugin-relative path:
  ```bash
  npm run start --prefix ./.claude/plugins/job-search-automation/packages/job-search-ui
  ```
  Or run the launcher directly:
  ```bash
  node ./.claude/plugins/job-search-automation/packages/job-search-ui/scripts/start.js
  ```
  The dashboard binds to `http://localhost:3847` (with automatic port-increment fallback if 3847 is busy).

## Available Skills

- **`company-search`**: Discovers hiring companies across YC, BuiltIn, Wellfound, and LinkedIn.
- **`job-search-crawl`**: Crawls a company career board using the lightweight crawler (`node .claude/plugins/job-search-automation/scripts/crawl-job-board.js "<url>" --json`). Falls back to WebSearch / WebFetch if needed.
- **`job-search-assess`**: Scores crawl queue postings against the user's resume and rubric.
- **`job-search-lead-gen`**: End-to-end orchestrator: selects target companies, crawls their boards, and scores matches.
- **`title-discovery`**: Discovers target job titles and skills based on resume analysis.
- **`pipeline-diagram`**: Generates Mermaid diagrams of the pipeline state.

## Resume Updates

If the user provides a new resume later:
```bash
npx @personal-automation/job-search-automation update-resume "<path-to-new-resume.pdf>" --directory "<path-to-workspace>"
```
Or using the local shell script:
```bash
./setup.sh --directory "<path-to-workspace>" --update-resume "<path-to-new-resume.pdf>"
```
