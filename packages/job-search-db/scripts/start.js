#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.resolve(__dirname, '..');
const DB_DIST_SERVER = path.join(DB_DIR, 'dist', 'index.js');
const DB_NODE_MODULES = path.join(DB_DIR, 'node_modules');

const isDbBuilt = fs.existsSync(DB_DIST_SERVER);
const hasNodeModules = fs.existsSync(DB_NODE_MODULES);

if (!isDbBuilt || !hasNodeModules) {
  // CRITICAL: Write all compilation logs and notifications to stderr ONLY.
  // In stdio MCP transport, stdout is strictly reserved for JSON-RPC messages.
  process.stderr.write('\x1b[36m[*] Building job-search-db MCP server for first run...\x1b[0m\n');

  try {
    if (!hasNodeModules) {
      execSync('npm install --prefer-offline --no-audit --no-fund', {
        cwd: DB_DIR,
        stdio: ['ignore', process.stderr, process.stderr],
      });
    }

    if (!isDbBuilt) {
      execSync('npm run build', {
        cwd: DB_DIR,
        stdio: ['ignore', process.stderr, process.stderr],
      });
    }
  } catch (err) {
    process.stderr.write(`\x1b[31m[!] Failed to build job-search-db MCP server: ${err.message}\x1b[0m\n`);
    process.exit(1);
  }
}

if (!fs.existsSync(DB_DIST_SERVER)) {
  process.stderr.write(`\x1b[31m[!] MCP server binary not found at ${DB_DIST_SERVER} after build attempt.\x1b[0m\n`);
  process.exit(1);
}

// Spawn compiled dist/index.js with stdio inheritance forwarding JSON-RPC communication cleanly
const args = process.argv.slice(2);
const child = spawn(process.execPath, [DB_DIST_SERVER, ...args], {
  cwd: DB_DIR,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    if (child.pid) {
      child.kill(sig);
    }
  });
});
