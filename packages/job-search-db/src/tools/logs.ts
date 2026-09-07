import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerLogTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'log_run',
    'Record a pipeline search run with processed companies, queued URLs, and scored candidates',
    {
      companies_processed: z.array(z.string()).describe('List of company names processed during the run'),
      urls_queued: z.number().describe('Number of new URLs added to the crawl queue'),
      candidates_scored: z.number().describe('Number of candidates assessed and scored'),
      summary: z.string().optional().describe('Summary of the run execution'),
      details: z.record(z.unknown()).optional().describe('Additional metadata or performance stats'),
    },
    async ({ companies_processed, urls_queued, candidates_scored, summary, details }) => {
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
    }
  );

  server.tool(
    'get_recent_runs',
    'Retrieve recent pipeline run history',
    {
      limit: z.number().default(10).optional().describe('Maximum number of runs to return (default: 10)'),
    },
    async ({ limit }) => {
      const runs = await adapter.getRecentRuns(limit || 10);
      return {
        content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }],
      };
    }
  );
}
