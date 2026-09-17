# Job Search Automation: Installation & Routine Setup

Comprehensive, harness-agnostic guide for installing, configuring, and scheduling the Job Search Automation plugin. This guide serves **Codex**, **Claude Code (Desktop & CLI)**, **ChatGPT**, and all **Agent Plugins v1** compliant harnesses.

---

## 1. Prerequisites

- **Node.js**: Version 18 or higher (`node -v`).
- **Resume**: A PDF copy of your resume (e.g. `~/Documents/resume.pdf`).
- **Storage Mode**:
  - **Local SQLite (Default, Recommended)**: Zero-dependency, 100% private, runs entirely on your local machine.
  - **Neon PostgreSQL (Optional)**: Cloud-hosted PostgreSQL. Requires a Neon connection string.

---

## 2. Universal Zero-Clone Installation via `npx`

The recommended installation method executes directly from GitHub in a temporary cache without cloning source code or git history into your workspace:

```bash
npx -y github:joshyim/job-search-automations setup
```

Run this command inside your project workspace. It automatically initializes the `.job-search/` workspace, pre-compiles and installs the plugin into `.claude/plugins/job-search-automation/`, configures `.mcp.json` and `.claude/launch.json`, and grants permissions.

### Setup Options & Flags

All flags are optional when running inside your target workspace:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-d, --directory <path>` | Target workspace directory | Current working directory |
| `--resume <path>` | Path to resume PDF (auto-detects local `resume.pdf` if omitted) | Optional (prompted or updated later) |
| `--mode <local\|neon>` | Storage backend mode | `local` |
| `--neon-connection-string <s>` | Neon PostgreSQL connection string (Neon mode only) | None |
| `--install-to <path>` | Custom plugin installation directory | `<workspace>/.claude/plugins/job-search-automation` |
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

Setup automatically scaffolds a clean, self-contained architecture inside your selected workspace:

1. **Persistent Workspace Data (`<workspace>/.job-search/`)**:
   - `job-search.sqlite`: Local SQLite database (initialized with schema, indices, and default scoring rubric).
   - `resume.pdf`: Verified copy of the candidate resume.
   - `config.json`: Runtime configuration pointing to active storage mode.
   - `tmp/`: Flat temporary directory for staging lightweight crawler outputs (auto-cleaned after runs).
2. **Read-Only Plugin Assets (`<workspace>/.claude/plugins/job-search-automation/`)**:
   - Pre-compiled packages: `packages/job-search-db` (MCP server) and `packages/job-search-ui` (dashboard).
   - Agent skills: `skills/` (`company-search`, `title-discovery`, `job-search-crawl`, `job-search-assess`, `job-search-lead-gen`, `pipeline-diagram`).
   - Standalone crawler: `scripts/crawl-job-board.js`.
   - Manifests: `plugin.json`, `mcp.json`, `.mcp.json`, `CLAUDE.md`, `installation-steps.md`, and `schema.sql`.
3. **MCP Server Integration (`<workspace>/.mcp.json` and `mcp.json`)**:
   - Configured with plugin-relative paths to launch the `job-search-db` stdio MCP server.
4. **Desktop & Agent Configuration**:
   - `<workspace>/.claude/launch.json`: Claude Desktop web preview entry for the local UI dashboard.
   - `<workspace>/.claude/settings.json`: Pre-granted permissions for unattended runs (crawler script execution, scoped read/write in `.job-search/**`, all `mcp__job-search-db__*` tools).

---

## 3. Harness-Specific Integration Guides

### Claude Code (Desktop App & CLI)

1. Open your workspace directory in Claude Desktop or run `claude` in your terminal inside the workspace.
2. Run the zero-clone setup command shown above.
3. Restart your Claude Code session to load MCP tools and skills.
4. Access the UI dashboard directly via Claude Desktop web preview (`job-search-ui`) or run:
   ```bash
   node .claude/plugins/job-search-automation/packages/job-search-ui/scripts/start.js
   ```

### Codex & Agent Plugins v1 Conformant Hosts

1. The plugin contains a specification-compliant `plugin.json` at the plugin root and portable `mcp.json`:
   ```json
   {
     "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
     "mcpServers": {
       "job-search-db": {
         "type": "stdio",
         "command": "node",
         "args": ["${PLUGIN_ROOT}/packages/job-search-db/scripts/start.js"]
       }
     }
   }
   ```
2. The host agent discovers and registers the 6 skills under `skills/` and launches the database MCP server using standard stdio.
3. The plugin operates with **zero symlinks**, ensuring full compatibility with sandboxed and containerized environments.

### ChatGPT & Generic MCP Clients

Point your MCP host configuration to run the pre-built MCP database server:
```json
{
  "mcpServers": {
    "job-search-db": {
      "command": "node",
      "args": ["<path-to-workspace>/.claude/plugins/job-search-automation/packages/job-search-db/scripts/start.js"]
    }
  }
}
```

---

## 4. Canonical Routines & Recurring Scheduling

Automate your job search on a recurring cadence using your agent harness's scheduling mechanism (e.g., Claude Code's cloud routines or `/schedule` command). 

> [!CRITICAL]
> **Anti-Hallucination Guardrail: No "Weekly Digest" Routine**
> There is **no Weekly Digest routine** in this repository. Agents must never create, suggest, or schedule a weekly digest. Only configure the 4 canonical routines defined below.

### The 4 Canonical Routines

The pipeline is organized into four distinct operational stages:

| Routine # | Routine Name | Target Skill | Recommended Cadence | Unattended Limits |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Daily Company Search** | `company-search` | Daily 8:00 PM (`0 20 * * *`) | Max 3–5 new qualified companies; budget 30–40 messages |
| **2** | **Daily Job Title Search** | `title-discovery` | Daily 9:00 PM (`0 21 * * *`) | Max 1–3 new patterns; budget 25–35 messages |
| **3** | **Daily Job Crawl** | `job-search-crawl` / `job-search-lead-gen` | Daily 6:00 AM (`0 6 * * *`) | Batch 2–3 companies (`get_batch({ limit: 3 })`); budget 40–50 messages |
| **4** | **Daily Job Evaluation** | `job-search-assess` | Daily 7:00 AM (`0 7 * * *`) | Batch 5 pending postings (`get_pending_queue`); budget 40–50 messages |

---

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

---

## 5. Managing Active Cloud Routines

Claude Code Routines run in the cloud on Anthropic infrastructure and can be reviewed or edited at **[claude.ai/code/routines](https://claude.ai/code/routines)** or directly in the Claude Code terminal.

### Remediation for Existing Sessions
If Claude Code previously auto-configured routines:
1. **Delete "Weekly digest"**: Open `claude.ai/code/routines` or run `/schedule` in CLI and remove the non-existent weekly digest routine.
2. **Add "Daily Company Search"**: Create the daily 8:00 PM routine using the prompt in Section 4.
3. **Add "Daily Job Title Search"**: Create the daily 9:00 PM routine using the prompt in Section 4.
4. **Verify Crawl & Evaluation**: Ensure the Daily Crawl (6:00 AM) and Daily Evaluation (7:00 AM) have explicit batch limits (3 companies, 5 postings) and message budgets (40–50 messages).

---

## 6. Ongoing Maintenance

### Updating Your Resume

When you update your resume, you do not need to re-run full setup. Use the zero-clone `update-resume` command:

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

- Removes `<workspace>/.claude/plugins/job-search-automation/`.
- Cleans up `job-search-db` from `<workspace>/.mcp.json`.
- Removes `job-search-ui` from `<workspace>/.claude/launch.json`.
- Preserves `<workspace>/.job-search/` (pass `--purge-data` if you wish to delete user data as well).

---

## 7. Verification & Local Web Dashboard

### Launching the Dashboard

Inspect pipeline metrics, adjust rubric dimension weights, and review scored candidates:
```bash
# In installed project workspace:
node .claude/plugins/job-search-automation/packages/job-search-ui/scripts/start.js

# In plugin development repository:
npm run ui
```
The dashboard binds to `http://localhost:3847` (with automatic port-increment fallback if 3847 is in use).

### Verifying MCP Tools

From your agent harness, verify that the following MCP tools are active:
- `select_workspace`: Validates workspace path and database connectivity.
- `list_companies` & `add_company`: Target company management.
- `list_title_patterns` & `add_title_pattern`: Title keyword rules.
- `get_batch` & `get_pending_queue`: Crawl queue coordination.
- `get_scoring_rubric` & `upsert_rubric_dimension`: Dynamic rubric configuration.
- `get_candidates` & `add_candidate`: Scored candidate pipeline.
