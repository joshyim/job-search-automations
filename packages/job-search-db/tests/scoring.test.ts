import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  roundHalfUp,
  computeWeightedRubricScore,
  validateCandidateScoreAndBreakdown,
} from '../src/scoring.js';
import { SqliteAdapter } from '../src/adapters/sqlite/sqlite-adapter.js';
import { RubricDimension } from '../src/adapters/types.js';

describe('Scoring Validation and 0-100 Scale Enforcement (PRO-71)', () => {
  const sampleRubric: RubricDimension[] = [
    { id: 1, dimension: 'Title match', weight: 20 },
    { id: 2, dimension: 'Skills match', weight: 40 },
    { id: 3, dimension: 'Experience match', weight: 25 },
    { id: 4, dimension: 'Seniority fit', weight: 15 },
  ];

  describe('Unit: roundHalfUp', () => {
    it('rounds half-up accurately avoiding IEEE-754 floating drift', () => {
      expect(roundHalfUp(28.01, 1)).toBe(28.0);
      expect(roundHalfUp(28.05, 1)).toBe(28.1);
      expect(roundHalfUp(90.04, 1)).toBe(90.0);
      expect(roundHalfUp(90.05, 1)).toBe(90.1);
      expect(roundHalfUp(28.04999999999999, 1)).toBe(28.0);
    });
  });

  describe('Unit: computeWeightedRubricScore', () => {
    it('calculates exact weighted score for incident candidates', () => {
      // Code Metal Senior Product Manager
      const spmBreakdown = {
        'Title match': 90.0,
        'Skills match': 87.6,
        'Experience match': 96.0,
        'Seniority fit': 86.6,
      };
      const spmResult = computeWeightedRubricScore(spmBreakdown, sampleRubric);
      expect(spmResult.expectedScore).toBe(90.0);

      // Code Metal Deployment Strategist
      const dsBreakdown = {
        'Title match': 25.0,
        'Skills match': 25.0,
        'Experience match': 20.0,
        'Seniority fit': 53.4,
      };
      const dsResult = computeWeightedRubricScore(dsBreakdown, sampleRubric);
      expect(dsResult.expectedScore).toBe(28.0);
    });

    it('handles case-insensitive dimension matching and canonicalizes keys', () => {
      const breakdown = {
        'title match': 90.0,
        'SKILLS MATCH': 80.0,
        'Experience Match': 80.0,
        'seniority fit': 80.0,
      };
      const result = computeWeightedRubricScore(breakdown, sampleRubric);
      expect(result.canonicalBreakdown).toEqual({
        'Title match': 90.0,
        'Skills match': 80.0,
        'Experience match': 80.0,
        'Seniority fit': 80.0,
      });
      // 90*20 + 80*40 + 80*25 + 80*15 = 1800 + 3200 + 2000 + 1200 = 8200 / 100 = 82.0
      expect(result.expectedScore).toBe(82.0);
    });

    it('allows boundary values at 20.0 and 100.0', () => {
      const minBreakdown = {
        'Title match': 20.0,
        'Skills match': 20.0,
        'Experience match': 20.0,
        'Seniority fit': 20.0,
      };
      expect(computeWeightedRubricScore(minBreakdown, sampleRubric).expectedScore).toBe(20.0);

      const maxBreakdown = {
        'Title match': 100.0,
        'Skills match': 100.0,
        'Experience match': 100.0,
        'Seniority fit': 100.0,
      };
      expect(computeWeightedRubricScore(maxBreakdown, sampleRubric).expectedScore).toBe(100.0);
    });

    it('rejects dimension values below 20.0 or above 100.0', () => {
      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': 0, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/out of bounds \[20.0, 100.0\]/);

      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': 19.9, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/out of bounds \[20.0, 100.0\]/);

      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': 100.1, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/out of bounds \[20.0, 100.0\]/);

      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': 900, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/out of bounds \[20.0, 100.0\]/);
    });

    it('rejects missing or extra rubric dimensions', () => {
      // Missing Seniority fit
      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': 50, 'Skills match': 50, 'Experience match': 50 },
          sampleRubric
        )
      ).toThrow(/Missing rubric dimension/);

      // Extra dimension
      expect(() =>
        computeWeightedRubricScore(
          {
            'Title match': 50,
            'Skills match': 50,
            'Experience match': 50,
            'Seniority fit': 50,
            'Culture fit': 50,
          },
          sampleRubric
        )
      ).toThrow(/Unknown rubric dimension/);
    });

    it('rejects non-finite values (NaN, Infinity)', () => {
      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': NaN, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/must be a finite number/);

      expect(() =>
        computeWeightedRubricScore(
          { 'Title match': Infinity, 'Skills match': 50, 'Experience match': 50, 'Seniority fit': 50 },
          sampleRubric
        )
      ).toThrow(/must be a finite number/);
    });
  });

  describe('Unit: validateCandidateScoreAndBreakdown (4 Scenarios)', () => {
    it('Scenario A: validates consistent score and breakdown', () => {
      const res = validateCandidateScoreAndBreakdown(
        {
          score: 90.0,
          breakdown: {
            'Title match': 90.0,
            'Skills match': 87.6,
            'Experience match': 96.0,
            'Seniority fit': 86.6,
          },
        },
        sampleRubric
      );
      expect(res.score).toBe(90.0);
      expect(res.needsAssessment).toBe(false);
    });

    it('Scenario A: throws on inconsistent score and breakdown', () => {
      expect(() =>
        validateCandidateScoreAndBreakdown(
          {
            score: 27.0, // Should be 28.0
            breakdown: {
              'Title match': 25.0,
              'Skills match': 25.0,
              'Experience match': 20.0,
              'Seniority fit': 53.4,
            },
          },
          sampleRubric
        )
      ).toThrow(/does not match breakdown weighted average/);
    });

    it('Scenario B: auto-calculates score when omitted', () => {
      const res = validateCandidateScoreAndBreakdown(
        {
          breakdown: {
            'Title match': 25.0,
            'Skills match': 25.0,
            'Experience match': 20.0,
            'Seniority fit': 53.4,
          },
        },
        sampleRubric
      );
      expect(res.score).toBe(28.0);
      expect(res.needsAssessment).toBe(false);
    });

    it('Scenario C: provisional score without breakdown flags needsAssessment', () => {
      const res = validateCandidateScoreAndBreakdown({ score: 75.5 }, sampleRubric);
      expect(res.score).toBe(75.5);
      expect(res.breakdown).toBeNull();
      expect(res.needsAssessment).toBe(true);
    });

    it('Scenario D: unscored candidate flags needsAssessment', () => {
      const res = validateCandidateScoreAndBreakdown({}, sampleRubric);
      expect(res.score).toBeNull();
      expect(res.breakdown).toBeNull();
      expect(res.needsAssessment).toBe(true);
    });

    it('validates overall score boundaries [0.0, 100.0]', () => {
      expect(validateCandidateScoreAndBreakdown({ score: 0.0 }, sampleRubric).score).toBe(0.0);
      expect(validateCandidateScoreAndBreakdown({ score: 100.0 }, sampleRubric).score).toBe(100.0);

      expect(() => validateCandidateScoreAndBreakdown({ score: -0.1 }, sampleRubric)).toThrow(
        /out of bounds \[0.0, 100.0\]/
      );
      expect(() => validateCandidateScoreAndBreakdown({ score: 100.1 }, sampleRubric)).toThrow(
        /out of bounds \[0.0, 100.0\]/
      );
      expect(() => validateCandidateScoreAndBreakdown({ score: 900 }, sampleRubric)).toThrow(
        /out of bounds \[0.0, 100.0\]/
      );
    });
  });

  describe('Integration: SqliteAdapter & Assessment Flow Triggering', () => {
    let tempDir: string;
    let dbPath: string;
    let adapter: SqliteAdapter;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-scoring-test-'));
      dbPath = path.join(tempDir, 'job-search.sqlite');
      adapter = new SqliteAdapter(dbPath);
      await adapter.initialize();
    });

    afterEach(async () => {
      await adapter.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('accepts and persists valid 0-100 candidate with breakdown and marks queue assessed', async () => {
      // Add entry to queue first
      await adapter.addToQueue({
        company_name: 'Stripe',
        url: 'https://stripe.com/jobs/staff',
      });

      const candidate = await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/staff',
        location: 'Remote',
        score: 88.0,
        breakdown: {
          'Title match': 88.0,
          'Skills match': 88.0,
          'Experience match': 88.0,
          'Seniority fit': 88.0,
        },
        status: 'new',
      });

      expect(candidate.score).toBe(88.0);
      expect(candidate.breakdown).toEqual({
        'Title match': 88.0,
        'Skills match': 88.0,
        'Experience match': 88.0,
        'Seniority fit': 88.0,
      });

      // Verify queue entry was moved to assessed
      const queueCheck = await adapter.checkUrlExists('https://stripe.com/jobs/staff');
      expect(queueCheck.exists).toBe(true);
      expect(queueCheck.entry?.status).toBe('assessed');
    });

    it('auto-computes score when breakdown is provided without score', async () => {
      const candidate = await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/staff-auto',
        breakdown: {
          'Title match': 90.0,
          'Skills match': 80.0,
          'Experience match': 70.0,
          'Seniority fit': 60.0,
        },
      });

      // Rubric weights in default SQLite: Title 25, Skills 30, Experience 25, Seniority 20
      // 90*25 + 80*30 + 70*25 + 60*20 = 2250 + 2400 + 1750 + 1200 = 7600 / 100 = 76.0
      expect(candidate.score).toBe(76.0);
    });

    it('automatically enrolls candidate in crawl_queue as pending when breakdown is missing', async () => {
      // Scenario C: Provisional score provided
      await adapter.addCandidate({
        company_name: 'OpenAI',
        job_title: 'Research Scientist',
        url: 'https://openai.com/jobs/rs-1',
        score: 95.0,
      });

      let queueCheck = await adapter.checkUrlExists('https://openai.com/jobs/rs-1');
      expect(queueCheck.exists).toBe(true);
      expect(queueCheck.entry?.status).toBe('pending');
      expect(queueCheck.entry?.notes).toContain('Pending assessment flow');

      // Scenario D: Neither provided
      await adapter.addCandidate({
        company_name: 'Anthropic',
        job_title: 'Systems Engineer',
        url: 'https://anthropic.com/jobs/sys-1',
      });

      queueCheck = await adapter.checkUrlExists('https://anthropic.com/jobs/sys-1');
      expect(queueCheck.exists).toBe(true);
      expect(queueCheck.entry?.status).toBe('pending');
    });

    it('leaves existing candidate data INTACT when an invalid update is rejected', async () => {
      // 1. Create a valid initial candidate
      await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/durability',
        score: 85.0,
        breakdown: {
          'Title match': 85.0,
          'Skills match': 85.0,
          'Experience match': 85.0,
          'Seniority fit': 85.0,
        },
        status: 'new',
        notes: 'Original note',
      });

      // 2. Attempt update with score: 900 (out of bounds)
      await expect(
        adapter.addCandidate({
          company_name: 'Stripe',
          job_title: 'Staff Engineer Updated',
          url: 'https://stripe.com/jobs/durability',
          score: 900,
        })
      ).rejects.toThrow(/out of bounds \[0.0, 100.0\]/);

      // 3. Attempt update with inconsistent breakdown
      await expect(
        adapter.addCandidate({
          company_name: 'Stripe',
          job_title: 'Staff Engineer Updated',
          url: 'https://stripe.com/jobs/durability',
          score: 90.0,
          breakdown: {
            'Title match': 20.0,
            'Skills match': 20.0,
            'Experience match': 20.0,
            'Seniority fit': 20.0,
          },
        })
      ).rejects.toThrow(/does not match breakdown weighted average/);

      // 4. Verify existing record in database is completely untouched
      const candidates = await adapter.getCandidates();
      const existing = candidates.find((c) => c.url === 'https://stripe.com/jobs/durability');
      expect(existing).toBeDefined();
      expect(existing?.score).toBe(85.0);
      expect(existing?.job_title).toBe('Staff Engineer');
      expect(existing?.notes).toBe('Original note');
    });

    it('performs auditable migration on legacy 1-5 candidate breakdowns and enrolls missing-breakdown candidates', async () => {
      // Setup legacy database with:
      // - 1 candidate with legacy 1-5 breakdown (all values <= 5.0)
      // - 1 candidate with no breakdown
      const legacyDbPath = path.join(tempDir, 'legacy.sqlite');
      const rawDb = new DatabaseSync(legacyDbPath);
      rawDb.exec(`
        CREATE TABLE candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_name TEXT NOT NULL,
          job_title TEXT NOT NULL,
          url TEXT NOT NULL UNIQUE,
          location TEXT,
          score REAL,
          breakdown TEXT,
          status TEXT NOT NULL DEFAULT 'new',
          notes TEXT,
          discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
          applied_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE crawl_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL UNIQUE,
          company_name TEXT NOT NULL,
          ats_platform TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE scoring_rubric (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dimension TEXT NOT NULL UNIQUE,
          weight REAL NOT NULL,
          poor_description TEXT,
          moderate_description TEXT,
          strong_description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE run_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          mode TEXT NOT NULL,
          companies_processed TEXT NOT NULL DEFAULT '[]',
          urls_queued INTEGER NOT NULL DEFAULT 0,
          candidates_scored INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          details TEXT
        );

        INSERT INTO scoring_rubric (dimension, weight) VALUES
          ('Title match', 25),
          ('Skills match', 30),
          ('Experience match', 25),
          ('Seniority fit', 20);

        INSERT INTO candidates (company_name, job_title, url, score, breakdown) VALUES
          ('LegacyCo', 'Staff Eng', 'https://legacy.com/1', 4.5, '{"Title match": 4.5, "Skills match": 4.0, "Experience match": 4.0, "Seniority fit": 5.0}'),
          ('UnscoredCo', 'Product Lead', 'https://unscored.com/2', 70.0, NULL);
      `);
      rawDb.close();

      // Initialize adapter on the legacy DB
      const legacyAdapter = new SqliteAdapter(legacyDbPath);
      await legacyAdapter.initialize();

      const candidates = await legacyAdapter.getCandidates();
      const legacyCand = candidates.find((c) => c.url === 'https://legacy.com/1')!;
      const unscoredCand = candidates.find((c) => c.url === 'https://unscored.com/2')!;

      // 1-5 candidate converted: 4.5*20=90, 4*20=80, 4*20=80, 5*20=100
      // Weighted average: (90*25 + 80*30 + 80*25 + 100*20) / 100 = (2250 + 2400 + 2000 + 2000)/100 = 86.5
      expect(legacyCand.score).toBe(86.5);
      expect(legacyCand.breakdown).toEqual({
        'Title match': 90.0,
        'Skills match': 80.0,
        'Experience match': 80.0,
        'Seniority fit': 100.0,
      });

      // Unscored candidate retains its original score and null breakdown, but is enrolled in crawl_queue
      expect(unscoredCand.score).toBe(70.0);
      expect(unscoredCand.breakdown).toBeNull();

      const queueCheck = await legacyAdapter.checkUrlExists('https://unscored.com/2');
      expect(queueCheck.exists).toBe(true);
      expect(queueCheck.entry?.status).toBe('pending');

      // Verify run_logs contains migration records
      const logs = await legacyAdapter.getRecentRuns(10);
      const migrationLog = logs.find((l) => l.summary?.includes('legacy 1-5 candidate rubric breakdowns'));
      expect(migrationLog).toBeDefined();

      const enrollLog = logs.find((l) => l.summary?.includes('Enrolled 1 candidates without breakdowns'));
      expect(enrollLog).toBeDefined();

      await legacyAdapter.close();
    });
  });
});
