#!/usr/bin/env node

// ==============================================================================
// bin/cli.js - Job Search Automation CLI Orchestrator
//
// Supports subcommands:
//   - setup: Self-contained plugin installation & workspace initialization
//   - update-resume: Fast-path resume updater
//   - uninstall: Clean removal of plugin assets while preserving user data
//
// Conforms strictly to Agent Plugins specification (agent-plugins.org/specification)
// ZERO symlinks created; all skills and servers remain fully self-contained.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ANSI Color codes
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(process.cwd(), p);
}

function copyRecursiveSync(src, dest, filterFn) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      if (filterFn && !filterFn(srcPath, entry)) {
        continue;
      }
      copyRecursiveSync(srcPath, destPath, filterFn);
    }
  } else {
    const parentDir = path.dirname(dest);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    // Preserve executable permissions
    const mode = stat.mode;
    if (mode & 0o111) {
      fs.chmodSync(dest, mode);
    }
  }
}

function printHelp() {
  console.log(`${BOLD}Job Search Automation CLI${RESET}`);
  console.log(`Usage: job-search-automation <subcommand> [options]\n`);
  console.log(`${BOLD}Subcommands:${RESET}`);
  console.log(`  setup              Install self-contained plugin and initialize workspace`);
  console.log(`  update-resume      Instantly update resume in .job-search/`);
  console.log(`  uninstall          Remove installed plugin while preserving user data`);
  console.log(`\n${BOLD}Setup Options:${RESET}`);
  console.log(`  -d, --directory <path>       Target project directory (default: current directory)`);
  console.log(`  --resume <path>              Path to resume file (.pdf)`);
  console.log(`  --mode <local|neon>          Storage mode ('local' or 'neon', default: local)`);
  console.log(`  --neon-connection-string <s> Neon PostgreSQL connection string (Neon mode)`);
  console.log(`  --install-to <path>          Custom plugin installation target directory`);
  console.log(`  --force                      Overwrite existing files during scaffolding`);
  console.log(`  -y, --non-interactive        Run non-interactively using provided flags`);
  console.log(`  --mock                       Mock mode for database and external operations`);
  console.log(`\n${BOLD}Update Resume Options:${RESET}`);
  console.log(`  <path>                       Path to new resume file`);
  console.log(`  -d, --directory <path>       Project workspace directory containing .job-search/`);
  console.log(`  --config-path <path>         Explicit path to config.json`);
  console.log(`\n${BOLD}Uninstall Options:${RESET}`);
  console.log(`  -d, --directory <path>       Project workspace directory containing plugin`);
  console.log(`  --install-to <path>          Custom plugin directory to remove`);
  console.log(`  --purge-data                 Also delete .job-search/ user data (default: preserve)`);
  console.log(`\n${BOLD}General Options:${RESET}`);
  console.log(`  -h, --help                   Show this help message`);
  console.log(`  -v, --version                Show version number`);
}

function ensurePackagesBuilt() {
  const dbDir = path.join(REPO_ROOT, 'packages', 'job-search-db');
  const dbDist = path.join(dbDir, 'dist', 'index.js');
  const uiDir = path.join(REPO_ROOT, 'packages', 'job-search-ui');
  const uiDist = path.join(uiDir, 'dist', 'server.js');

  if (fs.existsSync(dbDir) && !fs.existsSync(dbDist)) {
    process.stderr.write(`${CYAN}[*] Building packages/job-search-db...${RESET}\n`);
    if (!fs.existsSync(path.join(dbDir, 'node_modules'))) {
      execSync('npm install --silent', { cwd: dbDir, stdio: 'inherit' });
    }
    execSync('npm run build --silent', { cwd: dbDir, stdio: 'inherit' });
  }

  if (fs.existsSync(uiDir) && !fs.existsSync(uiDist)) {
    process.stderr.write(`${CYAN}[*] Building packages/job-search-ui...${RESET}\n`);
    if (!fs.existsSync(path.join(uiDir, 'node_modules'))) {
      execSync('npm install --silent', { cwd: uiDir, stdio: 'inherit' });
    }
    execSync('npm run build --silent', { cwd: uiDir, stdio: 'inherit' });
  }
}

