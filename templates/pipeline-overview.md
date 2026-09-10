# Job Search Pipeline Overview

> The overview is split into progressive levels of detail. Start with the system at a glance, use the focused views to trace individual components and tools, and consult the full dependency map only when needed.

## 1. System at a glance

This view shows the primary conceptual groups and runtime interactions through the MCP data access layer.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    EXT["External job boards<br/>and web search"]
    MAINTENANCE["Scope maintenance<br/>skills (company & title)"]
    ACTIVE["Active search skills<br/>(lead-gen, crawl, assess)"]
    MCP["MCP Data Layer<br/>(job-search-db)"]
    STORAGE[("Storage Backend<br/>(Local SQLite or Neon DB)")]
    RESUME["Resume<br/>.job-search/resume.pdf"]

    EXT -->|market postings & careers| MAINTENANCE
    RESUME -->|candidate background| MAINTENANCE
    MAINTENANCE -->|add companies & title patterns| MCP

    MCP -->|least-recent batch, titles, rubric, queue| ACTIVE
    RESUME -->|evaluation benchmark| ACTIVE
    EXT -->|live job postings & details| ACTIVE
    ACTIVE -->|record queue, candidates, run logs| MCP

    MCP <-->|unified tool interface| STORAGE

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111,stroke-width:2px;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111,stroke-width:2px;
    classDef storage fill:#dae8fc,stroke:#6c8ebf,color:#111,stroke-width:2px;

    class EXT,RESUME external;
    class MAINTENANCE,ACTIVE skill;
    class MCP mcp;
    class STORAGE storage;
```

---

## 2. Scope maintenance view

These skills expand the target companies and title patterns via MCP tools before active search runs.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    EXT["Job boards &<br/>industry sources"]
    RESUME["Resume<br/>.job-search/resume.pdf"]
    TITLE_DISC["title-discovery"]
    COMP_SEARCH["company-search"]
    MCP["MCP Server<br/>(job-search-db)"]

    RESUME --> TITLE_DISC
    EXT --> TITLE_DISC
    MCP -->|list_title_patterns<br/>list_skills| TITLE_DISC
    TITLE_DISC -->|add_title_pattern| MCP

    RESUME --> COMP_SEARCH
    EXT --> COMP_SEARCH
    MCP -->|list_companies<br/>list_title_patterns| COMP_SEARCH
    COMP_SEARCH -->|add_company| MCP

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;

    class EXT,RESUME external;
    class TITLE_DISC,COMP_SEARCH skill;
    class MCP mcp;
```

---

## 3. Active search view

The orchestrator completes crawl and assessment sequentially per company, interacting strictly through MCP tools.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    RESUME["Resume<br/>.job-search/resume.pdf"]
    ORCHESTRATOR["job-search-lead-gen"]
    CRAWL["job-search-crawl"]
    ASSESS["job-search-assess"]
    MCP["MCP Server<br/>(job-search-db)"]

    MCP -->|get_batch| ORCHESTRATOR
    ORCHESTRATOR -->|Phase A: company & URL| CRAWL
    CRAWL -->|list_title_patterns<br/>check_url_exists<br/>add_to_queue| MCP
    ORCHESTRATOR -->|Phase B: assess company| ASSESS
    RESUME --> ASSESS
    MCP -->|get_scoring_rubric<br/>get_pending_queue<br/>list_skills| ASSESS
    ASSESS -->|add_candidate<br/>update_queue_status| MCP
    ORCHESTRATOR -->|log_run<br/>get_candidates| MCP

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;

    class RESUME external;
    class ORCHESTRATOR,CRAWL,ASSESS skill;
    class MCP mcp;
```

---

## 4. Crawl and assessment detail

### 4a. Crawl detail

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    EXT["Job board &<br/>web search"]
    CRAWLER["scripts/crawl-job-board.js"]
    CRAWL["job-search-crawl"]
    TMP["tmp/company-slug/<br/>Ephemeral crawl files"]
    MCP["MCP Server<br/>(job-search-db)"]

    EXT --> CRAWL
    CRAWLER --> CRAWL
    MCP -->|list_title_patterns| CRAWL
    MCP -->|check_url_exists| CRAWL
    CRAWL -->|intermediate JSON/extracts| TMP
    CRAWL -->|add_to_queue| MCP

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;
    classDef tmp fill:#fff2cc,stroke:#d6b656,color:#111;

    class EXT external;
    class CRAWLER,CRAWL skill;
    class TMP tmp;
    class MCP mcp;
```

### 4b. Assessment detail

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    EXT["Live posting &<br/>job description"]
    RESUME["Resume<br/>.job-search/resume.pdf"]
    ASSESS["job-search-assess"]
    MCP["MCP Server<br/>(job-search-db)"]

    MCP -->|get_pending_queue| ASSESS
    EXT --> ASSESS
    RESUME --> ASSESS
    MCP -->|get_scoring_rubric<br/>list_skills| ASSESS
    ASSESS -->|add_candidate| MCP
    ASSESS -->|update_queue_status| MCP

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;

    class EXT,RESUME external;
    class ASSESS skill;
    class MCP mcp;
