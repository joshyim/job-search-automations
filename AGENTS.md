# Agent Guidelines: Job Search Automation

This repository provides an automated, skill-based job search pipeline with local SQLite storage (and optional Neon Cloud PostgreSQL) and an MCP server.

This document defines runtime behavior, architecture, and constraints for **Codex**, **ChatGPT desktop Codex tasks**, and conforming **Agent Plugins v1** harnesses.

## Quickstart - Codex & ChatGPT

When a user in Codex Desktop, Codex CLI, or ChatGPT Codex task asks to install, set up, or get started with Job Search Automation:

1. **Keep it simple and frictionless**:
   - Do **NOT** debate marketplace mechanisms vs. local scripts.
   - Do **NOT** run `git clone`. The repository must NEVER be cloned into the user's workspace.
   - Data persists permanently in `<selected-directory>/.job-search/` (containing `job-search.sqlite`, `resume.pdf`, and `config.json`).
   - Do **NOT** ask about Neon database strings or storage modes unless the user explicitly requests Neon cloud mode. Local SQLite mode is the default zero-dependency mode.
   - Do **NOT** attempt to install Playwright or Chromium. The crawler runs zero-browser lightweight fetch with ATS APIs.
   - For universal, multi-harness installation flags and details, refer to [installation-steps.md](file:///Users/joshyim/projects/personal-automation/job-search-automations/installation-steps.md).

> [!CRITICAL]
> **NEVER run `git clone` to install this plugin.**
> Setup must ONLY be performed via `npx -y github:joshyim/job-search-automations setup --codex` (or `./setup.sh --codex`). Cloning the repository into the user's workspace is strictly forbidden and pollutes the workspace with unwanted source code and git history.

2. **Resume Path & Workspace Collection**:
   - If the user hasn't provided a resume path, ask:
     > *"To set up your job search pipeline, please provide the path to your resume PDF (for example: `~/Documents/resume.pdf` or drag-and-drop it here)."*

3. **Execute Setup**:
   - Run the automated zero-clone setup with the `--codex` flag:
     ```bash
     npx -y github:joshyim/job-search-automations setup --codex
     ```
     *(Optionally append `--resume "<path-to-resume.pdf>"` if the user has already provided a resume file).*
   - Setup will:
     - Install the self-contained plugin into `<selected-directory>/.codex/plugins/job-search-automations/`
     - Register the database MCP server in `<selected-directory>/.codex/config.toml` with `default_tools_approval_mode = "writes"`
     - Install the 6 declarative skills into `<selected-directory>/.agents/skills/`
     - Provide `<selected-directory>/AGENTS.md` for agent guidelines
     - Scaffold the `<selected-directory>/.job-search/` workspace with SQLite database, configuration, and default scoring rubric

4. **Conversational Next Step**:
   - Once setup reports completion, ask the user:
     > *"Your job search pipeline is ready! What job titles, locations, or target companies would you like to start with?"*
   - Save their preferences and offer to run their first search using `company-search` or `job-search-lead-gen`.
   - If asked to set up routines or recurring schedules, follow the **Canonical Routines** defined below and in [installation-steps.md](file:///Users/joshyim/projects/personal-automation/job-search-automations/installation-steps.md). **NEVER create a "Weekly digest" routine.**

---

## Runtime Architecture

The Job Search Automation workspace operates on a clean separation of three components:

1. **`.job-search/` — Persistent User Data (Source of Truth)**:
   - Contains persistent user state: `job-search.sqlite` (SQLite database), `resume.pdf` (active resume), `config.json` (runtime configuration), and ephemeral `tmp/` (crawl staging).
   - This directory is the **single source of truth** for all user data, search targets, crawl queues, candidate evaluations, and run logs.
   - It survives session resets, git branch switches, re-installations, and host restarts. It **always exists** once setup has run.

2. **Plugin Runtime Code (Read-Only)**:
   - Installed under `.codex/plugins/job-search-automations/` (or `.claude/plugins/job-search-automations/`).
   - Contains pre-compiled packages (`packages/job-search-db` and `packages/job-search-ui` with production bundles in `dist/` and `public/`), standalone scripts (`scripts/crawl-job-board.js`), manifests (`plugin.json`, `mcp.json`), and schema definitions (`schema.sql`).
   - It is strictly **read-only** at runtime. It does NOT require `npm install`, TypeScript compilation, or source rebuilds.

3. **Host MCP & Skills Integration**:
   - **Codex**: Configured in `.codex/config.toml` pointing to `packages/job-search-db/scripts/start.js` with `default_tools_approval_mode = "writes"`, and native skills located in `.agents/skills/`.
   - **Claude Code**: Configured in `.mcp.json` pointing to `packages/job-search-db/scripts/start.js`, with skills in `.claude/plugins/job-search-automations/skills/`.

---

## Post-Install Runtime Environment & Agent Directives

> [!CRITICAL]
> **NEVER assume the source repository, git history, or repo-root files exist at runtime.**
> Only the three runtime components above exist in an installed workspace. **No other files are needed, required, or expected.**

### Mandatory Agent Rules

1. **Do NOT search for or attempt to restore Git files**:
   The workspace does NOT contain a `.git` folder, git history, or git commits. Never run `git status`, `git checkout`, `git restore`, `git rev-parse`, or investigate missing git files. The plugin does not need or use git.
2. **Do NOT look for or scaffold root `package.json` or `node_modules`**:
   Neither `package.json` nor `node_modules` exists at the project root. Never run `npm init`, `npm install`, or try to reconstruct package manifests at the project root.
3. **Never reference source repository paths**:
   Paths like `packages/job-search-ui/` or `packages/job-search-db/` **do not exist** at the project root. Always use the installed plugin paths or `.agents/skills/`.
4. **Intermediate Crawl Data & Ephemeral Files (`.job-search/tmp/`)**:
   - The crawler outputs JSON directly to stdout (`node ... crawl-job-board.js "<url>" --json`). Agents should parse stdout JSON directly in memory without writing intermediate files to disk whenever possible.
   - If intermediate crawl data must be staged, write strictly to `<selected-directory>/.job-search/tmp/<company-slug>-crawl.json`.
   - **NEVER** create directories or write files in the project workspace or repo root. Never create nested subdirectories inside `.job-search/tmp/`.
   - Both `job-search-crawl` and `job-search-assess` must clean up any temporary files upon run completion.
5. **Scheduled & Unattended Execution Guidelines (Cost & Scoping Control)**:
   - **Message Budget**: State an explicit message budget in prompts: *"Complete within 40–50 messages. If more companies or pending postings remain, stop and let the next scheduled run continue."*
   - **Batch Limits**:
     - Crawl: Process at most 2–3 companies per scheduled run (`get_batch({ limit: 3 })`).
     - Assess: Process at most 5 pending postings per scheduled run (`get_pending_queue`).
     - Company Discovery (`company-search`): Add at most 3–5 newly qualified companies per run.
     - Title Discovery (`title-discovery`): Add at most 1–3 new validated title patterns per run.
   - **Zero Browser Automation**: Never invoke interactive browser tools during unattended runs. Stick strictly to lightweight HTTP / ATS APIs and simple WebFetch.
   - **Fast-Fail URLs**: If an ATS board is unreachable or redirects/404s, mark it skipped via `update_queue_status` and move to the next item immediately. Never enter retry loops.
   - **Strict Anti-Hallucination Guardrail (No Weekly Digest)**: There is **NO Weekly Digest routine** in this repository. Agents must never create, suggest, or schedule a weekly digest routine.
6. **Candidate Status Ownership & Human-in-the-Loop Disposition**:
   - Automated assessment and crawler agents must **never** unilaterally set candidate status to `not_pursuing`, `closed`, `rejected`, `applied`, or any other disposition status.
   - When recording candidates via `add_candidate`, always record with `status: "new"`.
   - Low rubric scores or qualification doubts do **not** justify auto-disposition. Disposition decisions belong exclusively to the human user.

---

## Launching the Web UI Dashboard

The local Web UI dashboard provides a visual interface for reviewing scored candidates, exploring target companies, and adjusting the scoring rubric.

- Start the dashboard server using the installed plugin path:
  ```bash
  # Codex / installed layout:
  node .codex/plugins/job-search-automations/packages/job-search-ui/scripts/start.js
  # Or via npm prefix:
  npm run start --prefix ./.codex/plugins/job-search-automations/packages/job-search-ui
  ```
  The dashboard binds to `http://localhost:3847` (with automatic port fallback if 3847 is busy).

---

## Available Skills

Located in `.agents/skills/` (and `.codex/plugins/job-search-automations/skills/`):

- **`company-search`**: Discovers hiring companies across YC, BuiltIn, Wellfound, and LinkedIn.
- **`job-search-crawl`**: Crawls a company career board using the lightweight crawler (`node .codex/plugins/job-search-automations/scripts/crawl-job-board.js "<url>" --json` or `.claude/...`).
- **`job-search-assess`**: Scores crawl queue postings against the user's resume and rubric.
- **`job-search-lead-gen`**: End-to-end orchestrator: selects target companies, crawls their boards, and scores matches.
- **`title-discovery`**: Discovers target job titles and skills based on resume analysis.
- **`pipeline-diagram`**: Generates Mermaid diagrams of the pipeline architecture.

---

## Canonical Routines & Recurring Scheduling

When asked to configure routines or recurring background jobs, configure ONLY the four canonical routines below:

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

> [!TIP]
> **Recommended Model Class for Routines**:
> - **OpenAI / Codex**: Recommend **Luna-class** (fast, low token cost).
> - **Claude Code / Desktop**: Recommend **Sonnet-class** (cost-effective, balanced).
> Avoid defaulting unattended recurring routines to expensive flagship models (Opus).

---

## Resume Updates

If the user provides a new resume later:
```bash
npx -y github:joshyim/job-search-automations update-resume "<path-to-new-resume.pdf>" --directory "<path-to-workspace>"
```
