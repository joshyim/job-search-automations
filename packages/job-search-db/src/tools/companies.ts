import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerCompanyTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'list_companies',
    'List all target companies, optionally including excluded ones',
    {
      include_excluded: z.boolean().optional().describe('Whether to include excluded companies (default false)'),
    },
    async ({ include_excluded }) => {
      const companies = await adapter.listCompanies(include_excluded);
      return {
        content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }],
      };
    }
  );

  server.tool(
    'add_company',
    'Add a new target company or update careers URL and notes if it already exists',
    {
      name: z.string().describe('The name of the target company'),
      careers_url: z.string().describe('The careers / jobs URL for the company'),
      notes: z.string().optional().describe('Optional notes about the company or industry'),
      last_searched_at: z.string().optional().describe('Optional ISO timestamp of when company was last searched'),
    },
    async ({ name, careers_url, notes, last_searched_at }) => {
      const company = await adapter.addCompany({ name, careers_url, notes, last_searched_at });
      return {
        content: [{ type: 'text', text: JSON.stringify(company, null, 2) }],
      };
    }
  );

  server.tool(
    'exclude_company',
    'Mark a company as excluded without deleting it from the list',
    {
      name: z.string().describe('The name of the company to exclude'),
      reason: z.string().optional().describe('Optional reason for exclusion (e.g. hiring freeze, not hiring remote)'),
    },
    async ({ name, reason }) => {
      const company = await adapter.excludeCompany(name, reason);
      return {
        content: [{ type: 'text', text: JSON.stringify(company, null, 2) }],
      };
    }
  );

  server.tool(
    'get_batch',
    'Get a batch of least-recently-searched companies for pipeline processing',
    {
      limit: z.number().default(5).optional().describe('Maximum number of companies to return (default: 5)'),
    },
    async ({ limit }) => {
      const companies = await adapter.getBatch(limit || 5);
      return {
        content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }],
      };
    }
  );
}
