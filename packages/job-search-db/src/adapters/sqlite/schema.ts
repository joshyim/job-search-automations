export const SQLITE_SCHEMA = `
-- Companies
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    careers_url TEXT NOT NULL,
    is_excluded INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    last_searched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companies_last_searched ON companies(last_searched_at ASC) WHERE is_excluded = 0;

-- Title Patterns
CREATE TABLE IF NOT EXISTS title_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('include', 'exclude')),
    level TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_pattern_type UNIQUE (pattern, type)
);

-- Skills
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    importance TEXT DEFAULT 'preferred',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scoring Rubric
CREATE TABLE IF NOT EXISTS scoring_rubric (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dimension TEXT NOT NULL UNIQUE,
    weight REAL NOT NULL,
    poor_description TEXT,
    moderate_description TEXT,
    strong_description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Crawl Queue
CREATE TABLE IF NOT EXISTS crawl_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    company_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assessed', 'skipped')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_company_status ON crawl_queue(company_name, status);

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    location TEXT,
    score REAL,
    breakdown TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer')),
    notes TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

-- Run Logs
CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    mode TEXT NOT NULL,
    companies_processed TEXT NOT NULL DEFAULT '[]',
    urls_queued INTEGER NOT NULL DEFAULT 0,
    candidates_scored INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    details TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_run_logs_timestamp ON run_logs(timestamp DESC);
`;

export interface DefaultRubricDimension {
  dimension: string;
  weight: number;
  poor_description: string;
  moderate_description: string;
  strong_description: string;
}

export const DEFAULT_RUBRIC: DefaultRubricDimension[] = [
  {
    dimension: 'Title match',
    weight: 25,
    poor_description: 'Little to no title relevance',
    moderate_description: 'Partial title keyword overlap',
    strong_description: 'Exact title match or target senior/lead level',
  },
  {
    dimension: 'Skills match',
    weight: 30,
    poor_description: 'Missing required core stack',
    moderate_description: 'Has some core skills, missing others',
    strong_description: 'Full alignment with required and preferred stack',
  },
  {
    dimension: 'Experience match',
    weight: 25,
    poor_description: 'Insufficient domain/system scale',
    moderate_description: 'Relevant domain, minor gaps in scale',
    strong_description: 'Proven track record in equivalent problem domain',
  },
  {
    dimension: 'Seniority fit',
    weight: 20,
    poor_description: 'Misaligned seniority level',
    moderate_description: 'Adjacent seniority level',
    strong_description: 'Matches target Staff/Principal IC level',
  },
];
