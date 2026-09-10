import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';

export function registerLogTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  server.tool(
    'log_run',
    'Record a pipeline search run with processed companies, queued URLs, and scored candidates',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      companies_processed: z.array(z.string()).describe('List of company names processed during the run'),
      urls_queued: z.number().describe('Number of new URLs added to the crawl queue'),
      candidates_scored: z.number().describe('Number of candidates assessed and scored'),
      summary: z.string().optional().describe('Summary of the run execution'),
      details: z.record(z.unknown()).optional().describe('Additional metadata or performance stats'),
    },
    async ({ selected_directory, directory, companies_processed, urls_queued, candidates_scored, summary, details }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const log = await adapter.logRun({
          companies_processed,
          urls_queued,
          candidates_scored,
          summary,
          details,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(log, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );

  server.tool(
    'get_recent_runs',
    'Retrieve recent pipeline run history',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      limit: z.number().default(10).optional().describe('Maximum number of runs to return (default: 10)'),
    },
    async ({ selected_directory, directory, limit }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const runs = await adapter.getRecentRuns(limit || 10);
        return {
          content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );
}
