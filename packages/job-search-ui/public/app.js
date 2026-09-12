/**
 * Job Search Automation — Web UI Single-Page Application
 * Communicates exclusively with job-search-db via MCP JSON-RPC
 */

(function () {
  'use strict';

  // State
  const state = {
    activeView: 'dashboard',
    companies: [],
    titlePatterns: [],
    skills: [],
    rubric: [],
    queue: [],
    candidates: [],
    history: [],
    selectedSkillCategory: 'all',
    selectedQueueStatus: 'all',
    selectedCandidateStatus: 'all',
    candidateSort: 'score_desc',
  };

  // Helper: Call MCP Tool via local HTTP bridge
  async function callMcp(name, args = {}) {
    try {
      const response = await fetch('/api/mcp/call-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      return json.data;
    } catch (err) {
      showToast(`MCP Tool Error (${name}): ${err.message}`, 'error');
      throw err;
    }
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // Modal Dialog System
  const modal = {
    backdrop: document.getElementById('modal-backdrop'),
    title: document.getElementById('modal-title'),
    body: document.getElementById('modal-body'),
    closeBtn: document.getElementById('modal-close-btn'),

    open(titleText, htmlContent) {
      this.title.textContent = titleText;
      this.body.innerHTML = htmlContent;
      this.backdrop.classList.remove('hidden');
    },

    close() {
      this.backdrop.classList.add('hidden');
      this.body.innerHTML = '';
    },
  };

  if (modal.closeBtn) {
    modal.closeBtn.addEventListener('click', () => modal.close());
  }
  if (modal.backdrop) {
    modal.backdrop.addEventListener('click', (e) => {
      if (e.target === modal.backdrop) modal.close();
    });
  }

  // View Navigation / Router
  function navigateTo(viewId) {
    if (viewId === 'candidates') {
      viewId = 'matched-jobs';
    }
    state.activeView = viewId;
    window.location.hash = viewId;

    // Update nav active classes
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
    const activeNav = document.getElementById(`nav-${viewId}`) || document.getElementById(`nav-${viewId === 'matched-jobs' ? 'candidates' : ''}`);
    if (activeNav) activeNav.classList.add('active');

    // Update view panels
    document.querySelectorAll('.view-panel').forEach((el) => el.classList.remove('active'));
    const targetPanel = document.getElementById(`view-${viewId}`) || document.getElementById(`view-${viewId === 'matched-jobs' ? 'candidates' : ''}`);
    if (targetPanel) targetPanel.classList.add('active');

    // Toggle full window layout class for visualization
    document.body.classList.toggle('view-is-visualization', viewId === 'visualization');

    // Update header titles
    const titles = {
      dashboard: ['Dashboard', ''],
      companies: ['Target Companies', 'Manage target list, update careers job boards, and toggle exclusions.'],
      titles: ['Job Title Patterns', 'Configure include & exclude match patterns for crawler filtering.'],
      skills: ['Target Skills', 'Manage required and preferred skills with priority designations.'],
      rubric: ['Scoring Rubric', 'Customize dimension weights and tier descriptors. Total weight must sum to 100%.'],
      visualization: ['Workflow Visualization', 'Interactive conceptual system architecture and sub-process loops.'],
      queue: ['Crawl Queue', 'Inspect queued URLs, status transitions (pending, assessed, skipped).'],
      'matched-jobs': ['Matched Jobs', 'Review scored job opportunities, assess rubric fit, and update application status.'],
      candidates: ['Matched Jobs', 'Review scored job opportunities, assess rubric fit, and update application status.'],
      history: ['Run History', 'Timeline of past automated search executions and audit logs.'],
    };

    const info = titles[viewId] || ['Dashboard', ''];
    document.getElementById('page-title').textContent = info[0];
    document.getElementById('page-subtitle').textContent = info[1];

    // Load data for the active view
    loadViewData(viewId);
  }

  // Check Health & Connection
  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      const pill = document.getElementById('mcp-status-pill');
      if (pill) {
        if (data.mcpConnected) {
          pill.innerHTML = `<span class="status-dot status-dot-success"></span><span class="status-label">MCP: Connected</span>`;
        } else {
          pill.innerHTML = `<span class="status-dot status-dot-danger"></span><span class="status-label">MCP: Disconnected</span>`;
        }
      }
    } catch {
      const pill = document.getElementById('mcp-status-pill');
      if (pill) {
        pill.innerHTML = `<span class="status-dot status-dot-danger"></span><span class="status-label">Server: Offline</span>`;
      }
    }
  }

  // Data Loading Dispatcher
  async function loadViewData(viewId) {
    try {
      switch (viewId) {
        case 'dashboard':
          await loadDashboard();
          break;
        case 'companies':
          await loadCompanies();
          break;
        case 'titles':
          await loadTitlePatterns();
          break;
        case 'skills':
          await loadSkills();
          break;
        case 'rubric':
          await loadRubric();
          break;
        case 'visualization':
          await loadVisualization();
          break;
        case 'queue':
          await loadQueue();
          break;
        case 'matched-jobs':
        case 'candidates':
          await loadCandidates();
          break;
        case 'history':
          await loadHistory();
          break;
      }
    } catch (err) {
      console.error(`Error loading view ${viewId}:`, err);
    }
  }

  // ==========================================
  // VIEW 1: DASHBOARD
  // ==========================================
  async function loadDashboard() {
    // 1. Companies
    try {
      const companies = await callMcp('list_companies', { include_excluded: true });
      state.companies = Array.isArray(companies) ? companies : [];
      const total = state.companies.length;
      const active = state.companies.filter((c) => !c.is_excluded).length;
      document.getElementById('stat-companies').textContent = total;
      document.getElementById('stat-companies-desc').textContent = `${active} active target companies`;
    } catch (e) {
      document.getElementById('stat-companies').textContent = '-';
    }

    // 2. Queue Pending
    try {
      const pendingQueue = await callMcp('list_queue', { status: 'pending' });
      const count = Array.isArray(pendingQueue) ? pendingQueue.length : 0;
      document.getElementById('stat-queue').textContent = count;
    } catch (e) {
      document.getElementById('stat-queue').textContent = '-';
    }

    // 3. New Candidates
    try {
      const candidates = await callMcp('get_candidates', { status: 'new' });
      const count = Array.isArray(candidates) ? candidates.length : 0;
      document.getElementById('stat-candidates').textContent = count;
    } catch (e) {
      document.getElementById('stat-candidates').textContent = '-';
    }

    // 4. Last Run
    try {
      const runs = await callMcp('get_recent_runs', { limit: 1 });
      if (Array.isArray(runs) && runs.length > 0 && runs[0].timestamp) {
        const d = new Date(runs[0].timestamp);
        document.getElementById('stat-last-run').textContent = d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        document.getElementById('stat-last-run-desc').textContent = `Mode: ${runs[0].mode || 'pipeline'} (${runs[0].companies_processed?.length || 0} companies)`;
      } else {
        document.getElementById('stat-last-run').textContent = 'None';
        document.getElementById('stat-last-run-desc').textContent = 'No runs logged yet';
      }
    } catch (e) {
      document.getElementById('stat-last-run').textContent = '-';
    }

    // Load top matched jobs on dashboard
    await loadDashboardMatchedJobs();
  }

  async function loadDashboardMatchedJobs() {
    const tbody = document.getElementById('dashboard-matched-jobs-tbody');
    if (!tbody) return;

    try {
      const data = await callMcp('get_candidates', { sort_by: 'score', sort_order: 'desc' });
      const candidates = Array.isArray(data) ? data : [];

      if (candidates.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-10 text-muted">
              No matched jobs discovered yet. Run the active search workflow to crawl job boards and score postings.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = candidates.slice(0, 10).map((c) => {
        const score = c.score !== null && c.score !== undefined ? parseFloat(c.score).toFixed(1) : '-';
        const scoreNum = parseFloat(c.score) || 0;
        const scoreClass = scoreNum >= 8.5 ? 'score-high' : scoreNum >= 7.0 ? 'score-mid' : 'score-low';
        const discovered = c.discovered_at ? new Date(c.discovered_at).toLocaleDateString() : '-';

        return `
          <tr>
            <td>
              <div class="font-semibold text-primary">${escapeHtml(c.job_title)}</div>
              ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-accent" style="text-decoration: underline;">View Posting ↗</a>` : ''}
            </td>
            <td>
              <span class="company-badge">${escapeHtml(c.company_name)}</span>
            </td>
            <td>${escapeHtml(c.location || 'Remote')}</td>
            <td>
              <span class="score-badge ${scoreClass}">${score}</span>
            </td>
            <td>
              <select class="form-select form-select-sm dashboard-status-select" data-url="${escapeHtml(c.url)}" style="width: 125px; font-size: 12px; font-weight: 500;">
                <option value="new" ${c.status === 'new' ? 'selected' : ''}>New</option>
                <option value="applied" ${c.status === 'applied' ? 'selected' : ''}>Applied</option>
                <option value="in_progress" ${c.status === 'in_progress' || c.status === 'interviewing' ? 'selected' : ''}>In Progress</option>
                <option value="not_pursuing" ${c.status === 'not_pursuing' || c.status === 'closed' || c.status === 'rejected' || c.status === 'offer' ? 'selected' : ''}>Not Pursuing</option>
              </select>
            </td>
            <td>${discovered}</td>
            <td class="text-right">
              <button class="btn btn-secondary btn-sm dashboard-goto-candidate-btn">
                Review Fit
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Wire status dropdowns
      tbody.querySelectorAll('.dashboard-status-select').forEach((sel) => {
        sel.addEventListener('change', async (e) => {
          const url = sel.dataset.url;
          const newStatus = e.target.value;
          try {
            await callMcp('update_candidate_status', { url, status: newStatus });
            showToast(`Updated status to "${newStatus}"`, 'success');
            // Refresh stats
            const newCand = await callMcp('get_candidates', { status: 'new' });
            document.getElementById('stat-candidates').textContent = Array.isArray(newCand) ? newCand.length : 0;
          } catch (err) {
            showToast(`Failed to update status: ${err.message || err}`, 'danger');
          }
        });
      });

      // Wire review fit buttons to navigate to Matched Jobs view
      tbody.querySelectorAll('.dashboard-goto-candidate-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          navigateTo('matched-jobs');
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-danger">Failed to load matched jobs: ${escapeHtml(err?.message || err)}</td></tr>`;
    }
  }

  // ==========================================
  // VIEW: WORKFLOW VISUALIZATION
  // ==========================================
  async function loadVisualization() {
    renderMermaid();
  }

  let diagramZoom = 1.0;
  let activeWorkflowLoop = 'overview';

  const WORKFLOW_LOOPS = {
    overview: {
      title: 'Workflow Visualization — Vertical System Architecture',
      subtitle: 'System architecture structured vertically into sub-process phases. Click any box or use the tabs to drill down.',
      diagram: `flowchart TB
    EXT["External job boards and web search"]

    subgraph BOX_FOUNDATION["1. CANDIDATE CRITERIA & SEARCH SCOPE"]
        direction TB
        RESUME["Candidate Resume<br/>.job-search/resume.pdf"]
        TITLES["title_patterns & skills tables<br/>Include/exclude patterns, P1 & P2 skills"]
        COMPANIES["companies table<br/>Target companies & careers URLs"]
    end

    subgraph BOX_MAINTENANCE["2 & 3. SCOPE MAINTENANCE SUB-PROCESS"]
        direction TB
        TITLE_DISCOVERY["title-discovery<br/>Discover & add validated title variants"]
        COMPANY_SEARCH["company-search<br/>Discover & qualify target companies"]
    end

    subgraph BOX_ACTIVE["4. ACTIVE SEARCH SUB-PROCESS"]
        direction TB
        ORCHESTRATOR["job-search-lead-gen<br/>Select batch & coordinate pipeline execution"]
        CRAWL["job-search-crawl<br/>Collect, match & deduplicate job postings"]
        CRAWLER["scripts/crawl-job-board.js<br/>Lightweight ATS / HTTP crawler"]
        ASSESS["job-search-assess<br/>Validate posting & score against rubric"]
        RUBRIC["scoring_rubric table<br/>Weighted evaluation dimensions via MCP"]
        ORCHESTRATOR -->|Phase A: crawl| CRAWL
        CRAWL --> CRAWLER
        ORCHESTRATOR -->|Phase B: assess| ASSESS
        RUBRIC --> ASSESS
    end

    subgraph BOX_STATE["7. PIPELINE STATE & RELATIONAL TABLES"]
        direction TB
        MCP["MCP Server: job-search-db<br/>Unified data access layer"]
        STORAGE[("Storage Backend<br/>Local SQLite (.job-search/job-search.sqlite)<br/>or Neon PostgreSQL")]
        QUEUE["crawl_queue table<br/>pending &rarr; assessed / skipped"]
        CANDIDATES["candidates table<br/>Scored roles & application status"]
        LOGS["run_logs table<br/>Run checkpoints & batch logs"]
        MCP <-->|unified interface| STORAGE
        MCP --> QUEUE
        MCP --> CANDIDATES
        MCP --> LOGS
    end

    EXT -->|market postings & domain research| BOX_MAINTENANCE
    BOX_MAINTENANCE -->|expand companies & titles| BOX_FOUNDATION
    BOX_FOUNDATION -->|search scope & candidate criteria| BOX_ACTIVE
    EXT -->|live job boards & career pages| BOX_ACTIVE
    BOX_ACTIVE -->|persist queue, candidates & checkpoints| BOX_STATE
    BOX_STATE -->|history, dedup & pending work| BOX_ACTIVE

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef foundation fill:#f0f9ff,stroke:#0284c7,color:#0369a1,stroke-width:1.5px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef orchestrator fill:#0a0a0a,stroke:#0a0a0a,color:#ffffff,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;
    classDef storage fill:#eff6ff,stroke:#2563eb,color:#1e40af,stroke-width:2px;
    classDef state fill:#f8fafc,stroke:#475569,color:#0f0f0f,stroke-width:1.5px;

    class EXT external;
    class RESUME,TITLES,COMPANIES foundation;
    class TITLE_DISCOVERY,COMPANY_SEARCH,CRAWL,CRAWLER,ASSESS,RUBRIC skill;
    class ORCHESTRATOR orchestrator;
    class MCP mcp;
    class STORAGE storage;
    class QUEUE,CANDIDATES,LOGS state;`
    },
    'company-search': {
      title: 'Workflow Visualization — Company Discovery Loop',
      subtitle: 'Company search loop: Discovers companies from job boards & web search, checks targets via MCP, and persists new target additions or exclusions.',
      diagram: `flowchart TB
    EXT["Job boards &<br/>industry sources"]
    RESUME["Resume<br/>.job-search/resume.pdf"]
    COMP_SEARCH["company-search<br/>(Discovery Skill)"]
    MCP["MCP Server<br/>(job-search-db)"]

    RESUME -->|candidate background & domains| COMP_SEARCH
    EXT -->|market postings & tech companies| COMP_SEARCH
    MCP -->|list_companies: check existing targets| COMP_SEARCH
    MCP -->|list_title_patterns: target roles| COMP_SEARCH
    COMP_SEARCH -->|add_company: persist new target| MCP
    COMP_SEARCH -->|exclude_company: mark unaligned| MCP

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;

    class EXT,RESUME external;
    class COMP_SEARCH skill;
    class MCP mcp;`
    },
    'title-search': {
      title: 'Workflow Visualization — Title Discovery Loop',
      subtitle: 'Title search loop: Discovers title variations, extracts target levels, and adds include/exclude match patterns via MCP.',
      diagram: `flowchart TB
    EXT["Job boards &<br/>industry sources"]
    RESUME["Resume<br/>.job-search/resume.pdf"]
    TITLE_DISC["title-discovery<br/>(Title Discovery Skill)"]
    MCP["MCP Server<br/>(job-search-db)"]

    RESUME -->|skills & seniority benchmark| TITLE_DISC
    EXT -->|live title keywords| TITLE_DISC
    MCP -->|list_title_patterns: check patterns| TITLE_DISC
    MCP -->|list_skills: target competencies| TITLE_DISC
    TITLE_DISC -->|add_title_pattern: include target roles| MCP
    TITLE_DISC -->|add_title_pattern: exclude junior or unwanted| MCP

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;

    class EXT,RESUME external;
    class TITLE_DISC skill;
    class MCP mcp;`
    },
    'active-search': {
      title: 'Workflow Visualization — Active Search Orchestrator Loop',
      subtitle: 'Actual job search loop: Orchestrator fetches least-recently-searched batch, dispatches crawl and assess per company sequentially, and logs metrics.',
      diagram: `flowchart TB
    ORCH["job-search-lead-gen<br/>(Master Orchestrator)"]
    CRAWL["Phase A:<br/>job-search-crawl"]
    ASSESS["Phase B:<br/>job-search-assess"]
    MCP["MCP Server<br/>(job-search-db)"]
    RESUME["Candidate Resume<br/>.job-search/resume.pdf"]

    MCP -->|get_batch: limit 3 least-recent| ORCH
    ORCH -->|1. Dispatch crawl per company| CRAWL
    CRAWL -->|list_title_patterns, check_url, add_to_queue| MCP
    ORCH -->|2. Dispatch assess per company| ASSESS
    RESUME --> ASSESS
    MCP -->|get_rubric, get_pending_queue, list_skills| ASSESS
    ASSESS -->|add_candidate: scored, update queue status| MCP
    ORCH -->|3. log_run & get_candidates| MCP

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef orchestrator fill:#0a0a0a,stroke:#0a0a0a,color:#ffffff,stroke-width:2px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;

    class RESUME external;
    class ORCH orchestrator;
    class CRAWL,ASSESS skill;
    class MCP mcp;`
    },
    'crawl-detail': {
      title: 'Workflow Visualization — Crawl Execution Loop',
      subtitle: 'Lightweight ATS/HTTP crawl script dumps raw postings to ephemeral storage; crawl skill filters by title patterns and deduplicates via MCP.',
      diagram: `flowchart TB
    EXT["Job board &<br/>web search"]
    SCRIPT["scripts/crawl-job-board.js<br/>(Lightweight crawler)"]
    CRAWL["job-search-crawl<br/>(Per-company crawler)"]
    TMP["Ephemeral Storage<br/>.job-search/tmp/*.json"]
    MCP["MCP Server<br/>(job-search-db)"]

    CRAWL -->|executes crawl script| SCRIPT
    EXT -->|page HTML & job cards| SCRIPT
    SCRIPT -->|dump raw postings JSON| TMP
    TMP -->|parse & normalize| CRAWL
    MCP -->|list_title_patterns| CRAWL
    CRAWL -->|pattern filter & wildcard match| CRAWL
    MCP -->|check_url_exists| CRAWL
    CRAWL -->|add_to_queue: pending status| MCP

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;
    classDef tmp fill:#fffbeb,stroke:#d97706,color:#92400e,stroke-width:2px;

    class EXT external;
    class SCRIPT,CRAWL skill;
    class TMP tmp;
    class MCP mcp;`
    },
    'assess-detail': {
      title: 'Workflow Visualization — Assessment & Scoring Loop',
      subtitle: 'Evaluation agent processes pending queue URLs, compares job description with candidate resume against scoring rubric & skills, and writes scored candidate.',
      diagram: `flowchart TB
    POSTING["Live Job Posting URL<br/>(Full Description)"]
    RESUME["Candidate Resume<br/>(PDF Text Extracts)"]
    ASSESS["job-search-assess<br/>(Evaluation Agent)"]
    MCP["MCP Server<br/>(job-search-db)"]

    MCP -->|get_pending_queue| ASSESS
    POSTING -->|fetch live job details| ASSESS
    RESUME -->|compare qualifications| ASSESS
    MCP -->|get_scoring_rubric: dimensions & weights| ASSESS
    MCP -->|list_skills: core & preferred| ASSESS
    ASSESS -->|synthesize score & breakdown| ASSESS
    ASSESS -->|add_candidate: status new| MCP
    ASSESS -->|update_queue_status: assessed or skipped| MCP

    classDef external fill:#ffffff,stroke:#525252,color:#0f0f0f,stroke-width:1.5px;
    classDef skill fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;

    class POSTING,RESUME external;
    class ASSESS skill;
    class MCP mcp;`
    },
    lifecycle: {
      title: 'Workflow Visualization — State & Checkpoint Lifecycle',
      subtitle: 'Complete lifecycle of queue status transitions (pending -> assessed / skipped), candidate recording, and checkpoint logging.',
      diagram: `flowchart TB
    START(["Trigger Orchestrator"])
    BATCH["MCP: get_batch: limit 3"]
    CRAWL_RUN["job-search-crawl"]
    QUEUE_ADD["MCP: add_to_queue: pending"]
    ASSESS_RUN["job-search-assess"]
    DECISION{"Validate & score"}
    CAND_ADD["MCP: add_candidate: status new"]
    Q_ASSESSED["MCP: update_queue_status: assessed"]
    Q_SKIPPED["MCP: update_queue_status: skipped"]
    LOG["MCP: log_run: checkpoint"]
    SORT["MCP: get_candidates: final sort"]

    START --> BATCH
    BATCH --> CRAWL_RUN
    CRAWL_RUN --> QUEUE_ADD
    QUEUE_ADD --> ASSESS_RUN
    ASSESS_RUN --> DECISION
    DECISION -->|score meets threshold| CAND_ADD
    CAND_ADD --> Q_ASSESSED
    DECISION -->|invalid or closed| Q_SKIPPED
    Q_ASSESSED --> LOG
    Q_SKIPPED --> LOG
    LOG --> SORT

    classDef action fill:#f5f4f0,stroke:#0a0a0a,color:#0f0f0f,stroke-width:2px;
    classDef mcp fill:#ecfdf5,stroke:#059669,color:#065f46,stroke-width:2px;
    classDef decision fill:#fffbeb,stroke:#d97706,color:#92400e,stroke-width:2px;

    class START,CRAWL_RUN,ASSESS_RUN action;
    class BATCH,QUEUE_ADD,CAND_ADD,Q_ASSESSED,Q_SKIPPED,LOG,SORT mcp;
    class DECISION decision;`
    }
  };

  function updateDiagramZoom(newZoom) {
    diagramZoom = Math.max(0.6, Math.min(2.5, Math.round(newZoom * 100) / 100));
    const viewport = document.getElementById('diagram-viewport');
    const spacer = document.getElementById('diagram-scroll-spacer');
    const container = document.getElementById('diagram-container');
    const resetBtn = document.getElementById('btn-zoom-reset');

    if (resetBtn) {
      resetBtn.textContent = `${Math.round(diagramZoom * 100)}%`;
    }

    if (!viewport || !spacer) return;

    // Measure unscaled SVG base dimensions
    const svg = viewport.querySelector('svg');
    let baseWidth = 1200;
    let baseHeight = 750;

    if (svg) {
      if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
        baseWidth = Math.ceil(svg.viewBox.baseVal.width);
        baseHeight = Math.ceil(svg.viewBox.baseVal.height);
      } else {
        const bbox = svg.getBBox ? svg.getBBox() : null;
        if (bbox && bbox.width > 0) {
          baseWidth = Math.ceil(bbox.width);
          baseHeight = Math.ceil(bbox.height);
        }
      }
      svg.setAttribute('width', baseWidth);
      svg.setAttribute('height', baseHeight);
      svg.style.width = `${baseWidth}px`;
      svg.style.height = `${baseHeight}px`;
    }

    viewport.style.width = `${baseWidth}px`;
    viewport.style.height = `${baseHeight}px`;
    viewport.style.transformOrigin = '0 0';
    viewport.style.transform = `scale(${diagramZoom})`;

    const scaledWidth = Math.ceil(baseWidth * diagramZoom);
    const scaledHeight = Math.ceil(baseHeight * diagramZoom);

    // Give spacer comfortable padding so the scrollbars reach past the full edge
    spacer.style.width = `${scaledWidth + 48}px`;
    spacer.style.height = `${scaledHeight + 48}px`;

    // Center spacer when diagram is smaller than container viewport
    if (container) {
      const containerWidth = container.clientWidth;
      if (scaledWidth + 48 < containerWidth) {
        const offset = Math.max(0, Math.floor((containerWidth - (scaledWidth + 48)) / 2));
        spacer.style.marginLeft = `${offset}px`;
      } else {
        spacer.style.marginLeft = '0px';
      }
    }
  }

  let diagramRenderCounter = 0;

  function switchToWorkflowLoop(loopKey) {
    activeWorkflowLoop = loopKey;
    const workflowTabs = document.getElementById('workflow-drilldown-tabs');
    if (workflowTabs) {
      workflowTabs.querySelectorAll('.tab-btn').forEach((b) => {
        if (b.dataset.loop === loopKey) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
    }
    renderWorkflowLoop(loopKey);
  }

  function attachOverviewDrilldownHandlers(container) {
    const mappings = [
      { pattern: /Company Discovery|company-search/i, loop: 'company-search', label: 'Company Discovery Loop' },
      { pattern: /Title Discovery|title-discovery/i, loop: 'title-search', label: 'Title Discovery Loop' },
      { pattern: /Active Search|job-search-lead-gen/i, loop: 'active-search', label: 'Active Search Orchestrator Loop' },
      { pattern: /Crawl Detail|crawl-job-board|job-search-crawl/i, loop: 'crawl-detail', label: 'Crawl Detail Execution' },
      { pattern: /Assess Detail|job-search-assess|scoring-rubric/i, loop: 'assess-detail', label: 'Assessment & Scoring Detail' },
      { pattern: /Pipeline State|crawl_queue|candidates|run_logs|State Lifecycle/i, loop: 'lifecycle', label: 'State & Checkpoint Lifecycle' },
    ];

    container.querySelectorAll('.cluster, .node').forEach((el) => {
      const text = el.textContent || '';
      for (const m of mappings) {
        if (m.pattern.test(text)) {
          el.classList.add('clickable-subloop');
          el.setAttribute('title', `Click to drill-down into ${m.label}`);
          el.style.cursor = 'pointer';
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            switchToWorkflowLoop(m.loop);
          });
          break;
        }
      }
    });
  }

  async function renderWorkflowLoop(loopKey = activeWorkflowLoop) {
    activeWorkflowLoop = loopKey;
    const loop = WORKFLOW_LOOPS[loopKey] || WORKFLOW_LOOPS.overview;

    const subtitleEl = document.getElementById('workflow-subtitle');
    if (subtitleEl) {
      if (loopKey === 'overview') {
        subtitleEl.innerHTML = `${loop.subtitle}`;
      } else {
        subtitleEl.innerHTML = `${loop.subtitle} &bull; <a href="javascript:void(0)" id="back-to-overview-link" style="color: var(--accent); font-weight: 600; text-decoration: underline;">&larr; Back to System Overview</a>`;
        const backLink = document.getElementById('back-to-overview-link');
        if (backLink) {
          backLink.addEventListener('click', () => switchToWorkflowLoop('overview'));
        }
      }
    }

    const container = document.getElementById('mermaid-system-diagram');
    if (!container) return;

    if (window.mermaid) {
      try {
        diagramRenderCounter++;
        const renderId = 'mermaid-canvas-' + diagramRenderCounter;

        // Clean up any residual temp element from earlier failed renders
        const existingTemp = document.getElementById(renderId) || document.getElementById('d' + renderId);
        if (existingTemp) existingTemp.remove();

        const { svg } = await window.mermaid.render(renderId, loop.diagram);
        container.innerHTML = svg;

        // Apply diagram zoom and update scroll spacer dimensions
        updateDiagramZoom(diagramZoom);

        // If rendering overview, attach click handlers to the sub-process boxes & nodes
        if (loopKey === 'overview') {
          attachOverviewDrilldownHandlers(container);
        }
      } catch (err) {
        console.warn('Mermaid rendering warning:', err);
        container.innerHTML = `
          <div style="padding: 16px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 12px; color: #92400e; margin-bottom: 12px;">
            Failed to render diagram: ${escapeHtml(err?.message || err)}
          </div>
          <pre class="text-xs text-muted" style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(loop.diagram)}</pre>
        `;
      }
    }
  }

  function renderMermaid() {
    renderWorkflowLoop(activeWorkflowLoop);
  }

  // ==========================================
  // VIEW 2: COMPANIES
  // ==========================================
  async function loadCompanies() {
    const tbody = document.getElementById('companies-tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Loading target companies...</td></tr>`;

    const data = await callMcp('list_companies', { include_excluded: true });
    state.companies = Array.isArray(data) ? data : [];
    renderCompaniesTable();
  }

  function renderCompaniesTable() {
    const tbody = document.getElementById('companies-tbody');
    const query = (document.getElementById('company-search-input')?.value || '').toLowerCase().trim();

    const filtered = state.companies.filter((c) => {
      if (!query) return true;
      return (c.name || '').toLowerCase().includes(query) ||
             (c.careers_url || '').toLowerCase().includes(query) ||
             (c.notes || '').toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">No companies found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((c) => {
      const isExcluded = Boolean(c.is_excluded);
      const rowClass = isExcluded ? 'row-excluded' : '';
      const statusBadge = isExcluded
        ? `<span class="badge badge-rose">Excluded</span>`
        : `<span class="badge badge-emerald">Active</span>`;

      return `
        <tr class="${rowClass}" data-company="${escapeHtml(c.name)}">
          <td>
            <span class="editable-field font-semibold" data-field="name" data-company="${escapeHtml(c.name)}" title="Click to edit name">${escapeHtml(c.name)}</span>
          </td>
          <td>
            <span class="editable-field text-muted text-xs" data-field="careers_url" data-company="${escapeHtml(c.name)}" title="Click to edit URL">
              <a href="${escapeHtml(c.careers_url)}" target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: #818cf8;">${escapeHtml(c.careers_url || 'No URL')}</a>
            </span>
          </td>
          <td>${statusBadge}</td>
          <td>
            <span class="editable-field text-xs text-muted" data-field="notes" data-company="${escapeHtml(c.name)}" title="Click to edit notes">${escapeHtml(c.notes || '-')}</span>
          </td>
          <td class="text-xs text-muted">${c.last_searched_at ? new Date(c.last_searched_at).toLocaleDateString() : 'Never'}</td>
          <td class="text-right">
            <label class="toggle-switch" title="${isExcluded ? 'Click to Include' : 'Click to Exclude'}">
              <input type="checkbox" ${isExcluded ? 'checked' : ''} class="company-exclude-toggle" data-company="${escapeHtml(c.name)}">
              <span class="toggle-slider"></span>
            </label>
          </td>
        </tr>
      `;
    }).join('');

    // Attach inline edit handlers
    attachCompanyInlineListeners();
  }

  function attachCompanyInlineListeners() {
    // Exclude toggle
    document.querySelectorAll('.company-exclude-toggle').forEach((checkbox) => {
      checkbox.addEventListener('change', async (e) => {
        const companyName = e.target.dataset.company;
        const willExclude = e.target.checked;
        try {
          await callMcp('update_company', {
            current_name: companyName,
            is_excluded: willExclude,
          });
          showToast(`Updated "${companyName}" exclusion status`, 'success');
          await loadCompanies();
        } catch (err) {
          e.target.checked = !willExclude; // revert
        }
      });
    });

    // Inline edit for text fields
    document.querySelectorAll('#companies-tbody .editable-field').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (el.querySelector('input')) return; // Already editing
        const companyName = el.dataset.company;
        const field = el.dataset.field;
        const currentText = el.textContent.trim();

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-edit-input';
        input.value = currentText === '-' ? '' : currentText;

        el.innerHTML = '';
        el.appendChild(input);
        input.focus();

        const saveEdit = async () => {
          const newVal = input.value.trim();
          if (newVal === currentText) {
            el.textContent = currentText;
            return;
          }

          try {
            const updates = { current_name: companyName };
            updates[field] = newVal;
            await callMcp('update_company', updates);
            showToast(`Updated ${field} for "${companyName}"`, 'success');
            await loadCompanies();
          } catch (err) {
            el.textContent = currentText;
          }
        };

        input.addEventListener('blur', saveEdit);
        input.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            input.blur();
          } else if (evt.key === 'Escape') {
            el.textContent = currentText;
          }
        });
      });
    });
  }

  // ==========================================
  // VIEW 3: TITLE PATTERNS
  // ==========================================
  async function loadTitlePatterns() {
    const data = await callMcp('list_title_patterns');
    state.titlePatterns = Array.isArray(data) ? data : [];
    renderTitlePatterns();
  }

  function renderTitlePatterns() {
    const includes = state.titlePatterns.filter((p) => p.type === 'include');
    const excludes = state.titlePatterns.filter((p) => p.type === 'exclude');

    document.getElementById('include-count').textContent = includes.length;
    document.getElementById('exclude-count').textContent = excludes.length;

    const renderTable = (list, tbodyId) => {
      const tbody = document.getElementById(tbodyId);
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-muted">No patterns defined.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map((p) => `
        <tr data-pattern="${escapeHtml(p.pattern)}" data-type="${p.type}">
          <td>
            <strong class="text-sm font-semibold">${escapeHtml(p.pattern)}</strong>
          </td>
          <td>
            ${p.level ? `<span class="badge badge-accent">${escapeHtml(p.level)}</span>` : '<span class="text-muted text-xs">-</span>'}
          </td>
          <td class="text-xs text-muted">${escapeHtml(p.notes || '-')}</td>
          <td class="text-right">
            <button class="btn-icon btn-icon-danger btn-remove-pattern" data-pattern="${escapeHtml(p.pattern)}" data-type="${p.type}" title="Remove pattern">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `).join('');
    };

    renderTable(includes, 'include-titles-tbody');
    renderTable(excludes, 'exclude-titles-tbody');

    // Attach remove handlers
    document.querySelectorAll('.btn-remove-pattern').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pattern = btn.dataset.pattern;
        const type = btn.dataset.type;
        if (confirm(`Remove title pattern "${pattern}"?`)) {
          try {
            await callMcp('remove_title_pattern', { pattern, type });
            showToast(`Removed title pattern "${pattern}"`, 'success');
            await loadTitlePatterns();
          } catch (err) {
            // error already toasted
          }
        }
      });
    });
  }

  // ==========================================
  // VIEW 4: SKILLS
  // ==========================================
  async function loadSkills() {
    const data = await callMcp('list_skills');
    state.skills = Array.isArray(data) ? data : [];
    renderSkillsView();
  }

  function renderSkillsView() {
    const categories = Array.from(new Set(state.skills.map((s) => s.category).filter(Boolean)));
    const tabsContainer = document.getElementById('skills-category-tabs');

    tabsContainer.innerHTML = `
      <button class="tab-btn ${state.selectedSkillCategory === 'all' ? 'active' : ''}" data-cat="all">All Skills (${state.skills.length})</button>
      ${categories.map((cat) => `
        <button class="tab-btn ${state.selectedSkillCategory === cat ? 'active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
      `).join('')}
    `;

    tabsContainer.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsContainer.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedSkillCategory = btn.dataset.cat;
        renderSkillsTable();
      });
    });

    renderSkillsTable();
  }

  function renderSkillsTable() {
    const tbody = document.getElementById('skills-tbody');
    const filtered = state.skills.filter((s) => {
      if (state.selectedSkillCategory === 'all') return true;
      return s.category === state.selectedSkillCategory;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-muted">No skills in this category.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((s) => `
      <tr data-skill="${escapeHtml(s.name)}">
        <td class="font-semibold">${escapeHtml(s.name)}</td>
        <td>
          <span class="badge badge-subtle">${escapeHtml(s.category || 'General')}</span>
        </td>
        <td>
          <select class="form-select skill-priority-select" data-skill="${escapeHtml(s.name)}" style="width: auto; padding: 4px 8px; font-size: 12px;">
            <option value="core" ${s.importance === 'core' ? 'selected' : ''}>Core / Required</option>
            <option value="preferred" ${s.importance === 'preferred' ? 'selected' : ''}>Preferred</option>
            <option value="P1" ${s.importance === 'P1' ? 'selected' : ''}>P1 (High)</option>
            <option value="P2" ${s.importance === 'P2' ? 'selected' : ''}>P2 (Medium)</option>
          </select>
        </td>
        <td class="text-xs text-muted">${escapeHtml(s.notes || '-')}</td>
        <td class="text-right">
          <button class="btn-icon btn-icon-danger btn-remove-skill" data-skill="${escapeHtml(s.name)}" title="Remove skill">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </td>
      </tr>
    `).join('');

    // Attach priority change
    document.querySelectorAll('.skill-priority-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const skillName = sel.dataset.skill;
        const newPriority = sel.value;
        try {
          await callMcp('update_skill', { name: skillName, importance: newPriority });
          showToast(`Updated priority for "${skillName}" to ${newPriority}`, 'success');
        } catch (err) {
          await loadSkills();
        }
      });
    });

    // Attach remove
    document.querySelectorAll('.btn-remove-skill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const skillName = btn.dataset.skill;
        if (confirm(`Remove skill "${skillName}"?`)) {
          try {
            await callMcp('remove_skill', { name: skillName });
            showToast(`Removed skill "${skillName}"`, 'success');
            await loadSkills();
          } catch (err) {}
        }
      });
    });
  }

  // ==========================================
  // VIEW 5: SCORING RUBRIC
  // ==========================================
  async function loadRubric() {
    const data = await callMcp('get_scoring_rubric');
    state.rubric = Array.isArray(data) ? data : [];
    renderRubricView();
  }

  function renderRubricView() {
    const container = document.getElementById('rubric-cards-container');
    const warningBanner = document.getElementById('rubric-warning-banner');
    const sumVal = document.getElementById('rubric-total-val');
    const sumBadge = document.getElementById('rubric-sum-badge');
    const currentWeightSum = document.getElementById('current-weight-sum');

    // Calculate sum of weights
    const totalWeight = state.rubric.reduce((acc, dim) => acc + (parseFloat(dim.weight) || 0), 0);
    const isValid = Math.abs(totalWeight - 100) < 0.1;

    sumVal.textContent = `${Math.round(totalWeight)}%`;
    if (isValid) {
      sumBadge.className = 'rubric-sum-badge valid';
      warningBanner.classList.add('hidden');
    } else {
      sumBadge.className = 'rubric-sum-badge invalid';
      warningBanner.classList.remove('hidden');
      if (currentWeightSum) currentWeightSum.textContent = Math.round(totalWeight);
    }

    if (state.rubric.length === 0) {
      container.innerHTML = `<div class="text-center py-10 text-muted col-span-full">No rubric dimensions found.</div>`;
      return;
    }

    container.innerHTML = state.rubric.map((dim) => `
      <div class="rubric-card" data-dim="${escapeHtml(dim.dimension)}">
        <div class="rubric-card-header">
          <div class="rubric-dim-name">${escapeHtml(dim.dimension)}</div>
          <div class="flex items-center gap-3">
            <div class="rubric-weight-box">
              <input type="number" class="rubric-weight-input" data-dim="${escapeHtml(dim.dimension)}" value="${dim.weight}" min="0" max="100">%
            </div>
            <button class="btn-icon btn-icon-danger btn-remove-rubric" data-dim="${escapeHtml(dim.dimension)}" title="Delete dimension">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>

        <div class="rubric-tiers">
          <div class="rubric-tier-item">
            <div class="tier-label" style="color: #ef4444;">Poor (1-2)</div>
            <div class="tier-desc editable-rubric-desc" data-dim="${escapeHtml(dim.dimension)}" data-tier="poor_description">${escapeHtml(dim.poor_description || 'No description')}</div>
          </div>
          <div class="rubric-tier-item">
            <div class="tier-label" style="color: #f59e0b;">Moderate (3)</div>
            <div class="tier-desc editable-rubric-desc" data-dim="${escapeHtml(dim.dimension)}" data-tier="moderate_description">${escapeHtml(dim.moderate_description || 'No description')}</div>
          </div>
          <div class="rubric-tier-item">
            <div class="tier-label" style="color: #10b981;">Strong (4-5)</div>
            <div class="tier-desc editable-rubric-desc" data-dim="${escapeHtml(dim.dimension)}" data-tier="strong_description">${escapeHtml(dim.strong_description || 'No description')}</div>
          </div>
        </div>
      </div>
    `).join('');

    // Attach weight inputs
    document.querySelectorAll('.rubric-weight-input').forEach((input) => {
      input.addEventListener('change', async () => {
        const dimName = input.dataset.dim;
        const newWeight = parseFloat(input.value) || 0;
        try {
          await callMcp('update_rubric_dimension', { dimension: dimName, weight: newWeight });
          showToast(`Updated weight for "${dimName}" to ${newWeight}%`, 'success');
          await loadRubric();
        } catch (err) {
          await loadRubric();
        }
      });
    });

    // Attach tier description edit
    document.querySelectorAll('.editable-rubric-desc').forEach((descEl) => {
      descEl.addEventListener('click', () => {
        if (descEl.querySelector('textarea')) return;
        const dimName = descEl.dataset.dim;
        const tier = descEl.dataset.tier;
        const currentText = descEl.textContent.trim();

        const textarea = document.createElement('textarea');
        textarea.className = 'form-textarea';
        textarea.value = currentText === 'No description' ? '' : currentText;
        descEl.innerHTML = '';
        descEl.appendChild(textarea);
        textarea.focus();

        const save = async () => {
          const newVal = textarea.value.trim();
          if (newVal === currentText) {
            descEl.textContent = currentText;
            return;
          }
          try {
            const updates = { dimension: dimName };
            updates[tier] = newVal;
            await callMcp('update_rubric_dimension', updates);
            showToast(`Updated ${tier.replace('_', ' ')} for "${dimName}"`, 'success');
            await loadRubric();
          } catch (err) {
            descEl.textContent = currentText;
          }
        };

        textarea.addEventListener('blur', save);
      });
    });

    // Attach delete
    document.querySelectorAll('.btn-remove-rubric').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dimName = btn.dataset.dim;
        if (confirm(`Remove dimension "${dimName}"?`)) {
          try {
            await callMcp('remove_rubric_dimension', { dimension: dimName });
            showToast(`Removed dimension "${dimName}"`, 'success');
            await loadRubric();
          } catch (err) {}
        }
      });
    });
  }

  // ==========================================
  // VIEW 6: CRAWL QUEUE
  // ==========================================
  async function loadQueue() {
    const filters = {};
    if (state.selectedQueueStatus !== 'all') {
      filters.status = state.selectedQueueStatus;
    }
    const data = await callMcp('list_queue', filters);
    state.queue = Array.isArray(data) ? data : [];
    renderQueueTable();
  }

  function renderQueueTable() {
    const tbody = document.getElementById('queue-tbody');
    const search = (document.getElementById('queue-search-input')?.value || '').toLowerCase().trim();

    const filtered = state.queue.filter((item) => {
      if (!search) return true;
      return (item.url || '').toLowerCase().includes(search) ||
             (item.company_name || '').toLowerCase().includes(search) ||
             (item.notes || '').toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-muted">No crawl queue entries match this filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((item) => {
      const statusClass = item.status === 'assessed' ? 'badge-emerald' : item.status === 'skipped' ? 'badge-subtle' : 'badge-amber';
      return `
        <tr>
          <td>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="hover:underline text-xs" style="color: #818cf8; word-break: break-all;">
              ${escapeHtml(item.url)}
            </a>
          </td>
          <td class="font-semibold">${escapeHtml(item.company_name)}</td>
          <td class="text-xs text-muted">${escapeHtml(item.notes || '-')}</td>
          <td>
            <span class="badge ${statusClass}">${escapeHtml(item.status)}</span>
          </td>
          <td class="text-xs text-muted">${item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================
  // VIEW 7: CANDIDATES
  // ==========================================
  async function loadCandidates() {
    const filters = {};
    if (state.selectedCandidateStatus !== 'all') {
      filters.status = state.selectedCandidateStatus;
    }

    if (state.candidateSort === 'score_desc') {
      filters.sort_by = 'score';
      filters.sort_order = 'desc';
    } else if (state.candidateSort === 'score_asc') {
      filters.sort_by = 'score';
      filters.sort_order = 'asc';
    } else if (state.candidateSort === 'date_desc') {
      filters.sort_by = 'discovered_at';
      filters.sort_order = 'desc';
    }

    const data = await callMcp('get_candidates', filters);
    state.candidates = Array.isArray(data) ? data : [];
    renderCandidatesView();
  }

  function renderCandidatesView() {
    const container = document.getElementById('candidates-container');

    if (state.candidates.length === 0) {
      container.innerHTML = `<div class="text-center py-10 text-muted">No candidates found for this status.</div>`;
      return;
    }

    container.innerHTML = state.candidates.map((c) => {
      const score = c.score !== null && c.score !== undefined ? parseFloat(c.score).toFixed(1) : '-';
      const scoreNum = parseFloat(c.score) || 0;
      const scoreClass = scoreNum >= 8.5 ? 'score-high' : scoreNum >= 7.0 ? 'score-mid' : 'score-low';
      const breakdown = c.breakdown || {};

      return `
        <div class="candidate-card" data-url="${escapeHtml(c.url)}">
          <div class="candidate-main">
            <div class="candidate-info">
              <h4>${escapeHtml(c.job_title)} <span class="text-muted font-normal text-sm">at ${escapeHtml(c.company_name)}</span></h4>
              <div class="candidate-meta">
                <span>📍 ${escapeHtml(c.location || 'Remote')}</span>
                <span>📅 Discovered: ${c.discovered_at ? new Date(c.discovered_at).toLocaleDateString() : '-'}</span>
                <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" style="color: #818cf8;">View Posting ↗</a>
              </div>
            </div>

            <div class="candidate-score-box">
              <div class="text-center">
                <div class="score-badge ${scoreClass}">${score}</div>
                <div class="text-xs text-muted mt-1">Match Score</div>
              </div>

              <div class="candidate-status-dropdown-box" onclick="event.stopPropagation()">
                <select class="form-select candidate-status-select" data-url="${escapeHtml(c.url)}" style="width: 140px; font-size: 13px; font-weight: 500;">
                  <option value="new" ${c.status === 'new' ? 'selected' : ''}>New</option>
                  <option value="applied" ${c.status === 'applied' ? 'selected' : ''}>Applied</option>
                  <option value="in_progress" ${c.status === 'in_progress' || c.status === 'interviewing' ? 'selected' : ''}>In Progress</option>
                  <option value="not_pursuing" ${c.status === 'not_pursuing' || c.status === 'closed' || c.status === 'rejected' || c.status === 'offer' ? 'selected' : ''}>Not Pursuing</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Expandable Synopsis & Rubric Breakdown -->
          <div class="candidate-drawer">
            <h5 class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Scoring Rubric Breakdown</h5>
            <div class="breakdown-bars">
              ${Object.entries(breakdown).map(([dim, val]) => `
                <div class="bar-item">
                  <div class="bar-header">
                    <span>${escapeHtml(dim)}</span>
                    <strong>${val}/10</strong>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill" style="width: ${Math.min(val * 10, 100)}%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>

            ${c.notes ? `
              <div class="mt-4">
                <h5 class="text-xs font-semibold uppercase tracking-wider text-muted mb-1">Assessment Notes & Highlights</h5>
                <p class="text-sm text-secondary bg-surface p-3 rounded border border-subtle">${escapeHtml(c.notes)}</p>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Toggle drawer on card click
    document.querySelectorAll('.candidate-main').forEach((mainEl) => {
      mainEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'A' || e.target.tagName === 'SELECT') return;
        const card = mainEl.closest('.candidate-card');
        const drawer = card.querySelector('.candidate-drawer');
        if (drawer) {
          drawer.classList.toggle('open');
        }
      });
    });

    // Status change listener
    document.querySelectorAll('.candidate-status-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const url = sel.dataset.url;
        const newStatus = sel.value;
        try {
          await callMcp('update_candidate_status', { url, status: newStatus });
          showToast(`Candidate status updated to "${newStatus}"`, 'success');
        } catch (err) {
          await loadCandidates();
        }
      });
    });
  }

  // ==========================================
  // VIEW 8: RUN HISTORY
  // ==========================================
  async function loadHistory() {
    const data = await callMcp('get_recent_runs', { limit: 25 });
    state.history = Array.isArray(data) ? data : [];
    renderHistoryTimeline();
  }

  function renderHistoryTimeline() {
    const timeline = document.getElementById('history-timeline');
    if (state.history.length === 0) {
      timeline.innerHTML = `<div class="text-center py-8 text-muted">No pipeline runs have been recorded yet.</div>`;
      return;
    }

    timeline.innerHTML = state.history.map((run, idx) => {
      const dateStr = run.timestamp ? new Date(run.timestamp).toLocaleString() : 'Unknown';
      const companies = Array.isArray(run.companies_processed) ? run.companies_processed : [];
      const detailsJson = JSON.stringify(run.details || {}, null, 2);

      return `
        <div class="timeline-item">
          <div class="timeline-card">
            <div class="timeline-header">
              <div class="flex items-center gap-2">
                <span class="badge badge-accent">${escapeHtml(run.mode || 'standard')}</span>
                <strong class="text-sm">${escapeHtml(run.summary || 'Pipeline Search Run')}</strong>
              </div>
              <span class="text-xs text-muted">🕒 ${dateStr}</span>
            </div>

            <div class="flex items-center gap-6 text-xs text-muted mb-2">
              <span>🏢 Companies: <strong>${companies.length}</strong> (${companies.slice(0, 3).join(', ')}${companies.length > 3 ? '...' : ''})</span>
              <span>🔗 URLs Queued: <strong>${run.urls_queued || 0}</strong></span>
              <span>⭐ Candidates Scored: <strong>${run.candidates_scored || 0}</strong></span>
            </div>

            <button class="btn btn-secondary btn-sm toggle-json-btn" data-target="json-details-${idx}">
              <span>View JSON Details</span>
            </button>

            <pre class="json-viewer" id="json-details-${idx}">${escapeHtml(detailsJson)}</pre>
          </div>
        </div>
      `;
    }).join('');

    // Toggle JSON viewers
    document.querySelectorAll('.toggle-json-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const viewer = document.getElementById(btn.dataset.target);
        if (viewer) viewer.classList.toggle('open');
      });
    });
  }

  // ==========================================
  // EVENT LISTENERS & MODALS
  // ==========================================
  function setupEventListeners() {
    // Navigation Links
    document.querySelectorAll('.nav-item').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.getAttribute('href').replace('#', '');
        navigateTo(targetView);
      });
    });

    // Refresh Button
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        showToast('Refreshing pipeline data...', 'info');
        loadViewData(state.activeView);
      });
    }

    // Workflow Visualization Zoom & Full Window Controls
    const zoomIn = document.getElementById('btn-zoom-in');
    const zoomOut = document.getElementById('btn-zoom-out');
    const zoomReset = document.getElementById('btn-zoom-reset');
    if (zoomIn) zoomIn.addEventListener('click', () => updateDiagramZoom(diagramZoom + 0.15));
    if (zoomOut) zoomOut.addEventListener('click', () => updateDiagramZoom(diagramZoom - 0.15));
    if (zoomReset) zoomReset.addEventListener('click', () => updateDiagramZoom(1.0));

    const fsToggle = document.getElementById('btn-fullscreen-toggle');
    if (fsToggle) {
      fsToggle.addEventListener('click', () => {
        const card = document.getElementById('diagram-card');
        const label = document.getElementById('fullscreen-label');
        if (card) {
          card.classList.toggle('is-fullscreen');
          const isFull = card.classList.contains('is-fullscreen');
          if (label) label.textContent = isFull ? 'Collapse' : 'Full Window';
          setTimeout(() => updateDiagramZoom(diagramZoom), 50);
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const card = document.getElementById('diagram-card');
        const label = document.getElementById('fullscreen-label');
        if (card && card.classList.contains('is-fullscreen')) {
          card.classList.remove('is-fullscreen');
          if (label) label.textContent = 'Full Window';
          setTimeout(() => updateDiagramZoom(diagramZoom), 50);
        }
      }
    });

    window.addEventListener('resize', () => {
      if (state.activeView === 'visualization') {
        updateDiagramZoom(diagramZoom);
      }
    });

    // Workflow Drilldown Tabs
    const workflowTabs = document.getElementById('workflow-drilldown-tabs');
    if (workflowTabs) {
      workflowTabs.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          switchToWorkflowLoop(btn.dataset.loop);
        });
      });
    }

    // Search filters
    const compSearch = document.getElementById('company-search-input');
    if (compSearch) compSearch.addEventListener('input', renderCompaniesTable);

    const queueSearch = document.getElementById('queue-search-input');
    if (queueSearch) queueSearch.addEventListener('input', renderQueueTable);

    // Queue Status Tabs
    const queueTabs = document.getElementById('queue-status-tabs');
    if (queueTabs) {
      queueTabs.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          queueTabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.selectedQueueStatus = btn.dataset.status;
          loadQueue();
        });
      });
    }

    // Candidate Status Tabs
    const candTabs = document.getElementById('candidates-status-tabs');
    if (candTabs) {
      candTabs.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          candTabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.selectedCandidateStatus = btn.dataset.status;
          loadCandidates();
        });
      });
    }

    // Candidate Sort Select
    const candSort = document.getElementById('candidate-sort-select');
    if (candSort) {
      candSort.addEventListener('change', () => {
        state.candidateSort = candSort.value;
        loadCandidates();
      });
    }

    // Add Company Button
    const addCompBtn = document.getElementById('btn-add-company');
    if (addCompBtn) {
      addCompBtn.addEventListener('click', () => {
        modal.open(
          'Add Target Company',
          `
          <form id="form-add-company">
            <div class="form-group">
              <label class="form-label">Company Name *</label>
              <input type="text" id="add-company-name" class="form-input" placeholder="e.g. Stripe" required>
            </div>
            <div class="form-group">
              <label class="form-label">Job Board / Careers URL *</label>
              <input type="url" id="add-company-url" class="form-input" placeholder="https://stripe.com/jobs" required>
            </div>
            <div class="form-group">
              <label class="form-label">Notes (optional)</label>
              <textarea id="add-company-notes" class="form-textarea" placeholder="Hiring priorities, domains, or industry..."></textarea>
            </div>
            <div class="modal-footer" style="margin: 20px -24px -24px; padding: 16px 24px;">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Company</button>
            </div>
          </form>
          `
        );

        document.getElementById('form-add-company').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = document.getElementById('add-company-name').value.trim();
          const careers_url = document.getElementById('add-company-url').value.trim();
          const notes = document.getElementById('add-company-notes').value.trim();

          try {
            await callMcp('add_company', { name, careers_url, notes });
            showToast(`Added company "${name}"`, 'success');
            modal.close();
            await loadCompanies();
          } catch (err) {}
        });
      });
    }

    // Add Title Pattern Button
    const addTitleBtn = document.getElementById('btn-add-title');
    if (addTitleBtn) {
      addTitleBtn.addEventListener('click', () => {
        modal.open(
          'Add Job Title Pattern',
          `
          <form id="form-add-title">
            <div class="form-group">
              <label class="form-label">Title Pattern *</label>
              <input type="text" id="add-title-pattern" class="form-input" placeholder="e.g. Staff Software Engineer" required>
            </div>
            <div class="form-group">
              <label class="form-label">Type *</label>
              <select id="add-title-type" class="form-select">
                <option value="include">Include (Must Match)</option>
                <option value="exclude">Exclude (Filter Out)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Target Seniority Level (optional)</label>
              <input type="text" id="add-title-level" class="form-input" placeholder="e.g. Staff, Principal, Lead">
            </div>
            <div class="form-group">
              <label class="form-label">Notes (optional)</label>
              <textarea id="add-title-notes" class="form-textarea" placeholder="Matching guidelines..."></textarea>
            </div>
            <div class="modal-footer" style="margin: 20px -24px -24px; padding: 16px 24px;">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Pattern</button>
            </div>
          </form>
          `
        );

        document.getElementById('form-add-title').addEventListener('submit', async (e) => {
          e.preventDefault();
          const pattern = document.getElementById('add-title-pattern').value.trim();
          const type = document.getElementById('add-title-type').value;
          const level = document.getElementById('add-title-level').value.trim();
          const notes = document.getElementById('add-title-notes').value.trim();

          try {
            await callMcp('add_title_pattern', { pattern, type, level, notes });
            showToast(`Added title pattern "${pattern}"`, 'success');
            modal.close();
            await loadTitlePatterns();
          } catch (err) {}
        });
      });
    }

    // Add Skill Button
    const addSkillBtn = document.getElementById('btn-add-skill');
    if (addSkillBtn) {
      addSkillBtn.addEventListener('click', () => {
        modal.open(
          'Add Target Skill',
          `
          <form id="form-add-skill">
            <div class="form-group">
              <label class="form-label">Skill Name *</label>
              <input type="text" id="add-skill-name" class="form-input" placeholder="e.g. TypeScript" required>
            </div>
            <div class="form-group">
              <label class="form-label">Category</label>
              <input type="text" id="add-skill-category" class="form-input" placeholder="e.g. Languages, Databases, AI/ML">
            </div>
            <div class="form-group">
              <label class="form-label">Priority / Importance</label>
              <select id="add-skill-priority" class="form-select">
                <option value="core">Core / Required</option>
                <option value="preferred">Preferred</option>
                <option value="P1">P1 (High)</option>
                <option value="P2">P2 (Medium)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Notes (optional)</label>
              <textarea id="add-skill-notes" class="form-textarea" placeholder="Years experience, context..."></textarea>
            </div>
            <div class="modal-footer" style="margin: 20px -24px -24px; padding: 16px 24px;">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Skill</button>
            </div>
          </form>
          `
        );

        document.getElementById('form-add-skill').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = document.getElementById('add-skill-name').value.trim();
          const category = document.getElementById('add-skill-category').value.trim();
          const importance = document.getElementById('add-skill-priority').value;
          const notes = document.getElementById('add-skill-notes').value.trim();

          try {
            await callMcp('add_skill', { name, category, importance, notes });
            showToast(`Added skill "${name}"`, 'success');
            modal.close();
            await loadSkills();
          } catch (err) {}
        });
      });
    }

    // Add Rubric Dimension Button
    const addRubricBtn = document.getElementById('btn-add-rubric');
    if (addRubricBtn) {
      addRubricBtn.addEventListener('click', () => {
        modal.open(
          'Add Scoring Dimension',
          `
          <form id="form-add-rubric">
            <div class="form-group">
              <label class="form-label">Dimension Name *</label>
              <input type="text" id="add-rubric-name" class="form-input" placeholder="e.g. Architecture Fit" required>
            </div>
            <div class="form-group">
              <label class="form-label">Weight (Percentage) *</label>
              <input type="number" id="add-rubric-weight" class="form-input" placeholder="25" min="1" max="100" required>
            </div>
            <div class="form-group">
              <label class="form-label">Poor (1-2) Tier Description</label>
              <textarea id="add-rubric-poor" class="form-textarea" placeholder="Criteria for score 1-2..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Moderate (3) Tier Description</label>
              <textarea id="add-rubric-moderate" class="form-textarea" placeholder="Criteria for score 3..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Strong (4-5) Tier Description</label>
              <textarea id="add-rubric-strong" class="form-textarea" placeholder="Criteria for score 4-5..."></textarea>
            </div>
            <div class="modal-footer" style="margin: 20px -24px -24px; padding: 16px 24px;">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Dimension</button>
            </div>
          </form>
          `
        );

        document.getElementById('form-add-rubric').addEventListener('submit', async (e) => {
          e.preventDefault();
          const dimension = document.getElementById('add-rubric-name').value.trim();
          const weight = parseFloat(document.getElementById('add-rubric-weight').value) || 0;
          const poor_description = document.getElementById('add-rubric-poor').value.trim();
          const moderate_description = document.getElementById('add-rubric-moderate').value.trim();
          const strong_description = document.getElementById('add-rubric-strong').value.trim();

          try {
            await callMcp('add_rubric_dimension', {
              dimension,
              weight,
              poor_description,
              moderate_description,
              strong_description,
            });
            showToast(`Added rubric dimension "${dimension}"`, 'success');
            modal.close();
            await loadRubric();
          } catch (err) {}
        });
      });
    }
  }

  // HTML Escape helper
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Init
  window.addEventListener('DOMContentLoaded', () => {
    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        themeVariables: {
          primaryColor: '#ffffff',
          primaryBorderColor: '#0a0a0a',
          primaryTextColor: '#0f0f0f',
          lineColor: '#525252',
          secondaryColor: '#f5f4f0',
          tertiaryColor: '#faf9f6',
          fontFamily: 'Inter, -apple-system, sans-serif'
        },
        securityLevel: 'loose',
        flowchart: { curve: 'basis', htmlLabels: true },
      });
    }

    setupEventListeners();
    checkHealth();

    // Listen for hash route changes (browser back/forward or direct hash input)
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && hash !== state.activeView) {
        navigateTo(hash);
      }
    });

    // Check initial hash route
    const hash = window.location.hash.replace('#', '');
    const initialView = hash || 'dashboard';
    navigateTo(initialView);
  });
})();
