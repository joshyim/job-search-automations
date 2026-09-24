# Claude Code Agent Guidelines: Job Search Automation

This repository provides an automated, skill-based job search pipeline with local SQLite storage (and optional Neon Cloud PostgreSQL) and an MCP server.

## Quickstart - Claude Code

When a user in Claude Desktop (Claude Code mode) or Claude Code CLI asks to install, set up, or get started with Job Search Automation:

1. **Keep it simple and frictionless**:
   - Do **NOT** debate marketplace mechanisms vs. local scripts.
   - Do **NOT** run `git clone`. The repository must NEVER be cloned into the user's workspace.
   - Do **NOT** warn about ephemeral cloud sandboxes. Claude Code connects directly to the user's workspace, and data persists permanently in `<selected-directory>/.job-search/` (containing `job-search.sqlite`, `resume.pdf`, and `config.json`).
   - Do **NOT** ask about Neon database strings or storage modes unless the user explicitly requests Neon cloud mode. Local SQLite mode is the default zero-dependency mode.
   - Do **NOT** attempt to install Playwright or Chromium. The crawler runs zero-browser lightweight fetch with ATS APIs.
   - For universal, multi-harness installation flags and details, refer to [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md).

> [!CRITICAL]
> **NEVER run `git clone` to install this plugin.**
> Setup must ONLY be performed via `npx -y github:joshyim/job-search-automations setup`. Cloning the repository into the user's workspace is strictly forbidden and pollutes the workspace with unwanted source code and git history.

2. **Resume Path & Workspace Collection**:
   - If the user hasn't provided a resume path, ask:
     > *"To set up your job search pipeline, please provide the path to your resume PDF (for example: `~/Documents/resume.pdf` or drag-and-drop it here)."*

3. **Execute Setup**:
   - Run the automated zero-clone setup via `npx`:
     ```bash
     npx -y github:joshyim/job-search-automations setup
     ```
     *(Optionally append `--resume "<path-to-resume.pdf>"` if the user has already provided a resume file).*
   - Setup will:
     - Pre-compile packages and install the self-contained plugin into `<selected-directory>/.claude/plugins/job-search-automations/`
     - Configure `<selected-directory>/.mcp.json` to launch the database MCP server via plugin-relative path
     - Configure `<selected-directory>/.claude/launch.json` for web preview of the UI dashboard
     - Pre-grant permissions in `<selected-directory>/.claude/settings.json` for unattended crawler runs
     - Scaffold the `<selected-directory>/.job-search/` workspace with SQLite database, configuration, and default scoring rubric

4. **Conversational Next Step**:
   - Once setup reports completion, ask the user:
     > *"Your job search pipeline is ready! What job titles, locations, or target companies would you like to start with?"*
   - Save their preferences and offer to run their first search using `company-search` or `job-search-lead-gen`.
   - If asked to set up routines or recurring schedules, follow the **Canonical Routines** defined below and in [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md). **NEVER create a "Weekly digest" routine.**

## Runtime Architecture

The Job Search Automation workspace operates on a clean separation of three components:

1. **`.job-search/` — Persistent User Data (Source of Truth)**:
   - Contains persistent user state: `job-search.sqlite` (SQLite database), `resume.pdf` (active resume), `config.json` (runtime configuration), and ephemeral `tmp/` (crawl staging).
   - This directory is the **single source of truth** for all user data, search targets, crawl queues, candidate evaluations, and run logs.
   - It survives session resets, git branch switches, re-installations, and host restarts. It **always exists** once setup has run.

2. **`.claude/plugins/job-search-automations/` — Plugin Runtime Code (Read-Only)**:
   - Self-contained plugin package installed once during setup.
   - Contains pre-compiled packages (`packages/job-search-db` and `packages/job-search-ui` with production bundles in `dist/` and `public/`), declarative agent skills (`skills/`), standalone scripts (`scripts/crawl-job-board.js`), manifests (`plugin.json`, `mcp.json`), and schema definitions (`schema.sql`).
   - It is strictly **read-only** at runtime. It does NOT require `npm install`, TypeScript compilation, or source rebuilds.

