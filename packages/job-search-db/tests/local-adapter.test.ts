import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalAdapter } from '../src/adapters/local/local-adapter.js';

describe('LocalAdapter', () => {
  let tempDir: string;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-local-test-'));
    adapter = new LocalAdapter(tempDir);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes all 6 markdown files with standard headers', () => {
    const expectedFiles = [
      'target-companies.md',
      'target-job-titles-and-skills.md',
      'scoring-rubric.md',
      'crawl-queue.md',
      'job-candidates.md',
      'logs.md',
    ];

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(tempDir, file))).toBe(true);
    }
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

    it('getBatch prioritizes unsearched and oldest searched non-excluded companies', async () => {
      await adapter.addCompany({ name: 'Alpha', careers_url: 'https://alpha.com', last_searched_at: '2026-09-06T10:00:00Z' });
      await adapter.addCompany({ name: 'Beta', careers_url: 'https://beta.com' }); // Unsearched
      await adapter.addCompany({ name: 'Gamma', careers_url: 'https://gamma.com' });
      await adapter.excludeCompany('Gamma', 'Excluded test');

      const batch = await adapter.getBatch(2);
      expect(batch).toHaveLength(2);
      expect(batch[0].name).toBe('Beta'); // Unsearched first
      expect(batch[1].name).toBe('Alpha');
      expect(batch.map(c => c.name)).not.toContain('Gamma'); // Excluded omitted
    });
  });

  describe('Title Patterns & Skills', () => {
    it('adds, lists, and removes title patterns', async () => {
      await adapter.addTitlePattern({
        pattern: 'Staff Software Engineer',
        type: 'include',
        level: 'Staff',
        notes: 'Target level',
      });
      await adapter.addTitlePattern({
        pattern: 'Engineering Manager',
        type: 'exclude',
        level: 'Manager',
      });

      const includes = await adapter.listTitlePatterns('include');
      expect(includes).toHaveLength(1);
      expect(includes[0].pattern).toBe('Staff Software Engineer');

      const excludes = await adapter.listTitlePatterns('exclude');
      expect(excludes).toHaveLength(1);
      expect(excludes[0].pattern).toBe('Engineering Manager');

      const removed = await adapter.removeTitlePattern('Engineering Manager', 'exclude');
      expect(removed).toBe(true);

      const remaining = await adapter.listTitlePatterns();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].pattern).toBe('Staff Software Engineer');
    });

    it('lists skills by category', async () => {
      // Manually add rows to skills table for testing
      const filePath = path.join(tempDir, 'target-job-titles-and-skills.md');
      const content = fs.readFileSync(filePath, 'utf-8');
      const withSkills = content.replace(
        '| Skill | Category | Importance | Notes |\n| --- | --- | --- | --- |\n',
        '| Skill | Category | Importance | Notes |\n| --- | --- | --- | --- |\n| TypeScript | Languages | required | Primary |\n| Python | Languages | preferred | Secondary |\n| Postgres | Databases | required | Primary DB |\n'
      );
      fs.writeFileSync(filePath, withSkills, 'utf-8');

      const languageSkills = await adapter.listSkills('Languages');
      expect(languageSkills).toHaveLength(2);
      expect(languageSkills.map(s => s.name)).toEqual(['TypeScript', 'Python']);

      const allSkills = await adapter.listSkills();
      expect(allSkills).toHaveLength(3);
    });
  });

  describe('Scoring Rubric Operations', () => {
    it('retrieves initialized rubric dimensions', async () => {
      const rubric = await adapter.getScoringRubric();
      expect(rubric.length).toBeGreaterThanOrEqual(4);
      expect(rubric.map(r => r.dimension)).toContain('Title match');
      expect(rubric.map(r => r.dimension)).toContain('Skills match');
    });

    it('updates rubric dimension weight and descriptions', async () => {
      const updated = await adapter.updateRubricDimension('Title match', {
        weight: 35,
        strong_description: 'Exact Staff level match',
      });

      expect(updated.weight).toBe(35);
      expect(updated.strong_description).toBe('Exact Staff level match');

      const rubric = await adapter.getScoringRubric();
      const titleMatch = rubric.find(r => r.dimension === 'Title match');
      expect(titleMatch?.weight).toBe(35);
      expect(titleMatch?.strong_description).toBe('Exact Staff level match');
    });

    it('adds and removes a rubric dimension', async () => {
      await adapter.addRubricDimension({
        dimension: 'Location / Remote Fit',
        weight: 15,
        poor_description: 'On-site required',
        moderate_description: 'Hybrid with travel',
        strong_description: '100% remote',
      });

      let rubric = await adapter.getScoringRubric();
      expect(rubric.map(r => r.dimension)).toContain('Location / Remote Fit');

      const removed = await adapter.removeRubricDimension('Location / Remote Fit');
      expect(removed).toBe(true);

      rubric = await adapter.getScoringRubric();
      expect(rubric.map(r => r.dimension)).not.toContain('Location / Remote Fit');
    });
  });

  describe('Crawl Queue Operations', () => {
    it('checks existence, adds to queue, and updates status', async () => {
      const url = 'https://stripe.com/jobs/12345';
      const initialCheck = await adapter.checkUrlExists(url);
      expect(initialCheck.exists).toBe(false);

      const entry = await adapter.addToQueue({
        url,
        company_name: 'Stripe',
        notes: 'Found via career portal',
      });
      expect(entry.status).toBe('pending');

      const existsCheck = await adapter.checkUrlExists(url);
      expect(existsCheck.exists).toBe(true);
      expect(existsCheck.entry?.company_name).toBe('Stripe');

      const pending = await adapter.getPendingQueue('Stripe');
      expect(pending).toHaveLength(1);

      const updated = await adapter.updateQueueStatus(url, 'assessed', 'Scored 9/10');
      expect(updated.status).toBe('assessed');
      expect(updated.notes).toBe('Scored 9/10');

      const remainingPending = await adapter.getPendingQueue('Stripe');
      expect(remainingPending).toHaveLength(0);
    });
  });

  describe('Candidate Operations', () => {
    it('adds, updates status, filters, and sorts candidates', async () => {
      await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/staff',
        location: 'Remote, US',
        score: 9.2,
        breakdown: { title: 9, skills: 9.5 },
        status: 'new',
        notes: 'Great match',
      });

      await adapter.addCandidate({
        company_name: 'Datadog',
        job_title: 'Senior Engineer',
        url: 'https://datadog.com/jobs/senior',
        location: 'New York, NY',
        score: 7.5,
        breakdown: { title: 7, skills: 8 },
        status: 'new',
      });

      // Get candidates sorted by score descending
      const candidates = await adapter.getCandidates({ min_score: 8.0 });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].company_name).toBe('Stripe');

      // Update candidate status
      const updated = await adapter.updateCandidateStatus('https://stripe.com/jobs/staff', 'applied', 'Submitted resume');
      expect(updated.status).toBe('applied');
      expect(updated.applied_at).toBeDefined();

      const appliedList = await adapter.getCandidates({ status: 'applied' });
      expect(appliedList).toHaveLength(1);
      expect(appliedList[0].job_title).toBe('Staff Engineer');
    });
  });

  describe('Run Log Operations', () => {
    it('logs pipeline runs and retrieves recent history', async () => {
      await adapter.logRun({
        companies_processed: ['Stripe', 'Datadog'],
        urls_queued: 12,
        candidates_scored: 5,
        summary: 'Batch run finished successfully',
        details: { durationMs: 1200 },
      });

      const runs = await adapter.getRecentRuns(5);
      expect(runs).toHaveLength(1);
      expect(runs[0].companies_processed).toEqual(['Stripe', 'Datadog']);
      expect(runs[0].urls_queued).toBe(12);
      expect(runs[0].candidates_scored).toBe(5);
      expect(runs[0].mode).toBe('local');
    });
  });
});
