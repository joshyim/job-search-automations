import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RUBRIC, SQLITE_SCHEMA } from './schema.js';
import { detectAtsPlatform, normalizeAtsPlatform } from '../../ats.js';
export class SqliteAdapter {
    dbPath;
    resumePath;
    db = null;
    constructor(dbPath, resumePath) {
        this.dbPath = dbPath;
        this.resumePath = resumePath;
    }
    getDatabase() {
        if (!this.db) {
            throw new Error(`Database connection not initialized for ${this.dbPath}. Call initialize() first.`);
        }
        return this.db;
    }
    getDbPath() {
        return this.dbPath;
    }
    getResumePath() {
        return this.resumePath;
    }
    async initialize() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        try {
            fs.chmodSync(dir, 0o700);
        }
        catch { }
        this.db = new DatabaseSync(this.dbPath);
        try {
            fs.chmodSync(this.dbPath, 0o600);
        }
        catch { }
        // Enable WAL mode and foreign keys for performance and durability
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA foreign_keys = ON;');
        // Execute schema DDL
        this.db.exec(SQLITE_SCHEMA);
        // Non-destructive migration for existing tables: ensure ats_platform column exists
        const companyCols = this.db.prepare("PRAGMA table_info(companies)").all().map(c => c.name);
        if (!companyCols.includes('ats_platform')) {
            this.db.exec("ALTER TABLE companies ADD COLUMN ats_platform TEXT;");
        }
        const queueCols = this.db.prepare("PRAGMA table_info(crawl_queue)").all().map(c => c.name);
        if (!queueCols.includes('ats_platform')) {
            this.db.exec("ALTER TABLE crawl_queue ADD COLUMN ats_platform TEXT;");
        }
        // Backfill rows where ats_platform IS NULL using detectAtsPlatform
        const unpopulatedCompanies = this.db.prepare("SELECT id, careers_url FROM companies WHERE ats_platform IS NULL").all();
        if (unpopulatedCompanies.length > 0) {
            const updateCompanyAts = this.db.prepare("UPDATE companies SET ats_platform = ? WHERE id = ?");
            for (const c of unpopulatedCompanies) {
                const detected = detectAtsPlatform(c.careers_url);
                if (detected) {
                    updateCompanyAts.run(detected, c.id);
                }
            }
        }
        const unpopulatedQueue = this.db.prepare("SELECT id, url FROM crawl_queue WHERE ats_platform IS NULL").all();
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
        const countRow = this.db.prepare('SELECT COUNT(*) as count FROM scoring_rubric').get();
        if (countRow.count === 0) {
            const insertRubric = this.db.prepare('INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description) VALUES (?, ?, ?, ?, ?)');
            for (const item of DEFAULT_RUBRIC) {
                insertRubric.run(item.dimension, item.weight, item.poor_description, item.moderate_description, item.strong_description);
            }
        }
    }
    async close() {
        if (this.db) {
            try {
                this.db.close();
            }
            catch {
                // Ignore errors on close if already closed
            }
            this.db = null;
        }
    }
    // --- Companies ---
    async listCompanies(includeExcluded = false) {
        const db = this.getDatabase();
        let query = 'SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies';
        if (!includeExcluded) {
            query += ' WHERE is_excluded = 0';
        }
        query += ' ORDER BY name ASC';
        const rows = db.prepare(query).all();
        return rows.map((r) => ({
            ...r,
            ats_platform: r.ats_platform ?? null,
            is_excluded: Boolean(r.is_excluded),
        }));
    }
    async addCompany(data) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(data.name);
        const atsPlatform = normalizeAtsPlatform(data.ats_platform) ?? detectAtsPlatform(data.careers_url);
        if (existing) {
            const notes = data.notes !== undefined ? data.notes : existing.notes;
            const lastSearchedAt = data.last_searched_at !== undefined ? data.last_searched_at : existing.last_searched_at;
            const effectiveAtsPlatform = data.ats_platform !== undefined ? atsPlatform : (existing.ats_platform ?? atsPlatform);
            const now = new Date().toISOString();
            db.prepare('UPDATE companies SET careers_url = ?, ats_platform = ?, notes = ?, last_searched_at = ?, updated_at = ? WHERE id = ?').run(data.careers_url, effectiveAtsPlatform ?? null, notes ?? null, lastSearchedAt ?? null, now, existing.id);
            const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id);
            return {
                ...updated,
                ats_platform: updated.ats_platform ?? null,
                is_excluded: Boolean(updated.is_excluded),
            };
        }
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO companies (name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)').run(data.name, data.careers_url, atsPlatform ?? null, data.notes ?? null, data.last_searched_at ?? null, now, now);
        const inserted = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(result.lastInsertRowid);
        return {
            ...inserted,
            ats_platform: inserted.ats_platform ?? null,
            is_excluded: Boolean(inserted.is_excluded),
        };
    }
    async updateCompany(currentName, updates) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(currentName);
        if (!existing) {
            throw new Error(`Company not found: ${currentName}`);
        }
        const name = updates.name !== undefined ? updates.name : existing.name;
        const careersUrl = updates.careers_url !== undefined ? updates.careers_url : existing.careers_url;
        let atsPlatform = existing.ats_platform;
        if (updates.ats_platform !== undefined) {
            atsPlatform = normalizeAtsPlatform(updates.ats_platform);
        }
        else if (updates.careers_url !== undefined && updates.careers_url !== existing.careers_url) {
            atsPlatform = detectAtsPlatform(updates.careers_url) ?? atsPlatform;
        }
        const isExcluded = updates.is_excluded !== undefined ? (updates.is_excluded ? 1 : 0) : existing.is_excluded;
        const notes = updates.notes !== undefined ? updates.notes : existing.notes;
        const lastSearchedAt = updates.last_searched_at !== undefined ? updates.last_searched_at : existing.last_searched_at;
        const now = new Date().toISOString();
        db.prepare('UPDATE companies SET name = ?, careers_url = ?, ats_platform = ?, is_excluded = ?, notes = ?, last_searched_at = ?, updated_at = ? WHERE id = ?').run(name, careersUrl, atsPlatform ?? null, isExcluded, notes ?? null, lastSearchedAt ?? null, now, existing.id);
        const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id);
        return {
            ...updated,
            ats_platform: updated.ats_platform ?? null,
            is_excluded: Boolean(updated.is_excluded),
        };
    }
    async excludeCompany(name, reason) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE LOWER(name) = LOWER(?)').get(name);
        if (!existing) {
            throw new Error(`Company not found: ${name}`);
        }
        let combinedNotes = existing.notes || '';
        if (reason) {
            combinedNotes = combinedNotes ? `${combinedNotes} | Excluded: ${reason}` : `Excluded: ${reason}`;
        }
        const now = new Date().toISOString();
        db.prepare('UPDATE companies SET is_excluded = 1, notes = ?, updated_at = ? WHERE id = ?').run(combinedNotes, now, existing.id);
        const updated = db.prepare('SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at FROM companies WHERE id = ?').get(existing.id);
        return {
            ...updated,
            ats_platform: updated.ats_platform ?? null,
            is_excluded: true,
        };
    }
    async getBatch(limit = 5) {
        const db = this.getDatabase();
        // Prioritize companies where last_searched_at is NULL, then oldest last_searched_at
        const query = `
      SELECT id, name, careers_url, ats_platform, is_excluded, notes, last_searched_at, created_at, updated_at
      FROM companies
      WHERE is_excluded = 0
      ORDER BY (last_searched_at IS NOT NULL) ASC, last_searched_at ASC, id ASC
      LIMIT ?
    `;
        const rows = db.prepare(query).all(limit);
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
    async listTitlePatterns(type) {
        const db = this.getDatabase();
        let query = 'SELECT id, pattern, type, level, notes, created_at FROM title_patterns';
        const params = [];
        if (type) {
            query += ' WHERE type = ?';
            params.push(type);
        }
        query += ' ORDER BY id ASC';
        return db.prepare(query).all(...params);
    }
    async addTitlePattern(data) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE LOWER(pattern) = LOWER(?) AND type = ?').get(data.pattern, data.type);
        if (existing) {
            const level = data.level !== undefined ? data.level : existing.level;
            const notes = data.notes !== undefined ? data.notes : existing.notes;
            db.prepare('UPDATE title_patterns SET level = ?, notes = ? WHERE id = ?').run(level ?? null, notes ?? null, existing.id);
            return db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(existing.id);
        }
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO title_patterns (pattern, type, level, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(data.pattern, data.type, data.level ?? null, data.notes ?? null, now);
        return db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(result.lastInsertRowid);
    }
    async updateTitlePattern(pattern, type, updates) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE LOWER(pattern) = LOWER(?) AND type = ?').get(pattern, type);
        if (!existing) {
            throw new Error(`Title pattern not found: ${pattern} (${type})`);
        }
        const newPattern = updates.pattern !== undefined ? updates.pattern : existing.pattern;
        const newType = updates.type !== undefined ? updates.type : existing.type;
        const newLevel = updates.level !== undefined ? updates.level : existing.level;
        const newNotes = updates.notes !== undefined ? updates.notes : existing.notes;
        db.prepare('UPDATE title_patterns SET pattern = ?, type = ?, level = ?, notes = ? WHERE id = ?').run(newPattern, newType, newLevel ?? null, newNotes ?? null, existing.id);
        return db.prepare('SELECT id, pattern, type, level, notes, created_at FROM title_patterns WHERE id = ?').get(existing.id);
    }
    async removeTitlePattern(pattern, type) {
        const db = this.getDatabase();
        let query = 'DELETE FROM title_patterns WHERE LOWER(pattern) = LOWER(?)';
        const params = [pattern];
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        const result = db.prepare(query).run(...params);
        return result.changes > 0;
    }
    // --- Skills ---
    async listSkills(category) {
        const db = this.getDatabase();
        let query = 'SELECT id, name, category, importance, notes, created_at FROM skills';
        const params = [];
        if (category) {
            query += ' WHERE LOWER(category) = LOWER(?)';
            params.push(category);
        }
        query += ' ORDER BY id ASC';
        return db.prepare(query).all(...params);
    }
    async addSkill(data) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE LOWER(name) = LOWER(?)').get(data.name);
        if (existing) {
            const cat = data.category !== undefined ? data.category : existing.category;
            const imp = data.importance !== undefined ? data.importance : existing.importance;
            const notes = data.notes !== undefined ? data.notes : existing.notes;
            db.prepare('UPDATE skills SET category = ?, importance = ?, notes = ? WHERE id = ?').run(cat ?? null, imp ?? null, notes ?? null, existing.id);
            return db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(existing.id);
        }
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO skills (name, category, importance, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(data.name, data.category ?? null, data.importance ?? 'preferred', data.notes ?? null, now);
        return db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(result.lastInsertRowid);
    }
    async updateSkill(name, updates) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE LOWER(name) = LOWER(?)').get(name);
        if (!existing) {
            throw new Error(`Skill not found: ${name}`);
        }
        const newName = updates.name !== undefined ? updates.name : existing.name;
        const cat = updates.category !== undefined ? updates.category : existing.category;
        const imp = updates.importance !== undefined ? updates.importance : existing.importance;
        const notes = updates.notes !== undefined ? updates.notes : existing.notes;
        db.prepare('UPDATE skills SET name = ?, category = ?, importance = ?, notes = ? WHERE id = ?').run(newName, cat ?? null, imp ?? null, notes ?? null, existing.id);
        return db.prepare('SELECT id, name, category, importance, notes, created_at FROM skills WHERE id = ?').get(existing.id);
    }
    async removeSkill(name) {
        const db = this.getDatabase();
        const result = db.prepare('DELETE FROM skills WHERE LOWER(name) = LOWER(?)').run(name);
        return result.changes > 0;
    }
    // --- Rubric ---
    async getScoringRubric() {
        const db = this.getDatabase();
        return db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric ORDER BY id ASC').all();
    }
    async updateRubricDimension(dimension, updates) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').get(dimension);
        if (!existing) {
            throw new Error(`Rubric dimension not found: ${dimension}`);
        }
        const newDim = updates.dimension !== undefined ? updates.dimension : existing.dimension;
        const weight = updates.weight !== undefined ? updates.weight : existing.weight;
        const poor = updates.poor_description !== undefined ? updates.poor_description : existing.poor_description;
        const mod = updates.moderate_description !== undefined ? updates.moderate_description : existing.moderate_description;
        const strong = updates.strong_description !== undefined ? updates.strong_description : existing.strong_description;
        const now = new Date().toISOString();
        db.prepare('UPDATE scoring_rubric SET dimension = ?, weight = ?, poor_description = ?, moderate_description = ?, strong_description = ?, updated_at = ? WHERE id = ?').run(newDim, weight, poor ?? null, mod ?? null, strong ?? null, now, existing.id);
        return db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric WHERE id = ?').get(existing.id);
    }
    async addRubricDimension(dimension) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').get(dimension.dimension);
        if (existing) {
            return this.updateRubricDimension(dimension.dimension, dimension);
        }
        const now = new Date().toISOString();
        const result = db.prepare('INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(dimension.dimension, dimension.weight, dimension.poor_description ?? null, dimension.moderate_description ?? null, dimension.strong_description ?? null, now, now);
        return db.prepare('SELECT id, dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at FROM scoring_rubric WHERE id = ?').get(result.lastInsertRowid);
    }
    async removeRubricDimension(dimension) {
        const db = this.getDatabase();
        const result = db.prepare('DELETE FROM scoring_rubric WHERE LOWER(dimension) = LOWER(?)').run(dimension);
        return result.changes > 0;
    }
    // --- Crawl Queue ---
    async checkUrlExists(url) {
        const db = this.getDatabase();
        const row = db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(url);
        return {
            exists: Boolean(row),
            entry: row ? { ...row, ats_platform: row.ats_platform ?? null } : undefined,
        };
    }
    async addToQueue(data) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(data.url);
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
        const result = db.prepare('INSERT INTO crawl_queue (url, company_name, ats_platform, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(data.url, data.company_name, atsPlatform ?? null, 'pending', data.notes ?? null, now, now);
        const inserted = db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE id = ?').get(result.lastInsertRowid);
        return {
            ...inserted,
            ats_platform: inserted.ats_platform ?? null,
        };
    }
    async getPendingQueue(companyName, limit = 50) {
        const db = this.getDatabase();
        let query = "SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE status = 'pending'";
        const params = [];
        if (companyName) {
            query += ' AND LOWER(company_name) = LOWER(?)';
            params.push(companyName);
        }
        query += ' ORDER BY id ASC LIMIT ?';
        params.push(limit);
        const rows = db.prepare(query).all(...params);
        return rows.map(r => ({
            ...r,
            ats_platform: r.ats_platform ?? null,
        }));
    }
    async listQueue(filters) {
        const db = this.getDatabase();
        let query = 'SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue';
        const conditions = [];
        const params = [];
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
        const rows = db.prepare(query).all(...params);
        return rows.map(r => ({
            ...r,
            ats_platform: r.ats_platform ?? null,
        }));
    }
    async updateQueueStatus(url, status, notes) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, notes FROM crawl_queue WHERE LOWER(url) = LOWER(?)').get(url);
        if (!existing) {
            throw new Error(`Queue entry not found for URL: ${url}`);
        }
        const updatedNotes = notes !== undefined ? notes : existing.notes;
        const now = new Date().toISOString();
        db.prepare('UPDATE crawl_queue SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(status, updatedNotes ?? null, now, existing.id);
        const updated = db.prepare('SELECT id, url, company_name, ats_platform, status, notes, created_at, updated_at FROM crawl_queue WHERE id = ?').get(existing.id);
        return {
            ...updated,
            ats_platform: updated.ats_platform ?? null,
        };
    }
    // --- Candidates ---
    async addCandidate(data) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id FROM candidates WHERE LOWER(url) = LOWER(?)').get(data.url);
        const breakdownJson = data.breakdown ? JSON.stringify(data.breakdown) : null;
        const now = new Date().toISOString();
        if (existing) {
            db.prepare(`
        UPDATE candidates
        SET company_name = ?, job_title = ?, location = ?, score = ?, breakdown = ?, status = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(data.company_name, data.job_title, data.location ?? null, data.score ?? null, breakdownJson, data.status ?? 'new', data.notes ?? null, now, existing.id);
            const row = db.prepare('SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates WHERE id = ?').get(existing.id);
            return {
                ...row,
                breakdown: row.breakdown ? JSON.parse(row.breakdown) : null,
            };
        }
        const result = db.prepare(`
      INSERT INTO candidates (company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(data.company_name, data.job_title, data.url, data.location ?? null, data.score ?? null, breakdownJson, data.status ?? 'new', data.notes ?? null, now, now);
        const row = db.prepare('SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates WHERE id = ?').get(result.lastInsertRowid);
        return {
            ...row,
            breakdown: row.breakdown ? JSON.parse(row.breakdown) : null,
        };
    }
    async updateCandidateStatus(url, status, notes) {
        const db = this.getDatabase();
        const existing = db.prepare('SELECT id, notes FROM candidates WHERE LOWER(url) = LOWER(?)').get(url);
        if (!existing) {
            throw new Error(`Candidate not found for URL: ${url}`);
        }
        const now = new Date().toISOString();
        const appliedAt = status === 'applied' ? now : undefined;
        const updatedNotes = notes !== undefined ? notes : existing.notes;
        let updateQuery = 'UPDATE candidates SET status = ?, notes = ?, updated_at = ?';
        const params = [status, updatedNotes ?? null, now];
        if (appliedAt !== undefined) {
            updateQuery += ', applied_at = ?';
            params.push(appliedAt);
        }
        updateQuery += ' WHERE id = ?';
        params.push(existing.id);
        db.prepare(updateQuery).run(...params);
        const row = db.prepare('SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates WHERE id = ?').get(existing.id);
        return {
            ...row,
            breakdown: row.breakdown ? JSON.parse(row.breakdown) : null,
        };
    }
    async getCandidates(filters) {
        const db = this.getDatabase();
        let query = 'SELECT id, company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at FROM candidates';
        const conditions = [];
        const params = [];
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
        const rows = db.prepare(query).all(...params);
        return rows.map((r) => ({
            ...r,
            breakdown: r.breakdown ? JSON.parse(r.breakdown) : null,
        }));
    }
    // --- Run Logs ---
    async logRun(data) {
        const db = this.getDatabase();
        const now = new Date().toISOString();
        const companiesJson = JSON.stringify(data.companies_processed || []);
        const detailsJson = JSON.stringify(data.details || {});
        const result = db.prepare(`
      INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(now, 'local', companiesJson, data.urls_queued, data.candidates_scored, data.summary ?? null, detailsJson);
        const row = db.prepare('SELECT id, timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details FROM run_logs WHERE id = ?').get(result.lastInsertRowid);
        return {
            ...row,
            companies_processed: JSON.parse(row.companies_processed),
            details: row.details ? JSON.parse(row.details) : {},
        };
    }
    async getRecentRuns(limit = 10) {
        const db = this.getDatabase();
        const rows = db.prepare('SELECT id, timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details FROM run_logs ORDER BY id DESC LIMIT ?').all(limit);
        return rows.map((r) => ({
            ...r,
            companies_processed: JSON.parse(r.companies_processed),
            details: r.details ? JSON.parse(r.details) : {},
        }));
    }
}
