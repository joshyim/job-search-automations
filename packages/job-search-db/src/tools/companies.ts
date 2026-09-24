import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';
import { httpUrlSchema } from './validation.js';

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
      careers_url: httpUrlSchema.describe('The careers / jobs URL for the company'),
      ats_platform: z.string().optional().describe('ATS platform (e.g. ashby, greenhouse, lever, custom). Auto-detected from careers_url if omitted.'),
      notes: z.string().optional().describe('Optional notes about the company or industry'),
      last_searched_at: z.string().optional().describe('Optional ISO timestamp of when company was last searched'),
    },
    async ({ selected_directory, directory, name, careers_url, ats_platform, notes, last_searched_at }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const company = await adapter.addCompany({ name, careers_url, ats_platform, notes, last_searched_at });
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
      careers_url: httpUrlSchema.optional().describe('New careers / jobs URL'),
      ats_platform: z.string().optional().describe('ATS platform (e.g. ashby, greenhouse, lever, custom)'),
      is_excluded: z.boolean().optional().describe('Toggle excluded status (true/false)'),
      notes: z.string().optional().describe('Notes about the company'),
      last_searched_at: z.string().optional().describe('ISO timestamp of when company was last searched'),
    },
    async ({ selected_directory, directory, current_name, name, careers_url, ats_platform, is_excluded, notes, last_searched_at }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const company = await adapter.updateCompany(current_name, {
          name,
          careers_url,
          ats_platform,
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

  server.tool(
    'update_company_crawl_status',
    'Updates timestamp and crawl status/notes of last crawl pass for a company',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      company_name: z.string().describe('The name of the company'),
      status: z.enum(['success', 'failed', 'skipped']).describe('Crawl outcome status'),
      error_reason: z.string().optional().describe('Failure reason or error details if status is failed/skipped'),
      notes: z.string().optional().describe('Additional notes to record'),
    },
    async ({ selected_directory, directory, company_name, status, error_reason, notes }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const companies = await adapter.listCompanies(true);
        const existing = companies.find((c) => c.name.toLowerCase() === company_name.toLowerCase());
        const timestamp = new Date().toISOString();
        let updatedNotes = notes !== undefined ? notes : (existing?.notes || '');
        if (status === 'failed' || status === 'skipped') {
          const failurePrefix = `[Crawl ${status} ${timestamp.slice(0, 10)}: ${error_reason || 'Unknown error'}]`;
          updatedNotes = updatedNotes ? `${failurePrefix} ${updatedNotes}` : failurePrefix;
        }
        const updated = await adapter.updateCompany(company_name, {
          last_searched_at: timestamp,
          notes: updatedNotes,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
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
