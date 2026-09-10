import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_KEYCHAIN_ACCOUNT, DEFAULT_KEYCHAIN_SERVICE } from './keychain.js';

export const ConfigSchema = z.object({
  version: z.string().optional().default('1.0.0'),
  mode: z.enum(['local', 'neon']),
  databasePath: z.string().optional().default('./job-search.sqlite'),
  resumePath: z.string().optional().default('./resume.pdf'),
  workflowDataPath: z.string().optional(),
  keychainService: z.string().default(DEFAULT_KEYCHAIN_SERVICE),
  keychainAccount: z.string().default(DEFAULT_KEYCHAIN_ACCOUNT),
  updatedAt: z.string().optional(),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig extends ServerConfig {
  configDir: string;
  databasePath: string; // Absolute resolved path
  resumePath: string;   // Absolute resolved path
}

export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function loadConfig(configPath?: string): ResolvedConfig {
  const targetPath = configPath || process.env.JOB_SEARCH_CONFIG_PATH;

  if (!targetPath) {
    throw new Error(
      'Configuration file path was not provided.\n' +
      'Please specify a configuration file via --config or provide a workspace directory containing .job-search/.'
    );
  }

  const resolvedConfigPath = path.resolve(expandPath(targetPath));

  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(
      `Configuration file not found at: ${resolvedConfigPath}\n` +
      `Please run './setup.sh --directory <selected-directory> --resume <path>' to initialize your job search workspace.`
    );
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedConfigPath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Failed to read configuration file at ${resolvedConfigPath}: ${err.message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Invalid JSON in configuration file at ${resolvedConfigPath}: ${err.message}`);
  }

  const result = ConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    const errorDetails = result.error.errors.map((e) => ` - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed for ${resolvedConfigPath}:\n${errorDetails}`);
  }

  const data = result.data;
  const configDir = path.dirname(resolvedConfigPath);

  // Resolve databasePath and resumePath relative to the directory containing config.json
  const resolvedDbPath = path.resolve(configDir, data.databasePath || './job-search.sqlite');
  const resolvedResumePath = path.resolve(configDir, data.resumePath || './resume.pdf');

  return {
    ...data,
    configDir,
    databasePath: resolvedDbPath,
    resumePath: resolvedResumePath,
  };
}
