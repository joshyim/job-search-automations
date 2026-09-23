#!/usr/bin/env node

/**
 * Automated E2E Browser Test Suite for Job Search Web UI
 * Runs directly on macOS using local Google Chrome with --headless=new --disable-gpu
 * Connects via Chrome DevTools Protocol (CDP) WebSocket without third-party dependencies.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';

const UI_PORT = process.env.UI_PORT || 3847;
const BASE_URL = `http://localhost:${UI_PORT}`;
const CDP_PORT = 9345;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let cachedToken = process.env.JOB_SEARCH_UI_TOKEN || '';

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

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
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

  // 1. Verify UI server is up
  try {
    const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json());
    console.log(`✅ UI Server is running at ${BASE_URL} (MCP connected: ${health.mcpConnected})`);
  } catch (err) {
    console.error(`❌ UI Server is not reachable at ${BASE_URL}. Ensure it is running.`);
    process.exit(1);
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

    // Click the delete button
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

    console.log('\n🎉 ALL 4 AUTOMATED E2E BROWSER TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    cdp.close();
    cleanup();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
