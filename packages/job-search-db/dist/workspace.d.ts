import { DataAdapter } from './adapters/types.js';
export interface WorkspacePaths {
    projectDir: string;
    configDir: string;
    configFile: string;
    sqliteFile: string;
}
export declare class WorkspaceManager {
    private activeWorkspaceDir?;
    private adapters;
    constructor(initialDirOrConfig?: string);
    getActiveWorkspace(): string | undefined;
    resolvePaths(inputDir?: string): WorkspacePaths;
    validateWorkspace(inputDir?: string): WorkspacePaths;
    selectWorkspace(inputDir: string): Promise<{
        status: string;
        workspace_directory: string;
        database_path: string;
        resume_path: string;
    }>;
    getAdapter(inputDir?: string): Promise<DataAdapter>;
    getWorkspaceInfo(inputDir?: string): Promise<{
        active_workspace: string;
        database_path: string;
        resume_path: string;
        resume_exists: boolean;
        config_path: string;
        config_exists: boolean;
    }>;
    closeAll(): Promise<void>;
}
