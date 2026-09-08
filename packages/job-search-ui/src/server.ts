import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.resolve(PROJECT_ROOT, 'public');

// Resolve path to the job-search-db server dist/index.js
const DB_SERVER_PATH = path.resolve(PROJECT_ROOT, '../job-search-db/dist/index.js');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface ServerOptions {
  port: number;
  configPath?: string;
}

function parseArgs(): ServerOptions {
  const args = process.argv.slice(2);
  let port = parseInt(process.env.PORT || '3847', 10);
  let configPath: string | undefined = process.env.JOB_SEARCH_CONFIG_PATH;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  return { port, configPath };
}

class JobSearchUIServer {
  private options: ServerOptions;
  private mcpClient: Client | null = null;
  private mcpTransport: StdioClientTransport | null = null;
  private httpServer: http.Server | null = null;
  private isConnected = false;

  constructor(options: ServerOptions) {
    this.options = options;
  }

  private async initMcpClient(): Promise<void> {
    if (!fs.existsSync(DB_SERVER_PATH)) {
      throw new Error(
        `MCP server executable not found at ${DB_SERVER_PATH}.\n` +
        `Please build job-search-db first with: npm run build --prefix packages/job-search-db`
      );
    }

    // Ensure a configuration file exists so local mode starts effortlessly out-of-the-box
    const defaultCfgDir = path.join(os.homedir(), '.config', 'job-search-plugin');
    const defaultCfgFile = path.join(defaultCfgDir, 'config.json');
    const defaultWdp = path.join(os.homedir(), '.local', 'share', 'job-search-plugin');
    const activeCfg = this.options.configPath || process.env.JOB_SEARCH_CONFIG_PATH || defaultCfgFile;

    if (!fs.existsSync(activeCfg)) {
      console.log(`[UI Server] No config file found at ${activeCfg}. Creating default local configuration...`);
      fs.mkdirSync(path.dirname(activeCfg), { recursive: true });
      fs.mkdirSync(defaultWdp, { recursive: true });
      fs.writeFileSync(
        activeCfg,
        JSON.stringify(
          {
            $schema: 'https://json-schema.org/draft-07/schema#',
            version: '1.0.0',
            mode: 'local',
            workflowDataPath: defaultWdp,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    const args = [DB_SERVER_PATH];
    if (this.options.configPath) {
      args.push('--config', this.options.configPath);
    }

    console.log(`[UI Server] Connecting to MCP Server: node ${args.join(' ')}`);

    this.mcpTransport = new StdioClientTransport({
      command: 'node',
      args,
      env: {
        ...process.env,
        ...(this.options.configPath ? { JOB_SEARCH_CONFIG_PATH: this.options.configPath } : {}),
      },
    });

    this.mcpClient = new Client(
      {
        name: 'job-search-web-ui',
        version: '0.1.0',
      },
      {
        capabilities: {},
      }
    );

    await this.mcpClient.connect(this.mcpTransport);
    this.isConnected = true;
    console.log('[UI Server] Connected to job-search-db MCP Server successfully.');
  }

  public async callMcpTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.mcpClient || !this.isConnected) {
      throw new Error('MCP Client is not connected');
    }

    const response = await this.mcpClient.callTool({
      name,
      arguments: args,
    });

    // Parse text content from response
    if (response.content && Array.isArray(response.content) && response.content.length > 0) {
      const first = response.content[0];
      if (first.type === 'text') {
        try {
          return JSON.parse(first.text);
        } catch {
          return first.text;
        }
      }
    }

    return response;
  }

  private handleStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
    let reqPath = (req.url || '/').split('?')[0];
    if (reqPath === '/') {
      reqPath = '/index.html';
    }

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // SPA Fallback: serve index.html for navigation routes
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(indexPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e: any) {
          reject(new Error(`Invalid JSON payload: ${e.message}`));
        }
      });
      req.on('error', reject);
    });
  }

  public async start(): Promise<void> {
    await this.initMcpClient();

    this.httpServer = http.createServer(async (req, res) => {
      // CORS headers for local development
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url || '/';
      const cleanUrl = url.split('?')[0];

      // API Routes
      if (cleanUrl === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          mcpConnected: this.isConnected,
          port: this.options.port,
        }));
        return;
      }

      if (cleanUrl === '/api/mcp/tools' && req.method === 'GET') {
        try {
          const tools = await this.mcpClient?.listTools();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tools: tools?.tools || [] }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      if (cleanUrl === '/api/mcp/call-tool' && req.method === 'POST') {
        try {
          const body = await this.readJsonBody(req);
          const { name, arguments: toolArgs } = body;
          if (!name || typeof name !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing or invalid "name" field' }));
            return;
          }

          const data = await this.callMcpTool(name, toolArgs || {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
      }

      // Static files
      this.handleStatic(req, res);
    });

    const tryListen = (port: number): Promise<number> => {
      return new Promise((resolve, reject) => {
        this.httpServer!.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`[UI Server] Port ${port} is in use, trying port ${port + 1}...`);
            resolve(tryListen(port + 1));
          } else {
            reject(err);
          }
        });

        this.httpServer!.listen(port, '127.0.0.1', () => {
          resolve(port);
        });
      });
    };

    const activePort = await tryListen(this.options.port);
    this.options.port = activePort;

    console.log(`\n=============================================================`);
    console.log(`🚀 Job Search Web UI running at: http://localhost:${activePort}`);
    console.log(`   Connected to MCP Data Layer: job-search-db`);
    console.log(`=============================================================\n`);
  }

  public async stop(): Promise<void> {
    console.log('\n[UI Server] Shutting down...');
    if (this.httpServer) {
      await new Promise<void>(resolve => this.httpServer!.close(() => resolve()));
    }
    if (this.mcpClient) {
      await this.mcpClient.close();
    }
    console.log('[UI Server] Shutdown complete.');
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const server = new JobSearchUIServer(options);

  const shutdown = async () => {
    try {
      await server.stop();
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await server.start();
  } catch (err: any) {
    console.error('[UI Server] Fatal error:', err.message);
    process.exit(1);
  }
}

// Only execute when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

export { JobSearchUIServer };
