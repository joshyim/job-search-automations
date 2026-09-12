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

## Runtime Architecture

The Job Search Automation workspace operates on a clean separation of three components:

1. **`.job-search/` — Persistent User Data (Source of Truth)**:
   - Contains persistent user state: `job-search.sqlite` (SQLite database), `resume.pdf` (active resume), `config.json` (runtime configuration), and ephemeral `tmp/` (crawl staging).
   - This directory is the **single source of truth** for all user data, search targets, crawl queues, candidate evaluations, and run logs.
   - It survives session resets, git branch switches, re-installations, and host restarts. It **always exists** once setup has run.

2. **`.claude/plugins/job-search-automation/` — Plugin Runtime Code (Read-Only)**:
   - Self-contained plugin package installed once during setup.
   - Contains pre-compiled packages (`packages/job-search-db` and `packages/job-search-ui` with production bundles in `dist/` and `public/`), declarative agent skills (`skills/`), standalone scripts (`scripts/crawl-job-board.js`), manifests (`plugin.json`, `mcp.json`), and schema definitions (`schema.sql`).
   - It is strictly **read-only** at runtime. It does NOT require `npm install`, TypeScript compilation, or source rebuilds.

3. **`.mcp.json` — MCP Server Configuration (Host Integration)**:
   - MCP configuration at the project root pointing the host agent to the database MCP server launcher (`./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js`).
   - Connects agent tools directly to the `.job-search/` SQLite database.

## Post-Install Runtime Environment & Agent Directives

> [!CRITICAL]
> **NEVER assume the source repository, git history, or repo-root files exist at runtime.**
> Only the three runtime components above (`.job-search/`, `.claude/plugins/job-search-automation/`, and `.mcp.json`), plus `.claude/launch.json` and `.claude/settings.json`, exist in an installed workspace.
> **No other files are needed, required, or expected.**

### Explicit Runtime File Layout

In a user's project workspace after installation, the source repo and git history are **not present**. ONLY the following files and directories exist:
- `<selected-directory>/.job-search/`: Persistent workspace data (`job-search.sqlite`, `resume.pdf`, `config.json`, and ephemeral `tmp/`)
- `<selected-directory>/.claude/plugins/job-search-automation/`: The self-contained, pre-compiled plugin package containing:
  - Built packages (`packages/job-search-db` and `packages/job-search-ui`) with pre-compiled `dist/`, `public/`, and `scripts/start.js`
  - Skills in `skills/`
  - Lightweight crawler in `scripts/crawl-job-board.js`
  - Plugin manifests (`plugin.json`, `mcp.json`, `CLAUDE.md`) and `schema.sql`
- `<selected-directory>/.mcp.json`: MCP server configuration pointing to `./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js`
- `<selected-directory>/.claude/launch.json`: Claude Desktop web preview configuration for the UI dashboard
- `<selected-directory>/.claude/settings.json`: Pre-granted permissions for unattended runs

### Mandatory Agent Rules

1. **Do NOT search for or attempt to restore Git files**:
   The workspace does NOT contain a `.git` folder, git history, or git commits. Never run `git status`, `git checkout`, `git restore`, `git rev-parse`, or investigate missing git files. The plugin does not need or use git.
2. **Do NOT look for or scaffold root `package.json` or `node_modules`**:
   Neither `package.json` nor `node_modules` exists at the project root. Never run `npm init`, `npm install`, or try to reconstruct package manifests at the project root. All dependencies are pre-bundled inside `.claude/plugins/job-search-automation/packages/`.
3. **Never reference source repository paths**:
   Paths like `packages/job-search-ui/` or `packages/job-search-db/` **do not exist** at the project root. Never run commands targeting repo-relative package directories.
4. **Always reference installed plugin paths**:
   All package assets and scripts live under `.claude/plugins/job-search-automation/`. For example:
   - Crawler: `node .claude/plugins/job-search-automation/scripts/crawl-job-board.js "<url>" --json`
   - UI Dashboard: `npm run start --prefix ./.claude/plugins/job-search-automation/packages/job-search-ui`
   - Database MCP: Handled automatically via `.mcp.json` (`./.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js`)
5. **Use `start`, NEVER `dev`**:
   The plugin installation ships pre-compiled production bundles (`dist/` and `public/`). The TypeScript source directory `src/` is intentionally excluded from the plugin distribution. Running `npm run dev` or `tsx src/server.ts` will fail. Always use `npm run start` (or execute `scripts/start.js`).
6. **Never run `npm install` in the project root or package directories**:
   Dependencies are already bundled or resolved within `.claude/plugins/job-search-automation/packages/`. Running `npm install` at the project root or against deleted repo paths will fail.
7. **Intermediate Crawl Data & Ephemeral Files (`.job-search/tmp/`)**:
   - The crawler `scripts/crawl-job-board.js` outputs JSON directly to stdout (`node ... --json`). Agents should parse stdout JSON directly in memory without writing intermediate files to disk whenever possible.
   - If intermediate crawl data must be staged, write strictly to `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
   - **NEVER** create directories or write files in the project workspace or repo root (e.g. `./tmp/` or `./<company>/`). Never create nested subdirectories inside `.job-search/tmp/`. The flat `.job-search/tmp/` directory is pre-created during setup.
   - Pre-granted permissions in `.claude/settings.json` explicitly cover `mkdir` and `rm` for `.job-search/tmp*` and read/write for `.job-search/**` to guarantee unattended runs without prompts.
   - Both `job-search-crawl` and `job-search-assess` must clean up any temporary files in `.job-search/tmp/` upon run completion. Scored candidates and queue entries are committed to the SQLite database via MCP tools—never left as files on disk.

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
