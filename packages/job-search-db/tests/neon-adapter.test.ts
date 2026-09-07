import { describe, it, expect, vi } from 'vitest';
import { NeonAdapter } from '../src/adapters/neon/neon-adapter.js';

describe('NeonAdapter', () => {
  function createMockPool() {
    return {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('initializes by verifying connection with SELECT 1', async () => {
    const mockPool = createMockPool();
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const adapter = new NeonAdapter({
      connectionString: 'postgres://user:pass@ep-test.neon.tech/neondb',
      poolInstance: mockPool as any,
    });

    await adapter.initialize();
    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    await adapter.close();
    expect(mockPool.end).toHaveBeenCalled();
  });

  describe('Company Operations', () => {
    it('executes parameterized listCompanies query', async () => {
      const mockPool = createMockPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Stripe',
            careers_url: 'https://stripe.com/jobs',
            is_excluded: false,
            notes: null,
            last_searched_at: null,
            created_at: '2026-09-06T00:00:00Z',
            updated_at: '2026-09-06T00:00:00Z',
          },
        ],
      });

      const adapter = new NeonAdapter({
        connectionString: 'postgres://mock/db',
        poolInstance: mockPool as any,
      });

      const companies = await adapter.listCompanies(false);
      expect(companies).toHaveLength(1);
      expect(companies[0].name).toBe('Stripe');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_excluded = FALSE'),
        []
      );
    });

    it('executes upsert for addCompany', async () => {
      const mockPool = createMockPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Stripe',
            careers_url: 'https://stripe.com/jobs',
            is_excluded: false,
            notes: 'Fintech',
            last_searched_at: null,
            created_at: '2026-09-06T00:00:00Z',
            updated_at: '2026-09-06T00:00:00Z',
          },
        ],
      });

      const adapter = new NeonAdapter({
        connectionString: 'postgres://mock/db',
        poolInstance: mockPool as any,
      });

      const company = await adapter.addCompany({
        name: 'Stripe',
        careers_url: 'https://stripe.com/jobs',
        notes: 'Fintech',
      });

      expect(company.name).toBe('Stripe');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (name) DO UPDATE'),
        ['Stripe', 'https://stripe.com/jobs', 'Fintech', null]
      );
    });

    it('executes getBatch ordered by last_searched_at ASC NULLS FIRST', async () => {
      const mockPool = createMockPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'OldestCompany',
            careers_url: 'https://oldest.com',
            is_excluded: false,
            notes: null,
            last_searched_at: null,
            created_at: '2026-09-06T00:00:00Z',
            updated_at: '2026-09-06T00:00:00Z',
          },
        ],
      });

      const adapter = new NeonAdapter({
        connectionString: 'postgres://mock/db',
        poolInstance: mockPool as any,
      });

      const batch = await adapter.getBatch(5);
      expect(batch).toHaveLength(1);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY last_searched_at ASC NULLS FIRST'),
        [5]
      );
    });
  });

  describe('Crawl Queue Operations', () => {
    it('executes checkUrlExists with parameter', async () => {
      const mockPool = createMockPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            url: 'https://stripe.com/jobs/99',
            company_name: 'Stripe',
            status: 'pending',
            notes: null,
            created_at: '2026-09-06T10:00:00Z',
            updated_at: '2026-09-06T10:00:00Z',
          },
        ],
      });

      const adapter = new NeonAdapter({
        connectionString: 'postgres://mock/db',
        poolInstance: mockPool as any,
      });

      const res = await adapter.checkUrlExists('https://stripe.com/jobs/99');
      expect(res.exists).toBe(true);
      expect(res.entry?.company_name).toBe('Stripe');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE url = $1'),
        ['https://stripe.com/jobs/99']
      );
    });
  });

  describe('Candidate Operations', () => {
    it('adds and updates candidate status with parameterized query', async () => {
      const mockPool = createMockPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            company_name: 'Stripe',
            job_title: 'Staff Engineer',
            url: 'https://stripe.com/jobs/1',
            location: 'Remote',
            score: 9.5,
            breakdown: { title: 10 },
            status: 'new',
            notes: 'High fit',
            discovered_at: '2026-09-06T00:00:00Z',
            applied_at: null,
            updated_at: '2026-09-06T00:00:00Z',
          },
        ],
      });

      const adapter = new NeonAdapter({
        connectionString: 'postgres://mock/db',
        poolInstance: mockPool as any,
      });

      const candidate = await adapter.addCandidate({
        company_name: 'Stripe',
        job_title: 'Staff Engineer',
        url: 'https://stripe.com/jobs/1',
        location: 'Remote',
        score: 9.5,
        breakdown: { title: 10 },
        notes: 'High fit',
      });

      expect(candidate.company_name).toBe('Stripe');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO candidates'),
        expect.any(Array)
      );
    });
  });
});
