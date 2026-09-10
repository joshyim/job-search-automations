import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';

export function registerQueueTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  server.tool(
    'check_url_exists',
    'Check whether a job posting URL has already been queued or assessed',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      url: z.string().describe('The URL to check'),
    },
    async ({ selected_directory, directory, url }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const result = await adapter.checkUrlExists(url);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
    'add_to_queue',
    'Add a discovered job posting URL to the crawl queue with pending status',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      url: z.string().describe('The job posting URL'),
      company_name: z.string().describe('The company offering the job'),
      notes: z.string().optional().describe('Optional notes about the posting'),
    },
    async ({ selected_directory, directory, url, company_name, notes }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const entry = await adapter.addToQueue({ url, company_name, notes });
        return {
          content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
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
    'get_pending_queue',
    'Retrieve pending job URLs from the crawl queue, optionally filtered by company',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      company_name: z.string().optional().describe('Optional company name filter'),
      limit: z.number().optional().describe('Optional limit on number of items returned'),
    },
    async ({ selected_directory, directory, company_name, limit }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const entries = await adapter.getPendingQueue(company_name, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
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
    'list_queue',
    'Retrieve crawl queue entries, optionally filtered by status (pending, assessed, skipped) or company',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      status: z.enum(['pending', 'assessed', 'skipped']).optional().describe('Filter by queue status'),
      company_name: z.string().optional().describe('Optional company name filter'),
      limit: z.number().optional().describe('Optional limit on number of items returned'),
    },
    async ({ selected_directory, directory, status, company_name, limit }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const entries = await adapter.listQueue({ status, company_name, limit });
        return {
          content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
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
    'update_queue_status',
    'Update the processing status of a URL in the crawl queue (e.g. assessed, skipped)',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      url: z.string().describe('The URL to update'),
      status: z.enum(['pending', 'assessed', 'skipped']).describe('New status for the URL'),
      notes: z.string().optional().describe('Optional reason or assessment note'),
    },
    async ({ selected_directory, directory, url, status, notes }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const entry = await adapter.updateQueueStatus(url, status, notes);
        return {
          content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
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
