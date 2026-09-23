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
import { execSync, execFileSync } from 'node:child_process';
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
  console.log(`Usage: job-search-automations <subcommand> [options]\n`);
  console.log(`${BOLD}Subcommands:${RESET}`);
  console.log(`  setup              Install self-contained plugin and initialize workspace`);
  console.log(`  update-resume      Instantly update resume in .job-search/`);
  console.log(`  uninstall          Remove installed plugin while preserving user data`);
  console.log(`\n${BOLD}Setup Options:${RESET}`);
  console.log(`  -d, --directory <path>       Target project directory (default: current directory)`);
  console.log(`  --harness <standard|copilot|claude|codex|both> Target AI harness (default: auto-detected, fallback: standard)`);
  console.log(`  --standard                   Target standard Agent Plugins / MCP harness (default)`);
  console.log(`  --copilot                    Target GitHub Copilot / VS Code harness`);
  console.log(`  --codex                      Target OpenAI Codex / ChatGPT desktop harness`);
  console.log(`  --claude                     Target Claude Code / Claude Desktop harness`);
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

function reconcileClaudeScheduledRoutines(projectDir) {
  let patchedCount = 0;
  try {
    const candidates = [];
    if (process.platform === 'darwin') {
      const macBase = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
      candidates.push(path.join(macBase, 'claude-code-sessions'));
      candidates.push(path.join(macBase, 'local-agent-mode-sessions'));
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const winBase = path.join(appData, 'Claude');
      candidates.push(path.join(winBase, 'claude-code-sessions'));
      candidates.push(path.join(winBase, 'local-agent-mode-sessions'));
    } else {
      const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      const linuxBase = path.join(xdgConfig, 'Claude');
      candidates.push(path.join(linuxBase, 'claude-code-sessions'));
      candidates.push(path.join(linuxBase, 'local-agent-mode-sessions'));
    }

    for (const baseDir of candidates) {
      if (!fs.existsSync(baseDir)) continue;
      let accountDirs = [];
      try { accountDirs = fs.readdirSync(baseDir); } catch { continue; }
      for (const acc of accountDirs) {
        const accPath = path.join(baseDir, acc);
        try {
          if (!fs.statSync(accPath).isDirectory()) continue;
        } catch { continue; }
        let orgDirs = [];
        try { orgDirs = fs.readdirSync(accPath); } catch { continue; }
        for (const org of orgDirs) {
          const orgPath = path.join(accPath, org);
          try {
            if (!fs.statSync(orgPath).isDirectory()) continue;
          } catch { continue; }
          const tasksFile = path.join(orgPath, 'scheduled-tasks.json');
          if (fs.existsSync(tasksFile)) {
            try {
              const data = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
              let modified = false;
              if (Array.isArray(data.scheduledTasks)) {
                for (const task of data.scheduledTasks) {
                  const isJobSearch = (typeof task.id === 'string' && task.id.startsWith('job-search-')) &&
                                      (typeof task.cwd === 'string' && path.resolve(task.cwd) === path.resolve(projectDir));
                  if (isJobSearch && task.permissionMode !== 'auto') {
                    task.permissionMode = 'auto';
                    modified = true;
                    patchedCount++;
                  }
                }
              }
              if (modified) {
                fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n');
              }
            } catch {}
          }
        }
      }
    }
  } catch {}
  return patchedCount;
}

function detectHarness(projectDir) {
  const isCodexEnv = Boolean(
    process.env.CODEX ||
    process.env.CODEX_SANDBOX ||
    process.env.CODEX_THREAD_ID ||
    process.env.CODEX_SESSION_ID ||
    process.env.CODEX_TASK_ID ||
    process.env.CHATGPT_TASK
  );
  const isClaudeEnv = Boolean(
    process.env.CLAUDE_CODE ||
    process.env.CLAUDE_PROJECT_DIR
  );
  const isCopilotEnv = Boolean(
    process.env.GITHUB_COPILOT ||
    process.env.COPILOT_AGENT ||
    process.env.VSCODE_PID ||
    process.env.VSCODE_INJECTION
  );

  const hasCodexDir = fs.existsSync(path.join(projectDir, '.codex')) ||
                      fs.existsSync(path.join(projectDir, '.codex', 'config.toml'));
  const hasClaudeDir = fs.existsSync(path.join(projectDir, '.claude')) ||
                       fs.existsSync(path.join(projectDir, 'CLAUDE.md'));
  const hasVscodeDir = fs.existsSync(path.join(projectDir, '.vscode')) ||
                       fs.existsSync(path.join(projectDir, '.github'));

  const codexScore = (isCodexEnv ? 2 : 0) + (hasCodexDir ? 1 : 0);
  const claudeScore = (isClaudeEnv ? 2 : 0) + (hasClaudeDir ? 1 : 0);
  const copilotScore = (isCopilotEnv ? 2 : 0) + (hasVscodeDir ? 1 : 0);

  if (codexScore > 0 && claudeScore > 0) return 'both';
  if (copilotScore > 0 && claudeScore === 0 && codexScore === 0) return 'copilot';
  if (codexScore > 0) return 'codex';
  if (claudeScore > 0) return 'claude';
  return 'standard'; // Universal standard default conforming to Agent Plugins v1 spec
}

