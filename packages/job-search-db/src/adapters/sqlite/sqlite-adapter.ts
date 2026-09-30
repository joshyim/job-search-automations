import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Candidate,
  CandidateFilters,
  CandidateStatus,
  Company,
  DataAdapter,
  QueueEntry,
  QueueStatus,
  RubricDimension,
  RunLog,
  Skill,
  TitlePattern,
  TitlePatternType,
} from '../types.js';
import { DEFAULT_RUBRIC, SQLITE_SCHEMA } from './schema.js';
import { detectAtsPlatform, normalizeAtsPlatform } from '../../ats.js';
import { validateCandidateScoreAndBreakdown, computeWeightedRubricScore, roundHalfUp } from '../../scoring.js';

export class SqliteAdapter implements DataAdapter {
  private dbPath: string;
  private resumePath?: string;
  private db: DatabaseSync | null = null;

  constructor(dbPath: string, resumePath?: string) {
    this.dbPath = dbPath;
    this.resumePath = resumePath;
  }

  public getDatabase(): DatabaseSync {
    if (!this.db) {
      throw new Error(`Database connection not initialized for ${this.dbPath}. Call initialize() first.`);
    }
    return this.db;
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public getResumePath(): string | undefined {
    return this.resumePath;
  }

  public async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(dir, 0o700);
    } catch {}

    this.db = new DatabaseSync(this.dbPath);
    try {
      fs.chmodSync(this.dbPath, 0o600);
    } catch {}

    // Enable WAL mode and foreign keys for performance and durability
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Execute schema DDL
    this.db.exec(SQLITE_SCHEMA);

    // Non-destructive migration for existing tables: ensure ats_platform column exists
    const companyCols = (this.db.prepare("PRAGMA table_info(companies)").all() as any[]).map(c => c.name);
    if (!companyCols.includes('ats_platform')) {
      this.db.exec("ALTER TABLE companies ADD COLUMN ats_platform TEXT;");
    }
    const queueCols = (this.db.prepare("PRAGMA table_info(crawl_queue)").all() as any[]).map(c => c.name);
    if (!queueCols.includes('ats_platform')) {
      this.db.exec("ALTER TABLE crawl_queue ADD COLUMN ats_platform TEXT;");
    }

    // Backfill rows where ats_platform IS NULL using detectAtsPlatform
    const unpopulatedCompanies = this.db.prepare("SELECT id, careers_url FROM companies WHERE ats_platform IS NULL").all() as any[];
    if (unpopulatedCompanies.length > 0) {
      const updateCompanyAts = this.db.prepare("UPDATE companies SET ats_platform = ? WHERE id = ?");
      for (const c of unpopulatedCompanies) {
        const detected = detectAtsPlatform(c.careers_url);
        if (detected) {
          updateCompanyAts.run(detected, c.id);
        }
      }
    }

    const unpopulatedQueue = this.db.prepare("SELECT id, url FROM crawl_queue WHERE ats_platform IS NULL").all() as any[];
    if (unpopulatedQueue.length > 0) {
      const updateQueueAts = this.db.prepare("UPDATE crawl_queue SET ats_platform = ? WHERE id = ?");
      for (const q of unpopulatedQueue) {
        const detected = detectAtsPlatform(q.url);
        if (detected) {
          updateQueueAts.run(detected, q.id);
        }
      }
    }

    // Seed default rubric if scoring_rubric is empty
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM scoring_rubric').get() as { count: number };
    if (countRow.count === 0) {
      const insertRubric = this.db.prepare(
        'INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description) VALUES (?, ?, ?, ?, ?)'
      );
      for (const item of DEFAULT_RUBRIC) {
        insertRubric.run(
          item.dimension,
          item.weight,
          item.poor_description,
          item.moderate_description,
          item.strong_description
        );
      }
    }

