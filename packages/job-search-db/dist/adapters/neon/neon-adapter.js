import { Pool } from '@neondatabase/serverless';
import { detectAtsPlatform, normalizeAtsPlatform } from '../../ats.js';
export class NeonAdapter {
    connectionString;
    pool;
    constructor(config) {
        if (typeof config === 'string') {
            this.connectionString = config;
            this.pool = new Pool({ connectionString: config });
        }
        else {
            this.connectionString = config.connectionString;
            this.pool = config.poolInstance || new Pool({ connectionString: config.connectionString });
        }
    }
    async initialize() {
        // Verify connection
        await this.pool.query('SELECT 1');
        // Ensure ats_platform columns exist
        await this.pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS ats_platform VARCHAR(50);
      ALTER TABLE crawl_queue ADD COLUMN IF NOT EXISTS ats_platform VARCHAR(50);
    `);
    }
    async close() {
        await this.pool.end();
    }
    // --- Companies ---
    async listCompanies(includeExcluded = false) {
        let query = `
      SELECT id, name, careers_url, ats_platform, is_excluded, notes,
             last_searched_at::text as last_searched_at,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM companies
    `;
        const params = [];
        if (!includeExcluded) {
            query += ` WHERE is_excluded = FALSE`;
        }
        query += ` ORDER BY name ASC`;
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            name: r.name,
            careers_url: r.careers_url,
            ats_platform: r.ats_platform || null,
            is_excluded: Boolean(r.is_excluded),
            notes: r.notes || null,
            last_searched_at: r.last_searched_at || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }
    async addCompany(data) {
        const atsPlatform = normalizeAtsPlatform(data.ats_platform) ?? detectAtsPlatform(data.careers_url);
        const query = `
      INSERT INTO companies (name, careers_url, ats_platform, is_excluded, notes, last_searched_at, updated_at)
      VALUES ($1, $2, $3, FALSE, $4, $5, NOW())
      ON CONFLICT (name) DO UPDATE
      SET careers_url = EXCLUDED.careers_url,
          ats_platform = COALESCE(EXCLUDED.ats_platform, companies.ats_platform),
          notes = COALESCE(EXCLUDED.notes, companies.notes),
          last_searched_at = COALESCE(EXCLUDED.last_searched_at, companies.last_searched_at),
          updated_at = NOW()
      RETURNING id, name, careers_url, ats_platform, is_excluded, notes,
                last_searched_at::text as last_searched_at,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [
            data.name,
            data.careers_url,
            atsPlatform || null,
            data.notes || null,
            data.last_searched_at || null,
        ]);
        const r = result.rows[0];
        return {
            id: r.id,
            name: r.name,
            careers_url: r.careers_url,
            ats_platform: r.ats_platform || null,
            is_excluded: Boolean(r.is_excluded),
            notes: r.notes || null,
            last_searched_at: r.last_searched_at || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async updateCompany(currentName, updates) {
        const fields = [];
        const values = [];
        let idx = 1;
        if (updates.name !== undefined) {
            fields.push(`name = $${idx++}`);
            values.push(updates.name);
        }
        if (updates.careers_url !== undefined) {
            fields.push(`careers_url = $${idx++}`);
            values.push(updates.careers_url);
        }
        if (updates.ats_platform !== undefined) {
            fields.push(`ats_platform = $${idx++}`);
            values.push(normalizeAtsPlatform(updates.ats_platform));
        }
        else if (updates.careers_url !== undefined) {
            const detected = detectAtsPlatform(updates.careers_url);
            if (detected) {
                fields.push(`ats_platform = $${idx++}`);
                values.push(detected);
            }
        }
        if (updates.is_excluded !== undefined) {
            fields.push(`is_excluded = $${idx++}`);
            values.push(updates.is_excluded);
        }
        if (updates.notes !== undefined) {
            fields.push(`notes = $${idx++}`);
            values.push(updates.notes);
        }
        if (updates.last_searched_at !== undefined) {
            fields.push(`last_searched_at = $${idx++}`);
            values.push(updates.last_searched_at);
        }
        if (fields.length === 0) {
            const existing = await this.pool.query('SELECT * FROM companies WHERE LOWER(name) = LOWER($1)', [currentName]);
            if (existing.rows.length === 0)
                throw new Error(`Company "${currentName}" not found`);
            const r = existing.rows[0];
            return {
                id: r.id,
                name: r.name,
                careers_url: r.careers_url,
                ats_platform: r.ats_platform || null,
                is_excluded: Boolean(r.is_excluded),
                notes: r.notes || null,
                last_searched_at: r.last_searched_at || null,
                created_at: r.created_at,
                updated_at: r.updated_at,
            };
        }
        fields.push(`updated_at = NOW()`);
        values.push(currentName);
        const query = `
      UPDATE companies
      SET ${fields.join(', ')}
      WHERE LOWER(name) = LOWER($${idx})
      RETURNING id, name, careers_url, ats_platform, is_excluded, notes,
                last_searched_at::text as last_searched_at,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, values);
        if (result.rows.length === 0) {
            throw new Error(`Company "${currentName}" not found`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            name: r.name,
            careers_url: r.careers_url,
            ats_platform: r.ats_platform || null,
            is_excluded: Boolean(r.is_excluded),
            notes: r.notes || null,
            last_searched_at: r.last_searched_at || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async excludeCompany(name, reason) {
        const query = `
      INSERT INTO companies (name, careers_url, is_excluded, notes, updated_at)
      VALUES ($1, '', TRUE, $2, NOW())
      ON CONFLICT (name) DO UPDATE
      SET is_excluded = TRUE,
          notes = CASE
            WHEN $2 IS NOT NULL AND companies.notes IS NOT NULL THEN companies.notes || ' (' || $2 || ')'
            WHEN $2 IS NOT NULL THEN $2
            ELSE companies.notes
          END,
          updated_at = NOW()
      RETURNING id, name, careers_url, ats_platform, is_excluded, notes,
                last_searched_at::text as last_searched_at,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [name, reason || null]);
        const r = result.rows[0];
        return {
            id: r.id,
            name: r.name,
            careers_url: r.careers_url,
            ats_platform: r.ats_platform || null,
            is_excluded: Boolean(r.is_excluded),
            notes: r.notes || null,
            last_searched_at: r.last_searched_at || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async getBatch(limit) {
        const query = `
      SELECT id, name, careers_url, ats_platform, is_excluded, notes,
             last_searched_at::text as last_searched_at,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM companies
      WHERE is_excluded = FALSE
      ORDER BY last_searched_at ASC NULLS FIRST
      LIMIT $1
    `;
        const result = await this.pool.query(query, [limit]);
        // Stamp last_searched_at now, atomically with selection, so a batch is never
        // re-selected on the next call regardless of whether the caller remembers to
        // report back on how processing went.
        if (result.rows.length > 0) {
            const now = new Date().toISOString();
            const ids = result.rows.map((r) => r.id);
            await this.pool.query('UPDATE companies SET last_searched_at = $1, updated_at = $1 WHERE id = ANY($2::int[])', [now, ids]);
            for (const r of result.rows) {
                r.last_searched_at = now;
                r.updated_at = now;
            }
        }
        return result.rows.map(r => ({
            id: r.id,
            name: r.name,
            careers_url: r.careers_url,
            ats_platform: r.ats_platform || null,
            is_excluded: Boolean(r.is_excluded),
            notes: r.notes || null,
            last_searched_at: r.last_searched_at || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }
    // --- Title Patterns & Skills ---
    async listTitlePatterns(type) {
        let query = `
      SELECT id, pattern, type, level, notes,
             created_at::text as created_at
      FROM title_patterns
    `;
        const params = [];
        if (type) {
            query += ` WHERE type = $1`;
            params.push(type);
        }
        query += ` ORDER BY pattern ASC`;
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            pattern: r.pattern,
            type: r.type,
            level: r.level || null,
            notes: r.notes || null,
            created_at: r.created_at,
        }));
    }
    async addTitlePattern(data) {
        const query = `
      INSERT INTO title_patterns (pattern, type, level, notes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (pattern, type) DO UPDATE
      SET level = EXCLUDED.level,
          notes = EXCLUDED.notes
      RETURNING id, pattern, type, level, notes, created_at::text as created_at
    `;
        const result = await this.pool.query(query, [data.pattern, data.type, data.level || null, data.notes || null]);
        const r = result.rows[0];
        return {
            id: r.id,
            pattern: r.pattern,
            type: r.type,
            level: r.level || null,
            notes: r.notes || null,
            created_at: r.created_at,
        };
    }
    async updateTitlePattern(pattern, type, updates) {
        const fields = [];
        const values = [];
        let idx = 1;
        if (updates.pattern !== undefined) {
            fields.push(`pattern = $${idx++}`);
            values.push(updates.pattern);
        }
        if (updates.type !== undefined) {
            fields.push(`type = $${idx++}`);
            values.push(updates.type);
        }
        if (updates.level !== undefined) {
            fields.push(`level = $${idx++}`);
            values.push(updates.level);
        }
        if (updates.notes !== undefined) {
            fields.push(`notes = $${idx++}`);
            values.push(updates.notes);
        }
        if (fields.length === 0) {
            const existing = await this.pool.query('SELECT * FROM title_patterns WHERE LOWER(pattern) = LOWER($1) AND type = $2', [pattern, type]);
            if (existing.rows.length === 0)
                throw new Error(`Title pattern "${pattern}" (${type}) not found`);
            const r = existing.rows[0];
            return {
                id: r.id,
                pattern: r.pattern,
                type: r.type,
                level: r.level || null,
                notes: r.notes || null,
                created_at: r.created_at,
            };
        }
        values.push(pattern);
        const patternIdx = idx++;
        values.push(type);
        const typeIdx = idx++;
        const query = `
      UPDATE title_patterns
      SET ${fields.join(', ')}
      WHERE LOWER(pattern) = LOWER($${patternIdx}) AND type = $${typeIdx}
      RETURNING id, pattern, type, level, notes, created_at::text as created_at
    `;
        const result = await this.pool.query(query, values);
        if (result.rows.length === 0) {
            throw new Error(`Title pattern "${pattern}" (${type}) not found`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            pattern: r.pattern,
            type: r.type,
            level: r.level || null,
            notes: r.notes || null,
            created_at: r.created_at,
        };
    }
    async removeTitlePattern(pattern, type) {
        let query = `DELETE FROM title_patterns WHERE LOWER(pattern) = LOWER($1)`;
        const params = [pattern];
        if (type) {
            query += ` AND type = $2`;
            params.push(type);
        }
        const result = await this.pool.query(query, params);
        return (result.rowCount ?? 0) > 0;
    }
    async listSkills(category) {
        let query = `
      SELECT id, name, category, importance, notes,
             created_at::text as created_at
      FROM skills
    `;
        const params = [];
        if (category) {
            query += ` WHERE LOWER(category) = LOWER($1)`;
            params.push(category);
        }
        query += ` ORDER BY name ASC`;
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            name: r.name,
            category: r.category || null,
            importance: r.importance || null,
            notes: r.notes || null,
            created_at: r.created_at,
        }));
    }
    async addSkill(data) {
        const query = `
      INSERT INTO skills (name, category, importance, notes, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (name) DO UPDATE
      SET category = COALESCE(EXCLUDED.category, skills.category),
          importance = COALESCE(EXCLUDED.importance, skills.importance),
          notes = COALESCE(EXCLUDED.notes, skills.notes)
      RETURNING id, name, category, importance, notes, created_at::text as created_at
    `;
        const result = await this.pool.query(query, [
            data.name,
            data.category || null,
            data.importance || 'preferred',
            data.notes || null,
        ]);
        const r = result.rows[0];
        return {
            id: r.id,
            name: r.name,
            category: r.category || null,
            importance: r.importance || null,
            notes: r.notes || null,
            created_at: r.created_at,
        };
    }
    async updateSkill(name, updates) {
        const fields = [];
        const values = [];
        let idx = 1;
        if (updates.name !== undefined) {
            fields.push(`name = $${idx++}`);
            values.push(updates.name);
        }
        if (updates.category !== undefined) {
            fields.push(`category = $${idx++}`);
            values.push(updates.category);
        }
        if (updates.importance !== undefined) {
            fields.push(`importance = $${idx++}`);
            values.push(updates.importance);
        }
        if (updates.notes !== undefined) {
            fields.push(`notes = $${idx++}`);
            values.push(updates.notes);
        }
        if (fields.length === 0) {
            const existing = await this.pool.query('SELECT * FROM skills WHERE LOWER(name) = LOWER($1)', [name]);
            if (existing.rows.length === 0)
                throw new Error(`Skill "${name}" not found`);
            const r = existing.rows[0];
            return {
                id: r.id,
                name: r.name,
                category: r.category || null,
                importance: r.importance || null,
                notes: r.notes || null,
                created_at: r.created_at,
            };
        }
        values.push(name);
        const query = `
      UPDATE skills
      SET ${fields.join(', ')}
      WHERE LOWER(name) = LOWER($${idx})
      RETURNING id, name, category, importance, notes, created_at::text as created_at
    `;
        const result = await this.pool.query(query, values);
        if (result.rows.length === 0) {
            throw new Error(`Skill "${name}" not found`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            name: r.name,
            category: r.category || null,
            importance: r.importance || null,
            notes: r.notes || null,
            created_at: r.created_at,
        };
    }
    async removeSkill(name) {
        const query = `DELETE FROM skills WHERE LOWER(name) = LOWER($1)`;
        const result = await this.pool.query(query, [name]);
        return (result.rowCount ?? 0) > 0;
    }
    // --- Scoring Rubric ---
    async getScoringRubric() {
        const query = `
      SELECT id, dimension, weight::float as weight,
             poor_description, moderate_description, strong_description,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM scoring_rubric
      ORDER BY id ASC
    `;
        const result = await this.pool.query(query);
        return result.rows.map(r => ({
            id: r.id,
            dimension: r.dimension,
            weight: r.weight,
            poor_description: r.poor_description || null,
            moderate_description: r.moderate_description || null,
            strong_description: r.strong_description || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }
    async updateRubricDimension(dimension, updates) {
        const setClauses = ['updated_at = NOW()'];
        const params = [dimension];
        let paramIndex = 2;
        if (updates.weight !== undefined) {
            setClauses.push(`weight = $${paramIndex++}`);
            params.push(updates.weight);
        }
        if (updates.poor_description !== undefined) {
            setClauses.push(`poor_description = $${paramIndex++}`);
            params.push(updates.poor_description);
        }
        if (updates.moderate_description !== undefined) {
            setClauses.push(`moderate_description = $${paramIndex++}`);
            params.push(updates.moderate_description);
        }
        if (updates.strong_description !== undefined) {
            setClauses.push(`strong_description = $${paramIndex++}`);
            params.push(updates.strong_description);
        }
        const query = `
      UPDATE scoring_rubric
      SET ${setClauses.join(', ')}
      WHERE LOWER(TRIM(dimension)) = LOWER(TRIM($1))
      RETURNING id, dimension, weight::float as weight,
                poor_description, moderate_description, strong_description,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, params);
        if (result.rows.length === 0) {
            throw new Error(`Rubric dimension not found: ${dimension}`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            dimension: r.dimension,
            weight: r.weight,
            poor_description: r.poor_description || null,
            moderate_description: r.moderate_description || null,
            strong_description: r.strong_description || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async addRubricDimension(dimension) {
        const dimName = dimension.dimension.trim();
        // Resolve existing dimension name case-insensitively if present
        const existing = await this.pool.query(`SELECT dimension FROM scoring_rubric WHERE LOWER(TRIM(dimension)) = LOWER(TRIM($1)) LIMIT 1`, [dimName]);
        const resolvedName = existing.rows.length > 0 ? existing.rows[0].dimension : dimName;
        const query = `
      INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (dimension) DO UPDATE
      SET weight = EXCLUDED.weight,
          poor_description = COALESCE(EXCLUDED.poor_description, scoring_rubric.poor_description),
          moderate_description = COALESCE(EXCLUDED.moderate_description, scoring_rubric.moderate_description),
          strong_description = COALESCE(EXCLUDED.strong_description, scoring_rubric.strong_description),
          updated_at = NOW()
      RETURNING id, dimension, weight::float as weight,
                poor_description, moderate_description, strong_description,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [
            resolvedName,
            dimension.weight,
            dimension.poor_description || null,
            dimension.moderate_description || null,
            dimension.strong_description || null,
        ]);
        const r = result.rows[0];
        return {
            id: r.id,
            dimension: r.dimension,
            weight: r.weight,
            poor_description: r.poor_description || null,
            moderate_description: r.moderate_description || null,
            strong_description: r.strong_description || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async removeRubricDimension(dimension) {
        const query = `DELETE FROM scoring_rubric WHERE LOWER(TRIM(dimension)) = LOWER(TRIM($1))`;
        const result = await this.pool.query(query, [dimension.trim()]);
        return (result.rowCount ?? 0) > 0;
    }
    // --- Crawl Queue ---
    async checkUrlExists(url) {
        const query = `
      SELECT id, url, company_name, ats_platform, status, notes,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM crawl_queue
      WHERE url = $1
    `;
        const result = await this.pool.query(query, [url]);
        if (result.rows.length === 0) {
            return { exists: false };
        }
        const r = result.rows[0];
        return {
            exists: true,
            entry: {
                id: r.id,
                url: r.url,
                company_name: r.company_name,
                ats_platform: r.ats_platform || null,
                status: r.status,
                notes: r.notes || null,
                created_at: r.created_at,
                updated_at: r.updated_at,
            },
        };
    }
    async addToQueue(data) {
        const atsPlatform = normalizeAtsPlatform(data.ats_platform) ?? detectAtsPlatform(data.url);
        const query = `
      INSERT INTO crawl_queue (url, company_name, ats_platform, status, notes, updated_at)
      VALUES ($1, $2, $3, 'pending', $4, NOW())
      ON CONFLICT (url) DO UPDATE
      SET company_name = EXCLUDED.company_name,
          ats_platform = COALESCE(EXCLUDED.ats_platform, crawl_queue.ats_platform),
          notes = COALESCE(EXCLUDED.notes, crawl_queue.notes),
          updated_at = NOW()
      RETURNING id, url, company_name, ats_platform, status, notes,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [data.url, data.company_name, atsPlatform || null, data.notes || null]);
        const r = result.rows[0];
        return {
            id: r.id,
            url: r.url,
            company_name: r.company_name,
            ats_platform: r.ats_platform || null,
            status: r.status,
            notes: r.notes || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    async getPendingQueue(companyName, limit) {
        let query = `
      SELECT id, url, company_name, ats_platform, status, notes,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM crawl_queue
      WHERE status = 'pending'
    `;
        const params = [];
        let paramIndex = 1;
        if (companyName) {
            query += ` AND LOWER(company_name) = LOWER($${paramIndex++})`;
            params.push(companyName);
        }
        query += ` ORDER BY created_at ASC`;
        if (limit && limit > 0) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(limit);
        }
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            url: r.url,
            company_name: r.company_name,
            ats_platform: r.ats_platform || null,
            status: r.status,
            notes: r.notes || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }
    async listQueue(filters) {
        let query = `
      SELECT id, url, company_name, ats_platform, status, notes,
             created_at::text as created_at,
             updated_at::text as updated_at
      FROM crawl_queue
    `;
        const params = [];
        const whereClauses = [];
        let paramIndex = 1;
        if (filters?.status) {
            whereClauses.push(`status = $${paramIndex++}`);
            params.push(filters.status);
        }
        if (filters?.company_name) {
            whereClauses.push(`LOWER(company_name) = LOWER($${paramIndex++})`);
            params.push(filters.company_name);
        }
        if (filters?.ats_platform) {
            whereClauses.push(`LOWER(ats_platform) = LOWER($${paramIndex++})`);
            params.push(filters.ats_platform);
        }
        if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        query += ` ORDER BY created_at DESC`;
        if (filters?.limit && filters.limit > 0) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(filters.limit);
        }
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            url: r.url,
            company_name: r.company_name,
            ats_platform: r.ats_platform || null,
            status: r.status,
            notes: r.notes || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }
    async updateQueueStatus(url, status, notes) {
        const query = `
      UPDATE crawl_queue
      SET status = $2,
          notes = COALESCE($3, notes),
          updated_at = NOW()
      WHERE url = $1
      RETURNING id, url, company_name, ats_platform, status, notes,
                created_at::text as created_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [url, status, notes || null]);
        if (result.rows.length === 0) {
            throw new Error(`Queue entry not found for URL: ${url}`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            url: r.url,
            company_name: r.company_name,
            ats_platform: r.ats_platform || null,
            status: r.status,
            notes: r.notes || null,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }
    // --- Candidates ---
    async addCandidate(data) {
        const query = `
      INSERT INTO candidates (company_name, job_title, url, location, score, breakdown, status, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (url) DO UPDATE
      SET company_name = EXCLUDED.company_name,
          job_title = EXCLUDED.job_title,
          location = COALESCE(EXCLUDED.location, candidates.location),
          score = COALESCE(EXCLUDED.score, candidates.score),
          breakdown = COALESCE(EXCLUDED.breakdown, candidates.breakdown),
          status = COALESCE(EXCLUDED.status, candidates.status),
          notes = COALESCE(EXCLUDED.notes, candidates.notes),
          updated_at = NOW()
      RETURNING id, company_name, job_title, url, location,
                score::float as score,
                breakdown, status, notes,
                discovered_at::text as discovered_at,
                applied_at::text as applied_at,
                updated_at::text as updated_at
    `;
        const breakdownJson = data.breakdown ? JSON.stringify(data.breakdown) : null;
        const result = await this.pool.query(query, [
            data.company_name,
            data.job_title,
            data.url,
            data.location || null,
            data.score !== undefined ? data.score : null,
            breakdownJson,
            data.status || 'new',
            data.notes || null,
        ]);
        const r = result.rows[0];
        return {
            id: r.id,
            company_name: r.company_name,
            job_title: r.job_title,
            url: r.url,
            location: r.location || null,
            score: r.score,
            breakdown: r.breakdown ? (typeof r.breakdown === 'string' ? JSON.parse(r.breakdown) : r.breakdown) : null,
            status: r.status,
            notes: r.notes || null,
            discovered_at: r.discovered_at,
            applied_at: r.applied_at || null,
            updated_at: r.updated_at,
        };
    }
    async updateCandidateStatus(url, status, notes) {
        const query = `
      UPDATE candidates
      SET status = $2,
          applied_at = CASE WHEN $2 = 'applied' AND applied_at IS NULL THEN NOW() ELSE applied_at END,
          notes = COALESCE($3, notes),
          updated_at = NOW()
      WHERE url = $1
      RETURNING id, company_name, job_title, url, location,
                score::float as score,
                breakdown, status, notes,
                discovered_at::text as discovered_at,
                applied_at::text as applied_at,
                updated_at::text as updated_at
    `;
        const result = await this.pool.query(query, [url, status, notes || null]);
        if (result.rows.length === 0) {
            throw new Error(`Candidate not found with URL: ${url}`);
        }
        const r = result.rows[0];
        return {
            id: r.id,
            company_name: r.company_name,
            job_title: r.job_title,
            url: r.url,
            location: r.location || null,
            score: r.score,
            breakdown: r.breakdown ? (typeof r.breakdown === 'string' ? JSON.parse(r.breakdown) : r.breakdown) : null,
            status: r.status,
            notes: r.notes || null,
            discovered_at: r.discovered_at,
            applied_at: r.applied_at || null,
            updated_at: r.updated_at,
        };
    }
    async getCandidates(filters) {
        const whereClauses = [];
        const params = [];
        let paramIndex = 1;
        if (filters?.status) {
            if (filters.status === 'in_progress') {
                whereClauses.push(`status IN ($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
                params.push('in_progress', 'interviewing', 'in progress');
            }
            else if (filters.status === 'not_pursuing' || filters.status === 'closed') {
                whereClauses.push(`status IN ($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
                params.push('not_pursuing', 'closed', 'rejected', 'offer');
            }
            else {
                whereClauses.push(`status = $${paramIndex++}`);
                params.push(filters.status);
            }
        }
        if (filters?.company_name) {
            whereClauses.push(`LOWER(company_name) = LOWER($${paramIndex++})`);
            params.push(filters.company_name);
        }
        if (filters?.min_score !== undefined) {
            whereClauses.push(`score >= $${paramIndex++}`);
            params.push(filters.min_score);
        }
        const sortByCol = filters?.sort_by === 'discovered_at' ? 'discovered_at' : 'score';
        const sortOrderDir = filters?.sort_order === 'asc' ? 'ASC' : 'DESC';
        let query = `
      SELECT id, company_name, job_title, url, location,
             score::float as score,
             breakdown, status, notes,
             discovered_at::text as discovered_at,
             applied_at::text as applied_at,
             updated_at::text as updated_at
      FROM candidates
    `;
        if (whereClauses.length > 0) {
            query += ` WHERE ` + whereClauses.join(' AND ');
        }
        query += ` ORDER BY ${sortByCol} ${sortOrderDir} NULLS LAST`;
        if (filters?.limit && filters.limit > 0) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(filters.limit);
        }
        const result = await this.pool.query(query, params);
        return result.rows.map(r => ({
            id: r.id,
            company_name: r.company_name,
            job_title: r.job_title,
            url: r.url,
            location: r.location || null,
            score: r.score,
            breakdown: r.breakdown ? (typeof r.breakdown === 'string' ? JSON.parse(r.breakdown) : r.breakdown) : null,
            status: r.status,
            notes: r.notes || null,
            discovered_at: r.discovered_at,
            applied_at: r.applied_at || null,
            updated_at: r.updated_at,
        }));
    }
    // --- Run Logs ---
    async logRun(data) {
        const query = `
      INSERT INTO run_logs (mode, companies_processed, urls_queued, candidates_scored, summary, details)
      VALUES ('neon', $1, $2, $3, $4, $5)
      RETURNING id, timestamp::text as timestamp, mode,
                companies_processed, urls_queued, candidates_scored,
                summary, details
    `;
        const result = await this.pool.query(query, [
            JSON.stringify(data.companies_processed),
            data.urls_queued,
            data.candidates_scored,
            data.summary || null,
            JSON.stringify(data.details || {}),
        ]);
        const r = result.rows[0];
        return {
            id: r.id,
            timestamp: r.timestamp,
            mode: r.mode,
            companies_processed: typeof r.companies_processed === 'string' ? JSON.parse(r.companies_processed) : r.companies_processed,
            urls_queued: r.urls_queued,
            candidates_scored: r.candidates_scored,
            summary: r.summary || null,
            details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
        };
    }
    async getRecentRuns(limit = 10) {
        const query = `
      SELECT id, timestamp::text as timestamp, mode,
             companies_processed, urls_queued, candidates_scored,
             summary, details
      FROM run_logs
      ORDER BY timestamp DESC
      LIMIT $1
    `;
        const result = await this.pool.query(query, [limit]);
        return result.rows.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            mode: r.mode,
            companies_processed: typeof r.companies_processed === 'string' ? JSON.parse(r.companies_processed) : r.companies_processed,
            urls_queued: r.urls_queued,
            candidates_scored: r.candidates_scored,
            summary: r.summary || null,
            details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
        }));
    }
}
