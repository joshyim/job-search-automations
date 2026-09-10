import fs from 'node:fs';
import path from 'node:path';
import { DataAdapter } from './adapters/types.js';
import { SqliteAdapter } from './adapters/sqlite/sqlite-adapter.js';
import { NeonAdapter } from './adapters/neon/neon-adapter.js';
import { expandPath, loadConfig, ResolvedConfig } from './config.js';
import { getNeonConnectionString } from './keychain.js';

export interface WorkspacePaths {
  projectDir: string;
  configDir: string;
  configFile: string;
  sqliteFile: string;
}

export class WorkspaceManager {
  private activeWorkspaceDir?: string;
  private adapters: Map<string, DataAdapter> = new Map();

  constructor(initialDirOrConfig?: string) {
    if (initialDirOrConfig) {
      const expanded = expandPath(initialDirOrConfig);
      if (fs.existsSync(expanded)) {
        const stat = fs.statSync(expanded);
        if (stat.isDirectory()) {
          this.activeWorkspaceDir = path.resolve(expanded);
        } else if (stat.isFile() && path.basename(expanded) === 'config.json') {
          const dir = path.dirname(path.resolve(expanded));
          this.activeWorkspaceDir = dir.endsWith('.job-search') ? path.dirname(dir) : dir;
        }
      } else {
        this.activeWorkspaceDir = path.resolve(expanded);
      }
    }
  }

  public getActiveWorkspace(): string | undefined {
    return this.activeWorkspaceDir;
  }

  public resolvePaths(inputDir?: string): WorkspacePaths {
    const rawDir = inputDir || this.activeWorkspaceDir;

    if (!rawDir) {
      throw new Error(
        'No workspace directory provided.\n' +
        'Local mode requires an explicit selected directory containing .job-search/.\n' +
        'Please pass "selected_directory" (or "directory") with your project directory path, or invoke the "select_workspace" tool.'
      );
    }

    const resolved = path.resolve(expandPath(rawDir));
    let projectDir: string;
    let configDir: string;

    if (path.basename(resolved) === '.job-search') {
      configDir = resolved;
      projectDir = path.dirname(resolved);
    } else {
      projectDir = resolved;
      configDir = path.join(resolved, '.job-search');
    }

    return {
      projectDir,
      configDir,
      configFile: path.join(configDir, 'config.json'),
      sqliteFile: path.join(configDir, 'job-search.sqlite'),
    };
  }

  public validateWorkspace(inputDir?: string): WorkspacePaths {
    const paths = this.resolvePaths(inputDir);

    if (!fs.existsSync(paths.configDir) || !fs.existsSync(paths.sqliteFile)) {
      throw new Error(
        `Job search workspace not initialized at '${paths.projectDir}'.\n` +
        `Database not found at '${paths.sqliteFile}'.\n` +
        `Please run './setup.sh --directory "${paths.projectDir}" --resume <path>' to initialize this workspace.`
      );
    }

    return paths;
  }

  public async selectWorkspace(inputDir: string): Promise<{
    status: string;
    workspace_directory: string;
    database_path: string;
    resume_path: string;
  }> {
    const paths = this.validateWorkspace(inputDir);
    this.activeWorkspaceDir = paths.projectDir;

    let resumePath = path.join(paths.configDir, 'resume.pdf');
    if (fs.existsSync(paths.configFile)) {
      try {
        const config = loadConfig(paths.configFile);
        resumePath = config.resumePath;
      } catch {}
    }

    return {
      status: 'active',
      workspace_directory: paths.projectDir,
      database_path: paths.sqliteFile,
      resume_path: resumePath,
    };
  }

  public async getAdapter(inputDir?: string): Promise<DataAdapter> {
    const paths = this.validateWorkspace(inputDir);

    // If an adapter is already cached for this sqlite path, return it
    if (this.adapters.has(paths.sqliteFile)) {
      return this.adapters.get(paths.sqliteFile)!;
    }

    let config: ResolvedConfig | null = null;
    if (fs.existsSync(paths.configFile)) {
      config = loadConfig(paths.configFile);
    }

    if (config && config.mode === 'neon') {
      const connectionString = getNeonConnectionString(config.keychainService, config.keychainAccount);
      const adapter = new NeonAdapter(connectionString);
      await adapter.initialize();
      this.adapters.set(paths.sqliteFile, adapter);
      return adapter;
    }

    // Default to SQLite adapter for local mode
    const resumePath = config?.resumePath || path.join(paths.configDir, 'resume.pdf');
    const adapter = new SqliteAdapter(paths.sqliteFile, resumePath);
    await adapter.initialize();
    this.adapters.set(paths.sqliteFile, adapter);
    return adapter;
  }

  public async getWorkspaceInfo(inputDir?: string): Promise<{
    active_workspace: string;
    database_path: string;
    resume_path: string;
    resume_exists: boolean;
    config_path: string;
    config_exists: boolean;
  }> {
    const paths = this.validateWorkspace(inputDir);
    let resumePath = path.join(paths.configDir, 'resume.pdf');
    if (fs.existsSync(paths.configFile)) {
      try {
        const config = loadConfig(paths.configFile);
        resumePath = config.resumePath;
      } catch {}
    }

    return {
      active_workspace: paths.projectDir,
      database_path: paths.sqliteFile,
      resume_path: resumePath,
      resume_exists: fs.existsSync(resumePath),
      config_path: paths.configFile,
      config_exists: fs.existsSync(paths.configFile),
    };
  }

  public async closeAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.close();
      } catch {}
    }
    this.adapters.clear();
  }
}
