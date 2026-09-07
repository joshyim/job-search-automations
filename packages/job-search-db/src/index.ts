import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DataAdapter } from './adapters/types.js';
import { LocalAdapter } from './adapters/local/local-adapter.js';
import { NeonAdapter } from './adapters/neon/neon-adapter.js';
import { loadConfig } from './config.js';
import { getNeonConnectionString } from './keychain.js';
import { registerAllTools } from './tools/register.js';

async function main(): Promise<void> {
  // Process command-line arguments (e.g. --config /path/to/config.json)
  let customConfigPath: string | undefined;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      customConfigPath = args[i + 1];
      i++;
    }
  }

  // Load and validate configuration
  const config = loadConfig(customConfigPath);

  let adapter: DataAdapter;
  if (config.mode === 'local') {
    adapter = new LocalAdapter(config.workflowDataPath!);
  } else if (config.mode === 'neon') {
    const connectionString = getNeonConnectionString(config.keychainService, config.keychainAccount);
    adapter = new NeonAdapter(connectionString);
  } else {
    throw new Error(`Unsupported mode: ${(config as any).mode}`);
  }

  // Initialize storage backend
  await adapter.initialize();

  // Create MCP Server
  const server = new McpServer({
    name: 'job-search-db',
    version: '0.1.0',
  });

  // Register all tools
  registerAllTools(server, adapter);

  // Setup graceful shutdown
  const shutdown = async () => {
    try {
      await adapter.close();
    } catch (err) {
      console.error('Error during adapter close:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[job-search-db] MCP server started in "${config.mode}" mode.`);
}

main().catch((err) => {
  console.error('[job-search-db] Fatal error:', err.message);
  process.exit(1);
});
