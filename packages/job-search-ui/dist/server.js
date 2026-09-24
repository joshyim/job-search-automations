import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};
// Strict allowlist of tools accessible via dashboard HTTP bridge
const ALLOWED_DASHBOARD_TOOLS = new Set([
    'list_companies',
    'add_company',
    'update_company',
    'exclude_company',
    'list_title_patterns',
    'add_title_pattern',
    'remove_title_pattern',
    'list_skills',
    'add_skill',
    'update_skill',
    'remove_skill',
    'get_scoring_rubric',
    'add_rubric_dimension',
    'update_rubric_dimension',
    'remove_rubric_dimension',
    'list_queue',
    'get_candidates',
    'update_candidate_status',
    'get_recent_runs',
]);
const DEFAULT_MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB default
const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_BODY_TIMEOUT_MS = 10000; // 10 seconds
class PayloadTooLargeError extends Error {
    statusCode = 413;
    constructor(message = 'Payload Too Large: Request body exceeds limit') {
        super(message);
        this.name = 'PayloadTooLargeError';
    }
}
class RequestTimeoutError extends Error {
    statusCode = 408;
    constructor(message = 'Request Timeout: Stream read timed out') {
        super(message);
        this.name = 'RequestTimeoutError';
    }
}
const DEFAULT_PORT = 3847;
function parseArgs() {
    const args = process.argv.slice(2);
    let rawPort = process.env.PORT;
    let configPath = process.env.JOB_SEARCH_CONFIG_PATH;
    let directory = process.env.JOB_SEARCH_WORKSPACE;
    let token = process.env.JOB_SEARCH_UI_TOKEN;
    let maxBodySize = process.env.JOB_SEARCH_UI_MAX_BODY_SIZE
        ? parseInt(process.env.JOB_SEARCH_UI_MAX_BODY_SIZE, 10)
        : undefined;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--port' && args[i + 1]) {
            rawPort = args[i + 1];
            i++;
        }
        else if (arg.startsWith('--port=')) {
            rawPort = arg.slice('--port='.length);
        }
        else if (arg === '--config' && args[i + 1]) {
            configPath = args[i + 1];
            i++;
        }
        else if (arg.startsWith('--config=')) {
            configPath = arg.slice('--config='.length);
        }
        else if (arg === '--directory' && args[i + 1]) {
            directory = args[i + 1];
            i++;
        }
        else if (arg.startsWith('--directory=')) {
            directory = arg.slice('--directory='.length);
        }
        else if (arg === '--token' && args[i + 1]) {
            token = args[i + 1];
            i++;
        }
        else if (arg.startsWith('--token=')) {
            token = arg.slice('--token='.length);
        }
        else if (arg === '--max-body-size' && args[i + 1]) {
            const parsedSize = parseInt(args[i + 1], 10);
            if (!isNaN(parsedSize) && parsedSize > 0) {
                maxBodySize = parsedSize;
            }
            i++;
        }
        else if (arg.startsWith('--max-body-size=')) {
            const parsedSize = parseInt(arg.slice('--max-body-size='.length), 10);
            if (!isNaN(parsedSize) && parsedSize > 0) {
                maxBodySize = parsedSize;
            }
        }
    }
    let port = DEFAULT_PORT;
    if (rawPort) {
        const parsed = parseInt(rawPort, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
            port = parsed;
        }
        else {
            console.warn(`[UI Server] Invalid port "${rawPort}" provided, falling back to default ${DEFAULT_PORT}.`);
        }
    }
    return { port, configPath, directory, token, maxBodySize };
}
class JobSearchUIServer {
    options;
    mcpClient = null;
    mcpTransport = null;
    httpServer = null;
    isConnected = false;
    sessionToken;
    configuredWorkspaceDir;
    constructor(options) {
        this.options = options;
        // Session token is strictly in-memory per server process lifecycle
        this.sessionToken = options.token || process.env.JOB_SEARCH_UI_TOKEN || crypto.randomBytes(24).toString('hex');
    }
    getSessionToken() {
        return this.sessionToken;
    }
    isValidToken(providedToken) {
        if (!providedToken || typeof providedToken !== 'string')
            return false;
        const providedBuf = Buffer.from(providedToken);
        const expectedBuf = Buffer.from(this.sessionToken);
        if (providedBuf.length !== expectedBuf.length)
            return false;
        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    }
    async initMcpClient() {
        if (!fs.existsSync(DB_SERVER_PATH)) {
            throw new Error(`MCP server executable not found at ${DB_SERVER_PATH}.\n` +
                `Please build job-search-db first with: npm run build --prefix packages/job-search-db`);
        }
        const args = [DB_SERVER_PATH];
        const isWorkspace = (dir) => {
            if (!dir)
                return false;
            return (fs.existsSync(path.join(dir, '.job-search', 'config.json')) ||
                fs.existsSync(path.join(dir, '.job-search', 'job-search.sqlite')));
        };
        const detectWorkspace = () => {
            const baseCwd = process.env.INIT_CWD || process.cwd();
            // 1. Check INIT_CWD if launched via npm
            if (process.env.INIT_CWD && isWorkspace(process.env.INIT_CWD)) {
                return path.resolve(process.env.INIT_CWD);
            }
            // 2. Check process.cwd()
            if (isWorkspace(process.cwd())) {
                return path.resolve(process.cwd());
            }
            // 3. Walk up ancestors from caller's working directory
            let curr = path.resolve(baseCwd);
            while (curr !== path.dirname(curr)) {
                if (isWorkspace(curr))
                    return curr;
                curr = path.dirname(curr);
            }
            return undefined;
        };
        const targetDir = this.options.directory || process.env.JOB_SEARCH_WORKSPACE || detectWorkspace();
        const activeCfg = this.options.configPath || process.env.JOB_SEARCH_CONFIG_PATH;
        if (targetDir) {
            this.configuredWorkspaceDir = path.resolve(targetDir);
        }
        if (!targetDir && !activeCfg) {
            console.warn('[UI Server] ⚠️ WARNING: No workspace directory provided or detected. ' +
                'MCP database queries may fail with "No workspace directory provided". ' +
                'Pass --directory <path> or set JOB_SEARCH_WORKSPACE.');
        }
        if (targetDir) {
            args.push('--directory', path.resolve(targetDir));
        }
        else if (activeCfg) {
            args.push('--config', path.resolve(activeCfg));
        }
        console.log(`[UI Server] Connecting to MCP Server: node ${args.join(' ')}`);
        this.mcpTransport = new StdioClientTransport({
            command: 'node',
            args,
            env: {
                ...process.env,
                ...(targetDir ? { JOB_SEARCH_WORKSPACE: path.resolve(targetDir) } : {}),
                ...(activeCfg ? { JOB_SEARCH_CONFIG_PATH: path.resolve(activeCfg) } : {}),
            },
        });
        this.mcpClient = new Client({
            name: 'job-search-web-ui',
            version: '0.1.0',
        }, {
            capabilities: {},
        });
        await this.mcpClient.connect(this.mcpTransport);
        this.isConnected = true;
        console.log('[UI Server] Connected to job-search-db MCP Server successfully.');
    }
    async callMcpTool(name, args = {}) {
        if (!this.mcpClient || !this.isConnected) {
            throw new Error('MCP Client is not connected');
        }
        const response = await this.mcpClient.callTool({
            name,
            arguments: args,
        });
        if (response.isError) {
            let errorMessage = 'MCP tool call resulted in an error';
            if (response.content && Array.isArray(response.content) && response.content.length > 0) {
                const first = response.content[0];
                if (first.type === 'text' && typeof first.text === 'string') {
                    errorMessage = first.text;
                }
            }
            throw new Error(errorMessage);
        }
        // Parse text content from response
        if (response.content && Array.isArray(response.content) && response.content.length > 0) {
            const first = response.content[0];
            if (first.type === 'text') {
                try {
                    return JSON.parse(first.text);
                }
                catch {
                    return first.text;
                }
            }
        }
        return response;
    }
    handleStatic(req, res) {
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
        const serveIndexHtml = () => {
            const indexPath = path.join(PUBLIC_DIR, 'index.html');
            if (fs.existsSync(indexPath)) {
                try {
                    const raw = fs.readFileSync(indexPath, 'utf-8');
                    const scriptNonce = crypto.randomBytes(16).toString('base64');
                    const scriptInjection = `<script nonce="${scriptNonce}">window.__DASHBOARD_TOKEN__ = ${JSON.stringify(this.sessionToken)};</script>\n</head>`;
                    const injected = raw.includes('</head>')
                        ? raw.replace('</head>', scriptInjection)
                        : `${raw}\n${scriptInjection}`;
                    const csp = [
                        "default-src 'self'",
                        `script-src 'self' 'nonce-${scriptNonce}'`,
                        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                        "font-src 'self' https://fonts.gstatic.com",
                        "img-src 'self' data:",
                        "connect-src 'self'",
                        "object-src 'none'",
                        "base-uri 'self'",
                        "form-action 'self'",
                        "frame-ancestors 'none'",
                    ].join('; ');
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Set-Cookie': `dashboard_token=${this.sessionToken}; Path=/; SameSite=Strict`,
                        'Content-Security-Policy': csp,
                        'X-Content-Type-Options': 'nosniff',
                        'X-Frame-Options': 'DENY',
                        'Referrer-Policy': 'strict-origin-when-cross-origin',
                    });
                    res.end(injected);
                }
                catch {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                }
            }
            else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        };
        fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
                // SPA Fallback: serve index.html for navigation routes
                serveIndexHtml();
                return;
            }
            if (path.basename(filePath) === 'index.html') {
                serveIndexHtml();
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff',
            });
            fs.createReadStream(filePath).pipe(res);
        });
    }
    async readJsonBody(req) {
        return new Promise((resolve, reject) => {
            const maxLimit = this.options.maxBodySize || DEFAULT_MAX_BODY_SIZE;
            const timeoutMs = this.options.bodyTimeoutMs || DEFAULT_BODY_TIMEOUT_MS;
            // Early check on Content-Length header if provided
            const contentLengthHeader = req.headers['content-length'];
            if (contentLengthHeader) {
                const contentLength = parseInt(contentLengthHeader, 10);
                if (!isNaN(contentLength) && contentLength > maxLimit) {
                    req.pause();
                    req.removeAllListeners('data');
                    reject(new PayloadTooLargeError(`Payload Too Large: Content-Length ${contentLength} exceeds ${maxLimit} bytes limit`));
                    return;
                }
            }
            let body = '';
            let bytesReceived = 0;
            let completed = false;
            const timer = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    req.removeAllListeners('data');
                    req.removeAllListeners('end');
                    req.pause();
                    reject(new RequestTimeoutError(`Request Timeout: Request body was not received within ${timeoutMs}ms`));
                }
            }, timeoutMs);
            const onData = (chunk) => {
                if (completed)
                    return;
                const chunkLen = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
                bytesReceived += chunkLen;
                if (bytesReceived > maxLimit) {
                    completed = true;
                    clearTimeout(timer);
                    req.removeListener('data', onData);
                    req.removeListener('end', onEnd);
                    req.pause();
                    reject(new PayloadTooLargeError(`Payload Too Large: Request body exceeds ${maxLimit} bytes limit`));
                    return;
                }
                body += chunk;
            };
            const onEnd = () => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(timer);
                if (!body.trim()) {
                    resolve({});
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(new Error(`Invalid JSON payload: ${e.message}`));
                }
            };
            const onError = (err) => {
                if (completed)
                    return;
                completed = true;
                clearTimeout(timer);
                reject(err);
            };
            req.on('data', onData);
            req.on('end', onEnd);
            req.on('error', onError);
        });
    }
    async start() {
        await this.initMcpClient();
        this.httpServer = http.createServer(async (req, res) => {
            const activePort = this.options.port;
            // Defense-in-depth security headers
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            // 1. Host Header Validation (mitigate DNS rebinding)
            const rawHost = req.headers.host || '';
            const allowedHosts = new Set([
                `localhost:${activePort}`,
                `127.0.0.1:${activePort}`,
                `[::1]:${activePort}`,
                'localhost',
                '127.0.0.1',
                '[::1]',
            ]);
            if (!rawHost || !allowedHosts.has(rawHost)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Forbidden: Invalid Host header' }));
                return;
            }
            // 2. Origin Header Validation (no wildcard CORS)
            const rawOrigin = req.headers.origin;
            let isAllowedOrigin = false;
            if (rawOrigin) {
                try {
                    const parsed = new URL(rawOrigin);
                    const isLocalhostHost = parsed.hostname === 'localhost' ||
                        parsed.hostname === '127.0.0.1' ||
                        parsed.hostname === '[::1]';
                    const isMatchingPort = parsed.port === '' || String(parsed.port) === String(activePort);
                    if (isLocalhostHost && isMatchingPort) {
                        isAllowedOrigin = true;
                    }
                }
                catch {
                    isAllowedOrigin = false;
                }
                if (!isAllowedOrigin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Forbidden: Cross-origin request not allowed' }));
                    return;
                }
                // Return restricted CORS headers strictly echoing the validated localhost origin
                res.setHeader('Access-Control-Allow-Origin', rawOrigin);
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token, Authorization');
                res.setHeader('Vary', 'Origin');
            }
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const url = req.url || '/';
            const cleanUrl = url.split('?')[0];
            // Helper to extract session token from custom header or bearer Authorization
            const getProvidedToken = () => {
                const headerToken = req.headers['x-session-token'];
                if (typeof headerToken === 'string' && headerToken.trim()) {
                    return headerToken.trim();
                }
                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    return authHeader.slice('Bearer '.length).trim();
                }
                return undefined;
            };
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
                if (!this.isValidToken(getProvidedToken())) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Unauthorized: Missing or invalid session token' }));
                    return;
                }
                try {
                    const tools = await this.mcpClient?.listTools();
                    const filtered = (tools?.tools || []).filter(t => ALLOWED_DASHBOARD_TOOLS.has(t.name));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, tools: filtered }));
                }
                catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
                return;
            }
            if (cleanUrl === '/api/mcp/call-tool' && req.method === 'POST') {
                // Enforce Content-Type: application/json (blocks browser-simple text/plain POSTs)
                const contentType = req.headers['content-type'] || '';
                if (!contentType.toLowerCase().includes('application/json')) {
                    res.writeHead(415, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Unsupported Media Type: Content-Type must be application/json' }));
                    return;
                }
                // Require session token authentication
                if (!this.isValidToken(getProvidedToken())) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Unauthorized: Missing or invalid session token' }));
                    return;
                }
                try {
                    const body = await this.readJsonBody(req);
                    const { name, arguments: toolArgs = {} } = body;
                    if (!name || typeof name !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Missing or invalid "name" field' }));
                        return;
                    }
                    // Enforce strict tool allowlist
                    if (!ALLOWED_DASHBOARD_TOOLS.has(name)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: `Tool "${name}" is not permitted via dashboard HTTP API` }));
                        return;
                    }
                    // Workspace confinement: reject cross-workspace directory arguments
                    const callerDir = toolArgs.selected_directory || toolArgs.directory;
                    if (callerDir && typeof callerDir === 'string') {
                        const resolvedCaller = path.resolve(callerDir);
                        if (this.configuredWorkspaceDir && resolvedCaller !== this.configuredWorkspaceDir) {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Cross-workspace directory arguments are forbidden' }));
                            return;
                        }
                    }
                    const safeArgs = { ...toolArgs };
                    if (this.configuredWorkspaceDir) {
                        safeArgs.selected_directory = this.configuredWorkspaceDir;
                        safeArgs.directory = this.configuredWorkspaceDir;
                    }
                    const data = await this.callMcpTool(name, safeArgs);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data }));
                }
                catch (err) {
                    const isTooLarge = err.statusCode === 413 || err instanceof PayloadTooLargeError;
                    const isTimeout = err.statusCode === 408 || err instanceof RequestTimeoutError;
                    const statusCode = isTooLarge ? 413 : isTimeout ? 408 : 500;
                    res.writeHead(statusCode, {
                        'Content-Type': 'application/json',
                        ...(isTooLarge || isTimeout ? { Connection: 'close' } : {}),
                    });
                    res.end(JSON.stringify({ success: false, error: err.message }), () => {
                        if (isTooLarge || isTimeout) {
                            req.destroy();
                        }
                    });
                    if (isTooLarge || isTimeout) {
                        setTimeout(() => {
                            if (!req.destroyed)
                                req.destroy();
                        }, 50);
                    }
                }
                return;
            }
            // Static files
            this.handleStatic(req, res);
        });
        this.httpServer.requestTimeout = this.options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
        this.httpServer.headersTimeout = 10000;
        this.httpServer.keepAliveTimeout = 5000;
        const MAX_PORT_RETRIES = 100;
        const tryListen = (port, attempt = 0) => {
            if (attempt >= MAX_PORT_RETRIES) {
                return Promise.reject(new Error(`Could not find an available port after ${MAX_PORT_RETRIES} attempts (tried ${this.options.port}-${port - 1}).`));
            }
            return new Promise((resolve, reject) => {
                const onListening = () => {
                    this.httpServer.removeListener('error', onError);
                    resolve(port);
                };
                const onError = (err) => {
                    this.httpServer.removeListener('listening', onListening);
                    if (err.code === 'EADDRINUSE') {
                        console.warn(`[UI Server] Port ${port} is in use, trying port ${port + 1}...`);
                        resolve(tryListen(port + 1, attempt + 1));
                    }
                    else {
                        reject(err);
                    }
                };
                this.httpServer.once('listening', onListening);
                this.httpServer.once('error', onError);
                this.httpServer.listen(port, '127.0.0.1');
            });
        };
        const activePort = await tryListen(this.options.port);
        this.options.port = activePort;
        console.log(`\n=============================================================`);
        console.log(`🚀 Job Search Web UI running at: http://localhost:${activePort}`);
        console.log(`   Dashboard running at http://localhost:${activePort}`);
        console.log(`   Connected to MCP Data Layer: job-search-db`);
        console.log(`=============================================================\n`);
    }
    getPort() {
        return this.options.port;
    }
    async stop() {
        console.log('\n[UI Server] Shutting down...');
        if (this.httpServer) {
            await new Promise(resolve => this.httpServer.close(() => resolve()));
        }
        if (this.mcpClient) {
            await this.mcpClient.close();
        }
        console.log('[UI Server] Shutdown complete.');
    }
}
async function main() {
    const options = parseArgs();
    const server = new JobSearchUIServer(options);
    const shutdown = async () => {
        try {
            await server.stop();
        }
        catch (err) {
            console.error('Error during shutdown:', err);
        }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    try {
        await server.start();
    }
    catch (err) {
        console.error('[UI Server] Fatal error:', err.message);
        process.exit(1);
    }
}
// Only execute when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main();
}
export { JobSearchUIServer, PayloadTooLargeError, RequestTimeoutError, DEFAULT_MAX_BODY_SIZE, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_BODY_TIMEOUT_MS, };