```

---

## 5. State and checkpoint lifecycle

The MCP data access layer abstracts queue state, candidate records, and run checkpoints.

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    START["Trigger job-search-lead-gen"]
    BATCH["MCP: get_batch(limit: 3)"]
    CRAWL_RUN["Phase A: job-search-crawl"]
    QUEUE_ADD["MCP: add_to_queue(status: pending)"]
    ASSESS_RUN["Phase B: job-search-assess"]
    DECISION{"Validate & score"}
    CAND_ADD["MCP: add_candidate(status: new)"]
    Q_ASSESSED["MCP: update_queue_status(assessed)"]
    Q_SKIPPED["MCP: update_queue_status(skipped)"]
    LOG["MCP: log_run(checkpoint)"]
    SORT["MCP: get_candidates(final sort)"]

    START --> BATCH --> CRAWL_RUN --> QUEUE_ADD --> ASSESS_RUN --> DECISION
    DECISION -->|score >= threshold| CAND_ADD --> Q_ASSESSED
    DECISION -->|invalid / closed| Q_SKIPPED
    Q_ASSESSED --> LOG
    Q_SKIPPED --> LOG
    LOG --> SORT

    classDef action fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;
    classDef decision fill:#fff2cc,stroke:#d6b656,color:#111;

    class START,CRAWL_RUN,ASSESS_RUN action;
    class BATCH,QUEUE_ADD,CAND_ADD,Q_ASSESSED,Q_SKIPPED,LOG,SORT mcp;
    class DECISION decision;
```

---

## 6. Full dependency view

```mermaid
---
config:
  flowchart:
    wrappingWidth: 160
---
flowchart TB
    subgraph EXTERNAL["External Sources & Assets"]
        EXT["External job boards & web search"]
        RESUME["Resume<br/>.job-search/resume.pdf"]
    end

    subgraph SCOPE["Scope Maintenance Skills"]
        TITLE_DISC["title-discovery"]
        COMP_SEARCH["company-search"]
    end

    subgraph PIPELINE["Active Search Skills"]
        LEAD_GEN["job-search-lead-gen"]
        CRAWL["job-search-crawl"]
        ASSESS["job-search-assess"]
        CRAWLER["scripts/crawl-job-board.js"]
        TMP[".job-search/tmp/company-slug/<br/>Ephemeral crawl files"]
    end

    subgraph MCP_LAYER["MCP Data Access Layer (job-search-db)"]
        MCP["MCP Server Tools<br/>get_batch, list_companies, add_company,<br/>list_title_patterns, add_title_pattern, list_skills,<br/>get_scoring_rubric, check_url_exists, add_to_queue,<br/>get_pending_queue, update_queue_status,<br/>add_candidate, get_candidates, log_run"]
    end

    subgraph BACKEND["Storage Backend (Dual-Mode)"]
        STORAGE[("Local SQLite (.job-search/job-search.sqlite) OR Neon PostgreSQL")]
    end

    RESUME --> TITLE_DISC
    EXT --> TITLE_DISC
    MCP -->|list_title_patterns, list_skills| TITLE_DISC
    TITLE_DISC -->|add_title_pattern| MCP

    RESUME --> COMP_SEARCH
    EXT --> COMP_SEARCH
    MCP -->|list_companies, list_title_patterns| COMP_SEARCH
    COMP_SEARCH -->|add_company| MCP

    MCP -->|get_batch| LEAD_GEN
    LEAD_GEN -->|Phase A: crawl company| CRAWL
    CRAWLER --> CRAWL
    EXT --> CRAWL
    MCP -->|list_title_patterns, check_url_exists| CRAWL
    CRAWL -->|add_to_queue| MCP
    CRAWL -->|crawl output| TMP

    LEAD_GEN -->|Phase B: assess company| ASSESS
    RESUME --> ASSESS
    EXT --> ASSESS
    MCP -->|get_scoring_rubric, get_pending_queue, list_skills| ASSESS
    ASSESS -->|add_candidate, update_queue_status| MCP

    LEAD_GEN -->|log_run, get_candidates| MCP
    LEAD_GEN -->|clean temp dir| TMP

    MCP <--> STORAGE

    classDef external fill:#f2f2f2,stroke:#777,color:#111;
    classDef skill fill:#eee6ff,stroke:#7651a8,color:#111;
    classDef mcp fill:#d5e8d4,stroke:#82b366,color:#111;
    classDef storage fill:#dae8fc,stroke:#6c8ebf,color:#111;
    classDef tmp fill:#fff2cc,stroke:#d6b656,color:#111;

    class EXT,RESUME external;
    class TITLE_DISC,COMP_SEARCH,LEAD_GEN,CRAWL,ASSESS,CRAWLER skill;
    class MCP mcp;
    class STORAGE storage;
    class TMP tmp;
```
