#!/usr/bin/env node

/**
 * Automated E2E Browser Test Suite for Job Search Web UI
 * Runs directly on macOS using local Google Chrome with --headless=new --disable-gpu
 * Connects via Chrome DevTools Protocol (CDP) WebSocket without third-party dependencies.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(UI_DIR, '../..');

let UI_PORT = process.env.UI_PORT ? parseInt(process.env.UI_PORT, 10) : 3847;
let BASE_URL = `http://localhost:${UI_PORT}`;
const CDP_PORT = 9345;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let cachedToken = process.env.JOB_SEARCH_UI_TOKEN || '';

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function getAvailablePort(preferredPort) {
  let port = preferredPort;
  while (!(await isPortAvailable(port))) {
    console.log(`[Port Check] Port ${port} is occupied, checking port ${port + 1}...`);
    port++;
  }
  return port;
}

async function getAuthToken() {
  if (cachedToken) return cachedToken;
  try {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();
    const match = html.match(/__DASHBOARD_TOKEN__\s*=\s*"([^"]+)"/) || html.match(/__DASHBOARD_TOKEN__\s*=\s*'([^']+)'/);
    if (match) {
      cachedToken = match[1];
      return cachedToken;
    }
  } catch {}
  return '';
}

// Helpers for API calls to local UI server
async function callApi(name, args = {}) {
  const token = await getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['X-Session-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}/api/mcp/call-tool`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, arguments: args }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API error (${name}): ${json.error}`);
  }
  return json.data;
}

// Simple CDP Client over WebSocket
class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 1;
    this.pending = new Map();
    this.listeners = [];

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        for (const l of this.listeners) {
          l(data.method, data.params);
        }
      }
    };
  }

  on(fn) {
    this.listeners.push(fn);
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });
  }

  async send(method, params = {}) {
    await this.ready();
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async waitFor(predicateExpr, timeoutMs = 8000, intervalMs = 150) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await this.eval(predicateExpr);
        if (val) return val;
      } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${predicateExpr}`);
  }

  close() {
    this.ws.close();
  }
}

async function runTests() {
  console.log('🚀 Starting Automated E2E Browser Test Suite...\n');

  let spawnedServerProc = null;
  let testWsDir = null;

  // 1. Verify UI server is up or auto-start it
  let needsSpawn = false;
  if (!process.env.UI_PORT) {
    // Port discovery: if default 3847 is occupied, advance to next open port
    UI_PORT = await getAvailablePort(3847);
    BASE_URL = `http://localhost:${UI_PORT}`;
    needsSpawn = true;
  } else {
    try {
      const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json());
      console.log(`✅ UI Server is running at ${BASE_URL} (MCP connected: ${health.mcpConnected})`);
    } catch {
      needsSpawn = true;
    }
  }

  if (needsSpawn) {
    console.log(`[Setup] Auto-starting isolated test server on port ${UI_PORT}...`);
    testWsDir = path.join(REPO_ROOT, 'tests', 'fixtures', `e2e_ws_${Date.now()}`);
    fs.mkdirSync(path.join(testWsDir, '.job-search'), { recursive: true });
    fs.writeFileSync(
      path.join(testWsDir, '.job-search', 'config.json'),
      JSON.stringify({ mode: 'local', databasePath: './job-search.sqlite' }, null, 2)
    );

    const dbPath = path.join(testWsDir, '.job-search', 'job-search.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        careers_url TEXT NOT NULL,
        ats_platform TEXT,
        is_excluded INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        last_searched_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
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
        importance TEXT DEFAULT 'P2',
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
        ats_platform TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        location TEXT,
        score REAL,
        breakdown TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        applied_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
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

      INSERT OR REPLACE INTO candidates (company_name, job_title, url, location, score, breakdown, status) VALUES
        ('High Fit Corp', 'Principal Engineer', 'https://example.com/cand-80', 'Remote', 80.0, '{"Title match":80,"Skills match":80,"Experience match":80,"Seniority fit":80}', 'new'),
        ('Fractional Fit Corp', 'Senior Product Manager', 'https://example.com/cand-fractional', 'Remote', 90.0, '{"Title match":90,"Skills match":87.6,"Experience match":96,"Seniority fit":86.6}', 'new'),
        ('Mid High Corp', 'Staff Engineer', 'https://example.com/cand-79', 'Remote', 79.0, '{"Title match":79,"Skills match":79,"Experience match":79,"Seniority fit":79}', 'new'),
        ('Mid Low Corp', 'Senior Engineer', 'https://example.com/cand-50', 'Remote', 50.0, '{"Title match":50,"Skills match":50,"Experience match":50,"Seniority fit":50}', 'new'),
        ('Low Fit Corp', 'Associate Engineer', 'https://example.com/cand-49', 'Remote', 49.0, '{"Title match":49,"Skills match":49,"Experience match":49,"Seniority fit":49}', 'new'),
        ('Unrated Corp', 'Intern Engineer', 'https://example.com/cand-null', 'Remote', NULL, NULL, 'new');
    `);
    db.close();

    const serverJs = path.join(UI_DIR, 'dist', 'server.js');
    spawnedServerProc = spawn(process.execPath, [serverJs, '--port', String(UI_PORT), '--directory', testWsDir], {
      cwd: UI_DIR,
      stdio: 'pipe',
    });

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      throw new Error(`Failed to start UI Server on ${BASE_URL}`);
    }
    console.log(`✅ UI Server auto-started successfully on ${BASE_URL}`);
  }

  // 2. Seed Test Fixtures via MCP Bridge
  console.log('\n📦 Seeding test fixtures...');
  const testPattern = `E2E_Pattern_${Date.now()}`;
  const testSkill = `E2E_Skill_${Date.now()}`;
  const testRubric = `E2E_Rubric_${Date.now()}`;

  await callApi('add_title_pattern', {
    pattern: testPattern,
    type: 'include',
    level: 'Staff',
    notes: 'Automated E2E Test Fixture',
  });
  console.log(`  • Created test title pattern: "${testPattern}"`);

  await callApi('add_skill', {
    name: testSkill,
    category: 'Design',
    importance: 'P1',
    notes: 'Automated E2E Test Fixture',
  });
  console.log(`  • Created test skill: "${testSkill}"`);

  await callApi('add_rubric_dimension', {
    dimension: testRubric,
    weight: 5,
    poor_description: 'Poor test description',
    moderate_description: 'Moderate test description',
    strong_description: 'Strong test description',
  });
  console.log(`  • Created test rubric dimension: "${testRubric}"`);

  // Candidate fixtures for score badge threshold calibration tests (PRO-72)
  const candidateScores = [
    { name: 'High Fit Corp', title: 'Principal Engineer', url: 'https://example.com/cand-80', score: 80.0, expectedClass: 'score-high' },
    { name: 'Fractional Fit Corp', title: 'Senior Product Manager', url: 'https://example.com/cand-fractional', score: 90.0, expectedClass: 'score-high' },
    { name: 'Mid High Corp', title: 'Staff Engineer', url: 'https://example.com/cand-79', score: 79.0, expectedClass: 'score-mid' },
    { name: 'Mid Low Corp', title: 'Senior Engineer', url: 'https://example.com/cand-50', score: 50.0, expectedClass: 'score-mid' },
    { name: 'Low Fit Corp', title: 'Associate Engineer', url: 'https://example.com/cand-49', score: 49.0, expectedClass: 'score-low' },
    { name: 'Unrated Corp', title: 'Intern Engineer', url: 'https://example.com/cand-null', expectedClass: 'score-low' },
  ];

  // 3. Launch Local Chrome in Headless Mode with CDP
  console.log('\n🌐 Launching Headless Google Chrome...');
  const chromeProc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${CDP_PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try {
      chromeProc.kill('SIGTERM');
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(1);
  });

  // Wait for CDP port to open
  let targets;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      targets = await res.json();
      if (Array.isArray(targets) && targets.length > 0) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!targets || targets.length === 0) {
    console.error('❌ Failed to connect to headless Chrome CDP port.');
    cleanup();
    process.exit(1);
  }

  const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
  console.log(`✅ Attached to Chrome DevTools Protocol target: ${pageTarget.id}`);

  const cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    // ==========================================
    // TEST 1: Job Title Patterns Delete Button
    // ==========================================
    console.log('\n🧪 [Test 1] Testing Job Title Patterns Delete Button...');
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#titles` });

    // Wait for the test pattern row to render in DOM
    await cdp.waitFor(
      `Boolean(document.querySelector('.btn-remove-pattern[data-pattern="${testPattern}"]'))`,
      10000
    );
    console.log('  • Pattern row rendered in DOM');

    // Click the delete button
    await cdp.eval(`
      document.querySelector('.btn-remove-pattern[data-pattern="${testPattern}"]').click();
    `);

    // Verify confirmation modal opens
    const isModalOpen = await cdp.waitFor(
      `!document.getElementById('modal-backdrop').classList.contains('hidden')`,
      4000
    );
    const modalTitle = await cdp.eval(`document.getElementById('modal-title').textContent.trim()`);
    const modalBody = await cdp.eval(`document.getElementById('modal-body').textContent`);

    if (!isModalOpen || modalTitle !== 'Remove Title Pattern' || !modalBody.includes(testPattern)) {
      throw new Error(`Modal check failed! Title: "${modalTitle}", Body: "${modalBody}"`);
    }
    console.log(`  • Custom confirmation modal opened: "${modalTitle}"`);

    // Click "Remove Pattern" confirm button in modal
    await cdp.eval(`document.getElementById('modal-confirm-proceed').click()`);

    // Verify modal closes
    await cdp.waitFor(`document.getElementById('modal-backdrop').classList.contains('hidden')`, 4000);
    console.log('  • Modal confirmed and closed');

    // Verify item is removed from DOM
    await cdp.waitFor(
      `!document.querySelector('.btn-remove-pattern[data-pattern="${testPattern}"]')`,
      6000
    );
    console.log('  • Item successfully removed from DOM');

    // Verify backend SQLite state
    const patternsAfter = await callApi('list_title_patterns');
    const stillExists1 = patternsAfter.some((p) => p.pattern === testPattern);
    if (stillExists1) {
      throw new Error(`Pattern "${testPattern}" still exists in backend database!`);
    }
    console.log('  • Backend SQLite database verified: Item deleted');
    console.log('✅ [Test 1 PASSED] Job Title Patterns Delete Button works!');

    // ==========================================
    // TEST 2: Target Skills Delete Button
    // ==========================================
    console.log('\n🧪 [Test 2] Testing Target Skills Delete Button...');
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#skills` });

    // Wait for the test skill row to render in DOM
    await cdp.waitFor(
      `Boolean(document.querySelector('.btn-remove-skill[data-skill="${testSkill}"]'))`,
      10000
    );
    console.log('  • Skill row rendered in DOM');

    // TEST 2a: Verify Priority Dropdown Standardized Options (P1 - Must Have, P2 - Preferred)
    console.log('  • Testing Target Skills priority dropdown options...');
    const priorityOptions = await cdp.eval(`
      Array.from(document.querySelector('.skill-priority-select[data-skill="${testSkill}"]').options)
        .map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }))
    `);
    if (priorityOptions.length !== 2) {
      throw new Error(`Expected exactly 2 priority options, found ${priorityOptions.length}: ${JSON.stringify(priorityOptions)}`);
    }
    if (priorityOptions[0].value !== 'P1' || priorityOptions[0].text !== 'P1 - Must Have' || !priorityOptions[0].selected) {
      throw new Error(`First option mismatch: expected P1 - Must Have selected, got: ${JSON.stringify(priorityOptions[0])}`);
    }
    if (priorityOptions[1].value !== 'P2' || priorityOptions[1].text !== 'P2 - Preferred') {
      throw new Error(`Second option mismatch: expected P2 - Preferred, got: ${JSON.stringify(priorityOptions[1])}`);
    }
    console.log('  • Verified 2-tier dropdown options: P1 - Must Have, P2 - Preferred');

    // TEST 2b: Change Priority via Dropdown
    console.log('  • Testing inline priority change to P2...');
    await cdp.eval(`
      (() => {
        const sel = document.querySelector('.skill-priority-select[data-skill="${testSkill}"]');
        sel.value = 'P2';
        sel.dispatchEvent(new Event('change'));
      })()
    `);
    // Allow MCP roundtrip to complete
    await new Promise((r) => setTimeout(r, 600));
    const skillsAfterPriorityChange = await callApi('list_skills');
    const changedSkill = skillsAfterPriorityChange.find((s) => s.name === testSkill);
    if (!changedSkill || changedSkill.importance !== 'P2') {
      throw new Error(`Priority update failed! Expected P2, got ${changedSkill?.importance}`);
    }
    console.log('  • Verified inline priority change persisted to SQLite backend');

    // TEST 2c: Add Skill Modal Default Priority (P2)
    console.log('  • Testing Add Skill modal default priority...');
    await cdp.eval(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Add Skill')).click();
    `);
    await cdp.waitFor(`!document.getElementById('modal-backdrop').classList.contains('hidden')`, 4000);
    const addSkillOptions = await cdp.eval(`
      Array.from(document.getElementById('add-skill-priority').options)
        .map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }))
    `);
    if (addSkillOptions.length !== 2) {
      throw new Error(`Add Skill modal expected 2 options, found ${addSkillOptions.length}`);
    }
    const defaultSelected = addSkillOptions.find(o => o.selected);
    if (!defaultSelected || defaultSelected.value !== 'P2') {
      throw new Error(`Add Skill modal expected default P2, got: ${JSON.stringify(defaultSelected)}`);
    }
    // Close modal
    await cdp.eval(`document.getElementById('modal-close-btn').click()`);
    await cdp.waitFor(`document.getElementById('modal-backdrop').classList.contains('hidden')`, 4000);

    // TEST 2d: Unrecognized Value Renders Visibly
    console.log('  • Testing unrecognized priority value visible rendering...');
    const resolvedDbPath = testWsDir
      ? path.join(testWsDir, '.job-search', 'job-search.sqlite')
      : [
          process.env.JOB_SEARCH_WORKSPACE && path.join(process.env.JOB_SEARCH_WORKSPACE, '.job-search', 'job-search.sqlite'),
          path.join(REPO_ROOT, '.job-search', 'job-search.sqlite'),
        ].filter(Boolean).find((p) => fs.existsSync(p));

    if (resolvedDbPath && fs.existsSync(resolvedDbPath)) {
      const anomalySkillName = 'TestAnomalySkill';
      const localDb = new DatabaseSync(resolvedDbPath);
      localDb.exec(`INSERT INTO skills (name, category, importance) VALUES ('${anomalySkillName}', 'Test', 'unrecognized_tier');`);
      await cdp.send('Page.reload');
      await cdp.waitFor(
        `Boolean(document.querySelector('.skill-priority-select[data-skill="${anomalySkillName}"]'))`,
        10000
      );
      const anomalyOptions = await cdp.eval(`
        Array.from(document.querySelector('.skill-priority-select[data-skill="${anomalySkillName}"]').options)
          .map(o => o.text.trim())
      `);
      const hasVisibleWarning = anomalyOptions.some((t) => t.includes('unrecognized_tier') && t.includes('⚠️'));
      localDb.exec(`DELETE FROM skills WHERE name = '${anomalySkillName}';`);
      localDb.close();
      if (!hasVisibleWarning) {
        throw new Error(`Unrecognized priority was not rendered visibly! Options: ${JSON.stringify(anomalyOptions)}`);
      }
      console.log('  • Verified unrecognized priority value rendered visibly with warning');
    } else {
      console.log('  • Skipping SQLite direct insert (database path not directly accessible)');
    }

    // Click the delete button on testSkill
    await cdp.eval(`
      document.querySelector('.btn-remove-skill[data-skill="${testSkill}"]').click();
    `);

    // Verify confirmation modal opens
    await cdp.waitFor(
      `!document.getElementById('modal-backdrop').classList.contains('hidden')`,
      4000
    );
    const skillModalTitle = await cdp.eval(`document.getElementById('modal-title').textContent.trim()`);
    const skillModalBody = await cdp.eval(`document.getElementById('modal-body').textContent`);

    if (skillModalTitle !== 'Remove Target Skill' || !skillModalBody.includes(testSkill)) {
      throw new Error(`Modal check failed! Title: "${skillModalTitle}", Body: "${skillModalBody}"`);
    }
    console.log(`  • Custom confirmation modal opened: "${skillModalTitle}"`);

    // Click "Remove Skill" confirm button in modal
    await cdp.eval(`document.getElementById('modal-confirm-proceed').click()`);

    // Verify modal closes
    await cdp.waitFor(`document.getElementById('modal-backdrop').classList.contains('hidden')`, 4000);
    console.log('  • Modal confirmed and closed');

    // Verify item is removed from DOM
    await cdp.waitFor(
      `!document.querySelector('.btn-remove-skill[data-skill="${testSkill}"]')`,
      6000
    );
    console.log('  • Item successfully removed from DOM');

    // Verify backend SQLite state
    const skillsAfter = await callApi('list_skills');
    const stillExists2 = skillsAfter.some((s) => s.name === testSkill);
    if (stillExists2) {
      throw new Error(`Skill "${testSkill}" still exists in backend database!`);
    }
    console.log('  • Backend SQLite database verified: Item deleted');
    console.log('✅ [Test 2 PASSED] Target Skills Delete Button works!');

    // ==========================================
    // TEST 3: Scoring Rubric Delete Button
    // ==========================================
    console.log('\n🧪 [Test 3] Testing Scoring Rubric Delete Button...');
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#rubric` });

    // Wait for the test rubric card to render in DOM
    await cdp.waitFor(
      `Boolean(document.querySelector('.btn-remove-rubric[data-dim="${testRubric}"]'))`,
      10000
    );
    console.log('  • Rubric card rendered in DOM');

    // Click the delete button
    await cdp.eval(`
      document.querySelector('.btn-remove-rubric[data-dim="${testRubric}"]').click();
    `);

    // Verify confirmation modal opens
    await cdp.waitFor(
      `!document.getElementById('modal-backdrop').classList.contains('hidden')`,
      4000
    );
    const rubricModalTitle = await cdp.eval(`document.getElementById('modal-title').textContent.trim()`);
    const rubricModalBody = await cdp.eval(`document.getElementById('modal-body').textContent`);

    if (rubricModalTitle !== 'Remove Rubric Dimension' || !rubricModalBody.includes(testRubric)) {
      throw new Error(`Modal check failed! Title: "${rubricModalTitle}", Body: "${rubricModalBody}"`);
    }
    console.log(`  • Custom confirmation modal opened: "${rubricModalTitle}"`);

    // Click "Delete Dimension" confirm button in modal
    await cdp.eval(`document.getElementById('modal-confirm-proceed').click()`);

    // Verify modal closes
    await cdp.waitFor(`document.getElementById('modal-backdrop').classList.contains('hidden')`, 4000);
    console.log('  • Modal confirmed and closed');

    // Verify item is removed from DOM
    await cdp.waitFor(
      `!document.querySelector('.btn-remove-rubric[data-dim="${testRubric}"]')`,
      6000
    );
    console.log('  • Item successfully removed from DOM');

    // Verify backend SQLite state
    const rubricAfter = await callApi('get_scoring_rubric');
    const stillExists3 = rubricAfter.some((r) => r.dimension === testRubric);
    if (stillExists3) {
      throw new Error(`Rubric dimension "${testRubric}" still exists in backend database!`);
    }
    console.log('  • Backend SQLite database verified: Item deleted');
    console.log('✅ [Test 3 PASSED] Scoring Rubric Delete Button works!');

    // ==========================================
    // TEST 4: Modal Cancel Button Behavior
    // ==========================================
    console.log('\n🧪 [Test 4] Testing Modal Cancel Button (non-destructive check)...');
    const cancelPattern = `Cancel_Test_${Date.now()}`;
    await callApi('add_title_pattern', { pattern: cancelPattern, type: 'exclude' });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#titles` });

    await cdp.waitFor(`Boolean(document.querySelector('.btn-remove-pattern[data-pattern="${cancelPattern}"]'))`);
    await cdp.eval(`document.querySelector('.btn-remove-pattern[data-pattern="${cancelPattern}"]').click();`);
    await cdp.waitFor(`!document.getElementById('modal-backdrop').classList.contains('hidden')`);

    // Click Cancel
    await cdp.eval(`document.getElementById('modal-confirm-cancel').click();`);
    await cdp.waitFor(`document.getElementById('modal-backdrop').classList.contains('hidden')`);

    // Verify item remains in DOM
    const stillInDom = await cdp.eval(`Boolean(document.querySelector('.btn-remove-pattern[data-pattern="${cancelPattern}"]'))`);
    if (!stillInDom) {
      throw new Error(`Item was deleted despite clicking Cancel!`);
    }
    console.log('  • Cancel button successfully closed modal without deleting item');

    // Clean up cancel pattern
    await callApi('remove_title_pattern', { pattern: cancelPattern, type: 'exclude' });
    console.log('✅ [Test 4 PASSED] Cancel button behaves correctly!');

    // ==========================================
    // TEST 5: Mermaid Diagram Rendering & CSP Violation Enforcement (PRO-59)
    // ==========================================
    console.log('\n🧪 [Test 5] Testing Mermaid Diagram Rendering & CSP Enforcement (PRO-59)...');

    // Enable Log domain to detect CSP violation reports
    await cdp.send('Log.enable');
    const logEntries = [];
    cdp.on((method, params) => {
      if (method === 'Log.entryAdded' && params?.entry) {
        logEntries.push(params.entry);
      }
    });

    await cdp.send('Page.navigate', { url: `${BASE_URL}/#visualization` });

    // Wait for Mermaid diagram container to render SVG
    await cdp.waitFor(
      `Boolean(document.querySelector('#mermaid-system-diagram svg'))`,
      12000
    );
    console.log('  • Dashboard rendered Mermaid architecture SVG diagram successfully');

    const svgInfo = await cdp.eval(`
      (() => {
        const svg = document.querySelector('#mermaid-system-diagram svg');
        return {
          id: svg?.id,
          hasNodes: svg?.querySelectorAll('.node').length > 0,
          innerLength: svg?.innerHTML?.length || 0,
        };
      })()
    `);
    if (!svgInfo.hasNodes || svgInfo.innerLength < 100) {
      throw new Error(`Mermaid diagram SVG appears empty or invalid: ${JSON.stringify(svgInfo)}`);
    }
    console.log(`  • Mermaid SVG nodes verified (${svgInfo.innerLength} bytes of SVG markup)`);

    // Verify window.mermaid is present
    const hasMermaid = await cdp.eval(`Boolean(window.mermaid && typeof window.mermaid.render === 'function')`);
    if (!hasMermaid) {
      throw new Error('window.mermaid is not defined or missing render function');
    }
    console.log('  • window.mermaid is loaded and functional from vendored asset');

    // Test CSP: Attempt to inject untrusted inline script
    await cdp.eval(`
      (() => {
        const s = document.createElement('script');
        s.textContent = 'window.__MALICIOUS_INLINE_RAN__ = true;';
        document.body.appendChild(s);
      })()
    `);
    const inlineRan = await cdp.eval(`Boolean(window.__MALICIOUS_INLINE_RAN__)`);
    if (inlineRan) {
      throw new Error('CSP failed to block untrusted inline script without nonce!');
    }
    console.log('  • CSP successfully blocked untrusted inline script execution');

    // Test CSP: Attempt to inject untrusted external CDN script
    await cdp.eval(`
      (() => {
        const s = document.createElement('script');
        s.src = 'https://code.jquery.com/jquery-3.7.1.min.js';
        document.head.appendChild(s);
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));
    const jqueryLoaded = await cdp.eval(`Boolean(window.jQuery)`);
    if (jqueryLoaded) {
      throw new Error('CSP failed to block untrusted external script source!');
    }
    console.log('  • CSP successfully blocked untrusted external script source');

    // Verify that CSP violations were reported to browser log
    const securityViolations = logEntries.filter(
      (e) => e.source === 'security' || (e.text && e.text.includes('Content Security Policy'))
    );
    if (securityViolations.length === 0) {
      console.warn('  ⚠️ Note: No security log entries caught via CDP Log domain, but DOM checks confirmed execution was blocked.');
    } else {
      console.log(`  • Verified ${securityViolations.length} CSP violation entries logged by Chrome security subsystem`);
    }

    console.log('✅ [Test 5 PASSED] Mermaid rendering and CSP enforcement verified!');

    // ==========================================
    // TEST 6: Rubric Badge Colors Calibration (PRO-72)
    // ==========================================
    console.log('\n🧪 [Test 6] Testing Rubric Badge Colors 0-100 Scale Calibration (PRO-72)...');

    // 1. Check Candidates View
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#candidates` });
    await cdp.waitFor(
      `Boolean(document.querySelector('.candidate-card[data-url="https://example.com/cand-80"]'))`,
      8000
    );

    for (const c of candidateScores) {
      const actualClass = await cdp.eval(`
        (() => {
          const card = document.querySelector('.candidate-card[data-url="${c.url}"]');
          if (!card) return null;
          const badge = card.querySelector('.score-badge');
          if (!badge) return null;
          if (badge.classList.contains('score-high')) return 'score-high';
          if (badge.classList.contains('score-mid')) return 'score-mid';
          if (badge.classList.contains('score-low')) return 'score-low';
          return 'unknown';
        })()
      `);
      if (actualClass !== c.expectedClass) {
        throw new Error(
          `Candidates View: Expected badge for "${c.url}" (score ${c.score}) to have class "${c.expectedClass}", got "${actualClass}"`
        );
      }
    }
    console.log('  • Candidates view: Verified score-high (80), score-mid (79, 50), and score-low (49, null)');

    // 2. Check Dashboard Matched Jobs Table
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#dashboard` });
    await cdp.waitFor(
      `Boolean(document.querySelector('#dashboard-matched-jobs-tbody .score-badge'))`,
      8000
    );

    for (const c of candidateScores) {
      const actualClass = await cdp.eval(`
        (() => {
          const select = document.querySelector('.dashboard-status-select[data-url="${c.url}"]');
          if (!select) return null;
          const row = select.closest('tr');
          if (!row) return null;
          const badge = row.querySelector('.score-badge');
          if (!badge) return null;
          if (badge.classList.contains('score-high')) return 'score-high';
          if (badge.classList.contains('score-mid')) return 'score-mid';
          if (badge.classList.contains('score-low')) return 'score-low';
          return 'unknown';
        })()
      `);
      if (actualClass !== c.expectedClass) {
        throw new Error(
          `Dashboard View: Expected row badge for "${c.url}" (score ${c.score}) to have class "${c.expectedClass}", got "${actualClass}"`
        );
      }
    }
    console.log('  • Dashboard matched jobs table: Verified score-high (80, 90), score-mid (79, 50), and score-low (49, null)');
    console.log('✅ [Test 6 PASSED] Calibrated 0-100 rubric badge thresholds verified!');

    // ==========================================
    // TEST 7: Candidate Drawer Breakdown Display & Progress Bar (PRO-73)
    // ==========================================
    console.log('\n🧪 [Test 7] Testing Candidate Drawer Breakdown Display & Progress Bars (PRO-73)...');

    // 1. Navigate back to Candidates View
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#candidates` });
    await cdp.waitFor(
      `Boolean(document.querySelector('.candidate-card[data-url="https://example.com/cand-fractional"]'))`,
      8000
    );

    // 2. Click candidate card to expand drawer
    await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-fractional"]');
        const main = card.querySelector('.candidate-main');
        if (main) main.click();
      })()
    `);

    // 3. Verify drawer is opened
    await cdp.waitFor(
      `Boolean(document.querySelector('.candidate-card[data-url="https://example.com/cand-fractional"] .candidate-drawer.open'))`,
      5000
    );
    console.log('  • Candidate drawer successfully opened with .open class');

    // 4. Inspect breakdown items for cand-fractional (Title 90, Skills 87.6, Experience 96, Seniority 86.6)
    const fractionalBreakdown = await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-fractional"]');
        const drawer = card.querySelector('.candidate-drawer');
        const items = Array.from(drawer.querySelectorAll('.breakdown-bars .bar-item'));
        return items.map((item) => {
          const dim = item.querySelector('.bar-header span')?.textContent?.trim();
          const label = item.querySelector('.bar-header strong')?.textContent?.trim();
          const fill = item.querySelector('.progress-fill');
          const widthStyle = fill ? fill.style.width : '';
          return { dim, label, widthStyle };
        });
      })()
    `);

    const expectedFractional = [
      { dim: 'Title match', label: '90/100', expectedWidth: '90%' },
      { dim: 'Skills match', label: '88/100', expectedWidth: '87.6%' },
      { dim: 'Experience match', label: '96/100', expectedWidth: '96%' },
      { dim: 'Seniority fit', label: '87/100', expectedWidth: '86.6%' },
    ];

    if (!Array.isArray(fractionalBreakdown) || fractionalBreakdown.length !== 4) {
      throw new Error(`Expected 4 breakdown dimensions, found ${fractionalBreakdown?.length}`);
    }

    for (const exp of expectedFractional) {
      const actual = fractionalBreakdown.find((b) => b.dim === exp.dim);
      if (!actual) {
        throw new Error(`Missing expected breakdown dimension "${exp.dim}"`);
      }
      if (actual.label !== exp.label) {
        throw new Error(
          `Dimension "${exp.dim}": Expected integer label "${exp.label}", got "${actual.label}"`
        );
      }
      if (actual.label.includes('/10') && !actual.label.includes('/100')) {
        throw new Error(
          `Dimension "${exp.dim}": Label contains invalid legacy "/10" notation: "${actual.label}"`
        );
      }
      if (actual.widthStyle !== exp.expectedWidth) {
        throw new Error(
          `Dimension "${exp.dim}": Expected progress-fill width "${exp.expectedWidth}", got "${actual.widthStyle}" (width must not be multiplied by 10)`
        );
      }
    }
    console.log('  • Fractional candidate breakdown: Verified integer labels (90/100, 88/100, 96/100, 87/100) and unscaled progress widths');

    // 5. Check integer candidate (cand-80)
    await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-80"]');
        const main = card.querySelector('.candidate-main');
        if (main) main.click();
      })()
    `);
    await cdp.waitFor(
      `Boolean(document.querySelector('.candidate-card[data-url="https://example.com/cand-80"] .candidate-drawer.open'))`,
      5000
    );

    const intBreakdown = await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-80"]');
        const drawer = card.querySelector('.candidate-drawer');
        const items = Array.from(drawer.querySelectorAll('.breakdown-bars .bar-item'));
        return items.map((item) => {
          const dim = item.querySelector('.bar-header span')?.textContent?.trim();
          const label = item.querySelector('.bar-header strong')?.textContent?.trim();
          const fill = item.querySelector('.progress-fill');
          const widthStyle = fill ? fill.style.width : '';
          return { dim, label, widthStyle };
        });
      })()
    `);

    for (const b of intBreakdown) {
      if (b.label !== '80/100') {
        throw new Error(`Candidate 80 dimension "${b.dim}": Expected label "80/100", got "${b.label}"`);
      }
      if (b.widthStyle !== '80%') {
        throw new Error(`Candidate 80 dimension "${b.dim}": Expected width "80%", got "${b.widthStyle}"`);
      }
    }
    console.log('  • Integer candidate breakdown: Verified "80/100" label and "80%" progress width');

    // 6. Test drawer toggle close
    await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-80"]');
        const main = card.querySelector('.candidate-main');
        if (main) main.click();
      })()
    `);
    const isClosed = await cdp.eval(`
      (() => {
        const card = document.querySelector('.candidate-card[data-url="https://example.com/cand-80"]');
        const drawer = card.querySelector('.candidate-drawer');
        return !drawer.classList.contains('open');
      })()
    `);
    if (!isClosed) {
      throw new Error('Expected candidate drawer to toggle closed when clicked again');
    }
    console.log('  • Verified candidate drawer toggles closed on subsequent click');
    console.log('✅ [Test 7 PASSED] Candidate Drawer breakdown display & progress bars verified!');

    console.log('\n🎉 ALL 7 AUTOMATED E2E BROWSER TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    cdp.close();
    cleanup();
    if (spawnedServerProc) {
      try {
        spawnedServerProc.kill('SIGTERM');
      } catch {}
    }
    if (testWsDir) {
      try {
        fs.rmSync(testWsDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
