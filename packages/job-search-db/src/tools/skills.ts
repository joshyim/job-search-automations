import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerSkillTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'list_skills',
    'List target skills, optionally filtered by category',
    {
      category: z.string().optional().describe('Filter by skill category (e.g. Languages, Databases, AI/ML)'),
    },
    async ({ category }) => {
      const skills = await adapter.listSkills(category);
      return {
        content: [{ type: 'text', text: JSON.stringify(skills, null, 2) }],
      };
    }
  );
}
