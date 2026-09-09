---
name: company-search
description: Discover companies actively hiring for target roles and add qualified matches to the target companies list via MCP. Use to expand company coverage across YC, BuiltIn, Wellfound, and LinkedIn.
compatibility: Requires Node.js (v18+). Harness-agnostic.
---

# Company Search

Discover companies that are actively hiring for target roles and add qualified matches to the target companies list via MCP tools. This skill expands pipeline coverage beyond manually curated entries.

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

## Sources to Search

Search these platforms for companies hiring candidate target roles:

| Source | What to look for |
| --- | --- |
| Y Combinator (ycombinator.com/jobs, workatastartup.com) | YC-backed companies with open PM / target roles |
| BuiltIn (builtin.com) | Tech companies hiring target roles, filtered by location |
| Wellfound (wellfound.com) | Startup job listings matching target titles |
| LinkedIn Jobs | Companies with multiple open target roles (signals active hiring) |

## Steps

### 1. Load inputs via MCP

1. Fetch target title patterns via MCP:
   - Call `list_title_patterns({ type: "include" })`.
2. Fetch existing target and excluded companies via MCP:
   - Call `list_companies({ include_excluded: true })`.
   - Build a lookup set of existing company names and excluded company names/domains.
3. Read `<workflowDataPath>/resume.pdf` to understand candidate domain fit (e.g. AI/ML, developer tools, enterprise SaaS).

### 2. Search each source

For each source listed above:
1. Search for postings matching the target job titles and levels.
2. For each posting found, extract the company name and its careers page URL.
3. Deduplicate - if the same company appears across multiple sources, keep one entry.

### 3. Filter companies

For each discovered company, apply these checks in order. A company must pass all of them to proceed.

**3a. Exclusion check (first)**
Skip the company immediately if:
- Its name matches any entry where `is_excluded: true` in the company list (case-insensitive).
- Its careers page URL matches or is a subdomain/path of an excluded company's careers URL.
- It is a known subsidiary, brand, or division of an excluded company.

**3b. Qualification criteria**

| Criteria | Requirement |
| --- | --- |
| Active hiring | Has at least one open role matching a target title pattern |
| Location | Offers remote (US), San Francisco Bay Area, Seattle WA, or hybrid in those locations |
| Stage/size | Series A or later, or established company. Exclude pre-seed/seed unless founding role |
| Domain fit | Company product domain aligns with candidate experience from resume |

### 4. Find official careers URL

For each company that passes filtering, locate the official careers or jobs page URL. Prefer direct company careers pages (e.g., `https://company.com/careers` or direct ATS board) over third-party aggregator links.

### 5. Add company via MCP

Only add a company if:
1. It passed the exclusion check (step 3a).
2. It passed all qualification criteria (step 3b).
3. It is not already in the target companies list from `list_companies`.
4. A valid careers page URL was identified.

Call MCP tool `add_company`:
```json
{
  "name": "<company_name>",
  "careers_url": "<careers_url>",
  "notes": "Discovered via <source>; stage: <stage>; domain: <domain>"
}
```

### 6. Output summary

Output a clear summary:
- Total companies discovered across sources
- Excluded companies skipped
- Qualified companies passed
- New companies added to target list via MCP

## Rules

- Never add a company that is marked as excluded.
- Do not perform direct file I/O on markdown files. All company reads and writes MUST go through MCP tools (`list_companies`, `add_company`, `list_title_patterns`).
- If an external job source is unreachable or blocked, log a warning and continue to the next source. Do not halt the entire run.
- Do not apply to any roles or interact with forms. This skill discovers companies only.