function updateCodexConfig(configTomlPath, projectDir, relativeStartJs) {
  let content = '';
  if (fs.existsSync(configTomlPath)) {
    content = fs.readFileSync(configTomlPath, 'utf-8');
  }

  const block = [
    '[mcp_servers.job-search-db]',
    'command = "node"',
    `args = ["${relativeStartJs.replace(/\\/g, '/')}"]`,
    `cwd = "${projectDir.replace(/\\/g, '/')}"`,
    'default_tools_approval_mode = "writes"',
  ].join('\n');

  const regex = /\[mcp_servers\.job-search-db\][\s\S]*?(?=(\n\[|\n*$))/;
  if (regex.test(content)) {
    content = content.replace(regex, block);
  } else {
    if (content && !content.endsWith('\n')) content += '\n';
    if (content) content += '\n';
    content += block + '\n';
  }

  fs.writeFileSync(configTomlPath, content);
}

// -----------------------------------------------------------------------------
// Security & Git Workspace Hardening Helpers (PRO-57)
// -----------------------------------------------------------------------------

function ensureInnerGitignore(jobSearchDir) {
  const innerGitignore = path.join(jobSearchDir, '.gitignore');
  const defaultInner = `# Ignore all private workspace data\n*\n!.gitignore\n`;
  if (!fs.existsSync(innerGitignore)) {
    fs.writeFileSync(innerGitignore, defaultInner, { mode: 0o600 });
  } else {
    // Do not overwrite stricter existing ignore rules
    const content = fs.readFileSync(innerGitignore, 'utf-8');
    if (!content.includes('*')) {
      const privatePatterns = ['resume.pdf', 'config.json', 'job-search.sqlite*', 'tmp/'];
      const toAdd = privatePatterns.filter((p) => !content.includes(p));
      if (toAdd.length > 0) {
        fs.appendFileSync(innerGitignore, `\n# Additional private workspace files\n${toAdd.join('\n')}\n`);
      }
    }
  }
  try {
    fs.chmodSync(innerGitignore, 0o600);
  } catch {}
}

function checkAlreadyTrackedFiles(projectDir, jobSearchDir) {
  try {
    const relJobSearch = path.relative(projectDir, jobSearchDir) || '.job-search';
    const output = execFileSync('git', ['ls-files', relJobSearch], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (output) {
      const trackedFiles = output.split('\n').filter(Boolean);
      if (trackedFiles.length > 0) {
        console.warn(`\n${YELLOW}${BOLD}[WARNING] Sensitive workspace file(s) already tracked by Git:${RESET}`);
        for (const file of trackedFiles) {
          console.warn(`  ${YELLOW}- ${file}${RESET}`);
        }
        console.warn(`${YELLOW}Git ignore rules will NOT automatically untrack files already in history.${RESET}`);
        console.warn(`${YELLOW}To prevent accidental publication, untrack them by running:${RESET}`);
        console.warn(`  ${BOLD}git rm --cached ${trackedFiles.join(' ')}${RESET}\n`);
      }
    }
  } catch {
    // Not a git repository or git command unavailable
  }
}

// -----------------------------------------------------------------------------
// Subcommand: setup
// -----------------------------------------------------------------------------
async function handleSetup(args) {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let directory = '';
  let resumePath = '';
  let mode = 'local';
  let neonConnStr = '';
  let installTo = '';
  let harness = '';
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
    } else if (arg === '--harness') {
      harness = (args[++i] || '').toLowerCase();
    } else if (arg.startsWith('--harness=')) {
      harness = arg.slice('--harness='.length).toLowerCase();
    } else if (arg === '--copilot') {
      harness = 'copilot';
    } else if (arg === '--standard' || arg === '--universal') {
      harness = 'standard';
    } else if (arg === '--codex') {
      harness = 'codex';
    } else if (arg === '--claude') {
      harness = 'claude';
    } else if (arg === '--both' || arg === '--all') {
      harness = 'both';
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
  harness = harness || detectHarness(projectDir);
  let defaultPluginSubdir;
  if (harness === 'codex') {
    defaultPluginSubdir = path.join('.codex', 'plugins', 'job-search-automations');
  } else if (harness === 'claude') {
    defaultPluginSubdir = path.join('.claude', 'plugins', 'job-search-automations');
  } else {
    defaultPluginSubdir = path.join('.agents', 'plugins', 'job-search-automations');
  }
  const pluginDir = installTo ? expandPath(installTo) : path.join(projectDir, defaultPluginSubdir);
  const jobSearchDir = path.join(projectDir, '.job-search');
  const configFile = path.join(jobSearchDir, 'config.json');
  const targetResume = path.join(jobSearchDir, 'resume.pdf');
  const targetSqlite = path.join(jobSearchDir, 'job-search.sqlite');

  console.log(`${CYAN}${BOLD}[*] Initializing Job Search Plugin (${mode} mode, ${harness} harness)...${RESET}`);

  // 1. Ensure packages are prebuilt
  ensurePackagesBuilt();

  // 2. Install self-contained plugin directory (.claude/plugins/job-search-automations)
  fs.mkdirSync(pluginDir, { recursive: true });

  const runtimeFilter = (fullPath, name) => {
    if (name === '.git' || name === 'tests' || name === 'tmp' || name === '.cocoindex_code') return false;
    if (name === 'sync-public.sh') return false;
    if (name.endsWith('.test.ts') || name.endsWith('.test.js') || name.endsWith('.test.sh')) return false;
    return true;
  };

  // Copy root manifests and agent guidelines
  const rootFiles = ['plugin.json', 'mcp.json', '.mcp.json', 'schema.sql', 'CLAUDE.md', 'AGENTS.md', 'installation-steps.md'];
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

  const isClaudeTarget = (harness === 'claude' || harness === 'both');
  const isCodexTarget = (harness === 'codex' || harness === 'both');

  // Calculate relative path from projectDir to plugin's start.js
  const startJsAbs = path.join(pluginDir, 'packages', 'job-search-db', 'scripts', 'start.js');
  let relativeStartJs = path.relative(projectDir, startJsAbs);
  if (!relativeStartJs.startsWith('./') && !relativeStartJs.startsWith('../') && !relativeStartJs.startsWith('/')) {
    relativeStartJs = `./${relativeStartJs}`;
  }

  let launchFilePath = '';
  let settingsFilePath = '';
  let codexConfigPath = '';
  let agentsSkillsDir = '';

  // 3. Configure host harness integration
  if (isClaudeTarget) {
    // 3.1 Configure <project>/.mcp.json
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

    mcpConfig.mcpServers['job-search-db'] = {
      type: 'stdio',
      command: 'node',
      args: [relativeStartJs],
    };

    fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    console.log(`${GREEN}[+] MCP configuration updated:${RESET} ${mcpJsonPath}`);

    // 3.2 Configure <project>/.claude/launch.json for web preview
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    launchFilePath = path.join(claudeDir, 'launch.json');
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
      runtimeArgs: ['run', 'start', '--prefix', relativeUiPkg, '--', '--directory', '.'],
      port: 3847,
    });
    fs.writeFileSync(launchFilePath, JSON.stringify(launchConfig, null, 2) + '\n');
    console.log(`${GREEN}[+] Claude launch configuration created:${RESET} ${launchFilePath}`);

    // 3.3 Pre-grant permissions in <project>/.claude/settings.json
    settingsFilePath = path.join(claudeDir, 'settings.json');
    let settingsConfig = {};
    if (fs.existsSync(settingsFilePath)) {
      try {
        settingsConfig = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
      } catch {}
    }
    if (typeof settingsConfig.permissions !== 'object' || settingsConfig.permissions === null) settingsConfig.permissions = {};
    if (!Array.isArray(settingsConfig.permissions.allow)) settingsConfig.permissions.allow = [];
    if (typeof settingsConfig.permissions.defaultMode === 'undefined') {
      settingsConfig.permissions.defaultMode = 'auto';
    }

    const absCrawler = path.join(pluginDir, 'scripts', 'crawl-job-board.js');
    const absCleanup = path.join(pluginDir, 'scripts', 'cleanup-tmp.js');
    const absTmp = path.join(projectDir, '.job-search', 'tmp');
    const absJobSearch = path.join(projectDir, '.job-search');

    let crawlRel = path.relative(projectDir, absCrawler);
    if (!crawlRel.startsWith('.') && !crawlRel.startsWith('/')) crawlRel = `./${crawlRel}`;

    let cleanupRel = path.relative(projectDir, absCleanup);
    if (!cleanupRel.startsWith('.') && !cleanupRel.startsWith('/')) cleanupRel = `./${cleanupRel}`;

    // Filter out obsolete/overbroad grants if re-running setup
    const obsoleteGrants = [
      `Write(${projectDir}/**)`,
      'Write(./**)',
      'mcp__job-search-db__*',
      'mcp__job-search-db__delete_rubric_dimension',
    ];
    settingsConfig.permissions.allow = settingsConfig.permissions.allow.filter(g => {
      if (obsoleteGrants.includes(g)) return false;
      if (typeof g === 'string' && (g.startsWith('Bash(rm ') || g.startsWith('Bash(tee ') || g.startsWith('Bash(mkdir '))) return false;
      return true;
    });

    const grants = [
      // Crawler script execution (relative and absolute paths)
      `Bash(node ${crawlRel}:*)`,
      `Bash(node ./${crawlRel.replace(/^\.\//, '')}:*)`,
      `Bash(node ${absCrawler}:*)`,
      `Bash(node "${absCrawler}":*)`,

      // Ephemeral cleanup helper (replaces wildcard rm/tee/mkdir)
      `Bash(node ${cleanupRel}:*)`,
      `Bash(node ./${cleanupRel.replace(/^\.\//, '')}:*)`,
      `Bash(node ${absCleanup}:*)`,
      `Bash(node "${absCleanup}":*)`,

      // Scoped filesystem Read (workspace root and .job-search/)
      `Read(${projectDir}/**)`,
      'Read(./**)',
      `Read(${absJobSearch}/**)`,
      'Read(./.job-search/**)',
      'Read(.job-search/**)',

      // Scoped filesystem Write (strictly .job-search/ only, no workspace-wide Write)
      `Write(${absJobSearch}/**)`,
      'Write(./.job-search/**)',
      'Write(.job-search/**)',

      // MCP Database tools (explicitly enumerated operational tools, no wildcard or delete_rubric_dimension)
      'mcp__job-search-db__select_workspace',
      'mcp__job-search-db__get_workspace_info',
      'mcp__job-search-db__list_companies',
      'mcp__job-search-db__add_company',
      'mcp__job-search-db__upsert_company',
      'mcp__job-search-db__update_company_crawl_status',
      'mcp__job-search-db__list_title_patterns',
      'mcp__job-search-db__add_title_pattern',
      'mcp__job-search-db__list_skills',
      'mcp__job-search-db__add_skill',
      'mcp__job-search-db__set_skill_weight',
      'mcp__job-search-db__get_scoring_rubric',
      'mcp__job-search-db__get_skill_rubric',
      'mcp__job-search-db__update_rubric_dimension',
      'mcp__job-search-db__add_rubric_dimension',
      'mcp__job-search-db__get_batch',
      'mcp__job-search-db__get_pending_queue',
      'mcp__job-search-db__update_queue_status',
      'mcp__job-search-db__add_to_queue',
      'mcp__job-search-db__check_url_exists',
      'mcp__job-search-db__get_candidate',
      'mcp__job-search-db__list_candidates',
      'mcp__job-search-db__batch_score_candidates',
      'mcp__job-search-db__record_assessment',
      'mcp__job-search-db__get_pipeline_stats',
      'mcp__job-search-db__log_run',
      'mcp__job-search-db__get_run_logs',

      // Web discovery and fetch fallback tools
      'WebSearch',
      'WebFetch',
      'WebFetch(*)',
    ];
    for (const g of grants) {
      if (!settingsConfig.permissions.allow.includes(g)) settingsConfig.permissions.allow.push(g);
    }
    fs.writeFileSync(settingsFilePath, JSON.stringify(settingsConfig, null, 2) + '\n');
    console.log(`${GREEN}[+] Permissions pre-granted (Auto approval mode):${RESET} ${settingsFilePath}`);

    // 3.4 Reconcile any existing Claude Desktop / Code scheduled routines to "auto" permission mode
    const patchedRoutines = reconcileClaudeScheduledRoutines(projectDir);
    if (patchedRoutines > 0) {
      console.log(`${GREEN}[+] Configured ${patchedRoutines} scheduled routine(s) for Auto approval (unattended mode).${RESET}`);
    }
  }

  if (isCodexTarget) {
    // 3.5 Configure <project>/.codex/config.toml
    const codexDir = path.join(projectDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    codexConfigPath = path.join(codexDir, 'config.toml');
    updateCodexConfig(codexConfigPath, projectDir, relativeStartJs);
    console.log(`${GREEN}[+] Codex MCP configuration updated (least-privilege writes mode):${RESET} ${codexConfigPath}`);

    // 3.6 Register native Codex skills in <project>/.agents/skills
    agentsSkillsDir = path.join(projectDir, '.agents', 'skills');
    fs.mkdirSync(agentsSkillsDir, { recursive: true });
    if (fs.existsSync(skillsSrc)) {
      copyRecursiveSync(skillsSrc, agentsSkillsDir, runtimeFilter);
    }
    const crawlScriptDestDir = path.join(agentsSkillsDir, 'job-search-crawl', 'scripts');
    fs.mkdirSync(crawlScriptDestDir, { recursive: true });
    const crawlScriptSrc = path.join(REPO_ROOT, 'scripts', 'crawl-job-board.js');
    if (fs.existsSync(crawlScriptSrc)) {
      fs.copyFileSync(crawlScriptSrc, path.join(crawlScriptDestDir, 'crawl-job-board.js'));
      fs.chmodSync(path.join(crawlScriptDestDir, 'crawl-job-board.js'), 0o755);
    }
    console.log(`${GREEN}[+] Native Codex skills installed:${RESET} ${agentsSkillsDir}`);

    // 3.7 Copy AGENTS.md to project directory
    const agentsMdSrc = path.join(REPO_ROOT, 'AGENTS.md');
    if (fs.existsSync(agentsMdSrc)) {
      const targetAgentsMd = path.join(projectDir, 'AGENTS.md');
      fs.copyFileSync(agentsMdSrc, targetAgentsMd);
      console.log(`${GREEN}[+] Agent guidelines created:${RESET} ${targetAgentsMd}`);
    }
  }

  const isCopilotTarget = (harness === 'copilot');
  const isStandardTarget = (harness === 'standard' || harness === 'universal');
  let vscodeConfigPath = '';

  if (isStandardTarget || isCopilotTarget) {
    // 3.8 Configure root .mcp.json
    const mcpJsonPath = path.join(projectDir, '.mcp.json');
    let mcpConfig = { mcpServers: {} };
    if (fs.existsSync(mcpJsonPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
        if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      } catch {}
    }
    mcpConfig.mcpServers['job-search-db'] = {
      type: 'stdio',
      command: 'node',
      args: [relativeStartJs],
    };
    fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    console.log(`${GREEN}[+] Standard MCP configuration updated:${RESET} ${mcpJsonPath}`);

    // If Copilot target or .vscode exists, configure .vscode/mcp.json
    if (isCopilotTarget || fs.existsSync(path.join(projectDir, '.vscode'))) {
      const vscodeDir = path.join(projectDir, '.vscode');
      fs.mkdirSync(vscodeDir, { recursive: true });
      vscodeConfigPath = path.join(vscodeDir, 'mcp.json');
      let vscodeMcp = { mcpServers: {} };
      if (fs.existsSync(vscodeConfigPath)) {
        try {
          vscodeMcp = JSON.parse(fs.readFileSync(vscodeConfigPath, 'utf-8'));
          if (!vscodeMcp.mcpServers) vscodeMcp.mcpServers = {};
        } catch {}
      }
      vscodeMcp.mcpServers['job-search-db'] = {
        type: 'stdio',
        command: 'node',
        args: [relativeStartJs],
      };
      fs.writeFileSync(vscodeConfigPath, JSON.stringify(vscodeMcp, null, 2) + '\n');
      console.log(`${GREEN}[+] VS Code / Copilot MCP configuration updated:${RESET} ${vscodeConfigPath}`);
    }

    // Register skills in .agents/skills
    agentsSkillsDir = path.join(projectDir, '.agents', 'skills');
    fs.mkdirSync(agentsSkillsDir, { recursive: true });
    if (fs.existsSync(skillsSrc)) {
      copyRecursiveSync(skillsSrc, agentsSkillsDir, runtimeFilter);
    }
    const crawlScriptDestDir = path.join(agentsSkillsDir, 'job-search-crawl', 'scripts');
    fs.mkdirSync(crawlScriptDestDir, { recursive: true });
    const crawlScriptSrc = path.join(REPO_ROOT, 'scripts', 'crawl-job-board.js');
    if (fs.existsSync(crawlScriptSrc)) {
      fs.copyFileSync(crawlScriptSrc, path.join(crawlScriptDestDir, 'crawl-job-board.js'));
      fs.chmodSync(path.join(crawlScriptDestDir, 'crawl-job-board.js'), 0o755);
    }
    console.log(`${GREEN}[+] Declarative agent skills installed:${RESET} ${agentsSkillsDir}`);

    // Copy AGENTS.md
    const agentsMdSrc = path.join(REPO_ROOT, 'AGENTS.md');
    if (fs.existsSync(agentsMdSrc)) {
      const targetAgentsMd = path.join(projectDir, 'AGENTS.md');
      fs.copyFileSync(agentsMdSrc, targetAgentsMd);
      console.log(`${GREEN}[+] Agent guidelines created:${RESET} ${targetAgentsMd}`);
    }
  }

  // 4. Initialize <project>/.job-search/
  fs.mkdirSync(jobSearchDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(jobSearchDir, 0o700);
  } catch {}
  const tmpDir = path.join(jobSearchDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(tmpDir, 0o700);
  } catch {}

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
    fs.chmodSync(targetResume, 0o600);
    console.log(`${GREEN}[+] Resume installed to:${RESET} ${targetResume}`);
  } else if (fs.existsSync(targetResume)) {
    try {
      fs.chmodSync(targetResume, 0o600);
    } catch {}
    console.log(`${GREEN}[+] Existing resume preserved:${RESET} ${targetResume}`);
  } else {
    // Check for a local resume.pdf in the workspace root
    const localResume = path.join(projectDir, 'resume.pdf');
    if (fs.existsSync(localResume)) {
      fs.copyFileSync(localResume, targetResume);
      fs.chmodSync(targetResume, 0o600);
      console.log(`${GREEN}[+] Auto-detected and installed local resume:${RESET} ${localResume}`);
    } else {
      console.log(`${YELLOW}[!] No resume provided yet.${RESET} Workspace scaffolding will proceed.`);
      console.log(`    You can add your resume anytime by placing it at: ${BOLD}${targetResume}${RESET}`);
      console.log(`    Or by running: ${BOLD}npx -y github:joshyim/job-search-automations update-resume <path>${RESET}`);
    }
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
      try {
        fs.chmodSync(targetSqlite, 0o600);
      } catch {}
      console.log(`${GREEN}[+] SQLite schema initialized and seeded.${RESET}`);
    } else {
      if (fs.existsSync(targetSqlite)) {
        try {
          fs.chmodSync(targetSqlite, 0o600);
        } catch {}
      }
      console.log(`${GREEN}[+] Existing SQLite database preserved:${RESET} ${targetSqlite}`);
    }
    if (fs.existsSync(`${targetSqlite}-wal`)) {
      try { fs.chmodSync(`${targetSqlite}-wal`, 0o600); } catch {}
    }
    if (fs.existsSync(`${targetSqlite}-shm`)) {
      try { fs.chmodSync(`${targetSqlite}-shm`, 0o600); } catch {}
    }
  } else if (mode === 'neon') {
    if (neonConnStr && !mockMode) {
      if (process.platform === 'darwin') {
        try {
          execFileSync(
            'security',
            ['add-generic-password', '-s', 'job-search-automations', '-a', 'neon-connection-string', '-w', neonConnStr, '-U'],
            { stdio: 'ignore' }
          );
          console.log(`${GREEN}[+] Connection string secured in macOS Keychain.${RESET}`);
        } catch (err) {
          console.error(`${RED}[!] Failed to store Neon connection string in macOS Keychain:${RESET}`, err.message);
          process.exit(1);
        }
      } else {
        console.warn(`${YELLOW}[*] Non-macOS platform: Skipped macOS Keychain storage.${RESET}`);
      }
    }
    const initScript = path.join(REPO_ROOT, 'scripts', 'init-neon.js');
    if (fs.existsSync(initScript)) {
      const initArgs = mockMode ? ['--mock'] : [];
      const childEnv = { ...process.env };
      if (neonConnStr) {
        childEnv.DATABASE_URL = neonConnStr;
      }
      try {
        execFileSync(process.execPath, [initScript, ...initArgs], {
          stdio: 'inherit',
          env: childEnv,
        });
      } catch (err) {
        console.error(`${RED}[!] Neon database initialization failed.${RESET}`);
        process.exit(err.status || 1);
      }
    }
  }

  // Create/update inner .job-search/.gitignore in both storage modes (PRO-57)
  ensureInnerGitignore(jobSearchDir);

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
  try {
    fs.chmodSync(configFile, 0o600);
  } catch {}
  console.log(`${GREEN}[+] Configuration written to:${RESET} ${configFile}`);

  // 5. Append workspace data directory and plugin directories to project .gitignore if git repo
  const projectGitignore = path.join(projectDir, '.gitignore');
  const ignorePatterns = ['.job-search/'];
  if (isClaudeTarget) ignorePatterns.push('.claude/plugins/');
  if (isCodexTarget) ignorePatterns.push('.codex/plugins/');
  if (isStandardTarget || isCopilotTarget) ignorePatterns.push('.agents/plugins/');

  if (fs.existsSync(projectGitignore)) {
    const giContent = fs.readFileSync(projectGitignore, 'utf-8');
    const toAdd = ignorePatterns.filter((pat) => {
      if (pat === '.job-search/' && (giContent.includes('.job-search/') || giContent.includes('.job-search'))) {
        return false;
      }
      return !giContent.includes(pat);
    });
    if (toAdd.length > 0) {
      fs.appendFileSync(projectGitignore, `\n# Job Search Workspace and Plugins\n${toAdd.join('\n')}\n`);
    }
  } else if (fs.existsSync(path.join(projectDir, '.git'))) {
    fs.writeFileSync(projectGitignore, `# Job Search Workspace and Plugins\n${ignorePatterns.join('\n')}\n`);
  }

  // Check for already-tracked sensitive workspace files in Git history (PRO-57)
  checkAlreadyTrackedFiles(projectDir, jobSearchDir);

  console.log(`\n${GREEN}${BOLD}==============================================================${RESET}`);
  console.log(`${GREEN}${BOLD}  Setup Complete! Job Search Automation is ready to use.      ${RESET}`);
  console.log(`${GREEN}${BOLD}==============================================================${RESET}`);
  console.log(`  Mode:              ${BOLD}${mode}${RESET}`);
  console.log(`  Harness:           ${BOLD}${harness}${RESET}`);
  console.log(`  Plugin Dir:        ${BOLD}${pluginDir}${RESET}`);
  console.log(`  Workspace Dir:     ${BOLD}${jobSearchDir}${RESET}`);
  console.log(`  Database:          ${BOLD}${targetSqlite}${RESET}`);
  console.log(`  Resume:            ${BOLD}${targetResume}${RESET}`);
  console.log(`  Configuration:     ${BOLD}${configFile}${RESET}`);
  if (isCodexTarget) {
    console.log(`  Codex Config:      ${BOLD}${codexConfigPath}${RESET}`);
    console.log(`                     ${GREEN}✓${RESET} MCP Server:      ${CYAN}[mcp_servers.job-search-db]${RESET}`);
    console.log(`                     ${GREEN}✓${RESET} Approval Policy: ${CYAN}default_tools_approval_mode = "writes"${RESET}`);
    console.log(`  Codex Skills:      ${BOLD}${agentsSkillsDir}${RESET}`);
  }
  if (isClaudeTarget) {
    if (launchFilePath) console.log(`  Launch Config:     ${BOLD}${launchFilePath}${RESET}`);
    if (settingsFilePath) {
      console.log(`  Permissions:       ${BOLD}${settingsFilePath}${RESET}`);
      console.log(`                     ${GREEN}✓${RESET} Scoped Read/Write: ${CYAN}${projectDir}/** (Read)${RESET} & ${CYAN}.job-search/** (Read/Write)${RESET}`);
      console.log(`                     ${GREEN}✓${RESET} Crawler Script:    ${CYAN}node .claude/plugins/job-search-automations/scripts/crawl-job-board.js:*${RESET}`);
      console.log(`                     ${GREEN}✓${RESET} Ephemeral Temp:    ${CYAN}node .claude/plugins/job-search-automations/scripts/cleanup-tmp.js:*${RESET} (cleanup-tmp helper)`);
      console.log(`                     ${GREEN}✓${RESET} MCP Database:      ${CYAN}Operational tools pre-approved (least privilege)${RESET}`);
      console.log(`                     ${GREEN}✓${RESET} Web Access:        ${CYAN}WebSearch${RESET}, ${CYAN}WebFetch${RESET} (fallback discovery)`);
    }
  }
  if (isCopilotTarget) {
    if (vscodeConfigPath) {
      console.log(`  VS Code Config:    ${BOLD}${vscodeConfigPath}${RESET}`);
      console.log(`                     ${GREEN}✓${RESET} MCP Server:      ${CYAN}job-search-db${RESET}`);
    }
    console.log(`  Agent Skills:      ${BOLD}${agentsSkillsDir}${RESET}`);
  } else if (isStandardTarget && !isClaudeTarget && !isCodexTarget) {
    console.log(`  Standard MCP:      ${BOLD}${path.join(projectDir, '.mcp.json')}${RESET}`);
    console.log(`  Agent Skills:      ${BOLD}${agentsSkillsDir}${RESET}`);
  }
  console.log(`\n${CYAN}${BOLD}Recurring Pipeline Runs:${RESET}`);
  console.log(`  Use the /schedule command or harness routine settings to automate runs:`);
  console.log(`  /schedule CronExpression="0 9 * * 1-5" Prompt="Run job-search-lead-gen for a batch of 3 companies in directory '${projectDir}'. Complete within 50 messages."`);
  console.log(`\n  ${BOLD}Model Class Recommendation:${RESET}`);
  if (isClaudeTarget) {
    console.log(`    • Claude Code / Desktop: Recommend Sonnet-class (cost-effective, balanced)`);
  }
  if (isCodexTarget) {
    console.log(`    • OpenAI / Codex:        Recommend Luna-class (fast, low token cost)`);
  }
  if (isCopilotTarget) {
    console.log(`    • GitHub Copilot:        Recommend Claude 3.5 Sonnet or GPT-4o-mini`);
  }
  if (!isClaudeTarget && !isCodexTarget && !isCopilotTarget) {
    console.log(`    • OpenAI / Codex:        Recommend Luna-class (fast, low token cost)`);
    console.log(`    • Claude Code / Desktop: Recommend Sonnet-class (cost-effective, balanced)`);
    console.log(`    • Standard Harnesses:    Recommend balanced tier models`);
  }
  console.log(`    (Avoid defaulting unattended recurring routines to expensive flagship models like Opus)`);

  if (isCopilotTarget) {
    console.log(`\nPlease reload your VS Code window (Cmd+Shift+P -> 'Developer: Reload Window') for Copilot to load skills and MCP tools.`);
  } else if (isCodexTarget && !isClaudeTarget) {
    console.log(`\nPlease reload your Codex workspace window or inspect /mcp for skills and MCP tools to load.`);
  } else if (isClaudeTarget && !isCodexTarget) {
    console.log(`\nPlease restart your Claude session for skills and MCP tools to load.`);
  } else {
    console.log(`\nPlease reload your workspace window or restart your agent session for skills and MCP tools to load.`);
  }
}

