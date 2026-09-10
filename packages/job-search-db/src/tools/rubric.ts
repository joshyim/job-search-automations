import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WorkspaceManager } from '../workspace.js';

export function registerRubricTools(server: McpServer, workspaceManager: WorkspaceManager): void {
  server.tool(
    'get_scoring_rubric',
    'Get the candidate evaluation scoring rubric with dimensions, weights, and rating criteria',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
    },
    async ({ selected_directory, directory }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const rubric = await adapter.getScoringRubric();
        return {
          content: [{ type: 'text', text: JSON.stringify(rubric, null, 2) }],
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
    'update_rubric_dimension',
    'Update an existing rubric dimension weight or tier descriptions (case-insensitive dimension matching)',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      dimension: z.string().describe('The name of the dimension to update (case-insensitive)'),
      weight: z.number().optional().describe('New weight integer value (e.g. 25; no sum-to-100 restriction)'),
      poor_description: z.string().optional().describe('Description for poor tier (score 1-2)'),
      moderate_description: z.string().optional().describe('Description for moderate tier (score 3)'),
      strong_description: z.string().optional().describe('Description for strong tier (score 4-5)'),
    },
    async ({ selected_directory, directory, dimension, weight, poor_description, moderate_description, strong_description }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const updated = await adapter.updateRubricDimension(dimension, {
          weight,
          poor_description,
          moderate_description,
          strong_description,
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

  server.tool(
    'add_rubric_dimension',
    'Add or upsert a scoring dimension to the candidate evaluation rubric (case-insensitive matching)',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      dimension: z.string().describe('The dimension name (case-insensitive)'),
      weight: z.number().describe('Weight integer value (e.g. 25; no sum-to-100 restriction)'),
      poor_description: z.string().optional().describe('Description for poor tier (score 1-2)'),
      moderate_description: z.string().optional().describe('Description for moderate tier (score 3)'),
      strong_description: z.string().optional().describe('Description for strong tier (score 4-5)'),
    },
    async ({ selected_directory, directory, dimension, weight, poor_description, moderate_description, strong_description }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const created = await adapter.addRubricDimension({
          dimension,
          weight,
          poor_description,
          moderate_description,
          strong_description,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(created, null, 2) }],
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
    'remove_rubric_dimension',
    'Remove a dimension from the candidate evaluation rubric (case-insensitive matching)',
    {
      selected_directory: z.string().optional().describe('Path to the selected project workspace directory containing .job-search/'),
      directory: z.string().optional().describe('Alias for selected_directory'),
      dimension: z.string().describe('The name of the dimension to remove (case-insensitive)'),
    },
    async ({ selected_directory, directory, dimension }) => {
      try {
        const adapter = await workspaceManager.getAdapter(selected_directory || directory);
        const removed = await adapter.removeRubricDimension(dimension);
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
