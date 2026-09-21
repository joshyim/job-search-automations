import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';
import { registerCompanyTools } from './companies.js';
import { registerTitleTools } from './titles.js';
import { registerSkillTools } from './skills.js';
import { registerRubricTools } from './rubric.js';
import { registerQueueTools } from './queue.js';
import { registerCandidateTools } from './candidates.js';
import { registerLogTools } from './logs.js';

export function registerAllTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  // Workspace management tools
  server.tool(
    'select_workspace',
    'Set or validate the active project workspace directory containing .job-search/',
    {
      directory: z.string().describe('Absolute or relative path to the project workspace directory'),
    },
    async ({ directory }) => {
      try {
        const info = await workspaceManager.selectWorkspace(directory);
        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
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
    'get_workspace_info',
    'Get information about the current or specified project workspace',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
    },
    async ({ selected_directory, directory }) => {
      try {
        const info = await workspaceManager.getWorkspaceInfo(selected_directory || directory);
        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );

  registerCompanyTools(server, workspaceManager);
  registerTitleTools(server, workspaceManager);
  registerSkillTools(server, workspaceManager);
  registerRubricTools(server, workspaceManager);
  registerQueueTools(server, workspaceManager);
  registerCandidateTools(server, workspaceManager);
  registerLogTools(server, workspaceManager);
}
