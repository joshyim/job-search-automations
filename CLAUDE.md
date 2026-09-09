# Claude Cowork & Claude Code Agent Guidelines: Job Search Automation

This repository provides an automated, skill-based job search pipeline with dual-mode data access (Local Markdown and Neon Cloud PostgreSQL) and an MCP server.

## Installation & First-Time Setup (Claude Cowork / Desktop App)

When a user in Claude Desktop (Cowork mode) or Claude Code asks to install, set up, or get started with Job Search Automation:

1. **Keep it simple and frictionless**:
   - Do **NOT** debate marketplace mechanisms vs. local scripts.
   - Do **NOT** warn about ephemeral cloud sandboxes. Cowork connects directly to the user's workspace, and data persists permanently in `~/.local/share/job-search-automation/`.
   - Do **NOT** ask about Neon database strings or storage modes unless the user explicitly requests Neon cloud mode. Local Markdown mode is the default zero-dependency mode.
   - Do **NOT** attempt to install Playwright or Chromium. The crawler runs zero-browser lightweight fetch with ATS APIs.

2. **Resume Path Collection**:
   - If the user hasn't provided a resume path, ask:
     > *"To set up your job search pipeline, please provide the path to your resume PDF (for example: `~/Documents/resume.pdf` or drag-and-drop it here)."*

3. **Execute Setup**:
   - Run the automated setup non-interactively:
     ```bash
     ./setup.sh --mode local --resume "<path-to-resume.pdf>" -y
     ```
   - Setup will automatically compile the local database MCP server (`packages/job-search-db`) and scaffold the Markdown storage tables.

4. **Conversational Next Step**:
   - Once setup reports completion, ask the user:
     > *"Your job search pipeline is ready! What job titles, locations, or target companies would you like to start with?"*
   - Save their preferences and offer to run their first search using `company-search` or `job-search-lead-gen`.

## Available Skills

- **`company-search`**: Discovers hiring companies across YC, BuiltIn, Wellfound, and LinkedIn.
- **`job-search-crawl`**: Crawls a company career board using the lightweight crawler (`node scripts/crawl-job-board.js "<url>" --json`). Falls back to WebSearch / WebFetch if needed.
- **`job-search-assess`**: Scores crawl queue postings against the user's resume and rubric.
- **`job-search-lead-gen`**: End-to-end orchestrator: selects target companies, crawls their boards, and scores matches.
- **`title-discovery`**: Discovers target job titles and skills based on resume analysis.
- **`pipeline-diagram`**: Generates Mermaid diagrams of the pipeline state.

## Resume Updates

If the user provides a new resume later:
```bash
./setup.sh --update-resume "<path-to-new-resume.pdf>"
```
