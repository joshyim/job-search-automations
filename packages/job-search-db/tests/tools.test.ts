import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DataAdapter } from '../src/adapters/types.js';
import { WorkspaceManager } from '../src/workspace.js';
import { registerAllTools } from '../src/tools/register.js';

describe('MCP Tools Registration & Invocation', () => {
  function createMockAdapter(): DataAdapter {
    return {
      initialize: vi.fn(),
      close: vi.fn(),
      listCompanies: vi.fn().mockResolvedValue([{ name: 'Stripe', careers_url: 'https://stripe.com', is_excluded: false }]),
      addCompany: vi.fn().mockResolvedValue({ name: 'Airbnb', careers_url: 'https://airbnb.com', is_excluded: false }),
      updateCompany: vi.fn().mockResolvedValue({ name: 'Airbnb', careers_url: 'https://airbnb.com/jobs', is_excluded: false }),
      excludeCompany: vi.fn().mockResolvedValue({ name: 'OldCo', is_excluded: true }),
      getBatch: vi.fn().mockResolvedValue([{ name: 'Stripe', careers_url: 'https://stripe.com' }]),
      listTitlePatterns: vi.fn().mockResolvedValue([{ pattern: 'Staff Engineer', type: 'include' }]),
      addTitlePattern: vi.fn().mockResolvedValue({ pattern: 'Principal Engineer', type: 'include' }),
      updateTitlePattern: vi.fn().mockResolvedValue({ pattern: 'Staff Engineer', type: 'include', level: 'Staff' }),
      removeTitlePattern: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([{ name: 'TypeScript', category: 'Languages' }]),
      addSkill: vi.fn().mockResolvedValue({ name: 'TypeScript', category: 'Languages', importance: 'core' }),
      updateSkill: vi.fn().mockResolvedValue({ name: 'TypeScript', importance: 'P1' }),
      removeSkill: vi.fn().mockResolvedValue(true),
      getScoringRubric: vi.fn().mockResolvedValue([{ dimension: 'Title match', weight: 25 }]),
      updateRubricDimension: vi.fn().mockResolvedValue({ dimension: 'Title match', weight: 30 }),
      addRubricDimension: vi.fn().mockResolvedValue({ dimension: 'New Dim', weight: 10 }),
      removeRubricDimension: vi.fn().mockResolvedValue(true),
      checkUrlExists: vi.fn().mockResolvedValue({ exists: true }),
      addToQueue: vi.fn().mockResolvedValue({ url: 'https://example.com/job', status: 'pending' }),
      getPendingQueue: vi.fn().mockResolvedValue([{ url: 'https://example.com/job', status: 'pending' }]),
      listQueue: vi.fn().mockResolvedValue([{ url: 'https://example.com/job', status: 'pending' }]),
      updateQueueStatus: vi.fn().mockResolvedValue({ url: 'https://example.com/job', status: 'assessed' }),
      addCandidate: vi.fn().mockResolvedValue({ job_title: 'Staff Engineer', score: 9.0, status: 'new' }),
      updateCandidateStatus: vi.fn().mockResolvedValue({ url: 'https://example.com', status: 'applied' }),
      getCandidates: vi.fn().mockResolvedValue([{ job_title: 'Staff Engineer', score: 9.0 }]),
      logRun: vi.fn().mockResolvedValue({ id: 1, mode: 'local', companies_processed: ['Stripe'] }),
      getRecentRuns: vi.fn().mockResolvedValue([{ id: 1, mode: 'local' }]),
    };
  }

  function createMockWorkspaceManager(adapter: DataAdapter): WorkspaceManager {
    const wm = new WorkspaceManager();
    vi.spyOn(wm, 'getAdapter').mockResolvedValue(adapter);
    vi.spyOn(wm, 'selectWorkspace').mockResolvedValue({
      status: 'active',
      workspace_directory: '/mock/project',
      database_path: '/mock/project/.job-search/job-search.sqlite',
      resume_path: '/mock/project/.job-search/resume.pdf',
    });
    vi.spyOn(wm, 'getWorkspaceInfo').mockResolvedValue({
      active_workspace: '/mock/project',
      database_path: '/mock/project/.job-search/job-search.sqlite',
      resume_path: '/mock/project/.job-search/resume.pdf',
      resume_exists: true,
      config_path: '/mock/project/.job-search/config.json',
      config_exists: true,
    });
    return wm;
  }

  it('registers all expected tools on the McpServer', () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);

    registerAllTools(server, wm);

    const registeredToolNames = Object.keys((server as any)._registeredTools);

    const expectedTools = [
      'select_workspace',
      'get_workspace_info',
      'list_companies',
      'add_company',
      'update_company',
      'exclude_company',
      'get_batch',
      'list_title_patterns',
      'add_title_pattern',
      'update_title_pattern',
      'remove_title_pattern',
      'list_skills',
      'add_skill',
      'update_skill',
      'remove_skill',
      'get_scoring_rubric',
      'update_rubric_dimension',
      'add_rubric_dimension',
      'remove_rubric_dimension',
      'check_url_exists',
      'add_to_queue',
      'get_pending_queue',
      'list_queue',
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

  it('invokes select_workspace tool and returns workspace details', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);
    registerAllTools(server, wm);

    const selectTool = (server as any)._registeredTools['select_workspace'];
    const result = await selectTool.handler({ directory: '/mock/project' });
    expect(wm.selectWorkspace).toHaveBeenCalledWith('/mock/project');
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('active');
    expect(parsed.workspace_directory).toBe('/mock/project');
  });

  it('invokes company tools and returns expected text content', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);
    registerAllTools(server, wm);

    const listCompaniesTool = (server as any)._registeredTools['list_companies'];
    const result = await listCompaniesTool.handler({ include_excluded: false, selected_directory: '/mock/project' });
    expect(wm.getAdapter).toHaveBeenCalledWith('/mock/project');
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual([
      { name: 'Stripe', careers_url: 'https://stripe.com', is_excluded: false },
    ]);
  });

  it('invokes get_batch tool and delegates to adapter', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);
    registerAllTools(server, wm);

    const getBatchTool = (server as any)._registeredTools['get_batch'];
    const result = await getBatchTool.handler({ limit: 3, directory: '/mock/project' });
    expect(wm.getAdapter).toHaveBeenCalledWith('/mock/project');
    expect(adapter.getBatch).toHaveBeenCalledWith(3);
    expect(JSON.parse(result.content[0].text)).toHaveLength(1);
  });

  it('invokes candidate and log tools properly', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);
    registerAllTools(server, wm);

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

  it('invokes update_company, update_title_pattern, skill tools, and list_queue properly', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const adapter = createMockAdapter();
    const wm = createMockWorkspaceManager(adapter);
    registerAllTools(server, wm);

    // update_company
    const updateCompanyTool = (server as any)._registeredTools['update_company'];
    await updateCompanyTool.handler({
      current_name: 'Airbnb',
      careers_url: 'https://airbnb.com/jobs',
      is_excluded: false,
    });
    expect(adapter.updateCompany).toHaveBeenCalledWith('Airbnb', {
      careers_url: 'https://airbnb.com/jobs',
      is_excluded: false,
    });

    // update_title_pattern
    const updateTitlePatternTool = (server as any)._registeredTools['update_title_pattern'];
    await updateTitlePatternTool.handler({
      current_pattern: 'Staff Engineer',
      current_type: 'include',
      level: 'Staff',
    });
    expect(adapter.updateTitlePattern).toHaveBeenCalledWith('Staff Engineer', 'include', {
      level: 'Staff',
    });

    // add_skill
    const addSkillTool = (server as any)._registeredTools['add_skill'];
    await addSkillTool.handler({
      name: 'TypeScript',
      category: 'Languages',
      importance: 'core',
    });
    expect(adapter.addSkill).toHaveBeenCalledWith({
      name: 'TypeScript',
      category: 'Languages',
      importance: 'core',
    });

    // update_skill
    const updateSkillTool = (server as any)._registeredTools['update_skill'];
    await updateSkillTool.handler({
      name: 'TypeScript',
      importance: 'P1',
    });
    expect(adapter.updateSkill).toHaveBeenCalledWith('TypeScript', {
      importance: 'P1',
    });

    // remove_skill
    const removeSkillTool = (server as any)._registeredTools['remove_skill'];
    await removeSkillTool.handler({ name: 'TypeScript' });
    expect(adapter.removeSkill).toHaveBeenCalledWith('TypeScript');

    // list_queue
    const listQueueTool = (server as any)._registeredTools['list_queue'];
    await listQueueTool.handler({ status: 'pending' });
    expect(adapter.listQueue).toHaveBeenCalledWith({ status: 'pending' });
  });

  it('returns actionable error response when workspace is uninitialized', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.1.0' });
    const wm = new WorkspaceManager(); // uninitialized
    registerAllTools(server, wm);

    const listCompaniesTool = (server as any)._registeredTools['list_companies'];
    const result = await listCompaniesTool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No workspace directory provided');
  });
});
