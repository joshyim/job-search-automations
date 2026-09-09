---
name: title-discovery
description: Discover job titles that match key skills but are not yet in the target titles list, adding validated include/exclude patterns via MCP. Use to expand title coverage.
compatibility: Requires Node.js (v18+). Harness-agnostic.
---

# Title Discovery

Discover job titles that match key candidate skills but are not yet covered by target title patterns, adding validated include/exclude patterns via MCP tools.

## Resume Resolution

Before beginning:
1. Determine `workflowDataPath`: Read `~/.config/job-search-automation/config.json` for `workflowDataPath` (default: `~/.local/share/job-search-automation`).
2. Verify `workflowDataPath/resume.pdf` exists.
3. If `workflowDataPath/resume.pdf` does not exist, halt immediately with the error:
   ```
   Error: Resume file not found at workflowDataPath/resume.pdf.
   Please place your resume at this location or run:
     ./setup.sh --update-resume /path/to/your/resume.pdf
   ```

## Steps

### 1. Load inputs via MCP

1. Fetch existing patterns via MCP:
   - Call `list_title_patterns()` to retrieve include and exclude patterns.
2. Fetch target candidate skills via MCP:
   - Call `list_skills()` to retrieve target skills, categories, and priority levels (P1/P2).
3. Read `<workflowDataPath>/resume.pdf` to understand candidate seniority, experience, and background.

### 2. Search for title variants

Search job boards (LinkedIn, Wellfound, BuiltIn, Greenhouse boards, Lever boards) and industry postings for roles whose descriptions match P1 and P2 key skills. Look for:
- **Alternate names for the same function**: e.g., "Technical Program Manager (AI)" vs "AI Product Manager".
- **Emerging titles**: Newer titles the market has adopted (e.g., "AI Enablement Lead", "ML Platform PM").
- **Company-specific titles**: e.g., "Product Lead", "Program Manager - AI Products".
- **Adjacent roles**: Roles where primary responsibilities overlap significantly with product management/strategy.

### 3. Check pattern coverage

For each discovered title, test whether it already matches an existing include pattern from `list_title_patterns`.
Focus strictly on titles that fall **outside** all existing patterns.

### 4. Validate uncovered titles

Confirm:
- **Skill overlap**: Role's typical responsibilities match at least 2 P1 key skills or 1 P1 + 2 P2 skills.
- **Function fit**: Role is primarily product management, product strategy, or a closely adjacent function (not purely engineering, design, marketing, sales).
- **Seniority fit**: Seniority range aligns with candidate background (Senior through Principal / Director).

### 5. Add patterns via MCP

For validated titles not covered by existing patterns, decide the right pattern action:
- **New include pattern**: If the title represents a class of roles (e.g. `*Program Manager, AI*`), add an include pattern.
- **New exclude pattern**: If existing include patterns catch irrelevant roles (e.g. `*Product Ops*`), add an exclude pattern.

Call MCP tool `add_title_pattern`:
```json
{
  "pattern": "<pattern>",
  "type": "include", // or "exclude"
  "level": "<level>", // e.g. "Senior+", "Principal", "Lead"
  "notes": "Matched skills: <skills>; Example companies: <companies>"
}
```

### 6. Output summary

Output:
- New patterns added via MCP (pattern, type, level, example titles, targeted skills).
- Titles considered but already covered.
- Titles evaluated but not added (with reasons).

## Rules

- Do not perform direct file I/O on markdown files. All title pattern and skill reads and writes MUST go through MCP tools (`list_title_patterns`, `add_title_pattern`, `list_skills`).
- Only add patterns where the primary function is product management or product strategy.
- Prefer broad patterns (with wildcards `*`) over exact titles to minimize maintenance.
- Do not apply to any roles.
