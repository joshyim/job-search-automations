#!/usr/bin/env node

/**
 * Automated Security Regression Test Suite for Job Search Web UI (PRO-54)
 * Verifies Host validation, Origin validation, wildcard CORS removal,
 * Content-Type enforcement, session token authentication, tool allowlist,
 * and workspace confinement.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(UI_DIR, '../..');
const TEST_PORT = 3989;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

import { DatabaseSync } from 'node:sqlite';

// Setup temporary synthetic workspace
const TEST_WS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', `security_ws_${Date.now()}`);
fs.mkdirSync(path.join(TEST_WS_DIR, '.job-search'), { recursive: true });
fs.writeFileSync(
  path.join(TEST_WS_DIR, '.job-search', 'config.json'),
  JSON.stringify({ mode: 'local', databasePath: './job-search.sqlite' }, null, 2)
);

const dbPath = path.join(TEST_WS_DIR, '.job-search', 'job-search.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    careers_url TEXT NOT NULL,
    is_excluded INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    last_searched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO companies (name, careers_url) VALUES ('TestCo', 'https://testco.invalid/careers');
`);
db.close();

let serverProcess = null;
let sessionToken = '';

function cleanup() {
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
  }
  try {
    fs.rmSync(TEST_WS_DIR, { recursive: true, force: true });
  } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

import http from 'node:http';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function rawRequest({ method = 'GET', path = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', (c) => (resBody += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(resBody);
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: resBody,
            json,
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🔒 Starting PRO-54 Security Regression Test Suite...\n');

  // 1. Spawn UI server on TEST_PORT bound to synthetic workspace
  console.log(`[Setup] Starting UI server on port ${TEST_PORT} with workspace ${TEST_WS_DIR}...`);
  const serverJs = path.join(UI_DIR, 'dist', 'server.js');
  serverProcess = spawn(process.execPath, [serverJs, '--port', String(TEST_PORT), '--directory', TEST_WS_DIR], {
    cwd: UI_DIR,
    stdio: 'pipe',
  });

  serverProcess.stderr.on('data', (d) => {
    // console.error('[Server Err]', d.toString());
  });

  // Wait for server to listen
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {}
    await sleep(200);
  }

  if (!serverReady) {
    throw new Error(`Server failed to start on ${BASE_URL} within 6 seconds`);
  }
  console.log('  ✓ UI Server is up and responding to health check\n');

  // 2. Test Host Header Validation
  console.log('[Test 1] Host Header Validation (Anti-DNS Rebinding)');
  {
    // Invalid external host
    const res = await rawRequest({
      path: '/api/health',
      headers: { Host: 'attacker.evil.com' },
    });
    assert(res.status === 403, 'Rejects unexpected Host "attacker.evil.com" with 403');
    assert(res.json?.error?.includes('Invalid Host header'), 'Returns Invalid Host header error message');

    // Valid Host
    const validRes = await rawRequest({
      path: '/api/health',
      headers: { Host: `127.0.0.1:${TEST_PORT}` },
    });
    assert(validRes.status === 200, 'Accepts valid Host "127.0.0.1:<port>" with 200');
  }

  // 3. Test Origin Validation & Wildcard CORS Removal
  console.log('\n[Test 2] Origin Validation & No Wildcard CORS');
  {
    // Untrusted Origin read
    const untrustedGet = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://security-test.invalid' },
    });
    assert(untrustedGet.status === 403, 'Rejects untrusted Origin on GET with 403');
    assert(
      !untrustedGet.headers.get('access-control-allow-origin'),
      'Does NOT return Access-Control-Allow-Origin to untrusted origin'
    );

    // Untrusted Origin write
    const untrustedPost = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        Origin: 'https://security-test.invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(untrustedPost.status === 403, 'Rejects untrusted Origin on POST with 403');
    assert(
      untrustedPost.headers.get('access-control-allow-origin') !== '*',
      'Never returns wildcard Access-Control-Allow-Origin: *'
    );

    // Valid local origin CORS preflight
    const preflight = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'OPTIONS',
      headers: {
        Origin: `http://localhost:${TEST_PORT}`,
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert(preflight.status === 204, 'Accepts OPTIONS preflight from local origin with 204');
    assert(
      preflight.headers.get('access-control-allow-origin') === `http://localhost:${TEST_PORT}`,
      'Echoes exact local origin instead of wildcard'
    );
  }

  // 4. Test HTML Dynamic Token Injection
  console.log('\n[Test 3] Dynamic Session Token Injection in HTML');
  {
    const indexRes = await fetch(`${BASE_URL}/index.html`);
    assert(indexRes.status === 200, 'Serves /index.html with 200');
    const html = await indexRes.text();
    const tokenMatch = html.match(/__DASHBOARD_TOKEN__\s*=\s*"([^"]+)"/);
    assert(Boolean(tokenMatch && tokenMatch[1]), 'Injects window.__DASHBOARD_TOKEN__ script into index.html');
    sessionToken = tokenMatch[1];
    assert(sessionToken.length >= 32, 'Session token has high entropy');

    const setCookie = indexRes.headers.get('set-cookie') || '';
    assert(setCookie.includes('SameSite=Strict'), 'Sets SameSite=Strict session cookie');
    assert(setCookie.includes('dashboard_token='), 'Cookie contains dashboard_token');
  }

  // 5. Test Content-Type Enforcement (Blocks browser-simple text/plain POSTs)
  console.log('\n[Test 4] Content-Type Enforcement (Anti-CSRF)');
  {
    // text/plain body without JSON preflight
    const plainPost = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(plainPost.status === 415, 'Rejects Content-Type: text/plain with 415 Unsupported Media Type');

    // Missing Content-Type
    const noContentType = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(noContentType.status === 415, 'Rejects missing Content-Type with 415');
  }

  // 6. Test Session Token Authentication
  console.log('\n[Test 5] Authentication & Session Token Verification');
  {
    // Missing token
    const noToken = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(noToken.status === 401, 'Rejects unauthenticated call-tool with 401 Unauthorized');

    // Invalid token
    const badToken = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'wrong-token-abc',
      },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(badToken.status === 401, 'Rejects invalid token with 401 Unauthorized');

    // GET /api/mcp/tools without token
    const noTokenTools = await fetch(`${BASE_URL}/api/mcp/tools`);
    assert(noTokenTools.status === 401, 'Rejects unauthenticated list tools with 401 Unauthorized');

    // Valid token via Bearer Authorization header
    const bearerTools = await fetch(`${BASE_URL}/api/mcp/tools`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert(bearerTools.status === 200, 'Accepts Bearer token in Authorization header');
  }

  // 7. Test Tool Allowlist Enforcement
  console.log('\n[Test 6] Tool Allowlist Enforcement');
  {
    // select_workspace should be blocked over HTTP
    const selectWs = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        name: 'select_workspace',
        arguments: { directory: '/tmp' },
      }),
    });
    assert(selectWs.status === 403, 'Blocks "select_workspace" tool with 403 Forbidden');
    const selectJson = await selectWs.json();
    assert(selectJson.error?.includes('not permitted'), 'Returns tool not permitted error message');

    // get_workspace_info should be blocked over HTTP
    const getWs = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({ name: 'get_workspace_info', arguments: {} }),
    });
    assert(getWs.status === 403, 'Blocks "get_workspace_info" tool with 403 Forbidden');

    // Tools list should NOT contain blocked tools
    const toolsRes = await fetch(`${BASE_URL}/api/mcp/tools`, {
      headers: { 'X-Session-Token': sessionToken },
    });
    const toolsData = await toolsRes.json();
    const toolNames = toolsData.tools.map((t) => t.name);
    assert(!toolNames.includes('select_workspace'), 'Tools list excludes "select_workspace"');
    assert(!toolNames.includes('get_workspace_info'), 'Tools list excludes "get_workspace_info"');
    assert(toolNames.includes('list_companies'), 'Tools list includes allowed "list_companies"');
  }

  // 8. Test Workspace Confinement
  console.log('\n[Test 7] Workspace Confinement');
  {
    // Calling with cross-workspace directory override
    const crossWs = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        name: 'list_companies',
        arguments: { directory: '/var/tmp' },
      }),
    });
    assert(crossWs.status === 403, 'Rejects cross-workspace directory argument with 403 Forbidden');
    const crossJson = await crossWs.json();
    assert(crossJson.error?.includes('Cross-workspace'), 'Returns cross-workspace error message');

    // Legitimate call within configured workspace
    const legitCall = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        name: 'list_companies',
        arguments: {},
      }),
    });
    assert(legitCall.status === 200, 'Legitimate call within configured workspace succeeds with 200');
    const legitJson = await legitCall.json();
    assert(legitJson.success === true, 'Legitimate call returns success: true');
  }

  // 9. Test Content Security Policy & Security Headers (PRO-59)
  console.log('\n[Test 8] Content Security Policy & Subresource Integrity (PRO-59)');
  {
    const indexRes = await fetch(`${BASE_URL}/index.html`);
    assert(indexRes.status === 200, 'Serves /index.html with 200');

    // CSP Header Verification
    const csp = indexRes.headers.get('content-security-policy') || '';
    assert(csp.includes("default-src 'self'"), 'CSP includes default-src \'self\'');
    assert(csp.includes("script-src 'self' 'nonce-"), 'CSP includes script-src \'self\' \'nonce-...\'');
    assert(!csp.includes("script-src *"), 'CSP does not allow wildcard script-src');
    assert(!csp.includes("https://cdn.jsdelivr.net"), 'CSP does not whitelist jsdelivr CDN in script-src');
    assert(csp.includes("frame-ancestors 'none'"), 'CSP prevents framing (frame-ancestors \'none\')');

    // Security Headers Verification
    assert(indexRes.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is nosniff');
    assert(indexRes.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options is DENY');
    assert(
      indexRes.headers.get('referrer-policy') === 'strict-origin-when-cross-origin',
      'Referrer-Policy is strict-origin-when-cross-origin'
    );

    // Nonce Matching Verification
    const nonceMatch = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    assert(Boolean(nonceMatch && nonceMatch[1]), 'CSP contains valid base64 nonce');
    const expectedNonce = nonceMatch[1];

    const html = await indexRes.text();
    assert(
      html.includes(`nonce="${expectedNonce}"`),
      'Dynamic token script tag contains matching nonce attribute'
    );

    // Subresource Integrity & Vendored Mermaid Script Verification
    const mermaidTagMatch = html.match(/<script\s+src="vendor\/mermaid\.min\.js"\s+integrity="sha384-([^"]+)"/);
    assert(Boolean(mermaidTagMatch && mermaidTagMatch[1]), 'index.html contains vendor/mermaid.min.js with sha384 SRI integrity attribute');

    // Verify vendor/mermaid.min.js is served locally with nosniff and matching SRI hash
    const mermaidRes = await fetch(`${BASE_URL}/vendor/mermaid.min.js`);
    assert(mermaidRes.status === 200, 'Serves /vendor/mermaid.min.js with 200 OK');
    assert(mermaidRes.headers.get('x-content-type-options') === 'nosniff', '/vendor/mermaid.min.js served with nosniff');

    const crypto = await import('node:crypto');
    const mermaidBuf = Buffer.from(await mermaidRes.arrayBuffer());
    const actualHash = crypto.createHash('sha384').update(mermaidBuf).digest('base64');
    assert(
      actualHash === mermaidTagMatch[1],
      `Actual SHA-384 of served mermaid.min.js (${actualHash}) matches integrity attribute (${mermaidTagMatch[1]})`
    );
  }

  // 10. Test Resource Limits, Stream Abort & HTTP 413 (PRO-60)
  console.log('\n[Test 9] Resource Limits & Stream Abort Enforcement (PRO-60)');
  {
    // A. Rejection via Content-Length header exceeding 1 MB
    const oversizedContentLengthRes = await rawRequest({
      method: 'POST',
      path: '/api/mcp/call-tool',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
        'Content-Length': '2097152', // 2 MB
      },
      body: '{"name":"list_companies"}',
    });
    assert(oversizedContentLengthRes.status === 413, 'Rejects Content-Length > 1MB with 413 Payload Too Large');
    assert(
      oversizedContentLengthRes.json?.error?.includes('Payload Too Large'),
      'Returns descriptive Payload Too Large error message on header check'
    );

    // B. Rejection via streaming chunks exceeding 1 MB (chunked transfer)
    const streamedOversized = await new Promise((resolve) => {
      const clientReq = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: '/api/mcp/call-tool',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Token': sessionToken,
            'Transfer-Encoding': 'chunked',
          },
        },
        (res) => {
          let resBody = '';
          res.on('data', (c) => (resBody += c));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(resBody);
            } catch {}
            resolve({ status: res.statusCode, headers: res.headers, json });
          });
        }
      );
      clientReq.on('error', (err) => {
        // Handle socket reset or connection closed cleanly
        resolve({ status: null, error: err.message });
      });

      // Stream chunks until > 1 MB
      clientReq.write('{"name":"list_companies","arguments":{"pad":"');
      const paddingChunk = 'a'.repeat(64 * 1024); // 64 KB per chunk
      for (let i = 0; i < 20; i++) { // ~1.28 MB total
        try {
          clientReq.write(paddingChunk);
        } catch {
          break;
        }
      }
      try {
        clientReq.write('"}}');
        clientReq.end();
      } catch {}
    });

    assert(
      streamedOversized.status === 413,
      `Rejects streaming chunks exceeding 1MB with 413 Payload Too Large (got ${streamedOversized.status})`
    );
    assert(
      streamedOversized.json?.error?.includes('Payload Too Large'),
      'Returns descriptive Payload Too Large error message on stream abort'
    );

    // C. Normal-sized valid requests continue to work
    const normalRes = await rawRequest({
      method: 'POST',
      path: '/api/mcp/call-tool',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      },
      body: JSON.stringify({ name: 'list_companies', arguments: {} }),
    });
    assert(normalRes.status === 200, 'Normal-sized valid request succeeds with 200 OK');
    assert(normalRes.json?.success === true, 'Normal request returns success: true');
  }

  console.log('\n🎉 ALL 9 SECURITY TEST SUITES PASSED SUCCESSFULLY!\n');
}

runTests()
  .catch((err) => {
    console.error('\n❌ Security Test Suite Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
  });
