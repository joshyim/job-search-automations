#!/usr/bin/env node

/**
 * scripts/migrate.js
 *
 * Migration utility for job-search-automation:
 * - Scans a legacy markdown vault/directory for pipeline tables
 * - Parses tables into structured records
 * - Migrates records into either:
 *   - Local Mode: merges into workflowDataPath markdown files
 *   - Neon Mode: inserts/upserts into PostgreSQL tables via @neondatabase/serverless
 * - Displays a structured summary table of migrated records
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const requireFromPkg = createRequire(path.join(projectRoot, 'packages', 'job-search-db', 'package.json'));

const DEFAULT_KEYCHAIN_SERVICE = 'job-search-automation';
const LEGACY_KEYCHAIN_SERVICE = 'job-search-plugin';
const DEFAULT_KEYCHAIN_ACCOUNT = 'neon-connection-string';
const DEFAULT_CONFIG_PATH = fs.existsSync(path.join(os.homedir(), '.config', 'job-search-automation', 'config.json'))
  ? path.join(os.homedir(), '.config', 'job-search-automation', 'config.json')
  : path.join(os.homedir(), '.config', 'job-search-plugin', 'config.json');

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

function parseMarkdownTable(content) {
  const lines = content.split('\n');
  const headers = [];
  const rows = [];
  let inTable = false;
  let headerFound = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) {
      if (inTable && line.length === 0) {
        // blank line might end table
        continue;
      }
      continue;
    }

    const cells = line
      .slice(1, -1)
      .split('|')
      .map(c => c.trim());

    if (!headerFound) {
      headers.push(...cells);
      headerFound = true;
      continue;
    }

    // separator line | --- | --- |
    if (cells.every(c => /^:?-+:?$/.test(c))) {
      inTable = true;
      continue;
    }

    if (inTable && cells.length > 0) {
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cells[idx] !== undefined ? cells[idx] : '';
      });
      rows.push(rowObj);
    }
  }

  return { headers, rows };
}

function parseSectionsWithTables(content) {
  const sections = {};
  let currentSection = 'default';
  const lines = content.split('\n');

  let currentLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('## ') || line.startsWith('# ')) {
      if (currentLines.length > 0) {
        sections[currentSection] = parseMarkdownTable(currentLines.join('\n'));
      }
      currentSection = line.replace(/^#+\s*/, '').trim().toLowerCase();
      currentLines = [];
    } else {
      currentLines.push(rawLine);
    }
  }
  if (currentLines.length > 0) {
    sections[currentSection] = parseMarkdownTable(currentLines.join('\n'));
  }
  return sections;
}