// -----------------------------------------------------------------------------
// Subcommand: update-resume
// -----------------------------------------------------------------------------
async function handleUpdateResume(args) {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

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
    console.error(`${RED}[ERROR] Resume path missing. Usage: job-search-automations update-resume <path>${RESET}`);
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
    console.error(`Please run ${BOLD}npx -y github:joshyim/job-search-automations setup --directory <dir> --resume <path>${RESET} first to initialize the workspace.`);
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
  fs.chmodSync(tmpResume, 0o600);
  fs.renameSync(tmpResume, targetResume);
  try {
    fs.chmodSync(targetResume, 0o600);
  } catch {}

  // Ensure parent directory retains 0o700 if .job-search
  if (path.basename(cfgDir) === '.job-search') {
    try {
      fs.chmodSync(cfgDir, 0o700);
    } catch {}
  }

  // Update updatedAt in config.json
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    cfg.updatedAt = new Date().toISOString();
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(cfgFile, 0o600);
  } catch {}

  console.log(`${GREEN}${BOLD}[SUCCESS] Resume successfully updated at:${RESET} ${targetResume}`);
}

// -----------------------------------------------------------------------------
// Subcommand: uninstall
// -----------------------------------------------------------------------------
async function handleUninstall(args) {
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

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
  const pluginDir = installTo ? expandPath(installTo) : path.join(projectDir, '.claude', 'plugins', 'job-search-automations');

  console.log(`${CYAN}[*] Uninstalling Job Search Automation from ${projectDir}...${RESET}`);

  // 1. Remove plugin directory
  const candidatePluginDirs = installTo
    ? [expandPath(installTo)]
    : [
        path.join(projectDir, '.claude', 'plugins', 'job-search-automations'),
        path.join(projectDir, '.codex', 'plugins', 'job-search-automations'),
        path.join(projectDir, '.agents', 'plugins', 'job-search-automations'),
        path.join(projectDir, '.claude', 'plugins', 'job-search-automation'),
        path.join(projectDir, '.codex', 'plugins', 'job-search-automation'),
        path.join(projectDir, '.agents', 'plugins', 'job-search-automation'),
      ];
  for (const pDir of candidatePluginDirs) {
    if (fs.existsSync(pDir)) {
      fs.rmSync(pDir, { recursive: true, force: true });
      console.log(`${GREEN}[+] Removed plugin directory:${RESET} ${pDir}`);
    }
  }

  // 2. Remove job-search-db from .mcp.json (Claude / Standard)
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

  // 2.1 Remove job-search-db from .codex/config.toml (Codex)
  const codexTomlPath = path.join(projectDir, '.codex', 'config.toml');
  if (fs.existsSync(codexTomlPath)) {
    try {
      let content = fs.readFileSync(codexTomlPath, 'utf-8');
      const regex = /\[mcp_servers\.job-search-db\][\s\S]*?(?=(\n\[|\n*$))/;
      if (regex.test(content)) {
        content = content.replace(regex, '').trim();
        if (content.length === 0) {
          fs.rmSync(codexTomlPath);
          console.log(`${GREEN}[+] Cleaned up empty .codex/config.toml${RESET}`);
          try {
            const codexDir = path.join(projectDir, '.codex');
            if (fs.readdirSync(codexDir).length === 0) fs.rmdirSync(codexDir);
          } catch {}
        } else {
          fs.writeFileSync(codexTomlPath, content + '\n');
          console.log(`${GREEN}[+] Removed job-search-db from .codex/config.toml${RESET}`);
        }
      }
    } catch {}
  }

  // 2.2 Remove job-search-db from .vscode/mcp.json (Copilot / VS Code)
  const vscodeMcpPath = path.join(projectDir, '.vscode', 'mcp.json');
  if (fs.existsSync(vscodeMcpPath)) {
    try {
      const vscodeConfig = JSON.parse(fs.readFileSync(vscodeMcpPath, 'utf-8'));
      if (vscodeConfig.mcpServers && vscodeConfig.mcpServers['job-search-db']) {
        delete vscodeConfig.mcpServers['job-search-db'];
        if (Object.keys(vscodeConfig.mcpServers).length === 0) {
          fs.rmSync(vscodeMcpPath);
          console.log(`${GREEN}[+] Cleaned up empty .vscode/mcp.json${RESET}`);
          try {
            const vscodeDir = path.join(projectDir, '.vscode');
            if (fs.readdirSync(vscodeDir).length === 0) fs.rmdirSync(vscodeDir);
          } catch {}
        } else {
          fs.writeFileSync(vscodeMcpPath, JSON.stringify(vscodeConfig, null, 2) + '\n');
          console.log(`${GREEN}[+] Removed job-search-db from .vscode/mcp.json${RESET}`);
        }
      }
    } catch {}
  }

  // 2.2 Remove native skills in .agents/skills
  const installedSkills = ['job-search-lead-gen', 'job-search-crawl', 'job-search-assess', 'company-search', 'title-discovery', 'pipeline-diagram'];
  const agentsSkillsDir = path.join(projectDir, '.agents', 'skills');
  let removedSkillCount = 0;
  for (const skill of installedSkills) {
    const sDir = path.join(agentsSkillsDir, skill);
    if (fs.existsSync(sDir)) {
      fs.rmSync(sDir, { recursive: true, force: true });
      removedSkillCount++;
    }
  }
  if (removedSkillCount > 0) {
    console.log(`${GREEN}[+] Cleaned up ${removedSkillCount} native Codex skills in .agents/skills/${RESET}`);
    try {
      if (fs.readdirSync(agentsSkillsDir).length === 0) {
        fs.rmdirSync(agentsSkillsDir);
        if (fs.readdirSync(path.join(projectDir, '.agents')).length === 0) {
          fs.rmdirSync(path.join(projectDir, '.agents'));
        }
      }
    } catch {}
  }

  // 2.3 Remove AGENTS.md if present
  const targetAgentsMd = path.join(projectDir, 'AGENTS.md');
  if (fs.existsSync(targetAgentsMd)) {
    fs.rmSync(targetAgentsMd, { force: true });
    console.log(`${GREEN}[+] Removed AGENTS.md${RESET}`);
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