3. **`.mcp.json` — MCP Server Configuration (Host Integration)**:
   - MCP configuration at the project root pointing the host agent to the database MCP server launcher (`./.claude/plugins/job-search-automations/packages/job-search-db/scripts/start.js`).
   - Connects agent tools directly to the `.job-search/` SQLite database.

## Post-Install Runtime Environment & Agent Directives

> [!CRITICAL]
> **NEVER assume the source repository, git history, or repo-root files exist at runtime.**
> Only the three runtime components above (`.job-search/`, `.claude/plugins/job-search-automations/`, and `.mcp.json`), plus `.claude/launch.json` and `.claude/settings.json`, exist in an installed workspace.
> **No other files are needed, required, or expected.**

### Explicit Runtime File Layout

In a user's project workspace after installation, the source repo and git history are **not present**. ONLY the following files and directories exist:
- `<selected-directory>/.job-search/`: Persistent workspace data (`job-search.sqlite`, `resume.pdf`, `config.json`, and ephemeral `tmp/`)
- `<selected-directory>/.claude/plugins/job-search-automations/`: The self-contained, pre-compiled plugin package containing:
  - Built packages (`packages/job-search-db` and `packages/job-search-ui`) with pre-compiled `dist/`, `public/`, and `scripts/start.js`
  - Skills in `skills/`
  - Lightweight crawler in `scripts/crawl-job-board.js`
  - Plugin manifests (`plugin.json`, `mcp.json`, `CLAUDE.md`) and `schema.sql`
- `<selected-directory>/.mcp.json`: MCP server configuration pointing to `./.claude/plugins/job-search-automations/packages/job-search-db/scripts/start.js`
- `<selected-directory>/.claude/launch.json`: Claude Desktop web preview configuration for the UI dashboard
- `<selected-directory>/.claude/settings.json`: Pre-granted permissions for unattended runs

### Mandatory Agent Rules

1. **Do NOT search for or attempt to restore Git files**:
   The workspace does NOT contain a `.git` folder, git history, or git commits. Never run `git status`, `git checkout`, `git restore`, `git rev-parse`, or investigate missing git files. The plugin does not need or use git.
2. **Do NOT look for or scaffold root `package.json` or `node_modules`**:
   Neither `package.json` nor `node_modules` exists at the project root. Never run `npm init`, `npm install`, or try to reconstruct package manifests at the project root. All dependencies are pre-bundled inside `.claude/plugins/job-search-automations/packages/`.
3. **Never reference source repository paths**:
   Paths like `packages/job-search-ui/` or `packages/job-search-db/` **do not exist** at the project root. Never run commands targeting repo-relative package directories.
4. **Always reference installed plugin paths**:
   All package assets and scripts live under `.claude/plugins/job-search-automations/`. For example:
   - Crawler: `node .claude/plugins/job-search-automations/scripts/crawl-job-board.js "<url>" --json`
   - UI Dashboard: `npm run start --prefix ./.claude/plugins/job-search-automations/packages/job-search-ui`
   - Database MCP: Handled automatically via `.mcp.json` (`./.claude/plugins/job-search-automations/packages/job-search-db/scripts/start.js`)
5. **Use `start`, NEVER `dev`**:
   The plugin installation ships pre-compiled production bundles (`dist/` and `public/`). The TypeScript source directory `src/` is intentionally excluded from the plugin distribution. Running `npm run dev` or `tsx src/server.ts` will fail. Always use `npm run start` (or execute `scripts/start.js`).
6. **Never run `npm install` in the project root or package directories**:
   Dependencies are already bundled or resolved within `.claude/plugins/job-search-automations/packages/`. Running `npm install` at the project root or against deleted repo paths will fail.