// -----------------------------------------------------------------------------
// Subcommand: setup
// -----------------------------------------------------------------------------
async function handleSetup(args) {
  let directory = '';
  let resumePath = '';
  let mode = 'local';
  let neonConnStr = '';
  let installTo = '';
  let force = false;
  let nonInteractive = false;
  let mockMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--directory') {
      directory = args[++i];
    } else if (arg.startsWith('--directory=')) {
      directory = arg.slice('--directory='.length);
    } else if (arg === '--resume') {
      resumePath = args[++i];
    } else if (arg.startsWith('--resume=')) {
      resumePath = arg.slice('--resume='.length);
    } else if (arg === '--mode') {
      mode = args[++i];
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
    } else if (arg === '--neon-connection-string') {
      neonConnStr = args[++i];
    } else if (arg === '--install-to') {
      installTo = args[++i];
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '-y' || arg === '--non-interactive') {
      nonInteractive = true;
    } else if (arg === '--mock') {
      mockMode = true;
    }
  }

  const projectDir = expandPath(directory || process.cwd());
  const pluginDir = installTo ? expandPath(installTo) : path.join(projectDir, '.claude', 'plugins', 'job-search-automation');
  const jobSearchDir = path.join(projectDir, '.job-search');
  const configFile = path.join(jobSearchDir, 'config.json');
  const targetResume = path.join(jobSearchDir, 'resume.pdf');
  const targetSqlite = path.join(jobSearchDir, 'job-search.sqlite');

  console.log(`${CYAN}${BOLD}[*] Initializing Job Search Plugin (${mode} mode)...${RESET}`);

  // 1. Ensure packages are prebuilt
  ensurePackagesBuilt();

  // 2. Install self-contained plugin directory (.claude/plugins/job-search-automation)
  fs.mkdirSync(pluginDir, { recursive: true });

  const runtimeFilter = (fullPath, name) => {
    if (name === '.git' || name === 'tests' || name === 'tmp' || name === '.cocoindex_code') return false;
    if (name === 'sync-public.sh') return false;
    if (name.endsWith('.test.ts') || name.endsWith('.test.js') || name.endsWith('.test.sh')) return false;
    return true;
  };

  // Copy root manifests and agent guidelines
  const rootFiles = ['plugin.json', 'mcp.json', '.mcp.json', 'schema.sql', 'CLAUDE.md'];
  for (const f of rootFiles) {
    const src = path.join(REPO_ROOT, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(pluginDir, f));
    }
  }

  // Copy .claude-plugin directory if present
  const claudePluginSrc = path.join(REPO_ROOT, '.claude-plugin');
  if (fs.existsSync(claudePluginSrc)) {
    copyRecursiveSync(claudePluginSrc, path.join(pluginDir, '.claude-plugin'), runtimeFilter);
  }

  // Copy skills directory (self-contained per Agent Plugins spec §6.1, §7.1)
  const skillsSrc = path.join(REPO_ROOT, 'skills');
  if (fs.existsSync(skillsSrc)) {
    copyRecursiveSync(skillsSrc, path.join(pluginDir, 'skills'), runtimeFilter);
  }

  // Copy scripts directory (specifically crawl-job-board.js)
  const scriptsSrc = path.join(REPO_ROOT, 'scripts');
  if (fs.existsSync(scriptsSrc)) {
    copyRecursiveSync(scriptsSrc, path.join(pluginDir, 'scripts'), runtimeFilter);
  }

  // Copy built packages
  const packagesToCopy = ['job-search-db', 'job-search-ui'];
  for (const pkg of packagesToCopy) {
    const pkgSrc = path.join(REPO_ROOT, 'packages', pkg);
    if (fs.existsSync(pkgSrc)) {
      const pkgDest = path.join(pluginDir, 'packages', pkg);
      copyRecursiveSync(pkgSrc, pkgDest, (fullPath, name) => {
        if (name === 'src' || name === 'tests') return false;
        if (name.endsWith('.test.ts') || name.endsWith('.test.js')) return false;
        return runtimeFilter(fullPath, name);
      });

      // Ensure start.js is marked executable
      const startScript = path.join(pkgDest, 'scripts', 'start.js');
      if (fs.existsSync(startScript)) {
        fs.chmodSync(startScript, 0o755);
      }

      // If node_modules wasn't copied or is missing dependencies, install production dependencies
      const nodeModulesDir = path.join(pkgDest, 'node_modules');
      if (!fs.existsSync(nodeModulesDir)) {
        try {
          execSync('npm install --omit=dev --silent --no-audit --no-fund', {
            cwd: pkgDest,
            stdio: 'ignore',
          });
        } catch {}
      }
    }
  }

  console.log(`${GREEN}[+] Plugin package installed:${RESET} ${pluginDir}`);

  // 3. Configure <project>/.mcp.json
  const mcpJsonPath = path.join(projectDir, '.mcp.json');
  let mcpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }
    } catch {}
  }

  // Calculate relative path from projectDir to plugin's start.js
  const startJsAbs = path.join(pluginDir, 'packages', 'job-search-db', 'scripts', 'start.js');
  let relativeStartJs = path.relative(projectDir, startJsAbs);
  if (!relativeStartJs.startsWith('./') && !relativeStartJs.startsWith('../') && !relativeStartJs.startsWith('/')) {
    relativeStartJs = `./${relativeStartJs}`;
  }

  mcpConfig.mcpServers['job-search-db'] = {
    type: 'stdio',
    command: 'node',
    args: [relativeStartJs],
  };

  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`${GREEN}[+] MCP configuration updated:${RESET} ${mcpJsonPath}`);

  // 3.1 Configure <project>/.claude/launch.json for web preview
  const claudeDir = path.join(projectDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const launchFilePath = path.join(claudeDir, 'launch.json');
  let launchConfig = { version: '0.0.1', configurations: [] };
  if (fs.existsSync(launchFilePath)) {
    try {
      launchConfig = JSON.parse(fs.readFileSync(launchFilePath, 'utf-8'));
      if (!Array.isArray(launchConfig.configurations)) launchConfig.configurations = [];
    } catch {}
  }

  const uiPkgDir = path.join(pluginDir, 'packages', 'job-search-ui');
  let relativeUiPkg = path.relative(projectDir, uiPkgDir);
  if (!relativeUiPkg.startsWith('.') && !relativeUiPkg.startsWith('/')) {
    relativeUiPkg = `./${relativeUiPkg}`;
  }

  launchConfig.configurations = launchConfig.configurations.filter((c) => c && c.name !== 'job-search-ui');
  launchConfig.configurations.push({
    name: 'job-search-ui',
    runtimeExecutable: 'npm',
    runtimeArgs: ['run', 'start', '--prefix', relativeUiPkg],
    port: 3847,
  });
  fs.writeFileSync(launchFilePath, JSON.stringify(launchConfig, null, 2) + '\n');
  console.log(`${GREEN}[+] Claude launch configuration created:${RESET} ${launchFilePath}`);

  // 3.2 Pre-grant permissions in <project>/.claude/settings.json
  const settingsFilePath = path.join(claudeDir, 'settings.json');
  let settingsConfig = {};
  if (fs.existsSync(settingsFilePath)) {
    try {
      settingsConfig = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
    } catch {}
  }
  if (typeof settingsConfig.permissions !== 'object' || settingsConfig.permissions === null) settingsConfig.permissions = {};
  if (!Array.isArray(settingsConfig.permissions.allow)) settingsConfig.permissions.allow = [];

  let crawlRel = path.relative(projectDir, path.join(pluginDir, 'scripts', 'crawl-job-board.js'));
  if (!crawlRel.startsWith('.') && !crawlRel.startsWith('/')) crawlRel = `./${crawlRel}`;

  const grants = [
    `Bash(node ${crawlRel}:*)`,
    'Bash(mkdir -p ./.job-search/tmp*)',
    'Read(./.job-search/**)',
    'Write(./.job-search/**)',
  ];
  for (const g of grants) {
    if (!settingsConfig.permissions.allow.includes(g)) settingsConfig.permissions.allow.push(g);
  }
  fs.writeFileSync(settingsFilePath, JSON.stringify(settingsConfig, null, 2) + '\n');
  console.log(`${GREEN}[+] Permissions pre-granted for unattended runs:${RESET} ${settingsFilePath}`);

  // 4. Initialize <project>/.job-search/
  fs.mkdirSync(jobSearchDir, { recursive: true });

  // Handle resume copy
  if (resumePath) {
    const expResume = expandPath(resumePath);
    if (!fs.existsSync(expResume)) {
      console.error(`${RED}[ERROR] Resume file not found at: ${expResume}${RESET}`);
      process.exit(1);
    }
    if (!expResume.toLowerCase().endsWith('.pdf')) {
      console.warn(`${YELLOW}[WARNING] Resume does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}`);
    }
    fs.copyFileSync(expResume, targetResume);
    fs.chmodSync(targetResume, 0o644);
    console.log(`${GREEN}[+] Resume installed to:${RESET} ${targetResume}`);
  } else if (!fs.existsSync(targetResume)) {
    console.error(`${RED}[ERROR] Resume path is required. Specify via --resume <path>${RESET}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}[+] Existing resume preserved:${RESET} ${targetResume}`);
  }

  // Handle SQLite / Database initialization
  if (mode === 'local') {
    if (!fs.existsSync(targetSqlite) || force) {
      console.log(`${CYAN}[*] Initializing SQLite database at ${targetSqlite}...${RESET}`);
      const db = new DatabaseSync(targetSqlite);
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON;');
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
        CREATE INDEX IF NOT EXISTS idx_companies_last_searched ON companies(last_searched_at ASC) WHERE is_excluded = 0;

        CREATE TABLE IF NOT EXISTS title_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('include', 'exclude')),
            level TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CONSTRAINT uq_pattern_type UNIQUE (pattern, type)
        );

        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            category TEXT,
            importance TEXT DEFAULT 'preferred',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scoring_rubric (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dimension TEXT NOT NULL UNIQUE,
            weight REAL NOT NULL,
            poor_description TEXT,
            moderate_description TEXT,
            strong_description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crawl_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            company_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assessed', 'skipped')),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crawl_queue_company_status ON crawl_queue(company_name, status);

        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            location TEXT,
            score REAL,
            breakdown TEXT,
            status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer')),
            notes TEXT,
            discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
            applied_at TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
        CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

        CREATE TABLE IF NOT EXISTS run_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            mode TEXT NOT NULL,
            companies_processed TEXT NOT NULL DEFAULT '[]',
            urls_queued INTEGER NOT NULL DEFAULT 0,
            candidates_scored INTEGER NOT NULL DEFAULT 0,
            summary TEXT,
            details TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_run_logs_timestamp ON run_logs(timestamp DESC);
      `);

      const cnt = db.prepare('SELECT COUNT(*) as count FROM scoring_rubric').get().count;
      if (cnt === 0) {
        const ins = db.prepare('INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description) VALUES (?, ?, ?, ?, ?)');
        ins.run('Title match', 25, 'Little to no title relevance', 'Partial title keyword overlap', 'Exact title match or target senior/lead level');
        ins.run('Skills match', 30, 'Missing required core stack', 'Has some core skills, missing others', 'Full alignment with required and preferred stack');
        ins.run('Experience match', 25, 'Insufficient domain/system scale', 'Relevant domain, minor gaps in scale', 'Proven track record in equivalent problem domain');
        ins.run('Seniority fit', 20, 'Misaligned seniority level', 'Adjacent seniority level', 'Matches target Staff/Principal IC level');
      }
      db.close();
      console.log(`${GREEN}[+] SQLite schema initialized and seeded.${RESET}`);
    } else {
      console.log(`${GREEN}[+] Existing SQLite database preserved:${RESET} ${targetSqlite}`);
    }

    // Create .job-search/.gitignore
    fs.writeFileSync(path.join(jobSearchDir, '.gitignore'), 'job-search.sqlite*\ntmp/\n');
  } else if (mode === 'neon') {
    if (neonConnStr && !mockMode) {
      try {
        execSync(`security add-generic-password -s "job-search-automation" -a "neon-connection-string" -w "${neonConnStr}" -U`, {
          stdio: 'ignore',
        });
      } catch {}
    }
    const initScript = path.join(REPO_ROOT, 'scripts', 'init-neon.js');
    if (fs.existsSync(initScript)) {
      const initArgs = mockMode ? ['--mock'] : (neonConnStr ? ['--connection-string', neonConnStr] : []);
      execSync(`node "${initScript}" ${initArgs.join(' ')}`, { stdio: 'inherit' });
    }
  }

  // Write config.json
  const configData = {
    $schema: 'https://json-schema.org/draft-07/schema#',
    version: '1.0.0',
    mode: mode,
    databasePath: './job-search.sqlite',
    resumePath: './resume.pdf',
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configFile, JSON.stringify(configData, null, 2) + '\n', { mode: 0o600 });
  console.log(`${GREEN}[+] Configuration written to:${RESET} ${configFile}`);

  // 5. Append .claude/plugins/ to project .gitignore if git repo
  const projectGitignore = path.join(projectDir, '.gitignore');
  if (fs.existsSync(projectGitignore)) {
    const giContent = fs.readFileSync(projectGitignore, 'utf-8');
    if (!giContent.includes('.claude/plugins/')) {
      fs.appendFileSync(projectGitignore, '\n# Installed Agent Plugins\n.claude/plugins/\n');
    }
  } else if (fs.existsSync(path.join(projectDir, '.git'))) {
    fs.writeFileSync(projectGitignore, '# Installed Agent Plugins\n.claude/plugins/\n');
  }

  console.log(`\n${GREEN}${BOLD}==============================================================${RESET}`);
  console.log(`${GREEN}${BOLD}  Setup Complete! Job Search Automation is ready to use.      ${RESET}`);
  console.log(`${GREEN}${BOLD}==============================================================${RESET}`);
  console.log(`  Mode:              ${BOLD}${mode}${RESET}`);
  console.log(`  Plugin Dir:        ${BOLD}${pluginDir}${RESET}`);
  console.log(`  Workspace Dir:     ${BOLD}${jobSearchDir}${RESET}`);
  console.log(`  Database:          ${BOLD}${targetSqlite}${RESET}`);
  console.log(`  Resume:            ${BOLD}${targetResume}${RESET}`);
  console.log(`  Configuration:     ${BOLD}${configFile}${RESET}`);
  console.log(`  Launch Config:     ${BOLD}${launchFilePath}${RESET}`);
  console.log(`  Permissions:       ${BOLD}${settingsFilePath}${RESET}`);
  console.log(`\nPlease restart your Claude session for skills and MCP tools to load.`);
}

// -----------------------------------------------------------------------------
// Subcommand: update-resume
// -----------------------------------------------------------------------------
async function handleUpdateResume(args) {
  let newResumePath = '';
  let directory = '';
  let configPath = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--directory') {
      directory = args[++i];
    } else if (arg.startsWith('--directory=')) {
      directory = arg.slice('--directory='.length);
    } else if (arg === '--config-path') {
      configPath = args[++i];
    } else if (!arg.startsWith('-') && !newResumePath) {
      newResumePath = arg;
    }
  }

  if (!newResumePath) {
    console.error(`${RED}[ERROR] Resume path missing. Usage: job-search-automation update-resume <path>${RESET}`);
    process.exit(1);
  }

  const expResume = expandPath(newResumePath);
  if (!fs.existsSync(expResume)) {
    console.error(`${RED}[ERROR] Resume file not found: ${expResume}${RESET}`);
    process.exit(1);
  }

  // Resolve config.json location
  let cfgFile = configPath ? expandPath(configPath) : '';
  if (!cfgFile) {
    const projectDir = expandPath(directory || process.cwd());
    if (projectDir.endsWith('.job-search')) {
      cfgFile = path.join(projectDir, 'config.json');
    } else {
      cfgFile = path.join(projectDir, '.job-search', 'config.json');
    }
  }

  if (!fs.existsSync(cfgFile)) {
    console.error(`${RED}[ERROR] Plugin configuration not found at: ${cfgFile || '<unspecified>'}${RESET}`);
    console.error(`Please run ${BOLD}job-search-automation setup --directory <dir> --resume <path>${RESET} first to initialize the workspace.`);
    process.exit(1);
  }

  if (!expResume.toLowerCase().endsWith('.pdf')) {
    console.warn(`${YELLOW}[WARNING] Source file does not have a .pdf extension. Downstream assessment skills expect PDF format.${RESET}`);
  }

  const cfgDir = path.dirname(cfgFile);
  const targetResume = path.join(cfgDir, 'resume.pdf');

  // Atomic replace
  const tmpResume = `${targetResume}.tmp.${Date.now()}`;
  fs.copyFileSync(expResume, tmpResume);
  fs.chmodSync(tmpResume, 0o644);
  fs.renameSync(tmpResume, targetResume);

  // Update updatedAt in config.json
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    cfg.updatedAt = new Date().toISOString();
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  } catch {}

  console.log(`${GREEN}${BOLD}[SUCCESS] Resume successfully updated at:${RESET} ${targetResume}`);
}

// -----------------------------------------------------------------------------
// Subcommand: uninstall
// -----------------------------------------------------------------------------
async function handleUninstall(args) {
  let directory = '';
  let installTo = '';
  let purgeData = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-d' || arg === '--directory') {
      directory = args[++i];
    } else if (arg.startsWith('--directory=')) {
      directory = arg.slice('--directory='.length);
    } else if (arg === '--install-to') {
      installTo = args[++i];
    } else if (arg === '--purge-data') {
      purgeData = true;
    }
  }

  const projectDir = expandPath(directory || process.cwd());
  const pluginDir = installTo ? expandPath(installTo) : path.join(projectDir, '.claude', 'plugins', 'job-search-automation');

  console.log(`${CYAN}[*] Uninstalling Job Search Automation from ${projectDir}...${RESET}`);

  // 1. Remove plugin directory
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    console.log(`${GREEN}[+] Removed plugin directory:${RESET} ${pluginDir}`);
  }

  // 2. Remove job-search-db from .mcp.json
  const mcpJsonPath = path.join(projectDir, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpConfig.mcpServers && mcpConfig.mcpServers['job-search-db']) {
        delete mcpConfig.mcpServers['job-search-db'];
        if (Object.keys(mcpConfig.mcpServers).length === 0 && Object.keys(mcpConfig).length === 1) {
          fs.rmSync(mcpJsonPath);
          console.log(`${GREEN}[+] Cleaned up empty .mcp.json${RESET}`);
        } else {
          fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
          console.log(`${GREEN}[+] Removed job-search-db from .mcp.json${RESET}`);
        }
      }
    } catch {}
  }

  // 3. Remove job-search-ui from .claude/launch.json
  const launchFilePath = path.join(projectDir, '.claude', 'launch.json');
  if (fs.existsSync(launchFilePath)) {
    try {
      const launchConfig = JSON.parse(fs.readFileSync(launchFilePath, 'utf-8'));
      if (Array.isArray(launchConfig.configurations)) {
        launchConfig.configurations = launchConfig.configurations.filter((c) => c && c.name !== 'job-search-ui');
        if (launchConfig.configurations.length === 0) {
          fs.rmSync(launchFilePath);
          console.log(`${GREEN}[+] Cleaned up empty .claude/launch.json${RESET}`);
        } else {
          fs.writeFileSync(launchFilePath, JSON.stringify(launchConfig, null, 2) + '\n');
          console.log(`${GREEN}[+] Removed job-search-ui from .claude/launch.json${RESET}`);
        }
      }
    } catch {}
  }

  // 4. User data preservation
  const jobSearchDir = path.join(projectDir, '.job-search');
  if (purgeData) {
    if (fs.existsSync(jobSearchDir)) {
      fs.rmSync(jobSearchDir, { recursive: true, force: true });
      console.log(`${YELLOW}[!] Purged .job-search/ user data directory.${RESET}`);
    }
  } else {
    console.log(`${GREEN}[+] User data in .job-search/ preserved.${RESET}`);
  }

  console.log(`${GREEN}${BOLD}Uninstall complete.${RESET}`);
}

// -----------------------------------------------------------------------------
// Entry Point Router
// -----------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    printHelp();
    process.exit(0);
  }

  if (command === '-v' || command === '--version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    console.log(pkg.version);
    process.exit(0);
  }

  const subArgs = args.slice(1);
  switch (command) {
    case 'setup':
      await handleSetup(subArgs);
      break;
    case 'update-resume':
      await handleUpdateResume(subArgs);
      break;
    case 'uninstall':
      await handleUninstall(subArgs);
      break;
    default:
      console.error(`${RED}[ERROR] Unknown subcommand: ${command}${RESET}\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}[FATAL ERROR] ${err.message}${RESET}`);
  process.exit(1);
});
