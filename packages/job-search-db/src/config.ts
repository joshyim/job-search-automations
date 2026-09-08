import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_KEYCHAIN_ACCOUNT, DEFAULT_KEYCHAIN_SERVICE } from './keychain.js';

export const ConfigSchema = z.object({
  mode: z.enum(['local', 'neon']),
  workflowDataPath: z.string().optional(),
  keychainService: z.string().default(DEFAULT_KEYCHAIN_SERVICE),
  keychainAccount: z.string().default(DEFAULT_KEYCHAIN_ACCOUNT),
}).superRefine((data, ctx) => {
  if (data.mode === 'local' && (!data.workflowDataPath || data.workflowDataPath.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'workflowDataPath is required when mode is "local"',
      path: ['workflowDataPath'],
    });
  }
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function getDefaultConfigPath(): string {
  const newPath = path.join(os.homedir(), '.config', 'job-search-automation', 'config.json');
  if (fs.existsSync(newPath)) {
    return newPath;
  }
  const legacyPath = path.join(os.homedir(), '.config', 'job-search-plugin', 'config.json');
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

export function loadConfig(configPath?: string): ServerConfig {
  const resolvedPath = configPath || process.env.JOB_SEARCH_CONFIG_PATH || getDefaultConfigPath();

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Configuration file not found at: ${resolvedPath}\n` +
      `Please create the config file with either:\n` +
      `  {\n` +
      `    "mode": "local",\n` +
      `    "workflowDataPath": "/path/to/data"\n` +
      `  }\n` +
      `or\n` +
      `  {\n` +
      `    "mode": "neon"\n` +
      `  }`
    );
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch (err: any) {
    throw new Error(`Failed to read configuration file at ${resolvedPath}: ${err.message}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Invalid JSON in configuration file at ${resolvedPath}: ${err.message}`);
  }

  const result = ConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => ` - ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration validation failed for ${resolvedPath}:\n${errorDetails}`);
  }

  return result.data;
}
