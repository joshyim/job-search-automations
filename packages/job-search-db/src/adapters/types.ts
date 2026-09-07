export type CandidateStatus = 'new' | 'applied' | 'interviewing' | 'rejected' | 'offer';
export type QueueStatus = 'pending' | 'assessed' | 'skipped';
export type TitlePatternType = 'include' | 'exclude';

export interface Company {
  id?: number;
  name: string;
  careers_url: string;
  is_excluded: boolean;
  notes?: string | null;
  last_searched_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TitlePattern {
  id?: number;
  pattern: string;
  type: TitlePatternType;
  level?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface Skill {
  id?: number;
  name: string;
  category?: string | null;
  importance?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface RubricDimension {
  id?: number;
  dimension: string;
  weight: number;
  poor_description?: string | null;
  moderate_description?: string | null;
  strong_description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface QueueEntry {
  id?: number;
  url: string;
  company_name: string;
  status: QueueStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Candidate {
  id?: number;
  company_name: string;
  job_title: string;
  url: string;
  location?: string | null;
  score?: number | null;
  breakdown?: Record<string, number> | null;
  status: CandidateStatus;
  notes?: string | null;
  discovered_at?: string;
  applied_at?: string | null;
  updated_at?: string;
}

export interface CandidateFilters {
  status?: CandidateStatus;
  min_score?: number;
  company_name?: string;
  limit?: number;
  sort_by?: 'score' | 'discovered_at';
  sort_order?: 'asc' | 'desc';
}

export interface RunLog {
  id?: number;
  timestamp?: string;
  mode: string;
  companies_processed: string[];
  urls_queued: number;
  candidates_scored: number;
  summary?: string | null;
  details?: Record<string, unknown> | null;
}

export interface DataAdapter {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Companies
  listCompanies(includeExcluded?: boolean): Promise<Company[]>;
  addCompany(data: { name: string; careers_url: string; notes?: string; last_searched_at?: string }): Promise<Company>;
  excludeCompany(name: string, reason?: string): Promise<Company>;
  getBatch(limit: number): Promise<Company[]>;

  // Title Patterns
  listTitlePatterns(type?: TitlePatternType): Promise<TitlePattern[]>;
  addTitlePattern(data: { pattern: string; type: TitlePatternType; level?: string; notes?: string }): Promise<TitlePattern>;
  removeTitlePattern(pattern: string, type?: TitlePatternType): Promise<boolean>;

  // Skills
  listSkills(category?: string): Promise<Skill[]>;

  // Rubric
  getScoringRubric(): Promise<RubricDimension[]>;
  updateRubricDimension(dimension: string, updates: Partial<RubricDimension>): Promise<RubricDimension>;
  addRubricDimension(dimension: RubricDimension): Promise<RubricDimension>;
  removeRubricDimension(dimension: string): Promise<boolean>;

  // Crawl Queue
  checkUrlExists(url: string): Promise<{ exists: boolean; entry?: QueueEntry }>;
  addToQueue(data: { url: string; company_name: string; notes?: string }): Promise<QueueEntry>;
  getPendingQueue(companyName?: string, limit?: number): Promise<QueueEntry[]>;
  updateQueueStatus(url: string, status: QueueStatus, notes?: string): Promise<QueueEntry>;

  // Candidates
  addCandidate(data: {
    company_name: string;
    job_title: string;
    url: string;
    location?: string;
    score?: number;
    breakdown?: Record<string, number>;
    notes?: string;
    status?: CandidateStatus;
  }): Promise<Candidate>;
  updateCandidateStatus(url: string, status: CandidateStatus, notes?: string): Promise<Candidate>;
  getCandidates(filters?: CandidateFilters): Promise<Candidate[]>;

  // Run Logs
  logRun(data: {
    companies_processed: string[];
    urls_queued: number;
    candidates_scored: number;
    summary?: string;
    details?: Record<string, unknown>;
  }): Promise<RunLog>;
  getRecentRuns(limit?: number): Promise<RunLog[]>;
}