function findFile(dir, candidateNames) {
  for (const name of candidateNames) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function formatMarkdownTable(headers, rows) {
  if (rows.length === 0) {
    const headerRow = `| ${headers.join(' | ')} |`;
    const sepRow = `| ${headers.map(() => '---').join(' | ')} |`;
    return `${headerRow}\n${sepRow}\n`;
  }
  const colWidths = headers.map(h => h.length);
  for (const row of rows) {
    headers.forEach((h, idx) => {
      const val = (row[h] !== undefined && row[h] !== null) ? String(row[h]) : '';
      if (val.length > colWidths[idx]) colWidths[idx] = val.length;
    });
  }
  // format
  const headerRow = `| ${headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ')} |`;
  const sepRow = `| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`;
  const dataRows = rows.map(row => {
    return `| ${headers.map((h, i) => {
      const val = (row[h] !== undefined && row[h] !== null) ? String(row[h]) : '';
      return val.padEnd(colWidths[i]);
    }).join(' | ')} |`;
  });

  return `${headerRow}\n${sepRow}\n${dataRows.join('\n')}\n`;
}

function printSummaryTable(stats) {
  const entries = Object.entries(stats);
  const maxLabel = Math.max(...entries.map(([k]) => k.length), 20);
  const maxVal = Math.max(...entries.map(([, v]) => String(v).length), 16);

  const topBorder = `┌─${'─'.repeat(maxLabel)}─┬─${'─'.repeat(maxVal)}─┐`;
  const header = `│ ${'Entity'.padEnd(maxLabel)} │ ${'Records Migrated'.padEnd(maxVal)} │`;
  const midBorder = `├─${'─'.repeat(maxLabel)}─┼─${'─'.repeat(maxVal)}─┤`;
  const bottomBorder = `└─${'─'.repeat(maxLabel)}─┴─${'─'.repeat(maxVal)}─┘`;

  console.log('\n\x1b[36m=== Migration Summary ===\x1b[0m');
  console.log(topBorder);
  console.log(header);
  console.log(midBorder);
  for (const [entity, count] of entries) {
    console.log(`│ ${entity.padEnd(maxLabel)} │ ${String(count).padStart(maxVal)} │`);
  }
  console.log(bottomBorder);
}

async function main() {
  const args = process.argv.slice(2);
  let sourceDir = null;
  let mode = null;
  let directory = null;
  let databasePath = null;
  let workflowDataPath = null;
  let connectionString = null;
  let isDryRun = args.includes('--dry-run');
  let isMock = args.includes('--mock');
  let configPath = DEFAULT_CONFIG_PATH;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--source' || args[i] === '--migrate-from') && args[i + 1]) {
      sourceDir = args[++i];
    } else if (args[i] === '--mode' && args[i + 1]) {
      mode = args[++i];
    } else if ((args[i] === '--directory' || args[i] === '-d') && args[i + 1]) {
      directory = args[++i];
    } else if (args[i] === '--database' && args[i + 1]) {
      databasePath = args[++i];
    } else if (args[i] === '--workflow-data-path' && args[i + 1]) {
      workflowDataPath = args[++i];
    } else if (args[i] === '--connection-string' && args[i + 1]) {
      connectionString = args[++i];
    } else if (args[i] === '--config-path' && args[i + 1]) {
      configPath = args[++i];
    }
  }

  // Fallback to config file if mode or workflowDataPath not specified
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!mode) mode = cfg.mode;
      if (!workflowDataPath) workflowDataPath = cfg.workflowDataPath;
    } catch {}
  }
  mode = mode || 'local';
  workflowDataPath = workflowDataPath || path.join(os.homedir(), '.local', 'share', 'job-search-automation');

  if (!sourceDir) {
    console.error('\x1b[31m[ERROR] Source directory required. Use --source <path>\x1b[0m');
    process.exit(1);
  }

  const resolvedSource = path.resolve(sourceDir.replace(/^~(?=$|\/|\\)/, os.homedir()));
  if (!fs.existsSync(resolvedSource)) {
    console.error(`\x1b[31m[ERROR] Source directory not found: ${resolvedSource}\x1b[0m`);
    process.exit(1);
  }

  console.log(`\x1b[36m[*] Starting migration from: ${resolvedSource}\x1b[0m`);
  console.log(`[*] Target mode: ${mode}`);

  const stats = {
    'Companies': 0,
    'Title Patterns': 0,
    'Skills': 0,
    'Rubric Dimensions': 0,
    'Crawl Queue': 0,
    'Candidates': 0,
    'Run Logs': 0,
  };

  // 1. Parse Companies
  const compFile = findFile(resolvedSource, ['target-companies.md', 'companies.md']);
  const parsedCompanies = [];
  if (compFile) {
    const table = parseMarkdownTable(fs.readFileSync(compFile, 'utf-8'));
    for (const row of table.rows) {
      const name = row['Company'] || row['Company Name'] || row['Name'] || '';
      const careersUrl = row['Careers URL'] || row['Job Board URL'] || row['URL'] || '';
      const rawExcluded = (row['Excluded'] || row['Status'] || '').toLowerCase();
      const isExcluded = rawExcluded === 'yes' || rawExcluded === 'true' || rawExcluded === 'excluded';
      const notes = row['Notes'] || '';
      const lastSearched = row['Last Searched'] || row['Last Checked'] || '';
      if (name.trim()) {
        parsedCompanies.push({ name: name.trim(), careersUrl: careersUrl.trim(), isExcluded, notes: notes.trim(), lastSearched: lastSearched.trim() });
      }
    }
  }
  stats['Companies'] = parsedCompanies.length;

  // 2. Parse Title Patterns and Skills
  const titleSkillsFile = findFile(resolvedSource, ['target-job-titles-and-skills.md', 'job-titles.md', 'skills.md']);
  const parsedTitles = [];
  const parsedSkills = [];
  if (titleSkillsFile) {
    const sections = parseSectionsWithTables(fs.readFileSync(titleSkillsFile, 'utf-8'));
    // Title Patterns
    const titleSec = sections['title patterns'] || sections['target job titles'] || sections['titles'] || { rows: [] };
    for (const row of titleSec.rows) {
      const pattern = row['Pattern'] || row['Title'] || row['Job Title'] || '';
      const type = (row['Type'] || 'include').toLowerCase();
      const level = row['Level'] || '';
      const notes = row['Notes'] || '';
      if (pattern.trim()) {
        parsedTitles.push({ pattern: pattern.trim(), type: type === 'exclude' ? 'exclude' : 'include', level: level.trim(), notes: notes.trim() });
      }
    }
    // Skills
    const skillSec = sections['skills'] || sections['core skills'] || { rows: [] };
    for (const row of skillSec.rows) {
      const skill = row['Skill'] || row['Name'] || '';
      const category = row['Category'] || '';
      const importance = row['Importance'] || row['Level'] || 'preferred';
      const notes = row['Notes'] || '';
      if (skill.trim()) {
        parsedSkills.push({ skill: skill.trim(), category: category.trim(), importance: importance.trim(), notes: notes.trim() });
      }
    }
  }
  stats['Title Patterns'] = parsedTitles.length;
  stats['Skills'] = parsedSkills.length;

  // 3. Parse Rubric
  const rubricFile = findFile(resolvedSource, ['scoring-rubric.md', 'rubric.md']);
  const parsedRubric = [];
  if (rubricFile) {
    const table = parseMarkdownTable(fs.readFileSync(rubricFile, 'utf-8'));
    for (const row of table.rows) {
      const dim = row['Dimension'] || row['Criteria'] || '';
      const rawW = (row['Weight'] || '').replace('%', '').trim();
      const weight = parseFloat(rawW) || 0;
      const poor = row['Poor (1-2)'] || row['Poor'] || '';
      const moderate = row['Moderate (3)'] || row['Moderate'] || '';
      const strong = row['Strong (4-5)'] || row['Strong'] || '';
      if (dim.trim()) {
        parsedRubric.push({ dimension: dim.trim(), weight, poor_description: poor.trim(), moderate_description: moderate.trim(), strong_description: strong.trim() });
      }
    }
  }
  stats['Rubric Dimensions'] = parsedRubric.length;

  // 4. Parse Crawl Queue
  const queueFile = findFile(resolvedSource, ['crawl-queue.md', 'queue.md']);
  const parsedQueue = [];
  if (queueFile) {
    const table = parseMarkdownTable(fs.readFileSync(queueFile, 'utf-8'));
    for (const row of table.rows) {
      const url = row['URL'] || row['Job URL'] || '';
      const company = row['Company'] || row['Company Name'] || '';
      const status = (row['Status'] || 'pending').toLowerCase();
      const notes = row['Notes'] || '';
      const queuedAt = row['Queued At'] || row['Added Date'] || '';
      if (url.trim()) {
        parsedQueue.push({ url: url.trim(), company: company.trim(), status: status.trim(), notes: notes.trim(), queuedAt: queuedAt.trim() });
      }
    }
  }
  stats['Crawl Queue'] = parsedQueue.length;

  // 5. Parse Candidates
  const candFile = findFile(resolvedSource, ['job-candidates.md', 'candidates.md']);
  const parsedCandidates = [];
  if (candFile) {
    const table = parseMarkdownTable(fs.readFileSync(candFile, 'utf-8'));
    for (const row of table.rows) {
      const company = row['Company'] || row['Company Name'] || '';
      const jobTitle = row['Job Title'] || row['Title'] || '';
      const url = row['URL'] || '';
      const location = row['Location'] || '';
      const score = parseFloat(row['Score']) || 0;
      const breakdown = row['Breakdown'] || row['Match Breakdown'] || '';
      const status = (row['Status'] || 'new').toLowerCase();
      const discoveredAt = row['Discovered At'] || row['Date'] || '';
      const appliedAt = row['Applied At'] || '';
      const notes = row['Notes'] || '';
      if (url.trim()) {
        parsedCandidates.push({
          company: company.trim(),
          jobTitle: jobTitle.trim(),
          url: url.trim(),
          location: location.trim(),
          score,
          breakdown: breakdown.trim(),
          status: status.trim(),
          discoveredAt: discoveredAt.trim(),
          appliedAt: appliedAt.trim(),
          notes: notes.trim(),
        });
      }
    }
  }
  stats['Candidates'] = parsedCandidates.length;

  // 6. Parse Logs
  const logFile = findFile(resolvedSource, ['logs.md', 'run-logs.md']);
  const parsedLogs = [];
  if (logFile) {
    const table = parseMarkdownTable(fs.readFileSync(logFile, 'utf-8'));
    for (const row of table.rows) {
      const timestamp = row['Timestamp'] || '';
      const logMode = row['Mode'] || 'local';
      const companies = row['Companies Processed'] || '';
      const urlsQueued = parseInt(row['URLs Queued'], 10) || 0;
      const candidatesScored = parseInt(row['Candidates Scored'], 10) || 0;
      const summary = row['Summary'] || '';
      const details = row['Details'] || '';
      if (timestamp.trim()) {
        parsedLogs.push({ timestamp: timestamp.trim(), mode: logMode.trim(), companies: companies.trim(), urlsQueued, candidatesScored, summary: summary.trim(), details: details.trim() });
      }
    }
  }
  stats['Run Logs'] = parsedLogs.length;

  if (isDryRun || isMock) {
    printSummaryTable(stats);
    console.log('\x1b[32m[+] Migration completed in dry-run/mock mode. No permanent changes made.\x1b[0m');
    process.exit(0);
  }

  // Perform migration write
  if (mode === 'local') {
    let targetSqlitePath = null;
    let resolvedWdp = null;

    if (databasePath) {
      targetSqlitePath = path.resolve(databasePath.replace(/^~(?=$|\/|\\)/, os.homedir()));
    } else if (directory) {
      const resolvedDir = path.resolve(directory.replace(/^~(?=$|\/|\\)/, os.homedir()));
      targetSqlitePath = resolvedDir.endsWith('.job-search')
        ? path.join(resolvedDir, 'job-search.sqlite')
        : path.join(resolvedDir, '.job-search', 'job-search.sqlite');
      resolvedWdp = path.dirname(targetSqlitePath);
    } else if (workflowDataPath) {
      resolvedWdp = path.resolve(workflowDataPath.replace(/^~(?=$|\/|\\)/, os.homedir()));
      if (resolvedWdp.endsWith('.sqlite')) {
        targetSqlitePath = resolvedWdp;
      } else if (fs.existsSync(path.join(resolvedWdp, '.job-search', 'job-search.sqlite'))) {
        targetSqlitePath = path.join(resolvedWdp, '.job-search', 'job-search.sqlite');
      } else if (path.basename(resolvedWdp) === '.job-search') {
        targetSqlitePath = path.join(resolvedWdp, 'job-search.sqlite');
      } else {
        targetSqlitePath = path.join(resolvedWdp, 'job-search.sqlite');
      }
    }

    if (targetSqlitePath) {
      fs.mkdirSync(path.dirname(targetSqlitePath), { recursive: true });
      const db = new DatabaseSync(targetSqlitePath);
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON;');

      // Create SQLite schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            careers_url TEXT NOT NULL,
            is_excluded INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            last_searched_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_companies_last_searched ON companies(last_searched_at ASC) WHERE is_excluded = 0;

        CREATE TABLE IF NOT EXISTS title_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('include', 'exclude')),
            level TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CONSTRAINT uq_pattern_type UNIQUE (pattern, type)
        );

        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            category TEXT,
            importance TEXT DEFAULT 'preferred',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scoring_rubric (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dimension TEXT NOT NULL UNIQUE,
            weight REAL NOT NULL,
            poor_description TEXT,
            moderate_description TEXT,
            strong_description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crawl_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            company_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assessed', 'skipped')),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crawl_queue_company_status ON crawl_queue(company_name, status);

        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            location TEXT,
            score REAL,
            breakdown TEXT,
            status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'applied', 'in_progress', 'not_pursuing', 'closed', 'interviewing', 'rejected', 'offer')),
            notes TEXT,
            discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
            applied_at TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_candidates_score ON candidates(score DESC);
        CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

        CREATE TABLE IF NOT EXISTS run_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            mode TEXT NOT NULL,
            companies_processed TEXT NOT NULL DEFAULT '[]',
            urls_queued INTEGER NOT NULL DEFAULT 0,
            candidates_scored INTEGER NOT NULL DEFAULT 0,
            summary TEXT,
            details TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_run_logs_timestamp ON run_logs(timestamp DESC);
      `);

      // 1. Companies
      const insertCompany = db.prepare(`
        INSERT INTO companies (name, careers_url, is_excluded, notes, last_searched_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT (name) DO UPDATE SET
          careers_url = excluded.careers_url,
          is_excluded = excluded.is_excluded,
          notes = excluded.notes,
          last_searched_at = excluded.last_searched_at,
          updated_at = datetime('now')
      `);
      for (const c of parsedCompanies) {
        insertCompany.run(c.name, c.careersUrl, c.isExcluded ? 1 : 0, c.notes || null, c.lastSearched || null);
      }

      // 2. Title Patterns
      const insertTitle = db.prepare(`
        INSERT INTO title_patterns (pattern, type, level, notes, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT (pattern, type) DO UPDATE SET
          level = excluded.level,
          notes = excluded.notes
      `);
      for (const t of parsedTitles) {
        insertTitle.run(t.pattern, t.type, t.level || null, t.notes || null);
      }

      // 3. Skills
      const insertSkill = db.prepare(`
        INSERT INTO skills (name, category, importance, notes, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT (name) DO UPDATE SET
          category = excluded.category,
          importance = excluded.importance,
          notes = excluded.notes
      `);
      for (const s of parsedSkills) {
        insertSkill.run(s.skill, s.category || null, s.importance || 'preferred', s.notes || null);
      }

      // 4. Rubric
      const insertRubric = db.prepare(`
        INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT (dimension) DO UPDATE SET
          weight = excluded.weight,
          poor_description = excluded.poor_description,
          moderate_description = excluded.moderate_description,
          strong_description = excluded.strong_description,
          updated_at = datetime('now')
      `);
      for (const r of parsedRubric) {
        insertRubric.run(r.dimension, r.weight, r.poor_description || null, r.moderate_description || null, r.strong_description || null);
      }

      // 5. Crawl Queue
      const insertQueue = db.prepare(`
        INSERT INTO crawl_queue (url, company_name, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT (url) DO UPDATE SET
          company_name = excluded.company_name,
          status = excluded.status,
          notes = excluded.notes,
          updated_at = datetime('now')
      `);
      for (const q of parsedQueue) {
        insertQueue.run(q.url, q.company, q.status || 'pending', q.notes || null);
      }

      // 6. Candidates
      const insertCandidate = db.prepare(`
        INSERT INTO candidates (company_name, job_title, url, location, score, breakdown, status, notes, discovered_at, applied_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
        ON CONFLICT (url) DO UPDATE SET
          company_name = excluded.company_name,
          job_title = excluded.job_title,
          location = excluded.location,
          score = excluded.score,
          breakdown = excluded.breakdown,
          status = excluded.status,
          notes = excluded.notes,
          applied_at = excluded.applied_at,
          updated_at = datetime('now')
      `);
      for (const cd of parsedCandidates) {
        insertCandidate.run(
          cd.company,
          cd.jobTitle,
          cd.url,
          cd.location || null,
          cd.score || null,
          cd.breakdown ? JSON.stringify({ summary: cd.breakdown }) : null,
          cd.status || 'new',
          cd.notes || null,
          cd.appliedAt || null
        );
      }

      // 7. Logs
      const insertLog = db.prepare(`
        INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const l of parsedLogs) {
        insertLog.run(
          l.timestamp || new Date().toISOString(),
          l.mode || 'local',
          JSON.stringify([l.companies]),
          l.urlsQueued || 0,
          l.candidatesScored || 0,
          l.summary || null,
          l.details ? JSON.stringify({ details: l.details }) : '{}'
        );
      }

      db.close();
      console.log(`\x1b[32m[+] Successfully migrated records into SQLite database at: ${targetSqlitePath}\x1b[0m`);
    }

    // Also write markdown files if workflowDataPath was specified as a directory
    if (resolvedWdp && !resolvedWdp.endsWith('.sqlite')) {
      if (!fs.existsSync(resolvedWdp)) {
        fs.mkdirSync(resolvedWdp, { recursive: true });
      }

      // Target Companies
      if (parsedCompanies.length > 0) {
        const targetPath = path.join(resolvedWdp, 'target-companies.md');
        const rows = parsedCompanies.map((c) => ({
          Company: c.name,
          'Careers URL': c.careersUrl,
          Excluded: c.isExcluded ? 'Yes' : 'No',
          Notes: c.notes,
          'Last Searched': c.lastSearched,
        }));
        const content = `# Target Companies\n\n` + formatMarkdownTable(['Company', 'Careers URL', 'Excluded', 'Notes', 'Last Searched'], rows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      // Titles & Skills
      if (parsedTitles.length > 0 || parsedSkills.length > 0) {
        const targetPath = path.join(resolvedWdp, 'target-job-titles-and-skills.md');
        const titleRows = parsedTitles.map((t) => ({
          Pattern: t.pattern,
          Type: t.type,
          Level: t.level,
          Notes: t.notes,
        }));
        const skillRows = parsedSkills.map((s) => ({
          Skill: s.skill,
          Category: s.category,
          Importance: s.importance,
          Notes: s.notes,
        }));
        let content = `# Target Job Titles and Skills\n\n## Title Patterns\n\n`;
        content += formatMarkdownTable(['Pattern', 'Type', 'Level', 'Notes'], titleRows);
        content += `\n## Skills\n\n`;
        content += formatMarkdownTable(['Skill', 'Category', 'Importance', 'Notes'], skillRows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      // Scoring Rubric
      if (parsedRubric.length > 0) {
        const targetPath = path.join(resolvedWdp, 'scoring-rubric.md');
        const rows = parsedRubric.map((r) => ({
          Dimension: r.dimension,
          Weight: `${r.weight}%`,
          'Poor (1-2)': r.poor_description,
          'Moderate (3)': r.moderate_description,
          'Strong (4-5)': r.strong_description,
        }));
        const content = `# Scoring Rubric\n\n` + formatMarkdownTable(['Dimension', 'Weight', 'Poor (1-2)', 'Moderate (3)', 'Strong (4-5)'], rows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      // Crawl Queue
      if (parsedQueue.length > 0) {
        const targetPath = path.join(resolvedWdp, 'crawl-queue.md');
        const rows = parsedQueue.map((q) => ({
          URL: q.url,
          Company: q.company,
          Status: q.status,
          Notes: q.notes,
          'Queued At': q.queuedAt,
        }));
        const content = `# Crawl Queue\n\n` + formatMarkdownTable(['URL', 'Company', 'Status', 'Notes', 'Queued At'], rows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      // Candidates
      if (parsedCandidates.length > 0) {
        const targetPath = path.join(resolvedWdp, 'job-candidates.md');
        const rows = parsedCandidates.map((c) => ({
          Company: c.company,
          'Job Title': c.jobTitle,
          URL: c.url,
          Location: c.location,
          Score: String(c.score),
          Breakdown: c.breakdown,
          Status: c.status,
          'Discovered At': c.discoveredAt,
          'Applied At': c.appliedAt,
          Notes: c.notes,
        }));
        const content = `# Job Candidates\n\n` + formatMarkdownTable(['Company', 'Job Title', 'URL', 'Location', 'Score', 'Breakdown', 'Status', 'Discovered At', 'Applied At', 'Notes'], rows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      // Run Logs
      if (parsedLogs.length > 0) {
        const targetPath = path.join(resolvedWdp, 'logs.md');
        const rows = parsedLogs.map((l) => ({
          Timestamp: l.timestamp,
          Mode: l.mode,
          'Companies Processed': l.companies,
          'URLs Queued': String(l.urlsQueued),
          'Candidates Scored': String(l.candidatesScored),
          Summary: l.summary,
          Details: l.details,
        }));
        const content = `# Pipeline Run Logs\n\n` + formatMarkdownTable(['Timestamp', 'Mode', 'Companies Processed', 'URLs Queued', 'Candidates Scored', 'Summary', 'Details'], rows);
        fs.writeFileSync(targetPath, content, 'utf-8');
      }
    }

    printSummaryTable(stats);
    console.log(`\x1b[32m[SUCCESS] Successfully completed local data migration.\x1b[0m`);

  } else if (mode === 'neon') {
    const connStr = connectionString || process.env.DATABASE_URL || getKeychainSecret(DEFAULT_KEYCHAIN_SERVICE, DEFAULT_KEYCHAIN_ACCOUNT);
    if (!connStr) {
      console.error('\x1b[31m[ERROR] Neon connection string required for Neon migration.\x1b[0m');
      process.exit(1);
    }
    const neon = requireFromPkg('@neondatabase/serverless');
    const pool = new neon.Pool({ connectionString: connStr });

    try {
      console.log('[*] Inserting migrated records into Neon...');
      // 1. Companies
      for (const c of parsedCompanies) {
        await pool.query(
          `INSERT INTO companies (name, careers_url, is_excluded, notes, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (name) DO NOTHING`,
          [c.name, c.careersUrl, c.isExcluded, c.notes]
        );
      }
      // 2. Title Patterns
      for (const t of parsedTitles) {
        await pool.query(
          `INSERT INTO title_patterns (pattern, type, level, notes)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (pattern, type) DO NOTHING`,
          [t.pattern, t.type, t.level, t.notes]
        );
      }
      // 3. Skills
      for (const s of parsedSkills) {
        await pool.query(
          `INSERT INTO skills (name, category, importance, notes)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO NOTHING`,
          [s.skill, s.category, s.importance, s.notes]
        );
      }
      // 4. Rubric
      for (const r of parsedRubric) {
        await pool.query(
          `INSERT INTO scoring_rubric (dimension, weight, poor_description, moderate_description, strong_description, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (dimension) DO UPDATE SET weight = EXCLUDED.weight, poor_description = EXCLUDED.poor_description, moderate_description = EXCLUDED.moderate_description, strong_description = EXCLUDED.strong_description, updated_at = NOW()`,
          [r.dimension, r.weight, r.poor_description, r.moderate_description, r.strong_description]
        );
      }
      // 5. Crawl Queue
      for (const q of parsedQueue) {
        await pool.query(
          `INSERT INTO crawl_queue (url, company_name, status, notes)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (url) DO NOTHING`,
          [q.url, q.company, q.status, q.notes]
        );
      }
      // 6. Candidates
      for (const cd of parsedCandidates) {
        await pool.query(
          `INSERT INTO candidates (company_name, job_title, url, location, score, breakdown, status, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (url) DO UPDATE SET score = EXCLUDED.score, breakdown = EXCLUDED.breakdown, updated_at = NOW()`,
          [cd.company, cd.jobTitle, cd.url, cd.location, cd.score, cd.breakdown ? JSON.stringify({ summary: cd.breakdown }) : null, cd.status, cd.notes]
        );
      }
      // 7. Logs
      for (const l of parsedLogs) {
        await pool.query(
          `INSERT INTO run_logs (timestamp, mode, companies_processed, urls_queued, candidates_scored, summary, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [l.timestamp || new Date().toISOString(), l.mode, [l.companies], l.urlsQueued, l.candidatesScored, l.summary, l.details ? JSON.stringify({ details: l.details }) : null]
        );
      }

      printSummaryTable(stats);
      console.log('\x1b[32m[SUCCESS] Successfully migrated data into Neon PostgreSQL database!\x1b[0m');
    } finally {
      await pool.end().catch(() => {});
    }
  }
}

main().catch(err => {
  console.error('\x1b[31m[ERROR]\x1b[0m', err.message);
  process.exit(1);
});
