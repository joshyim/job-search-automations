export declare const DEFAULT_KEYCHAIN_SERVICE = "job-search-automations";
export declare const LEGACY_KEYCHAIN_SERVICE = "job-search-automation";
export declare const V0_KEYCHAIN_SERVICE = "job-search-plugin";
export declare const DEFAULT_KEYCHAIN_ACCOUNT = "neon-connection-string";
/**
 * Retrieves a generic password from macOS Keychain.
 * Returns null if not found or if the platform is not macOS / command fails.
 */
export declare function getKeychainSecret(service: string, account: string): string | null;
/**
 * Resolves the Neon connection string from macOS Keychain with fallback to DATABASE_URL.
 * Keeps connection string strictly in-memory; never writes to disk or logs.
 */
export declare function getNeonConnectionString(service?: string, account?: string): string;
