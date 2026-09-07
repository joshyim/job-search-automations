import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';

describe('Config Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('successfully loads a valid local config', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mode: 'local',
        workflowDataPath: '/Users/test/job-data',
      })
    );

    const config = loadConfig(configPath);
    expect(config.mode).toBe('local');
    expect(config.workflowDataPath).toBe('/Users/test/job-data');
    expect(config.keychainService).toBe('job-search-plugin');
    expect(config.keychainAccount).toBe('neon-connection-string');
  });

  it('successfully loads a valid neon config with custom keychain details', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mode: 'neon',
        keychainService: 'custom-service',
        keychainAccount: 'custom-account',
      })
    );

    const config = loadConfig(configPath);
    expect(config.mode).toBe('neon');
    expect(config.keychainService).toBe('custom-service');
    expect(config.keychainAccount).toBe('custom-account');
  });

  it('throws validation error when workflowDataPath is missing for local mode', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mode: 'local',
      })
    );

    expect(() => loadConfig(configPath)).toThrow(/workflowDataPath is required when mode is "local"/);
  });

  it('throws helpful error when configuration file is missing', () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.json');
    expect(() => loadConfig(nonExistentPath)).toThrow(/Configuration file not found at/);
  });
});
