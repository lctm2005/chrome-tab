import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.CDP_PORT || 9223);
const extensionId = process.env.EXT_ID || 'fignfifoniblkonapihmkfakmlgkbkcf';
const preview = process.env.PREVIEW !== '0';
const previewPort = Number(process.env.PREVIEW_PORT || 8765);
const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const base = `http://127.0.0.1:${port}`;
const autoChrome = process.env.E2E_AUTO_CHROME !== '0';
const sidepanelUrl = preview
  ? (process.env.PREVIEW_URL || `http://127.0.0.1:${previewPort}/sidepanel.html`)
  : `chrome-extension://${extensionId}/sidepanel.html`;

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
]);

async function startPreviewServer() {
  if (!preview || process.env.PREVIEW_URL) return null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://127.0.0.1:${previewPort}`);
      const pathname = decodeURIComponent(url.pathname === '/' ? '/sidepanel.html' : url.pathname);
      const filePath = normalize(join(repoRoot, pathname));
      if (relative(repoRoot, filePath).startsWith('..')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentTypes.get(extname(filePath)) || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(previewPort, '127.0.0.1', resolve);
  });
  return server;
}

async function startChromeForCdp() {
  if (await canReachCdp()) return null;
  if (!autoChrome) {
    throw new Error(`Cannot reach Chrome CDP at ${base}. Start Chrome with --remote-debugging-port=${port}, or unset E2E_AUTO_CHROME=0.`);
  }

  const executable = await findChromeExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), 'space-tabs-e2e-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--remote-allow-origins=*',
    ...(preview ? ['--headless=new', '--disable-gpu'] : []),
    'about:blank',
  ];
  const child = spawn(executable, args, { stdio: 'ignore' });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.unref();

  try {
    await waitForCdp();
  } catch (error) {
    child.kill('SIGTERM');
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  }

  return {
    child,
    userDataDir,
    async close() {
      if (!exited) {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

async function canReachCdp() {
  try {
    await json(`${base}/json/version`);
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReachCdp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Chrome CDP at ${base}.`);
}

async function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  throw new Error('Could not find Chrome. Set CHROME_PATH to the Chrome executable and rerun npm run e2e:smoke.');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function sidepanelTarget() {
  let targets = await json(`${base}/json/list`);
  let target = targets.find((item) => item.url === sidepanelUrl);
  if (!target) {
    target = await json(`${base}/json/new?${encodeURIComponent(sidepanelUrl)}`, { method: 'PUT' });
  }
  return target;
}

function createClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const record = pending.get(message.id);
    if (!record) return;
    pending.delete(message.id);
    if (message.error) record.reject(new Error(message.error.message));
    else record.resolve(message.result);
  });
  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    }),
    send(method, params = {}) {
      const requestId = ++id;
      ws.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails.exception?.description ||
      result.exceptionDetails.exception?.value ||
      result.exceptionDetails.text ||
      'Runtime.evaluate failed';
    throw new Error(details);
  }
  return result.result.value;
}

async function waitFor(client, expression, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function main() {
  const previewServer = await startPreviewServer();
  const chrome = await startChromeForCdp();
  let client = null;
  try {
    const target = await sidepanelTarget();
    client = createClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    const results = [];
    const bugs = [];
    const record = (name, ok, detail = '') => results.push({ name, ok, detail });

    await evaluate(client, `new Promise((resolve) => {
    if (document.readyState === 'complete') resolve(true);
    else addEventListener('load', () => resolve(true), { once: true });
  })`);

    await evaluate(client, `(async () => {
    const STORAGE_KEY = 'spaceTabsState';
    const SECRET_STORAGE_KEY = 'spaceTabsSecrets';
    if (${JSON.stringify(preview)}) {
      localStorage.clear();
      sessionStorage.removeItem(SECRET_STORAGE_KEY);
    } else {
      await chrome.storage.local.clear();
      if (chrome.storage.session) await chrome.storage.session.remove(SECRET_STORAGE_KEY);
    }
    const state = {
      version: 4,
      activeSpaceId: 'default',
      spaces: [],
      groupSpaces: {},
      tabSpaces: {},
      renamedTabs: {},
      groupOrder: {},
      tabOrder: {},
      collapsedGroups: {},
      collapsedSpaceGroups: {},
      askSessions: {},
      activeAskSessionKey: '',
      spaceSnapshots: {},
      shortcuts: {},
      ai: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        model: 'glm-5.1',
        apiKey: '',
        thinking: 'disabled',
        language: 'zh-CN',
        temperature: 0.6,
        maxTokens: 2048,
      },
    };
    state.spaces = [
      { id: 'default', name: 'Space', icon: 'S', color: 'blue' },
      { id: 'folder-demo', name: 'Folder Demo', icon: 'F', color: 'green' },
      { id: 'dormant-demo', name: 'Dormant Demo', icon: 'D', color: 'purple' },
      { id: 'temp-demo', name: 'Temp Demo', icon: 'T', color: 'orange' },
    ];
    state.activeSpaceId = 'default';
    state.spaceSnapshots['folder-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [{
        title: 'Work / Client / Docs',
        color: 'blue',
        collapsed: true,
        tabs: [
          { title: 'Nested Spec', url: 'https://example.com/nested-spec' },
          { title: 'Nested Plan', url: 'https://example.com/nested-plan' },
        ],
      }],
    };
    state.spaceSnapshots['dormant-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [{
        title: 'Search',
        color: 'blue',
        collapsed: true,
        tabs: [
          { title: 'Baidu', url: 'https://baidu.com' },
          { title: 'Google', url: 'https://www.google.com' },
        ],
      }],
    };
    state.spaceSnapshots['temp-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [{
        title: 'Ungrouped',
        color: 'grey',
        collapsed: false,
        tabs: [
          { title: 'Leftover Search', url: 'https://google.com/search?q=leftover' },
          { title: 'Leftover Baidu', url: 'https://baidu.com' },
        ],
      }],
    };
    if (${JSON.stringify(preview)}) localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: state }));
    else await chrome.storage.local.set({ [STORAGE_KEY]: state });
    return true;
  })()`);
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Space' && document.querySelector('.add-space')`);
    record('cold boot renders default Space', true);

  await evaluate(client, `document.querySelector('.add-space').click()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open`);
  await evaluate(client, `(() => {
    const input = document.querySelector('#actionDialogInput');
    input.value = 'E2E Space';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#actionDialogConfirm').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'E2E Space'`);
  record('add Space dialog creates and activates a Space', true);

  await evaluate(client, `document.querySelector('.new-tab-row').click()`);
  await waitFor(client, `document.querySelectorAll('.tab-row').length >= 1`);
  const newTabRows = await evaluate(client, `document.querySelectorAll('.tab-row').length`);
  record('New Tab row creates a tab owned by active Space', newTabRows >= 1, `${newTabRows} rows`);

  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `document.querySelector('#groupsList')?.classList.contains('groups-collapsed')`);
  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `!document.querySelector('#groupsList')?.classList.contains('groups-collapsed')`);
  record('Space collapse toggle hides and restores group content', true);

  await evaluate(client, `document.querySelector('#settingsButton').click()`);
  await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
  const apiState = await evaluate(client, `document.querySelector('#apiKeyStatus')?.textContent`);
  record('Settings opens and reports no API key without testing AI', apiState === 'No API key configured.', apiState);
  await evaluate(client, `document.querySelector('#settingsDialog [value="cancel"]').click()`);
  await waitFor(client, `!document.querySelector('#settingsDialog')?.open`);

  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const folder = buttons.find((button) => button.title === 'Folder Demo');
    folder.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Folder Demo'`);
  const folderState = await waitFor(client, `(() => {
    const headers = [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent);
    const folders = [...document.querySelectorAll('.folder-header strong')].map((node) => node.textContent);
    return headers.length || folders.length ? { headers, folders, rows: document.querySelectorAll('.tab-row.dormant').length } : null;
  })()`);
  record('snapshot-backed dormant Space loads collapsed saved tabs', folderState.rows === 0, JSON.stringify(folderState));
  if (folderState.headers.includes('Work / Client / Docs')) {
    bugs.push('Multi-level folders are flattened into one Group header ("Work / Client / Docs") instead of a visible folder tree.');
  }
  record(
    'multi-level folders render as visible nested folder tree',
    folderState.folders.join(' / ') === 'Work / Client' && folderState.headers.includes('Docs'),
    JSON.stringify(folderState)
  );

  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const space = buttons.find((button) => button.title === 'Space');
    space.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Space'`);
  await waitFor(client, `(() => {
    const headers = [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent);
    return headers.includes('Research') && headers.includes('Build') && headers.includes('Inbox');
  })()`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const folder = buttons.find((button) => button.title === 'Folder Demo');
    folder.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Folder Demo'`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const space = buttons.find((button) => button.title === 'Space');
    space.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Space'`);
  const roundTripState = await waitFor(client, `(() => {
    const headers = [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent);
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const defaultSnapshotGroups = (stored.spaceSnapshots?.default?.groups || []).map((group) => group.title);
    const folderSnapshotGroups = (stored.spaceSnapshots?.['folder-demo']?.groups || []).map((group) => group.title);
    return {
      headers,
      defaultSnapshotGroups,
      folderSnapshotGroups,
    };
  })()`);
  const defaultContentSurvived = ['Research', 'Build', 'Inbox']
    .every((title) => roundTripState.headers.includes(title) && roundTripState.defaultSnapshotGroups.includes(title));
  const folderContentSurvived = roundTripState.folderSnapshotGroups.includes('Work / Client / Docs');
  const placeholderTabsDidNotPersist = !roundTripState.defaultSnapshotGroups.includes('Ungrouped') &&
    !roundTripState.folderSnapshotGroups.includes('Ungrouped');
  record(
    'Space round trip keeps dormant content instead of replacing it with placeholder tabs',
    defaultContentSurvived && folderContentSurvived && placeholderTabsDidNotPersist,
    JSON.stringify(roundTripState)
  );
  if (!defaultContentSurvived || !folderContentSurvived || !placeholderTabsDidNotPersist) {
    bugs.push('Switching Spaces overwrote dormant snapshots with placeholder New Tab content.');
  }

  for (let index = 0; index < 3; index += 1) {
    await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('.space')];
      buttons.find((button) => button.title === 'Folder Demo').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Folder Demo'`);
    await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('.space')];
      buttons.find((button) => button.title === 'Space').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Space'`);
  }
  const stressState = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    return {
      headers: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
      defaultSnapshotGroups: (stored.spaceSnapshots?.default?.groups || []).map((group) => group.title),
      folderSnapshotGroups: (stored.spaceSnapshots?.['folder-demo']?.groups || []).map((group) => group.title),
    };
  })()`);
  const repeatedSwitchesKeptContent = ['Research', 'Build', 'Inbox']
    .every((title) => stressState.headers.includes(title) && stressState.defaultSnapshotGroups.includes(title)) &&
    stressState.folderSnapshotGroups.includes('Work / Client / Docs') &&
    !stressState.defaultSnapshotGroups.includes('Ungrouped') &&
    !stressState.folderSnapshotGroups.includes('Ungrouped');
  record(
    'repeated Space switches keep saved content stable',
    repeatedSwitchesKeptContent,
    JSON.stringify(stressState)
  );
  if (!repeatedSwitchesKeptContent) {
    bugs.push('Repeated Space switching destabilized saved Space snapshots.');
  }

  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    buttons.find((button) => button.title === 'Dormant Demo').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Dormant Demo'`);
  await waitFor(client, `[...document.querySelectorAll('.group-header h2')].some((node) => node.textContent === 'Search')`);
  await evaluate(client, `(() => {
    const header = [...document.querySelectorAll('.group-header')]
      .find((node) => node.querySelector('h2')?.textContent === 'Search');
    if (header?.closest('.collapsed')) header.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelectorAll('.tab-row.dormant').length === 2`);
  await evaluate(client, `document.querySelector('.tab-row.dormant').click()`);
  const firstDormantOpenState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const searchSnapshot = (stored.spaceSnapshots?.['dormant-demo']?.groups || [])
      .find((group) => group.title === 'Search');
    const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const searchRows = rows.filter((row) => /Baidu|Google|baidu|google/i.test(row.text));
    return {
      snapshotUrls: (searchSnapshot?.tabs || []).map((tab) => tab.url),
      searchRows,
      dormantRows: rows.filter((row) => row.dormant).length,
    };
  })()`);
  record(
    'opening one dormant grouped tab shows one live row and one remaining dormant row',
    firstDormantOpenState.snapshotUrls.length === 2 &&
      new Set(firstDormantOpenState.snapshotUrls).size === 2 &&
      firstDormantOpenState.searchRows.length === 2 &&
      firstDormantOpenState.dormantRows === 1,
    JSON.stringify(firstDormantOpenState)
  );
  if (firstDormantOpenState.searchRows.length !== 2 || firstDormantOpenState.dormantRows !== 1) {
    bugs.push('Opening a dormant grouped tab left duplicate dormant/live rows.');
  }

  await evaluate(client, `document.querySelector('.tab-row.dormant').click()`);
  const allDormantOpenState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const searchSnapshot = (stored.spaceSnapshots?.['dormant-demo']?.groups || [])
      .find((group) => group.title === 'Search');
    const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const searchRows = rows.filter((row) => /Baidu|Google|baidu|google/i.test(row.text));
    return {
      snapshotUrls: (searchSnapshot?.tabs || []).map((tab) => tab.url),
      searchRows,
      dormantRows: rows.filter((row) => row.dormant).length,
    };
  })()`);
  record(
    'opening all dormant grouped tabs leaves only live rows',
    allDormantOpenState.snapshotUrls.length === 2 &&
      new Set(allDormantOpenState.snapshotUrls).size === 2 &&
      allDormantOpenState.searchRows.length === 2 &&
      allDormantOpenState.dormantRows === 0,
    JSON.stringify(allDormantOpenState)
  );
  if (allDormantOpenState.searchRows.length !== 2 || allDormantOpenState.dormantRows !== 0) {
    bugs.push('Opening all dormant grouped tabs did not fully drain the dormant snapshot.');
  }

  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    buttons.find((button) => button.title === 'Temp Demo').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Temp Demo'`);
  const tempPurgeState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const tempGroups = stored.spaceSnapshots?.['temp-demo']?.groups || [];
    const dormantRows = document.querySelectorAll('.ungrouped-section .tab-row.dormant').length;
    const loaded = document.querySelector('#activeSpaceName')?.textContent === 'Temp Demo';
    return loaded ? { tempGroups: tempGroups.map((group) => group.title), dormantRows } : null;
  })()`);
  record(
    'legacy dormant temporary Ungrouped rows are purged on Space load',
    tempPurgeState.dormantRows === 0 && !tempPurgeState.tempGroups.includes('Ungrouped'),
    JSON.stringify(tempPurgeState)
  );
  if (tempPurgeState.dormantRows !== 0 || tempPurgeState.tempGroups.includes('Ungrouped')) {
    bugs.push('Legacy dormant temporary Ungrouped rows were visible or persisted after loading the Space.');
  }

  await evaluate(client, `(() => {
    const STORAGE_KEY = 'spaceTabsState';
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').spaceTabsState || {};
    stored.spaceSnapshots = stored.spaceSnapshots || {};
    stored.spaceSnapshots['temp-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [{
        title: 'Ungrouped',
        color: 'grey',
        collapsed: false,
        tabs: [
          { title: 'Injected Leftover', url: 'https://example.com/injected-leftover' },
        ],
      }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: stored }));
    location.reload();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Temp Demo'`);
  const tempReloadPurgeState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const tempGroups = stored.spaceSnapshots?.['temp-demo']?.groups || [];
    const dormantRows = document.querySelectorAll('.ungrouped-section .tab-row.dormant').length;
    return { tempGroups: tempGroups.map((group) => group.title), dormantRows };
  })()`);
  record(
    'reloaded legacy temporary snapshot still does not resurrect Ungrouped rows',
    tempReloadPurgeState.dormantRows === 0 && !tempReloadPurgeState.tempGroups.includes('Ungrouped'),
    JSON.stringify(tempReloadPurgeState)
  );
  if (tempReloadPurgeState.dormantRows !== 0 || tempReloadPurgeState.tempGroups.includes('Ungrouped')) {
    bugs.push('Reloading a legacy temporary snapshot resurrected Ungrouped rows.');
  }

  for (let index = 0; index < 8; index += 1) {
    await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('.space')];
      buttons.find((button) => button.title === 'Dormant Demo').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Dormant Demo'`);
    await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('.space')];
      buttons.find((button) => button.title === 'Temp Demo').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Temp Demo'`);
    await evaluate(client, `(() => {
      const buttons = [...document.querySelectorAll('.space')];
      buttons.find((button) => button.title === 'Space').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Space'`);
  }
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    buttons.find((button) => button.title === 'Dormant Demo').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Dormant Demo'`);
  await evaluate(client, `(() => {
    const header = [...document.querySelectorAll('.group-header')]
      .find((node) => node.querySelector('h2')?.textContent === 'Search');
    if (header?.closest('.collapsed')) header.click();
    return true;
  })()`);
  const brutalStressState = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const snapshots = stored.spaceSnapshots || {};
    const defaultGroups = (snapshots.default?.groups || []).map((group) => group.title);
    const dormantGroups = snapshots['dormant-demo']?.groups || [];
    const tempGroups = snapshots['temp-demo']?.groups || [];
    const searchRows = [...document.querySelectorAll('.tab-row')]
      .filter((row) => /Baidu|Google|baidu|google/i.test(row.textContent))
      .map((row) => ({
        text: row.textContent,
        dormant: row.classList.contains('dormant'),
      }));
    return {
      defaultGroups,
      dormantGroups: dormantGroups.map((group) => ({
        title: group.title,
        count: (group.tabs || []).length,
      })),
      tempGroups: tempGroups.map((group) => group.title),
      searchRows,
      activeRows: document.querySelectorAll('.tab-row').length,
      activeDormantRows: document.querySelectorAll('.tab-row.dormant').length,
    };
  })()`);
  const brutalStressStable = ['Research', 'Build', 'Inbox'].every((title) => brutalStressState.defaultGroups.includes(title)) &&
    !brutalStressState.defaultGroups.includes('Ungrouped') &&
    !brutalStressState.tempGroups.includes('Ungrouped') &&
    brutalStressState.dormantGroups.every((group) => group.title !== 'Search' || group.count === 2) &&
    brutalStressState.searchRows.length === 2;
  record(
    'brutal repeated Space switching does not duplicate saved grouped rows',
    brutalStressStable,
    JSON.stringify(brutalStressState)
  );
  if (!brutalStressStable) {
    bugs.push('Brutal repeated Space switching duplicated saved grouped rows or resurrected temporary rows.');
  }

    console.log(JSON.stringify({ results, bugs }, null, 2));
    const failures = results.filter((result) => !result.ok);
    if (failures.length || bugs.length) {
      throw new Error(`E2E smoke failed: ${failures.map((failure) => failure.name).join(', ') || bugs.join('; ')}`);
    }
  } finally {
    client?.close();
    await chrome?.close();
    await new Promise((resolve) => previewServer?.close(resolve) ?? resolve());
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
