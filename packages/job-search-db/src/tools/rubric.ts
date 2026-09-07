import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataAdapter } from '../adapters/types.js';

export function registerRubricTools(server: McpServer, adapter: DataAdapter): void {
  server.tool(
    'get_scoring_rubric',
    'Get the candidate evaluation scoring rubric with dimensions, weights, and rating criteria',
    {},
    async () => {
      const rubric = await adapter.getScoringRubric();
      return {
        content: [{ type: 'text', text: JSON.stringify(rubric, null, 2) }],
      };
    }
  );

  server.tool(
    'update_rubric_dimension',
    'Update an existing rubric dimension weight or tier descriptions (case-insensitive dimension matching)',
    {
      dimension: z.string().describe('The name of the dimension to update (case-insensitive)'),
      weight: z.number().optional().describe('New weight integer value (e.g. 25; no sum-to-100 restriction)'),
      poor_description: z.string().optional().describe('Description for poor tier (score 1-2)'),
      moderate_description: z.string().optional().describe('Description for moderate tier (score 3)'),
      strong_description: z.string().optional().describe('Description for strong tier (score 4-5)'),
    },
    async ({ dimension, weight, poor_description, moderate_description, strong_description }) => {
      const updated = await adapter.updateRubricDimension(dimension, {
        weight,
        poor_description,
        moderate_description,
        strong_description,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }],
      };
    }
  );

  server.tool(
    'add_rubric_dimension',
    'Add or upsert a scoring dimension to the candidate evaluation rubric (case-insensitive matching)',
    {
      dimension: z.string().describe('The dimension name (case-insensitive)'),
      weight: z.number().describe('Weight integer value (e.g. 25; no sum-to-100 restriction)'),
      poor_description: z.string().optional().describe('Description for poor tier (score 1-2)'),
      moderate_description: z.string().optional().describe('Description for moderate tier (score 3)'),
      strong_description: z.string().optional().describe('Description for strong tier (score 4-5)'),
    },
    async ({ dimension, weight, poor_description, moderate_description, strong_description }) => {
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
    }
  );

  server.tool(
    'remove_rubric_dimension',
    'Remove a dimension from the candidate evaluation rubric (case-insensitive matching)',
    {
      dimension: z.string().describe('The name of the dimension to remove (case-insensitive)'),
    },
    async ({ dimension }) => {
      const removed = await adapter.removeRubricDimension(dimension);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: removed }, null, 2) }],
      };
    }
  );
}
