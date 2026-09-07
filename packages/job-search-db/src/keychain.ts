import { execFileSync } from 'node:child_process';

export const DEFAULT_KEYCHAIN_SERVICE = 'job-search-plugin';
export const DEFAULT_KEYCHAIN_ACCOUNT = 'neon-connection-string';

/**
 * Retrieves a generic password from macOS Keychain.
 * Returns null if not found or if the platform is not macOS / command fails.
 */
export function getKeychainSecret(service: string, account: string): string | null {
  try {
    const stdout = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const secret = stdout.trim();
    return secret.length > 0 ? secret : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the Neon connection string from macOS Keychain with fallback to DATABASE_URL.
 * Keeps connection string strictly in-memory; never writes to disk or logs.
 */
export function getNeonConnectionString(
  service: string = DEFAULT_KEYCHAIN_SERVICE,
  account: string = DEFAULT_KEYCHAIN_ACCOUNT
): string {
  // 1. Try Keychain first
  const keychainSecret = getKeychainSecret(service, account);
  if (keychainSecret) {
    return keychainSecret;
  }

  // 2. Try environment variables fallback
  const envSecret = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (envSecret && envSecret.trim().length > 0) {
    return envSecret.trim();
  }

  throw new Error(
    `Neon database connection string could not be retrieved from macOS Keychain (service: "${service}", account: "${account}") or environment variable DATABASE_URL. ` +
    `To store your Neon connection string in Keychain, run: ` +
    `security add-generic-password -s "${service}" -a "${account}" -w "<your-neon-connection-string>"`
  );
}
