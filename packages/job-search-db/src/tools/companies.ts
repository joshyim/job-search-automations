import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';

export function registerCompanyTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  server.tool(
    'list_companies',
    'List all target companies, optionally including excluded ones',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      include_excluded: z.boolean().optional().describe('Whether to include excluded companies (default false)'),
    },
    async ({ selected_directory, directory, include_excluded }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const companies = await adapter.listCompanies(include_excluded);
        return {
          content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }],
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
    'add_company',
    'Add a new target company or update careers URL and notes if it already exists',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      name: z.string().describe('The name of the target company'),
      careers_url: z.string().describe('The careers / jobs URL for the company'),
      notes: z.string().optional().describe('Optional notes about the company or industry'),
      last_searched_at: z.string().optional().describe('Optional ISO timestamp of when company was last searched'),
    },
    async ({ selected_directory, directory, name, careers_url, notes, last_searched_at }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const company = await adapter.addCompany({ name, careers_url, notes, last_searched_at });
        return {
          content: [{ type: 'text', text: JSON.stringify(company, null, 2) }],
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
    'exclude_company',
    'Mark a company as excluded without deleting it from the list',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      name: z.string().describe('The name of the company to exclude'),
      reason: z.string().optional().describe('Optional reason for exclusion (e.g. hiring freeze, not hiring remote)'),
    },
    async ({ selected_directory, directory, name, reason }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const company = await adapter.excludeCompany(name, reason);
        return {
          content: [{ type: 'text', text: JSON.stringify(company, null, 2) }],
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
    'update_company',
    'Update details of an existing company (name, careers URL, excluded status, notes)',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      current_name: z.string().describe('The current name of the company to update'),
      name: z.string().optional().describe('New name for the company'),
      careers_url: z.string().optional().describe('New careers / jobs URL'),
      is_excluded: z.boolean().optional().describe('Toggle excluded status (true/false)'),
      notes: z.string().optional().describe('Notes about the company'),
      last_searched_at: z.string().optional().describe('ISO timestamp of when company was last searched'),
    },
    async ({ selected_directory, directory, current_name, name, careers_url, is_excluded, notes, last_searched_at }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const company = await adapter.updateCompany(current_name, {
          name,
          careers_url,
          is_excluded,
          notes,
          last_searched_at,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(company, null, 2) }],
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
    'get_batch',
    'Get a batch of least-recently-searched companies for pipeline processing',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      limit: z.number().default(5).optional().describe('Maximum number of companies to return (default: 5)'),
    },
    async ({ selected_directory, directory, limit }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const companies = await adapter.getBatch(limit || 5);
        return {
          content: [{ type: 'text', text: JSON.stringify(companies, null, 2) }],
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
