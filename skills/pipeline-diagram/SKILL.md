---
name: pipeline-diagram
description: Introspect current skill definitions, MCP tool surface, and data flow paths, then regenerate pipeline overview Mermaid diagrams. Use after modifying skills, MCP tools, or pipeline flows.
compatibility: Requires Node.js and Playwright (npx playwright install chromium).
---

# Pipeline Diagram Generator

Introspect the active skill definitions, MCP tools, and data flows, then regenerate the pipeline overview Mermaid diagrams across all five levels of detail.

## Goal

Ensure documentation and visual architecture maps stay synchronized with code changes, tool additions, and orchestration updates.

## Source of Truth

- **Diagram Templates**: `templates/pipeline-overview.md`
- **Skill Definitions**: `skills/*/SKILL.md`
- **MCP Server Surface**: `packages/job-search-db/src/tools/*.ts` and `mcp.json`
- **Crawler Scripts**: `scripts/crawl-job-board.js`

## Steps

### 1. Introspect Skill Definitions

1. List and inspect all skills under `skills/`:
   - `job-search-lead-gen`: Orchestrator, batch selection, sequential dispatch, run logging.
   - `job-search-crawl`: Single-company board crawl, pattern matching, queue deduplication.
   - `job-search-assess`: Validation, dynamic scoring rubric, skills matching, candidate pipeline recording.
   - `company-search`: Discovery across platforms, qualification, target list expansion.
   - `title-discovery`: Job title discovery, P1/P2 skill matching, pattern expansion.
2. Read the YAML frontmatter and `## Steps` of each skill to identify:
   - External inputs (job boards, resume)
   - Skills invoked or orchestrated
   - MCP tools called

### 2. Introspect MCP Tool Surface

Inspect registered MCP tools in `packages/job-search-db/src/tools/`:
- **Companies**: `list_companies`, `add_company`, `exclude_company`, `get_batch`
- **Titles**: `list_title_patterns`, `add_title_pattern`, `remove_title_pattern`
- **Skills**: `list_skills`
- **Rubric**: `get_scoring_rubric`, `update_rubric_dimension`, `add_rubric_dimension`, `remove_rubric_dimension`
- **Queue**: `check_url_exists`, `add_to_queue`, `get_pending_queue`, `update_queue_status`
- **Candidates**: `add_candidate`, `update_candidate_status`, `get_candidates`
- **Logs**: `log_run`, `get_recent_runs`

### 3. Read & Update Templates

1. Read `templates/pipeline-overview.md`.
2. Verify and regenerate each Mermaid diagram view:
   - **View 1: System at a Glance** - High-level conceptual overview showing external sources, maintenance skills, active search skills, MCP server layer, and dual-mode storage.
   - **View 2: Scope Maintenance View** - Data flows for `company-search` and `title-discovery` through MCP tools.
   - **View 3: Active Search View** - Orchestrator loop connecting `lead-gen`, `crawl`, and `assess` via MCP tools.
   - **View 4a & 4b: Crawl & Assessment Detail** - Ephemeral crawl temp storage, script invocation, dynamic rubric injection, and candidate writes.
   - **View 5: State & Checkpoint Lifecycle** - Queue status transitions (`pending` -> `assessed` / `skipped`), candidate creation, and run logging.
   - **View 6: Full Dependency View** - Unified complete graph tracing all skills, external sources, MCP tools, and storage backends.

### 4. Output & Validation

1. Write the updated diagrams to `templates/pipeline-overview.md` (and any targeted destination such as Obsidian documentation or `docs/pipeline-overview.md`).
2. Validate Mermaid syntax:
   - Confirm all node labels with special characters or parentheses are quoted.
   - Verify node connections and directional flow.
   - Ensure color classes render cleanly in both dark and light modes.

## Rules

- Preserve the progressive disclosure structure (Levels 1 to 6).
- Never reintroduce direct file dependencies for pipeline state; all state access must point through the MCP server layer.
- Keep diagrams compliant with Obsidian and standard Mermaid parsers.
