import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';

export function registerSkillTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  server.tool(
    'list_skills',
    'List target skills, optionally filtered by category',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      category: z.string().optional().describe('Filter by skill category (e.g. Languages, Databases, AI/ML)'),
    },
    async ({ selected_directory, directory, category }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const skills = await adapter.listSkills(category);
        return {
          content: [{ type: 'text', text: JSON.stringify(skills, null, 2) }],
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
    'add_skill',
    'Add a new target skill or update existing skill details',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      name: z.string().describe('Name of the skill (e.g. "TypeScript", "PostgreSQL")'),
      category: z.string().optional().describe('Skill category (e.g. Languages, Databases, AI/ML)'),
      importance: z.string().optional().describe('Skill priority/importance (e.g. core, preferred, P1, P2)'),
      notes: z.string().optional().describe('Optional notes about target proficiency or context'),
    },
    async ({ selected_directory, directory, name, category, importance, notes }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const skill = await adapter.addSkill({ name, category, importance, notes });
        return {
          content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
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
    'update_skill',
    'Update an existing target skill priority, category, or notes',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      name: z.string().describe('The name of the skill to update'),
      category: z.string().optional().describe('New skill category'),
      importance: z.string().optional().describe('New skill priority/importance'),
      notes: z.string().optional().describe('New notes'),
    },
    async ({ selected_directory, directory, name, category, importance, notes }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const skill = await adapter.updateSkill(name, { category, importance, notes });
        return {
          content: [{ type: 'text', text: JSON.stringify(skill, null, 2) }],
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
    'remove_skill',
    'Remove a skill from the target skills list',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      name: z.string().describe('The name of the skill to remove'),
    },
    async ({ selected_directory, directory, name }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const removed = await adapter.removeSkill(name);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: removed }, null, 2) }],
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
