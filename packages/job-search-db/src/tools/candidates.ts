import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CandidateStatus, DataAdapter } from '../adapters/types.js';

export function registerCandidateTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'add_candidate',
    'Add or update a scored candidate job opportunity',
    {
      company_name: z.string().describe('Company name'),
      job_title: z.string().describe('Job title'),
      url: z.string().describe('Job posting URL'),
      location: z.string().optional().describe('Job location (e.g. Remote, San Francisco, CA)'),
      score: z.number().optional().describe('Overall match score (0-10 or 0-100)'),
      breakdown: z.record(z.number()).optional().describe('Score breakdown by rubric dimension'),
      status: z.enum(['new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer']).optional().describe('Pipeline status (default "new")'),
      notes: z.string().optional().describe('Notes, key strengths, or interview highlights'),
    },
    async ({ company_name, job_title, url, location, score, breakdown, status, notes }) => {
      const candidate = await adapter.addCandidate({
        company_name,
        job_title,
        url,
        location,
        score,
        breakdown,
        status: status as CandidateStatus | undefined,
        notes,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(candidate, null, 2) }],
      };
    }
  );

  server.tool(
    'update_candidate_status',
    'Update the status of a candidate job posting (new, applied, in_progress, not_pursuing)',
    {
      url: z.string().describe('The URL of the candidate to update'),
      status: z.enum(['new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer']).describe('New application status'),
      notes: z.string().optional().describe('Optional notes about the status update'),
    },
    async ({ url, status, notes }) => {
      const candidate = await adapter.updateCandidateStatus(url, status as CandidateStatus, notes);
      return {
        content: [{ type: 'text', text: JSON.stringify(candidate, null, 2) }],
      };
    }
  );

  server.tool(
    'get_candidates',
    'Retrieve job candidates, filterable by status, company, or score, and sortable',
    {
      status: z.enum(['new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer']).optional().describe('Filter by status'),
      min_score: z.number().optional().describe('Filter by minimum score'),
      company_name: z.string().optional().describe('Filter by company name'),
      limit: z.number().optional().describe('Limit the number of candidates returned'),
      sort_by: z.enum(['score', 'discovered_at']).optional().describe('Sort field ("score" or "discovered_at", default "score")'),
      sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction ("asc" or "desc", default "desc")'),
    },
    async ({ status, min_score, company_name, limit, sort_by, sort_order }) => {
      const candidates = await adapter.getCandidates({
        status: status as CandidateStatus | undefined,
        min_score,
        company_name,
        limit,
        sort_by,
        sort_order,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(candidates, null, 2) }],
      };
    }
  );
}