7. **Intermediate Crawl Data & Ephemeral Files (`.job-search/tmp/`)**:
   - The crawler `scripts/crawl-job-board.js` outputs JSON directly to stdout (`node ... --json`). Agents should parse stdout JSON directly in memory without writing intermediate files to disk whenever possible.
   - If intermediate crawl data must be staged, write strictly to `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
   - **NEVER** create directories or write files in the project workspace or repo root (e.g. `./tmp/` or `./<company>/`). Never create nested subdirectories inside `.job-search/tmp/`. The flat `.job-search/tmp/` directory is pre-created during setup.
   - Pre-granted permissions in `.claude/settings.json` explicitly cover crawler script execution (`node ... crawl-job-board.js:*`), safe ephemeral directory cleanup via helper script (`node ... cleanup-tmp.js:*`), workspace read access (`Read(<selected-directory>/**)`), scoped database and tmp write access (`Write(<selected-directory>/.job-search/**)`), operational `mcp__job-search-db__*` tools, and web access fallback (`WebSearch`, `WebFetch`) to guarantee scheduled unattended runs without prompts.
   - Both `job-search-crawl` and `job-search-assess` must clean up any temporary files in `.job-search/tmp/` upon run completion (using `node .claude/plugins/job-search-automations/scripts/cleanup-tmp.js` or native Claude file tools). Scored candidates and queue entries are committed to the SQLite database via MCP tools—never left as files on disk.
8. **Scheduled & Unattended Execution Guidelines (Cost & Scoping Control)**:
   - Scheduled tasks in Claude Code run unattended without user intervention. Because Claude scheduled tasks lack native message or token caps, execution bounds MUST be strictly enforced via prompt instructions, bounded batching, and fast-fail logic.
   - **Message Budget**: Scheduled task prompts must state an explicit message budget: *"Complete within 40–50 messages. If more companies or pending postings remain, stop and let the next scheduled run continue."*
   - **Batch Limits**:
     - Crawl: Process at most 2–3 companies per scheduled run (via `get_batch({ limit: 3 })`).
     - Assess: Process at most 5 pending postings per scheduled run (via `get_pending_queue`).
     - Company Discovery (`company-search`): Add at most 3–5 newly qualified companies per scheduled run.
     - Title Discovery (`title-discovery`): Add at most 1–3 newly validated title patterns per scheduled run.
   - **Zero Browser Automation & ATS Fallback**: Never invoke interactive browser tools (`Claude_Browser`, browser preview tabs, Puppeteer) during unattended runs. Stick strictly to lightweight HTTP / ATS APIs and simple `WebFetch`. For Ashby or other ATS SPAs, use the crawler in posting mode (`crawl-job-board.js --posting`) which resolves complete job text via public APIs.
     - **Known ATS Public APIs**:
       - **Ashby**: Prefer unauthenticated public board API `https://api.ashbyhq.com/posting-api/job-board/<boardSlug>`. For individual postings, query the board endpoint or use `crawl-job-board.js "<url>" --posting --json`. **CRITICAL**: Never call `https://api.ashbyhq.com/posting-api/job/{id}` directly; that endpoint requires API authentication and will fail with `HTTP 401 Unauthorized`.
       - **Greenhouse**: Use public board API `https://boards-api.greenhouse.io/v1/boards/<boardToken>/jobs` and posting API `https://boards-api.greenhouse.io/v1/boards/<boardToken>/jobs/<jobId>`.
       - **Lever**: Use public board API `https://api.lever.co/v0/postings/<boardToken>?mode=json` and posting API `https://api.lever.co/v0/postings/<boardToken>/<jobId>`.
   - **Circuit Breaker Prevention & Fast-Fail URLs**: If an ATS board is unreachable or a posting URL redirects/404s, immediately mark it skipped via `update_queue_status` and move to the next item. Never enter retry loops. Crucially, when an SPA placeholder ("You need to enable JavaScript to run this app.") is detected on fetch #1, immediately switch to the ATS API or skip the company—never repeat `WebFetch` calls across identical shells to avoid tripping the 7-call loop detector circuit breaker.
   - **Per-Company Error Isolation & Batch Resilience**:
     - In batch operations (`job-search-lead-gen` or `job-search-crawl` with `get_batch`), each company MUST be processed inside an isolated error handling boundary.
     - A failure on one company (such as crawler exit codes 1/2/3/4, network timeout, HTTP 404/500, Cloudflare block, or unsupported SPA shell) must NEVER abort the batch run or cause the agent to drop subsequent companies.
     - When a company fails:
       1. Clean up its temporary files in `<selected-directory>/.job-search/tmp/`.
       2. Record the failure reason on the company record via `update_company_crawl_status` and in run telemetry via `log_run` with structured error details (`error_type`, `error_message`, `careers_url`, `needs_review: true`).
       3. Skip that company and proceed immediately to the next company in the batch.
     - Failure taxonomy:
       - `js_required`: SPA requires JS rendering and no public API or renderer is available (crawler exit 3)
       - `unreachable`: Careers board or posting returned 404/410/500 or DNS failure (crawler exit 4)
       - `timeout`: Network request exceeded execution deadline (crawler exit 2)
       - `blocked`: Cloudflare, captcha, or 403 Forbidden
       - `rate_limited`: Search provider rate-limited (e.g. DuckDuckGo 429/202 block) during search fallback; halts further search calls for the batch
       - `no_postings`: Careers board yielded 0 listings or no matching titles
       - `assessment_error`: Error reading resume or scoring against rubric
   - **Search Fallback Query Pacing & Rate Limit Guardrails (PRO-64)**:
     - Search fallback (`WebSearch`) is ONLY invoked if the lightweight crawler fails or yields 0 postings on custom non-ATS boards.
     - **Query Budget**: Limit search fallback to at most **1 targeted query per company** (e.g. `"<company>" "jobs" site:<careers_domain>`). Never loop over individual target title patterns.
     - **Batch Search Cap**: In unattended/batch runs, limit search fallback invocations to at most 2 total searches across the entire batch.
     - **Zero-Retry on Rate Limiting**: If DuckDuckGo or the search provider returns a rate limit message (`"DuckDuckGo is rate-limiting this machine..."`, HTTP 429, or HTTP 202), immediately mark the company as `failed` with `error_type: "rate_limited"`. **NEVER retry or rephrase the query**.
     - **Batch Circuit Breaker**: Once a rate limit occurs, immediately disable search fallback for all subsequent companies in the batch and continue using direct crawler only.
   - **Strict Anti-Hallucination Guardrail (No Weekly Digest)**: There is **NO Weekly Digest routine** in this repository. Agents must never create, suggest, or schedule a weekly digest routine. Only configure the 4 canonical routines documented in [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md).
9. **Candidate Status Ownership & Human-in-the-Loop Disposition**:
   - Automated assessment and crawler agents must **never** unilaterally set candidate status to `not_pursuing`, `closed`, `rejected`, `applied`, or any other disposition status.
   - When recording candidates via `add_candidate`, always record with `status: "new"`.
   - Low rubric scores, qualification doubts, or perceived misfit do **not** justify auto-disposition. The scoring agent's role is strictly to score and evaluate against the rubric; disposition decisions belong exclusively to the human user.

## Launching the Web UI Dashboard

The local Web UI dashboard provides a visual interface for reviewing scored candidates, exploring target companies, and adjusting the scoring rubric.

- **When User Asks to Launch**: If the user asks to launch or start the UI/dashboard, launch the server in the background:
  - Installed Project Workspace: `node .claude/plugins/job-search-automations/packages/job-search-ui/scripts/start.js`
  - Source Repository: `npm run ui`
  Confirm the running URL (default `http://localhost:3847`, or next available port if 3847 is busy) and provide it to the user.
- **Claude Desktop**: Users can also open via Claude Desktop's built-in web preview using the pre-configured `job-search-ui` entry in `.claude/launch.json`.
- **Command Line**: Users can manually launch directly:
  ```bash
  node .claude/plugins/job-search-automations/packages/job-search-ui/scripts/start.js
  ```

## Available Skills

- **`company-search`**: Discovers hiring companies across YC, BuiltIn, Wellfound, and LinkedIn.
- **`job-search-crawl`**: Crawls a company career board using the lightweight crawler (`node .claude/plugins/job-search-automations/scripts/crawl-job-board.js "<url>" --json`). Falls back to WebSearch / WebFetch if needed.
- **`job-search-assess`**: Scores crawl queue postings against the user's resume and rubric.
- **`job-search-lead-gen`**: End-to-end orchestrator: selects target companies, crawls their boards, and scores matches.
- **`title-discovery`**: Discovers target job titles and skills based on resume analysis.
- **`pipeline-diagram`**: Generates Mermaid diagrams of the pipeline state.

## Canonical Routines & Recurring Scheduling

When asked to configure routines or recurring background jobs, configure ONLY the four canonical routines below. See [installation-steps.md](file:///Users/joshyim/projects/agent-automations/job-search-automations/installation-steps.md) for full prompt templates, budgets, and cloud management steps.

1. **Daily Company Search** (`company-search`):
   - Schedule: Daily 8:00 PM (`0 20 * * *`)
   - Bounds: Add at most 3–5 newly qualified companies; budget 30–40 messages.
2. **Daily Job Title Search** (`title-discovery`):
   - Schedule: Daily 9:00 PM (`0 21 * * *`)
   - Bounds: Add at most 1–3 new validated patterns; budget 25–35 messages.
3. **Daily Job Crawl** (`job-search-crawl` or `job-search-lead-gen`):
   - Schedule: Daily 6:00 AM (`0 6 * * *`)
   - Bounds: Batch 2–3 companies (`get_batch({ limit: 3 })`); budget 40–50 messages.
4. **Daily Job Evaluation** (`job-search-assess`):
   - Schedule: Daily 7:00 AM (`0 7 * * *`)
   - Bounds: Batch 5 pending postings (`get_pending_queue`); budget 40–50 messages.

> [!IMPORTANT]
> **Mandatory Auto Approval for Routines**:
> Scheduled routines run autonomously without human supervision. When creating, configuring, or updating scheduled tasks or routines via MCP (`mcp__scheduled-tasks__create_scheduled_task`, `update_scheduled_task`, `/schedule`, or editing `scheduled-tasks.json`), always set or ensure `permissionMode: "auto"`. **NEVER leave routines set to "Manual" approval**, as unattended runs will stall on permission prompts.

> [!TIP]
> **Recommended Model Class for Routines**:
> Unattended daily routines perform high volumes of web searches, scraping, and evaluations. Always recommend or configure routines with **Sonnet-class** models (e.g. latest Sonnet release) rather than allowing them to default to expensive flagship/frontier models (such as Opus).

> [!CRITICAL]
> **NEVER configure a "Weekly digest" routine.** No digest tool, skill, or service exists.

## Resume Updates

If the user provides a new resume later:
```bash
npx -y github:joshyim/job-search-automations update-resume "<path-to-new-resume.pdf>" --directory "<path-to-workspace>"
```

## Maintainer: Standalone Repo Synchronization & Publishing

This plugin is developed and maintained inside the private `agent-automations` monorepo and published as a standalone public repository at [github.com/joshyim/job-search-automations](https://github.com/joshyim/job-search-automations).

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
- **Clean Working Tree**: Confirms there are no uncommitted changes in `job-search-automations/` before pushing.
- **Commit Isolation (`git subtree`)**: Extracts only commits that touched files inside `job-search-automations/`. Commits from other monorepo directories (such as `gmail-ai-triage/` or `.agents/`) are completely omitted from the public git history.
- **Confirmation Prompt**: Previews the latest commits in `job-search-automations/` and asks for explicit confirmation before pushing.

