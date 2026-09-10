import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteAdapter } from '../src/adapters/sqlite/sqlite-adapter.js';

describe('SqliteAdapter', () => {
  let tempDir: string;
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-sqlite-test-'));
    dbPath = path.join(tempDir, 'job-search.sqlite');
    adapter = new SqliteAdapter(dbPath, path.join(tempDir, 'resume.pdf'));
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes database and seeds default rubric', async () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    const rubric = await adapter.getScoringRubric();
    expect(rubric).toHaveLength(4);
    const dimensions = rubric.map((r) => r.dimension);
    expect(dimensions).toContain('Title match');
    expect(dimensions).toContain('Skills match');
    expect(dimensions).toContain('Experience match');
    expect(dimensions).toContain('Seniority fit');
  });

  describe('Company Operations', () => {
    it('adds and lists companies', async () => {
      await adapter.addCompany({
        name: 'Stripe',
        careers_url: 'https://stripe.com/jobs',
        notes: 'Fintech platform',
      });

      const companies = await adapter.listCompanies();
      expect(companies).toHaveLength(1);
      expect(companies[0].name).toBe('Stripe');
      expect(companies[0].careers_url).toBe('https://stripe.com/jobs');
      expect(companies[0].is_excluded).toBe(false);
    });

    it('excludes a company and preserves reason', async () => {
      await adapter.addCompany({
        name: 'Airbnb',
        careers_url: 'https://careers.airbnb.com',
      });

      await adapter.excludeCompany('Airbnb', 'Hiring freeze');

      const nonExcluded = await adapter.listCompanies(false);
      expect(nonExcluded).toHaveLength(0);

      const allCompanies = await adapter.listCompanies(true);
      expect(allCompanies).toHaveLength(1);
      expect(allCompanies[0].is_excluded).toBe(true);
      expect(allCompanies[0].notes).toContain('Hiring freeze');
    });

    it('updates existing company without duplicating', async () => {
      await adapter.addCompany({
        name: 'Linear',
        careers_url: 'https://linear.app/careers',
      });

      await adapter.updateCompany('Linear', {
        careers_url: 'https://linear.app/jobs',
        notes: 'Issue tracking',
      });

      const companies = await adapter.listCompanies();
      expect(companies).toHaveLength(1);
      expect(companies[0].careers_url).toBe('https://linear.app/jobs');
      expect(companies[0].notes).toBe('Issue tracking');
    });

    it('getBatch prioritizes unsearched and oldest searched non-excluded companies', async () => {
      await adapter.addCompany({ name: 'Alpha', careers_url: 'https://alpha.com', last_searched_at: '2026-09-06T10:00:00Z' });
      await adapter.addCompany({ name: 'Beta', careers_url: 'https://beta.com' }); // unsearched
      await adapter.addCompany({ name: 'Gamma', careers_url: 'https://gamma.com', last_searched_at: '2026-09-01T10:00:00Z' }); // oldest searched
      await adapter.addCompany({ name: 'Delta', careers_url: 'https://delta.com' }); // unsearched
      await adapter.excludeCompany('Beta');

      const batch = await adapter.getBatch(2);
      expect(batch).toHaveLength(2);
      // Beta is excluded, so Delta (unsearched) and Gamma (oldest) should be prioritized over Alpha
      expect(batch[0].name).toBe('Delta');
      expect(batch[1].name).toBe('Gamma');
    });
  });

  describe('Title Pattern Operations', () => {
    it('adds, lists, updates, and removes title patterns', async () => {
      await adapter.addTitlePattern({
        pattern: 'Staff Software Engineer',
        type: 'include',
        level: 'Staff',
      });
      await adapter.addTitlePattern({
        pattern: 'Frontend*',
        type: 'exclude',
      });

      const includes = await adapter.listTitlePatterns('include');
      expect(includes).toHaveLength(1);
      expect(includes[0].pattern).toBe('Staff Software Engineer');

      const excludes = await adapter.listTitlePatterns('exclude');
      expect(excludes).toHaveLength(1);
      expect(excludes[0].pattern).toBe('Frontend*');

      await adapter.updateTitlePattern('Staff Software Engineer', 'include', {
        notes: 'Target level',
      });
      const updated = await adapter.listTitlePatterns('include');
      expect(updated[0].notes).toBe('Target level');

      const removed = await adapter.removeTitlePattern('Frontend*', 'exclude');
      expect(removed).toBe(true);
      expect(await adapter.listTitlePatterns('exclude')).toHaveLength(0);
    });
  });

  describe('Skill Operations', () => {
    it('adds, lists, updates, and removes skills', async () => {
      await adapter.addSkill({
        name: 'TypeScript',
        category: 'Languages',
        importance: 'P1',
      });
      await adapter.addSkill({
        name: 'PostgreSQL',
        category: 'Databases',
        importance: 'P2',
      });

      const allSkills = await adapter.listSkills();
      expect(allSkills).toHaveLength(2);

      const dbSkills = await adapter.listSkills('Databases');
      expect(dbSkills).toHaveLength(1);
      expect(dbSkills[0].name).toBe('PostgreSQL');

      await adapter.updateSkill('TypeScript', { importance: 'core' });
      const updatedSkills = await adapter.listSkills('Languages');
      expect(updatedSkills[0].importance).toBe('core');

      const removed = await adapter.removeSkill('PostgreSQL');
      expect(removed).toBe(true);
      expect(await adapter.listSkills()).toHaveLength(1);
    });
  });

  describe('Scoring Rubric Operations', () => {
    it('updates, adds, and removes rubric dimensions', async () => {
      await adapter.updateRubricDimension('Title match', { weight: 35 });
      const rubric = await adapter.getScoringRubric();
      const titleMatch = rubric.find((r) => r.dimension === 'Title match');
      expect(titleMatch?.weight).toBe(35);

      await adapter.addRubricDimension({
        dimension: 'Culture fit',
        weight: 10,
        poor_description: 'Poor fit',
        moderate_description: 'Moderate fit',
        strong_description: 'Strong fit',
      });
      const updatedRubric = await adapter.getScoringRubric();
      expect(updatedRubric).toHaveLength(5);

      const removed = await adapter.removeRubricDimension('Culture fit');
      expect(removed).toBe(true);
      expect(await adapter.getScoringRubric()).toHaveLength(4);
    });
  });

  describe('Crawl Queue Operations', () => {
    it('adds entries, checks existence, and updates status', async () => {
      const entry = await adapter.addToQueue({
        url: 'https://stripe.com/jobs/123',
        company_name: 'Stripe',
        notes: 'Found via crawl',
      });
      expect(entry.url).toBe('https://stripe.com/jobs/123');
      expect(entry.status).toBe('pending');

      const exists = await adapter.checkUrlExists('https://stripe.com/jobs/123');
      expect(exists.exists).toBe(true);
      expect(exists.entry?.company_name).toBe('Stripe');

      const notExists = await adapter.checkUrlExists('https://stripe.com/jobs/456');
      expect(notExists.exists).toBe(false);

      const pending = await adapter.getPendingQueue('Stripe');
      expect(pending).toHaveLength(1);

      const updated = await adapter.updateQueueStatus(
        'https://stripe.com/jobs/123',
        'assessed',
        'Scored 85'
      );
      expect(updated.status).toBe('assessed');
      expect(updated.notes).toBe('Scored 85');

      const pendingAfter = await adapter.getPendingQueue('Stripe');
      expect(pendingAfter).toHaveLength(0);
    });
  });

  describe('Candidate Operations', () => {
    it('adds candidates, filters, and updates status', async () => {
      await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/staff',
        location: 'Remote',
        score: 88,
        breakdown: { 'Title match': 25, 'Skills match': 30 },
        status: 'new',
      });

      await adapter.addCandidate({
        company_name: 'Airbnb',
        job_title: 'Senior Engineer',
        url: 'https://airbnb.com/jobs/senior',
        location: 'SF',
        score: 72,
        status: 'new',
      });

      const all = await adapter.getCandidates();
      expect(all).toHaveLength(2);
      expect(all[0].score).toBe(88); // sorted by score desc

      const filtered = await adapter.getCandidates({ min_score: 80 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].company_name).toBe('Stripe');
      expect(filtered[0].breakdown).toEqual({ 'Title match': 25, 'Skills match': 30 });

      const updated = await adapter.updateCandidateStatus(
        'https://stripe.com/jobs/staff',
        'applied',
        'Submitted via referral'
      );
      expect(updated.status).toBe('applied');
      expect(updated.applied_at).toBeTruthy();
    });
  });

  describe('Run Log Operations', () => {
    it('logs runs and retrieves recent logs', async () => {
      await adapter.logRun({
        companies_processed: ['Stripe', 'Airbnb'],
        urls_queued: 5,
        candidates_scored: 2,
        summary: 'Batch run completed',
        details: { durationMs: 1200 },
      });

      const logs = await adapter.getRecentRuns(5);
      expect(logs).toHaveLength(1);
      expect(logs[0].companies_processed).toEqual(['Stripe', 'Airbnb']);
      expect(logs[0].urls_queued).toBe(5);
      expect(logs[0].candidates_scored).toBe(2);
      expect(logs[0].details).toEqual({ durationMs: 1200 });
    });
  });
});
