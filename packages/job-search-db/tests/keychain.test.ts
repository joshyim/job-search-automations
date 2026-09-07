import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNeonConnectionString } from '../src/keychain.js';

describe('Keychain & Credential Retrieval', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.NEON_DATABASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('falls back to DATABASE_URL when keychain entry is not present', () => {
    process.env.DATABASE_URL = 'postgres://env-user:env-pass@ep-env.neon.tech/neondb';
    const connStr = getNeonConnectionString('non-existent-service-test-12345', 'non-existent-account-test-12345');
    expect(connStr).toBe('postgres://env-user:env-pass@ep-env.neon.tech/neondb');
  });

  it('throws descriptive error when neither Keychain nor DATABASE_URL is available', () => {
    expect(() =>
      getNeonConnectionString('non-existent-service-test-12345', 'non-existent-account-test-12345')
    ).toThrow(/Neon database connection string could not be retrieved from macOS Keychain/);
  });
});
