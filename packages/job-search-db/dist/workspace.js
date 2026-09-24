import fs from 'node:fs';
import path from 'node:path';
import { SqliteAdapter } from './adapters/sqlite/sqlite-adapter.js';
import { NeonAdapter } from './adapters/neon/neon-adapter.js';
import { expandPath, loadConfig } from './config.js';
import { getNeonConnectionString } from './keychain.js';
export class WorkspaceManager {
    activeWorkspaceDir;
    adapters = new Map();
    constructor(initialDirOrConfig) {
        if (initialDirOrConfig) {
            const expanded = expandPath(initialDirOrConfig);
            if (fs.existsSync(expanded)) {
                const stat = fs.statSync(expanded);
                if (stat.isDirectory()) {
                    this.activeWorkspaceDir = path.resolve(expanded);
                }
                else if (stat.isFile() && path.basename(expanded) === 'config.json') {
                    const dir = path.dirname(path.resolve(expanded));
                    this.activeWorkspaceDir = dir.endsWith('.job-search') ? path.dirname(dir) : dir;
                }
            }
            else {
                this.activeWorkspaceDir = path.resolve(expanded);
            }
        }
    }
    getActiveWorkspace() {
        return this.activeWorkspaceDir;
    }
    resolvePaths(inputDir) {
        const rawDir = inputDir || this.activeWorkspaceDir;
        if (!rawDir) {
            throw new Error('No workspace directory provided.\n' +
                'Local mode requires an explicit selected directory containing .job-search/.\n' +
                'Please pass "selected_directory" (or "directory") with your project directory path, or invoke the "select_workspace" tool.');
        }
        const resolved = path.resolve(expandPath(rawDir));
        let projectDir;
        let configDir;
        if (path.basename(resolved) === '.job-search') {
            configDir = resolved;
            projectDir = path.dirname(resolved);
        }
        else {
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
    validateWorkspace(inputDir) {
        const paths = this.resolvePaths(inputDir);
        if (!fs.existsSync(paths.configDir) || !fs.existsSync(paths.sqliteFile)) {
            throw new Error(`Job search workspace not initialized at '${paths.projectDir}'.\n` +
                `Database not found at '${paths.sqliteFile}'.\n` +
                `Please run 'npx -y github:joshyim/job-search-automations setup --directory "${paths.projectDir}" --resume <path>' to initialize this workspace.`);
        }
        return paths;
    }
    async selectWorkspace(inputDir) {
        const paths = this.validateWorkspace(inputDir);
        this.activeWorkspaceDir = paths.projectDir;
        let resumePath = path.join(paths.configDir, 'resume.pdf');
        if (fs.existsSync(paths.configFile)) {
            try {
                const config = loadConfig(paths.configFile);
                resumePath = config.resumePath;
            }
            catch { }
        }
        return {
            status: 'active',
            workspace_directory: paths.projectDir,
            database_path: paths.sqliteFile,
            resume_path: resumePath,
        };
    }
    async getAdapter(inputDir) {
        const paths = this.validateWorkspace(inputDir);
        // If an adapter is already cached for this sqlite path, return it
        if (this.adapters.has(paths.sqliteFile)) {
            return this.adapters.get(paths.sqliteFile);
        }
        let config = null;
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
    async getWorkspaceInfo(inputDir) {
        const paths = this.validateWorkspace(inputDir);
        let resumePath = path.join(paths.configDir, 'resume.pdf');
        if (fs.existsSync(paths.configFile)) {
            try {
                const config = loadConfig(paths.configFile);
                resumePath = config.resumePath;
            }
            catch { }
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
    async closeAll() {
        for (const adapter of this.adapters.values()) {
            try {
                await adapter.close();
            }
            catch { }
        }
        this.adapters.clear();
    }
}
