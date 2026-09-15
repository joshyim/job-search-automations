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

// Auto-detect workspace directory or normalize provided paths before spawning server.
// When launched via `npm run start --prefix <ui-pkg>`, process.cwd() or INIT_CWD is the
// project root but the child server will run with cwd=UI_DIR.
const args = process.argv.slice(2);

let hasDirectoryArg = false;
let hasConfigArg = false;
const baseCwd = process.env.INIT_CWD || process.cwd();

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--directory' || args[i] === '-d') && args[i + 1]) {
    hasDirectoryArg = true;
    args[i + 1] = path.resolve(baseCwd, args[i + 1]);
    i++;
  } else if (args[i].startsWith('--directory=')) {
    hasDirectoryArg = true;
    const val = args[i].slice('--directory='.length);
    args[i] = `--directory=${path.resolve(baseCwd, val)}`;
  } else if (args[i] === '--config' && args[i + 1]) {
    hasConfigArg = true;
    args[i + 1] = path.resolve(baseCwd, args[i + 1]);
    i++;
  } else if (args[i].startsWith('--config=')) {
    hasConfigArg = true;
    const val = args[i].slice('--config='.length);
    args[i] = `--config=${path.resolve(baseCwd, val)}`;
  }
}

if (!hasDirectoryArg && !hasConfigArg && !process.env.JOB_SEARCH_WORKSPACE && !process.env.JOB_SEARCH_CONFIG_PATH) {
  const isWorkspace = (dir) => {
    if (!dir || typeof dir !== 'string') return false;
    return (
      fs.existsSync(path.join(dir, '.job-search', 'config.json')) ||
      fs.existsSync(path.join(dir, '.job-search', 'job-search.sqlite'))
    );
  };

  const findWorkspaceDir = () => {
    // 1. Check INIT_CWD if launched via npm from project directory
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
      if (isWorkspace(curr)) return curr;
      curr = path.dirname(curr);
    }

    return null;
  };

  const candidate = findWorkspaceDir();
  if (candidate) {
    args.push('--directory', candidate);
  }
}

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
