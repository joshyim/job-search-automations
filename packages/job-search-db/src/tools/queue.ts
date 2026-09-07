import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerQueueTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'check_url_exists',
    'Check whether a job posting URL has already been queued or assessed',
    {
      url: z.string().describe('The URL to check'),
    },
    async ({ url }) => {
      const result = await adapter.checkUrlExists(url);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'add_to_queue',
    'Add a discovered job posting URL to the crawl queue with pending status',
    {
      url: z.string().describe('The job posting URL'),
      company_name: z.string().describe('The company offering the job'),
      notes: z.string().optional().describe('Optional notes about the posting'),
    },
    async ({ url, company_name, notes }) => {
      const entry = await adapter.addToQueue({ url, company_name, notes });
      return {
        content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
      };
    }
  );

  server.tool(
    'get_pending_queue',
    'Retrieve pending job URLs from the crawl queue, optionally filtered by company',
    {
      company_name: z.string().optional().describe('Optional company name filter'),
      limit: z.number().optional().describe('Optional limit on number of items returned'),
    },
    async ({ company_name, limit }) => {
      const entries = await adapter.getPendingQueue(company_name, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
      };
    }
  );

  server.tool(
    'update_queue_status',
    'Update the processing status of a URL in the crawl queue (e.g. assessed, skipped)',
    {
      url: z.string().describe('The URL to update'),
      status: z.enum(['pending', 'assessed', 'skipped']).describe('New status for the URL'),
      notes: z.string().optional().describe('Optional reason or assessment note'),
    },
    async ({ url, status, notes }) => {
      const entry = await adapter.updateQueueStatus(url, status, notes);
      return {
        content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }],
      };
    }
  );
}
