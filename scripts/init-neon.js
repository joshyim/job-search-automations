#!/usr/bin/env node

/**
 * scripts/init-neon.js
 *
 * Lightweight Neon database initialization and seeding script:
 * - Reads connection string from Keychain, CLI arg, or environment variable
 * - Verifies database connectivity (SELECT 1)
 * - Executes schema.sql DDL
 * - Seeds default scoring rubric from templates/scoring-rubric.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load Neon driver from job-search-db package
const requireFromPkg = createRequire(path.join(projectRoot, 'packages', 'job-search-db', 'package.json'));
let NeonPool;
try {
  const neon = requireFromPkg('@neondatabase/serverless');
  NeonPool = neon.Pool;
} catch (err) {
  console.error('[ERROR] Failed to load @neondatabase/serverless:', err.message);
  process.exit(1);
}

const DEFAULT_KEYCHAIN_SERVICE = 'job-search-automation';
const LEGACY_KEYCHAIN_SERVICE = 'job-search-plugin';
const DEFAULT_KEYCHAIN_ACCOUNT = 'neon-connection-string';

function getKeychainSecret(service, account) {
  try {
    const stdout = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return stdout.trim() || null;
  } catch {
    if (service === DEFAULT_KEYCHAIN_SERVICE) {
      try {
        const stdoutLegacy = execFileSync(
          'security',
          ['find-generic-password', '-s', LEGACY_KEYCHAIN_SERVICE, '-a', account, '-w'],
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return stdoutLegacy.trim() || null;
      } catch {}
    }
    return null;
  }
}

function resolveConnectionString(args) {
  // 1. CLI flag --connection-string
  const connIdx = args.indexOf('--connection-string');
  if (connIdx !== -1 && args[connIdx + 1]) {
    return args[connIdx + 1];
  }

  // 2. Env vars
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;

  // 3. macOS Keychain
  const keychainSecret = getKeychainSecret(DEFAULT_KEYCHAIN_SERVICE, DEFAULT_KEYCHAIN_ACCOUNT);
  if (keychainSecret) return keychainSecret;

  return null;
}

function parseRubricMarkdown(rubricPath) {
  if (!fs.existsSync(rubricPath)) {
    throw new Error(`Rubric template not found at: ${rubricPath}`);
  }
  const content = fs.readFileSync(rubricPath, 'utf-8');
  const lines = content.split('\n');
  const rubricDimensions = [];

  let inTable = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('|') && line.includes('---')) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith('|')) {
      const cells = line
        .split('|')
        .map(c => c.trim())
        .filter((_, idx, arr) => idx !== 0 && idx !== arr.length - 1);
      
      if (cells.length >= 5) {
        const dimension = cells[0];
        const rawWeight = cells[1].replace('%', '').trim();
        const weight = parseFloat(rawWeight) || 0;
        const poor = cells[2];
        const moderate = cells[3];
        const strong = cells[4];

        if (dimension && !isNaN(weight)) {
          rubricDimensions.push({
            dimension,
            weight,
            poor_description: poor,
            moderate_description: moderate,
            strong_description: strong,
          });
        }
      }
    }
  }

  return rubricDimensions;
}

async function main() {
  const args = process.argv.slice(2);
  const isMock = args.includes('--mock');
  const schemaPath = path.resolve(projectRoot, 'schema.sql');
  const rubricPath = path.resolve(projectRoot, 'templates', 'scoring-rubric.md');

  console.log('\x1b[36m[*] Initializing Neon database...\x1b[0m');

  if (isMock) {
    console.log('[*] Running in mock verification mode (--mock).');
    console.log('[+] Verification: SELECT 1 (mocked: success)');
    console.log(`[+] Schema execution: ${schemaPath} (mocked: 7 tables verified)`);
    const mockRubric = parseRubricMarkdown(rubricPath);
    console.log(`[+] Seeded ${mockRubric.length} scoring rubric dimensions (mocked).`);
    console.log('\x1b[32m[SUCCESS] Neon database initialized and seeded successfully (mock mode).\x1b[0m');
    process.exit(0);
  }

  const connectionString = resolveConnectionString(args);
  if (!connectionString) {
    console.error('\x1b[31m[ERROR] Neon connection string not found.\x1b[0m');
    console.error('Please provide via Keychain, --connection-string flag, or DATABASE_URL env var.');
    process.exit(1);
  }

  const pool = new NeonPool({ connectionString });

  try {
    // 1. Connection check
    console.log('[*] Testing Neon connection (SELECT 1)...');
    await pool.query('SELECT 1');
    console.log('\x1b[32m[+] Connection verified successfully.\x1b[0m');

    // 2. Apply schema.sql
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at: ${schemaPath}`);
    }
    console.log(`[*] Executing DDL from ${path.basename(schemaPath)}...`);
    const ddl = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(ddl);
    console.log('\x1b[32m[+] Schema DDL applied successfully.\x1b[0m');

    // 3. Seed default scoring rubric
    console.log(`[*] Seeding default scoring rubric from ${path.basename(rubricPath)}...`);
    const rubricDimensions = parseRubricMarkdown(rubricPath);
    for (const item of rubricDimensions) {
      await pool.query(
        `INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (dimension) DO NOTHING`,
        [item.dimension, item.weight, item.poor_description, item.moderate_description, item.strong_description]
      );
    }
    console.log(`\x1b[32m[+] Seeded ${rubricDimensions.length} scoring rubric dimensions.\x1b[0m`);

    console.log('\x1b[32m[SUCCESS] Neon database initialized and seeded successfully.\x1b[0m');
  } catch (err) {
    console.error('\x1b[31m[ERROR] Failed to initialize Neon database:\x1b[0m', err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('\x1b[31m[UNEXPECTED ERROR]\x1b[0m', err);
  process.exit(1);
});
