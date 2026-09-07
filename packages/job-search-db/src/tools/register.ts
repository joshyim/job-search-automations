import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DataAdapter } from '../adapters/types.js';
import { registerCompanyTools } from './companies.js';
import { registerTitleTools } from './titles.js';
import { registerSkillTools } from './skills.js';
import { registerRubricTools } from './rubric.js';
import { registerQueueTools } from './queue.js';
import { registerCandidateTools } from './candidates.js';
import { registerLogTools } from './logs.js';

export function registerAllTools(server: McpServer, adapter: DataAdapter): void {
  registerCompanyTools(server, adapter);
  registerTitleTools(server, adapter);
  registerSkillTools(server, adapter);
  registerRubricTools(server, adapter);
  registerQueueTools(server, adapter);
  registerCandidateTools(server, adapter);
  registerLogTools(server, adapter);
}
