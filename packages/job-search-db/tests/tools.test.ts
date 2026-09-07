import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DataAdapter } from '../src/adapters/types.js';
import { registerAllTools } from '../src/tools/register.js';

describe('MCP Tools Registration & Invocation', () => {
  function createMockAdapter(): DataAdapter {
    return {
      initialize: vi.fn(),
      close: vi.fn(),
      listCompanies: vi.fn().mockResolvedValue([{ name: 'Stripe', careers_url: 'https://stripe.com', is_excluded: false }]),
      addCompany: vi.fn().mockResolvedValue({ name: 'Airbnb', careers_url: 'https://airbnb.com', is_excluded: false }),
      excludeCompany: vi.fn().mockResolvedValue({ name: 'OldCo', is_excluded: true }),
      getBatch: vi.fn().mockResolvedValue([{ name: 'Stripe', careers_url: 'https://stripe.com' }]),
      listTitlePatterns: vi.fn().mockResolvedValue([{ pattern: 'Staff Engineer', type: 'include' }]),
      addTitlePattern: vi.fn().mockResolvedValue({ pattern: 'Principal Engineer', type: 'include' }),
      removeTitlePattern: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([{ name: 'TypeScript', category: 'Languages' }]),
      getScoringRubric: vi.fn().mockResolvedValue([{ dimension: 'Title match', weight: 25 }]),
      updateRubricDimension: vi.fn().mockResolvedValue({ dimension: 'Title match', weight: 30 }),
      addRubricDimension: vi.fn().mockResolvedValue({ dimension: 'New Dim', weight: 10 }),
      removeRubricDimension: vi.fn().mockResolvedValue(true),
      checkUrlExists: vi.fn().mockResolvedValue({ exists: true }),
      addToQueue: vi.fn().mockResolvedValue({ url: 'https://example.com/job', status: 'pending' }),
      getPendingQueue: vi.fn().mockResolvedValue([{ url: 'https://example.com/job', status: 'pending' }]),
      updateQueueStatus: vi.fn().mockResolvedValue({ url: 'https://example.com/job', status: 'assessed' }),
      addCandidate: vi.fn().mockResolvedValue({ job_title: 'Staff Engineer', score: 9.0, status: 'new' }),
      updateCandidateStatus: vi.fn().mockResolvedValue({ url: 'https://example.com', status: 'applied' }),
      getCandidates: vi.fn().mockResolvedValue([{ job_title: 'Staff Engineer', score: 9.0 }]),
      logRun: vi.fn().mockResolvedValue({ id: 1, mode: 'local', companies_processed: ['Stripe'] }),
      getRecentRuns: vi.fn().mockResolvedValue([{ id: 1, mode: 'local' }]),
    };
  }

  it('registers all expected tools on the McpServer', () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();

    registerAllTools(server, adapter);

    const registeredToolNames = Object.keys((server as any)._registeredTools);

    const expectedTools = [
      'list_companies',
      'add_company',
      'exclude_company',
      'get_batch',
      'list_title_patterns',
      'add_title_pattern',
      'remove_title_pattern',
      'list_skills',
      'get_scoring_rubric',
      'update_rubric_dimension',
      'add_rubric_dimension',
      'remove_rubric_dimension',
      'check_url_exists',
      'add_to_queue',
      'get_pending_queue',
      'update_queue_status',
      'add_candidate',
      'update_candidate_status',
      'get_candidates',
      'log_run',
      'get_recent_runs',
    ];

    for (const toolName of expectedTools) {
      expect(registeredToolNames).toContain(toolName);
    }
  });

  it('invokes company tools and returns expected text content', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    registerAllTools(server, adapter);

    const listCompaniesTool = (server as any)._registeredTools['list_companies'];
    const result = await listCompaniesTool.handler({ include_excluded: false });
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual([
      { name: 'Stripe', careers_url: 'https://stripe.com', is_excluded: false },
    ]);
  });

  it('invokes get_batch tool and delegates to adapter', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    registerAllTools(server, adapter);

    const getBatchTool = (server as any)._registeredTools['get_batch'];
    const result = await getBatchTool.handler({ limit: 3 });
    expect(adapter.getBatch).toHaveBeenCalledWith(3);
    expect(JSON.parse(result.content[0].text)).toHaveLength(1);
  });

  it('invokes candidate and log tools properly', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    registerAllTools(server, adapter);

    const addCandidateTool = (server as any)._registeredTools['add_candidate'];
    await addCandidateTool.handler({
      company_name: 'Stripe',
      job_title: 'Staff Engineer',
      url: 'https://stripe.com/jobs/1',
      score: 9.0,
      status: 'new',
    });
    expect(adapter.addCandidate).toHaveBeenCalled();

    const logRunTool = (server as any)._registeredTools['log_run'];
    await logRunTool.handler({
      companies_processed: ['Stripe'],
      urls_queued: 10,
      candidates_scored: 3,
      summary: 'Run completed',
    });
    expect(adapter.logRun).toHaveBeenCalled();
  });
});
