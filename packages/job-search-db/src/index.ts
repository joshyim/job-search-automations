import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkspaceManager } from './workspace.js';
import { registerAllTools } from './tools/register.js';

async function main(): Promise<void> {
  // Process command-line arguments (e.g. --directory /path/to/project or --config /path/to/config.json)
  let initialWorkspace: string | undefined =
    process.env.JOB_SEARCH_WORKSPACE ||
    process.env.JOB_SEARCH_DIRECTORY ||
    process.env.JOB_SEARCH_CONFIG_PATH;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--config' || args[i] === '--directory' || args[i] === '-d') && args[i + 1]) {
      initialWorkspace = args[i + 1];
      i++;
    } else if (args[i].startsWith('--config=')) {
      initialWorkspace = args[i].slice('--config='.length);
    } else if (args[i].startsWith('--directory=')) {
      initialWorkspace = args[i].slice('--directory='.length);
    }
  }

  // Initialize WorkspaceManager
  const workspaceManager = new WorkspaceManager(initialWorkspace);

  // Create MCP Server
  const server = new McpServer({
    name: 'job-search-db',
    version: '0.1.0',
  });

  // Register all tools
  registerAllTools(server, workspaceManager);

  // Setup graceful shutdown
  const shutdown = async () => {
    try {
      await workspaceManager.closeAll();
    } catch (err) {
      console.error('Error during workspace close:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[job-search-db] MCP server started.');
}

main().catch((err) => {
  console.error('[job-search-db] Fatal error:', err.message);
  process.exit(1);
});
