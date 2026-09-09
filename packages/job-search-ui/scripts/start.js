#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UI_DIR = path.resolve(__dirname, '..');
const UI_DIST_SERVER = path.join(UI_DIR, 'dist', 'server.js');
const UI_NODE_MODULES = path.join(UI_DIR, 'node_modules');

const DB_DIR = path.resolve(UI_DIR, '../job-search-db');
const DB_DIST_SERVER = path.join(DB_DIR, 'dist', 'index.js');
const DB_NODE_MODULES = path.join(DB_DIR, 'node_modules');

const isUiBuilt = fs.existsSync(UI_DIST_SERVER);
const isDbBuilt = !fs.existsSync(DB_DIR) || fs.existsSync(DB_DIST_SERVER);

if (!isUiBuilt || !isDbBuilt) {
  console.log('\x1b[36m[*] Building dashboard for first run...\x1b[0m');

  // Build job-search-db if needed
  if (fs.existsSync(DB_DIR) && !fs.existsSync(DB_DIST_SERVER)) {
    if (!fs.existsSync(DB_NODE_MODULES)) {
      execSync('npm install --prefer-offline --no-audit --no-fund', {
        cwd: DB_DIR,
        stdio: 'inherit',
      });
    }
    execSync('npm run build', {
      cwd: DB_DIR,
      stdio: 'inherit',
    });
  }

  // Build job-search-ui if needed
  if (!fs.existsSync(UI_DIST_SERVER)) {
    if (!fs.existsSync(UI_NODE_MODULES)) {
      execSync('npm install --prefer-offline --no-audit --no-fund', {
        cwd: UI_DIR,
        stdio: 'inherit',
      });
    }
    execSync('npm run build', {
      cwd: UI_DIR,
      stdio: 'inherit',
    });
  }
}

// Spawn dist/server.js forwarding all passed arguments
const args = process.argv.slice(2);
const child = spawn(process.execPath, [UI_DIST_SERVER, ...args], {
  cwd: UI_DIR,
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
