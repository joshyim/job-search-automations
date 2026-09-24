import { Candidate, CandidateFilters, CandidateStatus, Company, DataAdapter, QueueEntry, QueueStatus, RubricDimension, RunLog, Skill, TitlePattern, TitlePatternType } from '../types.js';
export declare class LocalAdapter implements DataAdapter {
    private workflowDataPath;
    constructor(workflowDataPath: string);
    private getFilePath;
    private readFile;
    private writeFile;
    initialize(): Promise<void>;
    close(): Promise<void>;
    listCompanies(includeExcluded?: boolean): Promise<Company[]>;
    addCompany(data: {
        name: string;
        careers_url: string;
        ats_platform?: string;
        notes?: string;
        last_searched_at?: string;
    }): Promise<Company>;
    updateCompany(currentName: string, updates: Partial<Company>): Promise<Company>;
    excludeCompany(name: string, reason?: string): Promise<Company>;
    getBatch(limit: number): Promise<Company[]>;
    listTitlePatterns(type?: TitlePatternType): Promise<TitlePattern[]>;
    addTitlePattern(data: {
        pattern: string;
        type: TitlePatternType;
        level?: string;
        notes?: string;
    }): Promise<TitlePattern>;
    updateTitlePattern(pattern: string, type: TitlePatternType, updates: Partial<TitlePattern>): Promise<TitlePattern>;
    removeTitlePattern(pattern: string, type?: TitlePatternType): Promise<boolean>;
    listSkills(category?: string): Promise<Skill[]>;
    addSkill(data: {
        name: string;
        category?: string;
        importance?: string;
        notes?: string;
    }): Promise<Skill>;
    updateSkill(name: string, updates: Partial<Skill>): Promise<Skill>;
    removeSkill(name: string): Promise<boolean>;
    getScoringRubric(): Promise<RubricDimension[]>;
    updateRubricDimension(dimension: string, updates: Partial<RubricDimension>): Promise<RubricDimension>;
    addRubricDimension(dimension: RubricDimension): Promise<RubricDimension>;
    removeRubricDimension(dimension: string): Promise<boolean>;
    checkUrlExists(url: string): Promise<{
        exists: boolean;
        entry?: QueueEntry;
    }>;
    addToQueue(data: {
        url: string;
        company_name: string;
        ats_platform?: string;
        notes?: string;
    }): Promise<QueueEntry>;
    getPendingQueue(companyName?: string, limit?: number): Promise<QueueEntry[]>;
    listQueue(filters?: {
        status?: QueueStatus;
        company_name?: string;
        ats_platform?: string;
        limit?: number;
    }): Promise<QueueEntry[]>;
    updateQueueStatus(url: string, status: QueueStatus, notes?: string): Promise<QueueEntry>;
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
    logRun(data: {
        companies_processed: string[];
        urls_queued: number;
        candidates_scored: number;
        summary?: string;
        details?: Record<string, unknown>;
    }): Promise<RunLog>;
    getRecentRuns(limit?: number): Promise<RunLog[]>;
}