    // Non-destructive migration for legacy skill importance values ('core' -> 'P1', 'preferred' -> 'P2')
    const legacySkills = (this.db.prepare("SELECT COUNT(*) as count FROM skills WHERE LOWER(importance) IN ('core', 'preferred')").get() as any)?.count || 0;
    if (legacySkills > 0) {
      const p1Res = this.db.prepare("UPDATE skills SET importance = 'P1' WHERE LOWER(importance) = 'core'").run();
      const p2Res = this.db.prepare("UPDATE skills SET importance = 'P2' WHERE LOWER(importance) = 'preferred'").run();
      const totalMigrated = (Number(p1Res.changes) || 0) + (Number(p2Res.changes) || 0);
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        now,
        'local',
        '[]',
        0,
        0,
        `Migrated ${totalMigrated} legacy skill importance records to P1/P2`,
        JSON.stringify({
          migration: 'skills_importance_p1_p2',
          core_to_p1: Number(p1Res.changes) || 0,
          preferred_to_p2: Number(p2Res.changes) || 0,
        })
      );
    }

    // Non-destructive auditable migration for legacy 1-5 candidate rubric breakdowns (PRO-71)
    const candidatesWithBreakdown = this.db.prepare(
      'SELECT id, job_title, company_name, url, score, breakdown FROM candidates WHERE breakdown IS NOT NULL'
    ).all() as any[];

    const legacyOneToFive: Array<{ id: number; url: string; oldScore: number; newScore: number; oldBreakdown: Record<string, number>; newBreakdown: Record<string, number> }> = [];
    const rubricDimensions = await this.getScoringRubric();

    for (const c of candidatesWithBreakdown) {
      try {
        const b = typeof c.breakdown === 'string' ? JSON.parse(c.breakdown) : c.breakdown;
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        const vals = Object.values(b) as number[];
        if (vals.length > 0 && vals.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 5.0)) {
          // Unambiguously 1-5 rubric scale
          const newBreakdown: Record<string, number> = {};
          for (const [k, v] of Object.entries(b)) {
            newBreakdown[k] = roundHalfUp((Number(v) / 5.0) * 100, 1);
          }
          const { expectedScore } = computeWeightedRubricScore(newBreakdown, rubricDimensions);
          legacyOneToFive.push({
            id: c.id,
            url: c.url,
            oldScore: c.score,
            newScore: expectedScore,
            oldBreakdown: b,
            newBreakdown,
          });
        }
      } catch {}
    }

    if (legacyOneToFive.length > 0) {
      const updateCandidate = this.db.prepare('UPDATE candidates SET score = ?, breakdown = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      for (const item of legacyOneToFive) {
        updateCandidate.run(item.newScore, JSON.stringify(item.newBreakdown), now, item.id);
      }
      this.db.prepare(`
        INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        now,
        'local',
        '[]',
        0,
        legacyOneToFive.length,
        `Migrated ${legacyOneToFive.length} legacy 1-5 candidate rubric breakdowns to canonical 0-100 percentage scale`,
        JSON.stringify({
          migration: 'historical_1_5_to_0_100',
          records_converted: legacyOneToFive.length,
          changes: legacyOneToFive.map(i => ({ id: i.id, url: i.url, oldScore: i.oldScore, newScore: i.newScore })),
        })
      );
    }

    // Enroll historical candidates without breakdowns into crawl_queue with status 'pending' (PRO-71)
    const unscoredCandidates = this.db.prepare(
      'SELECT id, company_name, url FROM candidates WHERE breakdown IS NULL'
    ).all() as any[];

    if (unscoredCandidates.length > 0) {
      const checkQueue = this.db.prepare('SELECT id, status FROM crawl_queue WHERE LOWER(url) = LOWER(?)');
      const insertQueue = this.db.prepare(`
        INSERT INTO crawl_queue (url, company_name, ats_platform, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `);
      const updateQueue = this.db.prepare('UPDATE crawl_queue SET status = ?, notes = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      let queuedCount = 0;

      for (const c of unscoredCandidates) {
        const q = checkQueue.get(c.url) as any;
        if (!q) {
          insertQueue.run(
            c.url,
            c.company_name,
            detectAtsPlatform(c.url) || null,
            'Pending assessment flow to generate canonical rubric breakdown and score',
            now,
            now
          );
          queuedCount++;
        } else if (q.status !== 'pending') {
          updateQueue.run(
            'pending',
            'Pending assessment flow to generate canonical rubric breakdown and score',
            now,
            q.id
          );
          queuedCount++;
        }
      }

      if (queuedCount > 0) {
        this.db.prepare(`
          INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          now,
          'local',
          '[]',
          queuedCount,
          0,
          `Enrolled ${queuedCount} candidates without breakdowns into crawl queue for fresh assessment flow`,
          JSON.stringify({
            migration: 'enroll_unscored_into_assessment_flow',
            records_enrolled: queuedCount,
          })
        );
      }
    }
  }

  public async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore errors on close if already closed
      }
      this.db = null;
    }
  }

  // --- Companies ---

  public async listCompanies(includeExcluded = false): Promise<Company[]> {
    const db = this.getDatabase();
    let query = 'SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies';
    if (!includeExcluded) {
      query += ' WHERE is_excluded = 0';
    }
    query += ' ORDER BY name ASC';

    const rows = db.prepare(query).all() as any[];
    return rows.map((r) => ({
      ...r,
      ats_platform: r.ats_platform ?? null,
      is_excluded: Boolean(r.is_excluded),
    }));
  }

  public async addCompany(data: {
    name: string;
    careers_url: string;
    ats_platform?: string;
    notes?: string;
    last_searched_at?: string;
  }): Promise<Company> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(data.name) as any;

    const atsPlatform = normalizeAtsPlatform(data.ats_platform) ?? detectAtsPlatform(data.careers_url);

    if (existing) {
      const notes = data.notes !== undefined ? data.notes : existing.notes;
      const lastSearchedAt = data.last_searched_at !== undefined ? data.last_searched_at : existing.last_searched_at;
      const effectiveAtsPlatform = data.ats_platform !== undefined ? atsPlatform : (existing.ats_platform ?? atsPlatform);
      const now = new Date().toISOString();

      db.prepare(
        'UPDATE companies SET careers_url = ?, ats_platform = ?, notes = ?, last_searched_at = ?, updated_at = ? WHERE id = ?'
      ).run(data.careers_url, effectiveAtsPlatform ?? null, notes ?? null, lastSearchedAt ?? null, now, existing.id);

      const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id) as any;
      return {
        ...updated,
        ats_platform: updated.ats_platform ?? null,
        is_excluded: Boolean(updated.is_excluded),
      };
    }

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO companies (name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)'
    ).run(data.name, data.careers_url, atsPlatform ?? null, data.notes ?? null, data.last_searched_at ?? null, now, now);

    const inserted = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(result.lastInsertRowid) as any;
    return {
      ...inserted,
      ats_platform: inserted.ats_platform ?? null,
      is_excluded: Boolean(inserted.is_excluded),
    };
  }

  public async updateCompany(currentName: string, updates: Partial<Company>): Promise<Company> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(currentName) as any;

    if (!existing) {
      throw new Error(`Company not found: ${currentName}`);
    }

    const name = updates.name !== undefined ? updates.name : existing.name;
    const careersUrl = updates.careers_url !== undefined ? updates.careers_url : existing.careers_url;
    let atsPlatform = existing.ats_platform;
    if (updates.ats_platform !== undefined) {
      atsPlatform = normalizeAtsPlatform(updates.ats_platform);
    } else if (updates.careers_url !== undefined && updates.careers_url !== existing.careers_url) {
      atsPlatform = detectAtsPlatform(updates.careers_url) ?? atsPlatform;
    }
    const isExcluded = updates.is_excluded !== undefined ? (updates.is_excluded ? 1 : 0) : existing.is_excluded;
    const notes = updates.notes !== undefined ? updates.notes : existing.notes;
    const lastSearchedAt = updates.last_searched_at !== undefined ? updates.last_searched_at : existing.last_searched_at;
    const now = new Date().toISOString();

    db.prepare(
      'UPDATE companies SET name = ?, careers_url = ?, ats_platform = ?, is_excluded = ?, notes = ?, last_searched_at = ?, updated_at = ? WHERE id = ?'
    ).run(name, careersUrl, atsPlatform ?? null, isExcluded, notes ?? null, lastSearchedAt ?? null, now, existing.id);

    const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id) as any;
    return {
      ...updated,
      ats_platform: updated.ats_platform ?? null,
      is_excluded: Boolean(updated.is_excluded),
    };
  }

  public async excludeCompany(name: string, reason?: string): Promise<Company> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(name) as any;

    if (!existing) {
      throw new Error(`Company not found: ${name}`);
    }

    let combinedNotes = existing.notes || '';
    if (reason) {
      combinedNotes = combinedNotes ? `${combinedNotes} | Excluded: ${reason}` : `Excluded: ${reason}`;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE companies SET is_excluded = 1, notes = ?, updated_at = ? WHERE id = ?'
    ).run(combinedNotes, now, existing.id);

    const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id) as any;
    return {
      ...updated,
      ats_platform: updated.ats_platform ?? null,
      is_excluded: true,
    };
  }

  public async getBatch(limit = 5): Promise<Company[]> {
    const db = this.getDatabase();
    // Prioritize companies where last_searched_at is NULL, then oldest last_searched_at
    const query = `
      SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at
      FROM companies
      WHERE is_excluded = 0
      ORDER BY (last_searched_at IS NOT NULL) ASC, last_searched_at ASC, id ASC
      LIMIT ?
    `;

    const rows = db.prepare(query).all(limit) as any[];
    // Stamp last_searched_at now, atomically with selection, so a batch is never
    // re-selected on the next call regardless of whether the caller remembers to
    // report back on how processing went. Callers that later learn more (e.g. a
    // failure reason) can still call updateCompany to add notes.
    if (rows.length > 0) {
      const now = new Date().toISOString();
      const stamp = db.prepare('UPDATE companies SET last_searched_at = ?, updated_at = ? WHERE id = ?');
      for (const row of rows) {
        stamp.run(now, now, row.id);
        row.last_searched_at = now;
        row.updated_at = now;
      }
    }
    return rows.map((r) => ({
      ...r,
      is_excluded: Boolean(r.is_excluded),
    }));
  }

  // --- Title Patterns ---

  public async listTitlePatterns(type?: TitlePatternType): Promise<TitlePattern[]> {
    const db = this.getDatabase();
    let query = 'SELECT id, pattern, type, level, notes, created_at FROM title_patterns';
    const params: any[] = [];
    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }
    query += ' ORDER BY id ASC';

    return (db.prepare(query).all(...params) as unknown) as TitlePattern[];
  }

  public async addTitlePattern(data: {
    pattern: string;
    type: TitlePatternType;
    level?: string;
    notes?: string;
  }): Promise<TitlePattern> {
    const db = this.getDatabase();
    const existing = db.prepare(
      'SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE LOWER(pattern) = LOWER(?) AND type = ?'
    ).get(data.pattern, data.type) as any;

    if (existing) {
      const level = data.level !== undefined ? data.level : existing.level;
      const notes = data.notes !== undefined ? data.notes : existing.notes;
      db.prepare('UPDATE title_patterns SET level = ?, notes = ? WHERE id = ?').run(level ?? null, notes ?? null, existing.id);
      return (db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(existing.id) as unknown) as TitlePattern;
    }

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO title_patterns (pattern, type, level, notes, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(data.pattern, data.type, data.level ?? null, data.notes ?? null, now);

    return (db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(result.lastInsertRowid) as unknown) as TitlePattern;
  }

  public async updateTitlePattern(
    pattern: string,
    type: TitlePatternType,
    updates: Partial<TitlePattern>
  ): Promise<TitlePattern> {
    const db = this.getDatabase();
    const existing = db.prepare(
      'SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE LOWER(pattern) = LOWER(?) AND type = ?'
    ).get(pattern, type) as any;

    if (!existing) {
      throw new Error(`Title pattern not found: ${pattern} (${type})`);
    }

    const newPattern = updates.pattern !== undefined ? updates.pattern : existing.pattern;
    const newType = updates.type !== undefined ? updates.type : existing.type;
    const newLevel = updates.level !== undefined ? updates.level : existing.level;
    const newNotes = updates.notes !== undefined ? updates.notes : existing.notes;

    db.prepare(
      'UPDATE title_patterns SET pattern = ?, type = ?, level = ?, notes = ? WHERE id = ?'
    ).run(newPattern, newType, newLevel ?? null, newNotes ?? null, existing.id);

    return (db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(existing.id) as unknown) as TitlePattern;
  }

  public async removeTitlePattern(pattern: string, type?: TitlePatternType): Promise<boolean> {
    const db = this.getDatabase();
    let query = 'DELETE FROM title_patterns WHERE LOWER(pattern) = LOWER(?)';
    const params: any[] = [pattern];
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    const result = db.prepare(query).run(...params);
    return result.changes > 0;
  }

  // --- Skills ---

  public async listSkills(category?: string): Promise<Skill[]> {
    const db = this.getDatabase();
    let query = 'SELECT id, name, category, importance, notes, created_at FROM skills';
    const params: any[] = [];
    if (category) {
      query += ' WHERE LOWER(category) = LOWER(?)';
      params.push(category);
    }
    query += ' ORDER BY id ASC';

    return (db.prepare(query).all(...params) as unknown) as Skill[];
  }

  private normalizeSkillImportance(importance?: string | null): string {
    if (!importance) return 'P2';
    const lower = importance.trim().toLowerCase();
    if (lower === 'core' || lower === 'p1') return 'P1';
    if (lower === 'preferred' || lower === 'p2') return 'P2';
    return importance.trim();
  }

  public async addSkill(data: {
    name: string;
    category?: string;
    importance?: string;
    notes?: string;
  }): Promise<Skill> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE LOWER(name) = LOWER(?)').get(data.name) as any;

    if (existing) {
      const cat = data.category !== undefined ? data.category : existing.category;
      const imp = data.importance !== undefined ? this.normalizeSkillImportance(data.importance) : existing.importance;
      const notes = data.notes !== undefined ? data.notes : existing.notes;
      db.prepare('UPDATE skills SET category = ?, importance = ?, notes = ? WHERE id = ?').run(cat ?? null, imp ?? null, notes ?? null, existing.id);
      return (db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(existing.id) as unknown) as Skill;
    }

    const now = new Date().toISOString();
    const imp = this.normalizeSkillImportance(data.importance);
    const result = db.prepare(
      'INSERT INTO skills (name, category, importance, notes, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(data.name, data.category ?? null, imp, data.notes ?? null, now);

    return (db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(result.lastInsertRowid) as unknown) as Skill;
  }

  public async updateSkill(name: string, updates: Partial<Skill>): Promise<Skill> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE LOWER(name) = LOWER(?)').get(name) as any;

    if (!existing) {
      throw new Error(`Skill not found: ${name}`);
    }

    const newName = updates.name !== undefined ? updates.name : existing.name;
    const cat = updates.category !== undefined ? updates.category : existing.category;
    const imp = updates.importance !== undefined ? this.normalizeSkillImportance(updates.importance) : existing.importance;
    const notes = updates.notes !== undefined ? updates.notes : existing.notes;

    db.prepare('UPDATE skills SET name = ?, category = ?, importance = ?, notes = ? WHERE id = ?').run(newName, cat ?? null, imp ?? null, notes ?? null, existing.id);
    return (db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(existing.id) as unknown) as Skill;
  }

  public async removeSkill(name: string): Promise<boolean> {
    const db = this.getDatabase();
    const result = db.prepare('DELETE FROM skills WHERE LOWER(name) = LOWER(?)').run(name);
    return result.changes > 0;
  }

  // --- Rubric ---

  public async getScoringRubric(): Promise<RubricDimension[]> {
    const db = this.getDatabase();
    return (db.prepare(
      'SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric ORDER BY id ASC'
    ).all() as unknown) as RubricDimension[];
  }

  public async updateRubricDimension(
    dimension: string,
    updates: Partial<RubricDimension>
  ): Promise<RubricDimension> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').get(dimension) as any;

    if (!existing) {
      throw new Error(`Rubric dimension not found: ${dimension}`);
    }

    const newDim = updates.dimension !== undefined ? updates.dimension : existing.dimension;
    const weight = updates.weight !== undefined ? updates.weight : existing.weight;
    const poor = updates.poor_description !== undefined ? updates.poor_description : existing.poor_description;
    const mod = updates.moderate_description !== undefined ? updates.moderate_description : existing.moderate_description;
    const strong = updates.strong_description !== undefined ? updates.strong_description : existing.strong_description;
    const now = new Date().toISOString();

    db.prepare(
      'UPDATE scoring_rubric SET dimension = ?, weight = ?, poor_description = ?, moderate_description = ?, strong_description = ?, updated_at = ? WHERE id = ?'
    ).run(newDim, weight, poor ?? null, mod ?? null, strong ?? null, now, existing.id);

    return (db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric WHERE id = ?').get(existing.id) as unknown) as RubricDimension;
  }

  public async addRubricDimension(dimension: RubricDimension): Promise<RubricDimension> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').get(dimension.dimension) as any;

    if (existing) {
      return this.updateRubricDimension(dimension.dimension, dimension);
    }

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      dimension.dimension,
      dimension.weight,
      dimension.poor_description ?? null,
      dimension.moderate_description ?? null,
      dimension.strong_description ?? null,
      now,
      now
    );

    return (db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric WHERE id = ?').get(result.lastInsertRowid) as unknown) as RubricDimension;
  }

  public async removeRubricDimension(dimension: string): Promise<boolean> {
    const db = this.getDatabase();
    const result = db.prepare('DELETE FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').run(dimension);
    return result.changes > 0;
  }

  // --- Crawl Queue ---

  public async checkUrlExists(url: string): Promise<{ exists: boolean; entry?: QueueEntry }> {
    const db = this.getDatabase();
    const row = (db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(url) as unknown) as QueueEntry | undefined;
    return {
      exists: Boolean(row),
      entry: row ? { ...row, ats_platform: row.ats_platform ?? null } : undefined,
    };
  }

  public async addToQueue(data: {
    url: string;
    company_name: string;
    ats_platform?: string;
    notes?: string;
  }): Promise<QueueEntry> {
    const db = this.getDatabase();
    const existing = (db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(data.url) as unknown) as QueueEntry | undefined;

    const atsPlatform = normalizeAtsPlatform(data.ats_platform) ?? detectAtsPlatform(data.url);

    if (existing) {
      if (!existing.ats_platform && atsPlatform && existing.id !== undefined) {
        db.prepare('UPDATE crawl_queue SET ats_platform = ? WHERE id = ?').run(atsPlatform, existing.id);
        existing.ats_platform = atsPlatform;
      }
      return {
        ...existing,
        ats_platform: existing.ats_platform ?? null,
      };
    }

    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO crawl_queue (url, company_name, ats_platform, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(data.url, data.company_name, atsPlatform ?? null, 'pending', data.notes ?? null, now, now);

    const inserted = (db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE id = ?').get(result.lastInsertRowid) as unknown) as QueueEntry;
    return {
      ...inserted,
      ats_platform: inserted.ats_platform ?? null,
    };
  }

  public async getPendingQueue(companyName?: string, limit = 50): Promise<QueueEntry[]> {
    const db = this.getDatabase();
    let query = "SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE status = 'pending'";
    const params: any[] = [];
    if (companyName) {
      query += ' AND LOWER(company_name) = LOWER(?)';
      params.push(companyName);
    }
    query += ' ORDER BY id ASC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      ats_platform: r.ats_platform ?? null,
    })) as QueueEntry[];
  }

  public async listQueue(filters?: {
    status?: QueueStatus;
    company_name?: string;
    ats_platform?: string;
    limit?: number;
  }): Promise<QueueEntry[]> {
    const db = this.getDatabase();
    let query = 'SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.company_name) {
      conditions.push('LOWER(company_name) = LOWER(?)');
      params.push(filters.company_name);
    }
    if (filters?.ats_platform) {
      conditions.push('LOWER(ats_platform) = LOWER(?)');
      params.push(filters.ats_platform);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY id ASC';
    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      ats_platform: r.ats_platform ?? null,
    })) as QueueEntry[];
  }

  public async updateQueueStatus(
    url: string,
    status: QueueStatus,
    notes?: string
  ): Promise<QueueEntry> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, notes FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(url) as any;

    if (!existing) {
      throw new Error(`Queue entry not found for URL: ${url}`);
    }

    const updatedNotes = notes !== undefined ? notes : existing.notes;
    const now = new Date().toISOString();

    db.prepare('UPDATE crawl_queue SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
      status,
      updatedNotes ?? null,
      now,
      existing.id
    );

    const updated = (db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE id = ?').get(existing.id) as unknown) as QueueEntry;
    return {
      ...updated,
      ats_platform: updated.ats_platform ?? null,
    };
  }

  // --- Candidates ---

  public async addCandidate(data: {
    company_name: string;
    job_title: string;
    url: string;
    location?: string;
    score?: number;
    breakdown?: Record<string, number>;
    notes?: string;
    status?: CandidateStatus;
  }): Promise<Candidate> {
    const db = this.getDatabase();
    const rubric = await this.getScoringRubric();
    const validated = validateCandidateScoreAndBreakdown(data, rubric);

    const existing = db.prepare('SELECT id FROM candidates WHERE LOWER(url) = LOWER(?)').get(data.url) as any;
    const breakdownJson = validated.breakdown ? JSON.stringify(validated.breakdown) : null;
    const now = new Date().toISOString();

    let candidateRowId: number | bigint;

    if (existing) {
      db.prepare(`
        UPDATE candidates
        SET company_name = ?, job_title = ?, location = ?, score = ?, breakdown = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        data.company_name,
        data.job_title,
        data.location ?? null,
        validated.score,
        breakdownJson,
        data.status ?? 'new',
        data.notes ?? null,
        now,
        existing.id
      );
      candidateRowId = existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO candidates (company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.company_name,
        data.job_title,
        data.url,
        data.location ?? null,
        validated.score,
        breakdownJson,
        data.status ?? 'new',
        data.notes ?? null,
        now,
        now
      );
      candidateRowId = result.lastInsertRowid;
    }

    // Handle queue integration & assessment flow triggering
    const existingQueue = db.prepare('SELECT id, status FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(data.url) as any;
    if (validated.needsAssessment) {
      // Trigger assessment flow by ensuring entry is pending in crawl_queue
      const note = data.score !== undefined && data.score !== null
        ? 'Pending assessment flow to generate breakdown and update score'
        : 'Pending initial rubric assessment';
      if (!existingQueue) {
        db.prepare(`
          INSERT INTO crawl_queue (url, company_name, ats_platform, status, notes, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?, ?)
        `).run(
          data.url,
          data.company_name,
          detectAtsPlatform(data.url) || null,
          note,
          now,
          now
        );
      } else if (existingQueue.status !== 'pending') {
        db.prepare('UPDATE crawl_queue SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
          'pending',
          note,
          now,
          existingQueue.id
        );
      }
    } else {
      // Assessment completed with full breakdown: mark queue entry assessed if pending
      if (existingQueue && existingQueue.status === 'pending') {
        db.prepare('UPDATE crawl_queue SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
          'assessed',
          `Scored ${validated.score !== null ? validated.score : ''}`.trim(),
          now,
          existingQueue.id
        );
      }
    }

    const row = db.prepare('SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates WHERE id = ?').get(candidateRowId) as any;
    return {
      ...row,
      breakdown: row.breakdown ? JSON.parse(row.breakdown) : null,
    };
  }

  public async updateCandidateStatus(
    url: string,
    status: CandidateStatus,
    notes?: string
  ): Promise<Candidate> {
    const db = this.getDatabase();
    const existing = db.prepare('SELECT id, notes FROM candidates WHERE LOWER(url) = LOWER(?)').get(url) as any;

    if (!existing) {
      throw new Error(`Candidate not found for URL: ${url}`);
    }

    const now = new Date().toISOString();
    const appliedAt = status === 'applied' ? now : undefined;
    const updatedNotes = notes !== undefined ? notes : existing.notes;

    let updateQuery = 'UPDATE candidates SET status = ?, notes = ?, updated_at = ?';
    const params: any[] = [status, updatedNotes ?? null, now];

    if (appliedAt !== undefined) {
      updateQuery += ', applied_at = ?';
      params.push(appliedAt);
    }
    updateQuery += ' WHERE id = ?';
    params.push(existing.id);

    db.prepare(updateQuery).run(...params);

    const row = db.prepare('SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates WHERE id = ?').get(existing.id) as any;
    return {
      ...row,
      breakdown: row.breakdown ? JSON.parse(row.breakdown) : null,
    };
  }

  public async getCandidates(filters?: CandidateFilters): Promise<Candidate[]> {
    const db = this.getDatabase();
    let query = 'SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates';
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.company_name) {
      conditions.push('LOWER(company_name) = LOWER(?)');
      params.push(filters.company_name);
    }
    if (filters?.min_score !== undefined) {
      conditions.push('score >= ?');
      params.push(filters.min_score);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const sortBy = filters?.sort_by === 'discovered_at' ? 'discovered_at' : 'score';
    const sortOrder = filters?.sort_order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortBy} ${sortOrder} NULLS LAST, id DESC`;

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      ...r,
      breakdown: r.breakdown ? JSON.parse(r.breakdown) : null,
    }));
  }

  // --- Run Logs ---

  public async logRun(data: {
    companies_processed: string[];
    urls_queued: number;
    candidates_scored: number;
    summary?: string;
    details?: Record<string, unknown>;
  }): Promise<RunLog> {
    const db = this.getDatabase();
    const now = new Date().toISOString();
    const companiesJson = JSON.stringify(data.companies_processed || []);
    const detailsJson = JSON.stringify(data.details || {});

    const result = db.prepare(`
      INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      now,
      'local',
      companiesJson,
      data.urls_queued,
      data.candidates_scored,
      data.summary ?? null,
      detailsJson
    );

    const row = db.prepare('SELECT id, timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details FROM run_logs WHERE id = ?').get(result.lastInsertRowid) as any;
    return {
      ...row,
      companies_processed: JSON.parse(row.companies_processed),
      details: row.details ? JSON.parse(row.details) : {},
    };
  }

  public async getRecentRuns(limit = 10): Promise<RunLog[]> {
    const db = this.getDatabase();
    const rows = db.prepare(
      'SELECT id, timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details FROM run_logs ORDER BY id DESC LIMIT ?'
    ).all(limit) as any[];

    return rows.map((r) => ({
      ...r,
      companies_processed: JSON.parse(r.companies_processed),
      details: r.details ? JSON.parse(r.details) : {},
    }));
  }
}
