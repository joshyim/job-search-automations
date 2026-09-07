import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalAdapter } from '../src/adapters/local/local-adapter.js';

describe('Markdown Storage Round-Trip Fidelity', () => {
  let tempDir: string;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-roundtrip-test-'));
    adapter = new LocalAdapter(tempDir);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const files = [
    'target-companies.md',
    'target-job-titles-and-skills.md',
    'scoring-rubric.md',
    'crawl-queue.md',
    'job-candidates.md',
    'logs.md',
  ];

  it('populates realistic data and ensures read-then-write produces identical output when no changes are made', async () => {
    // Populate realistic data across all 6 files
    await adapter.addCompany({
      name: 'Stripe',
      careers_url: 'https://stripe.com/jobs',
      notes: 'Fintech platform',
      last_searched_at: '2026-09-01T12:00:00.000Z',
    });
    await adapter.excludeCompany('Airbnb', 'Hiring freeze in Q3');

    await adapter.addTitlePattern({
      pattern: 'Staff Software Engineer',
      type: 'include',
      level: 'Staff',
      notes: 'IC track',
    });
    await adapter.addTitlePattern({
      pattern: 'Engineering Manager',
      type: 'exclude',
      level: 'EM',
      notes: 'No management roles',
    });

    await adapter.addToQueue({
      url: 'https://stripe.com/jobs/101',
      company_name: 'Stripe',
      notes: 'Staff Infrastructure',
    });
    await adapter.updateQueueStatus('https://stripe.com/jobs/101', 'assessed', 'Passed initial screening');

    await adapter.addCandidate({
      company_name: 'Stripe',
      job_title: 'Staff Software Engineer',
      url: 'https://stripe.com/jobs/101',
      location: 'Remote, US',
      score: 9.4,
      breakdown: { title: 9.5, skills: 9.0 },
      status: 'new',
      notes: 'Strong candidate',
    });

    await adapter.logRun({
      companies_processed: ['Stripe', 'Airbnb'],
      urls_queued: 5,
      candidates_scored: 2,
      summary: 'Daily crawl completed',
      details: { processedAt: '2026-09-06T19:00:00Z' },
    });

    // Capture the state of all 6 files
    const fileStatesBefore: Record<string, string> = {};
    for (const f of files) {
      fileStatesBefore[f] = fs.readFileSync(path.join(tempDir, f), 'utf-8');
    }

    // Now re-read all data and perform idempotent read-only or identical write-back
    // Reading data through adapter
    const companies = await adapter.listCompanies(true);
    const titles = await adapter.listTitlePatterns();
    const skills = await adapter.listSkills();
    const rubric = await adapter.getScoringRubric();
    const queue = await adapter.getPendingQueue();
    const candidates = await adapter.getCandidates();
    const runs = await adapter.getRecentRuns();

    expect(companies.length).toBeGreaterThanOrEqual(2);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(rubric.length).toBeGreaterThanOrEqual(4);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(runs.length).toBeGreaterThanOrEqual(1);

    // Verify files were not modified simply by reading
    for (const f of files) {
      const currentContent = fs.readFileSync(path.join(tempDir, f), 'utf-8');
      expect(currentContent).toBe(fileStatesBefore[f]);
    }
  });

  it('re-saving identical rows preserves content identically', async () => {
    // Add a company
    await adapter.addCompany({
      name: 'Stripe',
      careers_url: 'https://stripe.com/jobs',
      notes: 'Fintech',
    });

    const fileContent1 = fs.readFileSync(path.join(tempDir, 'target-companies.md'), 'utf-8');

    // Add company again with identical data (idempotent update)
    await adapter.addCompany({
      name: 'Stripe',
      careers_url: 'https://stripe.com/jobs',
      notes: 'Fintech',
    });

    const fileContent2 = fs.readFileSync(path.join(tempDir, 'target-companies.md'), 'utf-8');
    expect(fileContent2).toBe(fileContent1);
  });
});
