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

  it('successfully loads a valid local config and resolves relative paths', () => {
    const configDir = path.join(tempDir, '.job-search');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: '1.0.0',
        mode: 'local',
        databasePath: './job-search.sqlite',
        resumePath: './resume.pdf',
      })
    );

    const config = loadConfig(configPath);
    expect(config.mode).toBe('local');
    expect(config.configDir).toBe(configDir);
    expect(config.databasePath).toBe(path.join(configDir, 'job-search.sqlite'));
    expect(config.resumePath).toBe(path.join(configDir, 'resume.pdf'));
    expect(config.keychainService).toBe('job-search-automation');
    expect(config.keychainAccount).toBe('neon-connection-string');
  });

  it('defaults databasePath and resumePath to relative defaults when omitted', () => {
    const configDir = path.join(tempDir, '.job-search');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mode: 'local',
      })
    );

    const config = loadConfig(configPath);
    expect(config.mode).toBe('local');
    expect(config.databasePath).toBe(path.join(configDir, 'job-search.sqlite'));
    expect(config.resumePath).toBe(path.join(configDir, 'resume.pdf'));
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

  it('throws helpful error when configuration file is missing', () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.json');
    expect(() => loadConfig(nonExistentPath)).toThrow(/Configuration file not found at/);
  });

  it('throws helpful error when no configuration path is provided without global fallback', () => {
    const origEnv = process.env.JOB_SEARCH_CONFIG_PATH;
    delete process.env.JOB_SEARCH_CONFIG_PATH;
    try {
      expect(() => loadConfig()).toThrow(/Configuration file path was not provided/);
    } finally {
      if (origEnv !== undefined) {
        process.env.JOB_SEARCH_CONFIG_PATH = origEnv;
      }
    }
  });
});
