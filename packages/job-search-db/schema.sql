-- Canonical PostgreSQL DDL for job-search-automation (Neon DB)

-- 1. Companies
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    careers_url TEXT NOT NULL,
    is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    last_searched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_companies_last_searched ON companies(last_searched_at ASC) WHERE is_excluded = FALSE;

-- 2. Title Patterns
CREATE TABLE IF NOT EXISTS title_patterns (
    id SERIAL PRIMARY KEY,
    pattern VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('include', 'exclude')),
    level VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pattern_type UNIQUE (pattern, type)
);

-- 3. Skills
CREATE TABLE IF NOT EXISTS skills (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(100),
    importance VARCHAR(50) DEFAULT 'preferred',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Scoring Rubric
CREATE TABLE IF NOT EXISTS scoring_rubric (
    id SERIAL PRIMARY KEY,
    dimension VARCHAR(100) NOT NULL UNIQUE,
    weight NUMERIC(5,2) NOT NULL,
    poor_description TEXT,
    moderate_description TEXT,
    strong_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Crawl Queue
CREATE TABLE IF NOT EXISTS crawl_queue (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assessed', 'skipped')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_company_status ON crawl_queue(company_name, status);

-- 6. Candidates
CREATE TABLE IF NOT EXISTS candidates (
    id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    job_title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL UNIQUE,
    location VARCHAR(255),
    score NUMERIC(5,2),
    breakdown JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer')),
    notes TEXT,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

-- 7. Run Logs
CREATE TABLE IF NOT EXISTS run_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mode VARCHAR(50) NOT NULL,
    companies_processed JSONB NOT NULL DEFAULT '[]'::jsonb,
    urls_queued INTEGER NOT NULL DEFAULT 0,
    candidates_scored INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    details JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_run_logs_timestamp ON run_logs(timestamp DESC);
