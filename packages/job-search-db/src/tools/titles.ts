import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerTitleTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'list_title_patterns',
    'List job title include and exclude patterns with target levels and notes',
    {
      type: z.enum(['include', 'exclude']).optional().describe('Filter by pattern type ("include" or "exclude")'),
    },
    async ({ type }) => {
      const patterns = await adapter.listTitlePatterns(type);
      return {
        content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }],
      };
    }
  );

  server.tool(
    'add_title_pattern',
    'Add a new job title match pattern (include or exclude)',
    {
      pattern: z.string().describe('Job title pattern (e.g. "Staff Software Engineer")'),
      type: z.enum(['include', 'exclude']).describe('Whether this is an include or exclude pattern'),
      level: z.string().optional().describe('Target level (e.g. "Staff", "Principal", "Lead")'),
      notes: z.string().optional().describe('Notes or matching guidelines'),
    },
    async ({ pattern, type, level, notes }) => {
      const result = await adapter.addTitlePattern({ pattern, type, level, notes });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'update_title_pattern',
    'Update an existing job title match pattern, level, or notes',
    {
      current_pattern: z.string().describe('The current pattern to update'),
      current_type: z.enum(['include', 'exclude']).describe('The current pattern type'),
      pattern: z.string().optional().describe('New pattern string'),
      type: z.enum(['include', 'exclude']).optional().describe('New pattern type'),
      level: z.string().optional().describe('New target level'),
      notes: z.string().optional().describe('New notes'),
    },
    async ({ current_pattern, current_type, pattern, type, level, notes }) => {
      const result = await adapter.updateTitlePattern(current_pattern, current_type, {
        pattern,
        type,
        level,
        notes,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'remove_title_pattern',
    'Remove a job title match pattern',
    {
      pattern: z.string().describe('The pattern to remove'),
      type: z.enum(['include', 'exclude']).optional().describe('Optional type filter'),
    },
    async ({ pattern, type }) => {
      const removed = await adapter.removeTitlePattern(pattern, type);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: removed }, null, 2) }],
      };
    }
  );
}
