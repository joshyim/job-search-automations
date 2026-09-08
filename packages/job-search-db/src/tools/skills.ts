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

  server.tool(
    'add_skill',
    'Add a new target skill or update existing skill details',
    {
      name: z.string().describe('Name of the skill (e.g. "TypeScript", "PostgreSQL")'),
      category: z.string().optional().describe('Skill category (e.g. Languages, Databases, AI/ML)'),
      importance: z.string().optional().describe('Skill priority/importance (e.g. core, preferred, P1, P2)'),
      notes: z.string().optional().describe('Optional notes about target proficiency or context'),
    },
    async ({ name, category, importance, notes }) => {
      const skill = await adapter.addSkill({ name, category, importance, notes });
      return {
        content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
      };
    }
  );

  server.tool(
    'update_skill',
    'Update an existing target skill priority, category, or notes',
    {
      name: z.string().describe('The name of the skill to update'),
      category: z.string().optional().describe('New skill category'),
      importance: z.string().optional().describe('New skill priority/importance'),
      notes: z.string().optional().describe('New notes'),
    },
    async ({ name, category, importance, notes }) => {
      const skill = await adapter.updateSkill(name, { category, importance, notes });
      return {
        content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
      };
    }
  );

  server.tool(
    'remove_skill',
    'Remove a skill from the target skills list',
    {
      name: z.string().describe('The name of the skill to remove'),
    },
    async ({ name }) => {
      const removed = await adapter.removeSkill(name);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: removed }, null, 2) }],
      };
    }
  );
}
