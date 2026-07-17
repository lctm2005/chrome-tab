import { spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromeGroupTitle } from '../src/shared/group-title.js';
import { createDefaultState } from '../src/shared/state.js';

const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const BEFORE_SESSION_ID = 'restart-e2e-before-session';
const SPACE_ID = 'default';
const SPACE_NAME = 'Restart Lab 精确恢复';
const SPACE_ICON = '重';
const GROUP_LOGICAL_TITLE = 'Restart Stable Identity Exact Logical Group Name';
const GROUP_PHYSICAL_TITLE = chromeGroupTitle(GROUP_LOGICAL_TITLE);
const PANEL_ALIAS = 'Panel-only exact alias after restart';
const CONTEXT = '# Restart context\nPreserve this exact portable workspace context.';
const SESSION_KEY_SENTINEL = 'restart-e2e-session-only-key';
const SNAPSHOT_IDS = Object.freeze({
  group: 'group:restart-live',
  unique: 'tab:restart-unique',
  duplicateA: 'tab:restart-duplicate-a',
  duplicateB: 'tab:restart-duplicate-b',
  ungroupedGroup: 'group:restart-ungrouped',
  ungrouped: 'tab:restart-ungrouped',
  savedGroup: 'group:restart-saved-only',
  saved: 'tab:restart-saved-only',
});

const runtimeEntries = [
  'manifest.json',
  'background.js',
  'sidepanel.html',
  'sidepanel.css',
  'sidepanel.js',
  'src',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error('Could not find Chrome. Set CHROME_PATH and rerun npm run e2e:restart.');
}

async function createExtensionFixture() {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'space-extension-restart-files-'));
  for (const entry of runtimeEntries) {
    const destination = join(fixtureDir, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repoRoot, entry), destination, { recursive: true });
  }
  const manifestPath = join(fixtureDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    'http://127.0.0.1/*',
  ])];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(fixtureDir, 'config.local.js'),
    '// Isolated restart E2E fixture. Never load developer secrets.\nwindow.SPACE_TABS_CONFIG = {};\n',
  );
  await writeFile(
    join(fixtureDir, 'e2e-probe.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Restart E2E probe</title></head><body></body></html>\n',
  );
  return fixtureDir;
}

async function startFixtureServer() {
  const sockets = new Set();
  const routes = new Map([
    ['/unique', 'Restart Unique Page'],
    ['/duplicate', 'Restart Duplicate Page'],
    ['/ungrouped', 'Restart Ungrouped Page'],
    ['/saved-only', 'Restart Saved-only Page'],
  ]);
  const server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const title = routes.get(path);
    if (!title) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      connection: 'close',
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(`<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  return {
    urls: {
      unique: `${origin}/unique`,
      duplicate: `${origin}/duplicate`,
      ungrouped: `${origin}/ungrouped`,
      savedOnly: `${origin}/saved-only`,
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function startChromeWithProfile({ executable, userDataDir, restoreLastSession = false }) {
  const args = [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-session-crashed-bubble',
  ];
  if (restoreLastSession) args.push('--restore-last-session');
  else args.push('about:blank');
  const child = spawn(executable, args, {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  });
  let exitRecord = null;
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exitRecord = { code, signal };
      resolve(exitRecord);
    });
  });
  return {
    child,
    pipeWrite: child.stdio[3],
    pipeRead: child.stdio[4],
    exited,
    get exitRecord() {
      return exitRecord;
    },
  };
}

function createPipeClient(pipeWrite, pipeRead, child) {
  let id = 0;
  let buffer = Buffer.alloc(0);
  let closed = false;
  const pending = new Map();

  const rejectPending = (error) => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };

  pipeRead.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let boundary = buffer.indexOf(0);
    while (boundary >= 0) {
      const payload = buffer.subarray(0, boundary).toString();
      buffer = buffer.subarray(boundary + 1);
      boundary = buffer.indexOf(0);
      if (!payload) continue;
      const message = JSON.parse(payload);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  pipeRead.on('error', rejectPending);
  pipeRead.on('close', () => rejectPending(new Error('Chrome closed the DevTools pipe.')));
  child.once('exit', (code, signal) => rejectPending(
    new Error(`Chrome exited: code=${code ?? 'null'} signal=${signal ?? 'null'}.`),
  ));

  return {
    send(method, params = {}, sessionId = '') {
      if (closed) return Promise.reject(new Error('Chrome DevTools pipe is closed.'));
      const requestId = ++id;
      const message = { id: requestId, method, params };
      if (sessionId) message.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timed out waiting for Chrome CDP method: ${method}`));
        }, 30000);
        pending.set(requestId, { resolve, reject, timeout });
        pipeWrite.write(`${JSON.stringify(message)}\0`);
      });
    },
    close() {
      rejectPending(new Error('Chrome DevTools pipe client closed.'));
    },
  };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Runtime.evaluate failed.',
    );
  }
  return result.result.value;
}

async function waitFor(client, sessionId, expression, timeoutMs = 15000) {
  const started = Date.now();
  let lastValue = null;
  while (Date.now() - started < timeoutMs) {
    lastValue = await evaluate(client, sessionId, expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}. Last value: ${JSON.stringify(lastValue)}`);
}

async function waitForTarget(client, predicate, timeoutMs = 10000) {
  const started = Date.now();
  let lastTargets = [];
  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await client.send('Target.getTargets');
    lastTargets = targetInfos;
    const target = targetInfos.find(predicate);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Chrome target: ${JSON.stringify(lastTargets)}`);
}

async function attachPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url });
  await waitForTarget(
    client,
    (target) => target.targetId === targetId && String(target.url || '').startsWith(url),
  );
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await waitFor(client, sessionId, `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url)})`);
  return { targetId, sessionId };
}

async function closeTarget(client, targetId) {
  if (!targetId) return;
  await client.send('Target.closeTarget', { targetId }).catch(() => null);
}

async function expandSavedOnlyGroup(client, sessionId) {
  await waitFor(client, sessionId, `(() => {
    const card = [...document.querySelectorAll('.group-card')].find((candidate) =>
      candidate.querySelector('.group-header h2')?.textContent === 'Saved Only');
    if (!card) return false;
    if (card.classList.contains('collapsed')) {
      card.querySelector('.group-toggle')?.click();
      return false;
    }
    return true;
  })()`, 10000);
}

async function stopChromeGracefully(client, chrome) {
  if (!chrome || chrome.exitRecord) return;
  await client?.send('Browser.close').catch(() => null);
  const stopped = await Promise.race([
    chrome.exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (!stopped && !chrome.exitRecord) chrome.child.kill('SIGTERM');
  const terminated = stopped || await Promise.race([
    chrome.exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!terminated && !chrome.exitRecord) chrome.child.kill('SIGKILL');
  if (!chrome.exitRecord) await chrome.exited;
  client?.close();
}

function fixtureStateTemplate() {
  const state = createDefaultState({ browserSessionId: BEFORE_SESSION_ID });
  state.spaces = [{ id: SPACE_ID, name: SPACE_NAME, icon: SPACE_ICON, color: 'blue' }];
  state.activeSpaceId = SPACE_ID;
  state.onboarding = { version: 2, completed: true, stage: 'done' };
  state.spaceContexts = { [SPACE_ID]: CONTEXT };
  state.ai = {
    ...state.ai,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: '',
  };
  return state;
}

function portableProjectionExpression() {
  return `(saved) => ({
    activeSpaceId: saved.activeSpaceId || '',
    spaces: (saved.spaces || []).map((space) => ({
      id: space.id || '', name: space.name || '', icon: space.icon || '', color: space.color || '',
    })),
    context: saved.spaceContexts?.[${JSON.stringify(SPACE_ID)}] || '',
    ai: {
      provider: saved.ai?.provider || '',
      baseUrl: saved.ai?.baseUrl || '',
      model: saved.ai?.model || '',
      apiKey: saved.ai?.apiKey || '',
    },
    snapshot: (saved.spaceSnapshots?.[${JSON.stringify(SPACE_ID)}]?.groups || []).map((group) => ({
      snapshotGroupId: group.snapshotGroupId || '',
      title: group.title || '',
      color: group.color || '',
      restorable: group.restorable === true,
      tabs: (group.tabs || []).map((tab) => ({
        snapshotTabId: tab.snapshotTabId || '',
        title: tab.title || '',
        panelTitle: tab.panelTitle || '',
        url: tab.url || '',
      })),
    })),
  })`;
}

function expectedPortableProjection(urls) {
  return {
    activeSpaceId: SPACE_ID,
    spaces: [{ id: SPACE_ID, name: SPACE_NAME, icon: SPACE_ICON, color: 'blue' }],
    context: CONTEXT,
    ai: {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: '',
    },
    snapshot: [
      {
        snapshotGroupId: SNAPSHOT_IDS.group,
        title: GROUP_LOGICAL_TITLE,
        color: 'blue',
        restorable: false,
        tabs: [
          {
            snapshotTabId: SNAPSHOT_IDS.unique,
            title: 'Restart Unique Page',
            panelTitle: PANEL_ALIAS,
            url: urls.unique,
          },
          {
            snapshotTabId: SNAPSHOT_IDS.duplicateA,
            title: 'Restart Duplicate Page',
            panelTitle: '',
            url: urls.duplicate,
          },
          {
            snapshotTabId: SNAPSHOT_IDS.duplicateB,
            title: 'Restart Duplicate Page',
            panelTitle: '',
            url: urls.duplicate,
          },
        ],
      },
      {
        snapshotGroupId: SNAPSHOT_IDS.savedGroup,
        title: 'Saved Only',
        color: 'orange',
        restorable: false,
        tabs: [{
          snapshotTabId: SNAPSHOT_IDS.saved,
          title: 'Restart Saved-only Page',
          panelTitle: 'Saved-only exact alias',
          url: urls.savedOnly,
        }],
      },
      {
        snapshotGroupId: SNAPSHOT_IDS.ungroupedGroup,
        title: 'Ungrouped',
        color: 'grey',
        restorable: true,
        tabs: [{
          snapshotTabId: SNAPSHOT_IDS.ungrouped,
          title: 'Restart Ungrouped Page',
          panelTitle: '',
          url: urls.ungrouped,
        }],
      },
    ],
  };
}

function panelStateExpression(urls) {
  return `(async () => {
    const [stored, session, browserTabs, browserGroups, currentWindow] = await Promise.all([
      chrome.storage.local.get('spaceTabsState'),
      chrome.storage.session.get(null),
      chrome.tabs.query({}),
      chrome.tabGroups.query({}),
      chrome.windows.getCurrent(),
    ]);
    const saved = stored.spaceTabsState || {};
    const fixtureUrls = new Set(${JSON.stringify([
      urls.unique,
      urls.duplicate,
      urls.ungrouped,
      urls.savedOnly,
    ])});
    const fixtureTabs = browserTabs.filter((tab) => fixtureUrls.has(tab.url || tab.pendingUrl || ''));
    const currentFixtureTabs = fixtureTabs.filter((tab) => tab.windowId === currentWindow.id);
    const fixtureGroups = browserGroups.filter((group) =>
      currentFixtureTabs.some((tab) => tab.groupId === group.id));
    const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
      tabId: row.dataset.tabId || '',
      snapshotTabId: row.dataset.snapshotTabId || '',
      snapshotGroupId: row.dataset.snapshotGroupId || '',
      title: row.querySelector('.tab-title')?.textContent || '',
      dormant: row.classList.contains('dormant'),
      groupTitle: row.closest('.group-card')?.querySelector('.group-header h2')?.textContent ||
        (row.closest('.ungrouped-section') ? 'Ungrouped' : ''),
    })).filter((row) => Object.values(${JSON.stringify(SNAPSHOT_IDS)}).includes(row.snapshotTabId));
    const lifecycle = Object.fromEntries(Object.entries(saved.tabLifecycle || {})
      .filter(([, binding]) => Object.values(${JSON.stringify(SNAPSHOT_IDS)}).includes(binding?.snapshotTabId)));
    return {
      ready: document.readyState === 'complete' &&
        document.querySelector('#activeSpaceName')?.textContent === ${JSON.stringify(SPACE_NAME)},
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      activeSpaceButton: (() => {
        const button = document.querySelector('.space[data-space-id=${JSON.stringify(SPACE_ID)}]');
        return { title: button?.title || '', icon: button?.querySelector('.space-mark')?.textContent || '' };
      })(),
      currentWindowId: currentWindow.id,
      browserSessionId: saved.browserSessionId || '',
      sessionBrowserId: session.spaceTabsBrowserSession || '',
      hasSecret: Object.hasOwn(session, 'spaceTabsSecrets'),
      sessionKey: session.spaceTabsSecrets?.ai?.apiKey || '',
      windowState: session.spaceTabsWindowState || null,
      pendingLifecycleKeys: Object.keys(session).filter((key) =>
        key.startsWith('spaceTabsLifecycleEvent:') || key.startsWith('spaceTabsLifecycleSuppression:')),
      portable: (${portableProjectionExpression()})(saved),
      fixtureTabs: currentFixtureTabs.map((tab) => ({
        id: tab.id, windowId: tab.windowId, groupId: tab.groupId, index: tab.index,
        title: tab.title || '', url: tab.url || tab.pendingUrl || '',
      })).sort((left, right) => left.index - right.index),
      fixtureGroups: fixtureGroups.map((group) => ({
        id: group.id, windowId: group.windowId, title: group.title || '',
        color: group.color || '', collapsed: Boolean(group.collapsed),
      })),
      liveMaps: {
        groupSpaces: structuredClone(saved.groupSpaces || {}),
        tabSpaces: structuredClone(saved.tabSpaces || {}),
        renamedTabs: structuredClone(saved.renamedTabs || {}),
        tabLifecycle: lifecycle,
        groupOrder: structuredClone(saved.groupOrder || {}),
        tabOrder: structuredClone(saved.tabOrder || {}),
      },
      rows,
    };
  })()`;
}

function assert(condition, message, detail = null) {
  if (condition) return;
  throw new Error(`${message}${detail === null ? '' : `: ${JSON.stringify(detail)}`}`);
}

function sorted(values) {
  return [...values].sort();
}

function assertPanelState({ state, fixture, urls, expectedPortable, previousIds = null }) {
  assert(state.ready, 'Workbench did not restore the expected active Space', state);
  assert(state.activeSpaceButton.title === SPACE_NAME && state.activeSpaceButton.icon === SPACE_ICON,
    'Space name or icon was not restored exactly', state.activeSpaceButton);
  assert(JSON.stringify(state.portable) === JSON.stringify(expectedPortable),
    'Portable workspace, snapshot, Context, or names changed', state.portable);
  assert(state.fixtureTabs.length === 4, 'Expected exactly four restored live fixture tabs', state.fixtureTabs);
  assert(state.fixtureTabs.filter((tab) => tab.url === urls.duplicate).length === 2,
    'Duplicate URL live tabs were collapsed or multiplied', state.fixtureTabs);
  assert(!state.fixtureTabs.some((tab) => tab.url === urls.savedOnly),
    'Saved-only identity unexpectedly opened a live tab', state.fixtureTabs);
  assert(state.fixtureGroups.length === 1, 'Expected exactly one restored Chrome group', state.fixtureGroups);
  assert(state.fixtureGroups[0].title === GROUP_PHYSICAL_TITLE && state.fixtureGroups[0].color === 'blue',
    'Chrome group presentation was not restored', state.fixtureGroups[0]);

  const currentGroupId = Number(state.fixtureGroups[0].id);
  const groupedTabs = state.fixtureTabs.filter((tab) => tab.groupId === currentGroupId);
  const ungroupedTabs = state.fixtureTabs.filter((tab) => tab.groupId === -1);
  assert(groupedTabs.length === 3 && ungroupedTabs.length === 1,
    'Grouped and persistent Ungrouped membership changed', state.fixtureTabs);
  assert(state.liveMaps.groupSpaces[String(currentGroupId)] === SPACE_ID,
    'Restored Chrome group was not rebound to the Space', state.liveMaps.groupSpaces);
  assert(Object.keys(state.liveMaps.groupSpaces).length === 1,
    'Stale Chrome group ownership survived restart', state.liveMaps.groupSpaces);
  assert(state.liveMaps.tabSpaces[String(ungroupedTabs[0].id)] === SPACE_ID,
    'Persistent Ungrouped tab was not rebound to the Space', state.liveMaps.tabSpaces);

  const lifecycleEntries = Object.entries(state.liveMaps.tabLifecycle);
  assert(lifecycleEntries.length === 4, 'Stable lifecycle bindings were lost or duplicated', lifecycleEntries);
  assert(lifecycleEntries.every(([, binding]) => binding.sessionId === state.browserSessionId),
    'A lifecycle binding retained the previous browser session', lifecycleEntries);
  const liveStableIds = sorted(lifecycleEntries.map(([, binding]) => binding.snapshotTabId));
  assert(JSON.stringify(liveStableIds) === JSON.stringify(sorted([
    SNAPSHOT_IDS.unique,
    SNAPSHOT_IDS.duplicateA,
    SNAPSHOT_IDS.duplicateB,
    SNAPSHOT_IDS.ungrouped,
  ])), 'Restored live tabs did not rebind one-to-one to stable identities', lifecycleEntries);

  const uniqueBinding = lifecycleEntries.find(([, binding]) => binding.snapshotTabId === SNAPSHOT_IDS.unique);
  assert(Boolean(uniqueBinding), 'Unique renamed tab lost its stable lifecycle identity', lifecycleEntries);
  assert(state.liveMaps.renamedTabs[uniqueBinding[0]] === PANEL_ALIAS,
    'Panel-only rename was not restored to the unique live tab', state.liveMaps.renamedTabs);
  assert(Object.keys(state.liveMaps.renamedTabs).length === 1,
    'A panel-only rename was guessed for a duplicate URL tab', state.liveMaps.renamedTabs);

  assert(state.rows.length === 5, 'DOM contains duplicate or missing stable rows', state.rows);
  const rowIdentityCounts = Object.fromEntries(Object.values(SNAPSHOT_IDS)
    .filter((id) => id.startsWith('tab:'))
    .map((id) => [id, state.rows.filter((row) => row.snapshotTabId === id).length]));
  assert(Object.values(rowIdentityCounts).every((count) => count === 1),
    'A stable row identity did not render exactly once', rowIdentityCounts);
  const uniqueRow = state.rows.find((row) => row.snapshotTabId === SNAPSHOT_IDS.unique);
  const duplicateRows = state.rows.filter((row) => [
    SNAPSHOT_IDS.duplicateA,
    SNAPSHOT_IDS.duplicateB,
  ].includes(row.snapshotTabId));
  const ungroupedRow = state.rows.find((row) => row.snapshotTabId === SNAPSHOT_IDS.ungrouped);
  const savedRow = state.rows.find((row) => row.snapshotTabId === SNAPSHOT_IDS.saved);
  assert(uniqueRow && !uniqueRow.dormant && uniqueRow.title === PANEL_ALIAS &&
    uniqueRow.groupTitle === GROUP_LOGICAL_TITLE,
  'Logical group title or panel alias was not rendered exactly', uniqueRow);
  assert(duplicateRows.length === 2 && duplicateRows.every((row) => !row.dormant),
    'Duplicate URL stable rows did not remain two live rows', duplicateRows);
  assert(ungroupedRow && !ungroupedRow.dormant && ungroupedRow.groupTitle === 'Ungrouped',
    'Persistent Ungrouped row was not restored live', ungroupedRow);
  assert(savedRow && savedRow.dormant && savedRow.title === 'Saved-only exact alias',
    'Saved-only stable identity did not remain one dormant row', savedRow);

  if (previousIds) {
    assert(state.browserSessionId && state.browserSessionId === state.sessionBrowserId &&
      state.browserSessionId !== BEFORE_SESSION_ID,
    'Browser session identity did not rotate after full Chrome restart', {
      before: BEFORE_SESSION_ID,
      state: state.browserSessionId,
      session: state.sessionBrowserId,
    });
    assert(!state.hasSecret && state.sessionKey === '',
      'Session-only API key survived full Chrome restart', state);
    const activeSpaceIds = state.windowState?.activeSpaceIds || {};
    assert(Object.keys(activeSpaceIds).length === 1 && activeSpaceIds[String(state.currentWindowId)] === SPACE_ID,
      'Window binding was not rebuilt solely for the current Chrome window', activeSpaceIds);
    const currentTabIds = new Set(state.fixtureTabs.map((tab) => Number(tab.id)));
    const staleTabIds = previousIds.tabIds.filter((tabId) => !currentTabIds.has(Number(tabId)));
    for (const staleTabId of staleTabIds) {
      for (const [mapName, map] of Object.entries({
        tabSpaces: state.liveMaps.tabSpaces,
        renamedTabs: state.liveMaps.renamedTabs,
        tabLifecycle: state.liveMaps.tabLifecycle,
      })) {
        assert(!Object.hasOwn(map, String(staleTabId)),
          `Stale pre-restart tab id survived in ${mapName}`, { staleTabId, map });
      }
    }
    if (Number(previousIds.groupId) !== currentGroupId) {
      assert(!Object.hasOwn(state.liveMaps.groupSpaces, String(previousIds.groupId)),
        'Stale pre-restart group id survived', state.liveMaps.groupSpaces);
      assert(!(state.liveMaps.groupOrder[SPACE_ID] || []).includes(`group:${previousIds.groupId}`),
        'Stale pre-restart group id survived in group order', state.liveMaps.groupOrder);
    }
  }
}

async function main() {
  const progress = (message) => process.stderr.write(`[e2e:restart] ${message}\n`);
  const executable = await findChromeExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), 'space-extension-restart-profile-'));
  const extensionFixture = await createExtensionFixture();
  const fixtureServer = await startFixtureServer();
  const expectedPortable = expectedPortableProjection(fixtureServer.urls);
  let chrome = null;
  let client = null;
  let firstChromeStopped = false;
  let extensionId = '';
  let probe = null;
  let workbench = null;

  try {
    progress('starting the first Chrome process with a caller-owned profile');
    chrome = await startChromeWithProfile({ executable, userDataDir });
    client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
    ({ id: extensionId } = await client.send('Extensions.loadUnpacked', { path: extensionFixture }));
    const probeUrl = `chrome-extension://${extensionId}/e2e-probe.html`;
    const workbenchUrl = `chrome-extension://${extensionId}/sidepanel.html?layout=workbench`;
    probe = await attachPage(client, probeUrl);

    progress('creating grouped, duplicate-URL, persistent Ungrouped, and saved-only identities');
    const fixture = await evaluate(client, probe.sessionId, `(async () => {
      const urls = ${JSON.stringify(fixtureServer.urls)};
      const window = await chrome.windows.getCurrent();
      const created = [];
      for (const url of [urls.unique, urls.duplicate, urls.duplicate, urls.ungrouped]) {
        created.push(await chrome.tabs.create({ url, active: false, windowId: window.id }));
      }
      const startedAt = Date.now();
      let tabs = [];
      while (Date.now() - startedAt < 15000) {
        tabs = await Promise.all(created.map((tab) => chrome.tabs.get(tab.id).catch(() => null)));
        if (tabs.every((tab) => tab?.status === 'complete')) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!tabs.every((tab) => tab?.status === 'complete')) {
        throw new Error('Restart fixture pages did not finish loading.');
      }
      const groupId = await chrome.tabs.group({
        tabIds: tabs.slice(0, 3).map((tab) => tab.id),
        createProperties: { windowId: window.id },
      });
      await chrome.tabGroups.update(groupId, {
        title: ${JSON.stringify(GROUP_PHYSICAL_TITLE)},
        color: 'blue',
        collapsed: false,
      });
      tabs = await Promise.all(tabs.map((tab) => chrome.tabs.get(tab.id)));
      const [unique, duplicateA, duplicateB, ungrouped] = tabs;
      const state = ${JSON.stringify(fixtureStateTemplate())};
      state.groupSpaces = { [String(groupId)]: ${JSON.stringify(SPACE_ID)} };
      state.tabSpaces = { [String(ungrouped.id)]: ${JSON.stringify(SPACE_ID)} };
      state.renamedTabs = { [String(unique.id)]: ${JSON.stringify(PANEL_ALIAS)} };
      state.groupOrder = {
        [${JSON.stringify(SPACE_ID)}]: [
          'group:' + groupId,
          'snapshot:1:${SPACE_ID}:${SNAPSHOT_IDS.savedGroup}',
          'ungrouped',
        ],
      };
      state.tabOrder = {
        [${JSON.stringify(SPACE_ID)}]: {
          ['group:' + groupId]: [unique.id, duplicateA.id, duplicateB.id],
          ungrouped: [ungrouped.id],
        },
      };
      state.spaceSnapshots = {
        [${JSON.stringify(SPACE_ID)}]: {
          version: 1,
          identityVersion: 1,
          preserveGroups: true,
          updatedAt: Date.now(),
          groups: [
            {
              snapshotGroupId: ${JSON.stringify(SNAPSHOT_IDS.group)},
              title: ${JSON.stringify(GROUP_LOGICAL_TITLE)},
              color: 'blue',
              collapsed: false,
              tabs: [
                {
                  snapshotTabId: ${JSON.stringify(SNAPSHOT_IDS.unique)},
                  title: unique.title,
                  panelTitle: ${JSON.stringify(PANEL_ALIAS)},
                  url: urls.unique,
                },
                {
                  snapshotTabId: ${JSON.stringify(SNAPSHOT_IDS.duplicateA)},
                  title: duplicateA.title,
                  url: urls.duplicate,
                },
                {
                  snapshotTabId: ${JSON.stringify(SNAPSHOT_IDS.duplicateB)},
                  title: duplicateB.title,
                  url: urls.duplicate,
                },
              ],
            },
            {
              snapshotGroupId: ${JSON.stringify(SNAPSHOT_IDS.savedGroup)},
              title: 'Saved Only',
              color: 'orange',
              collapsed: false,
              tabs: [{
                snapshotTabId: ${JSON.stringify(SNAPSHOT_IDS.saved)},
                title: 'Restart Saved-only Page',
                panelTitle: 'Saved-only exact alias',
                url: urls.savedOnly,
              }],
            },
            {
              snapshotGroupId: ${JSON.stringify(SNAPSHOT_IDS.ungroupedGroup)},
              title: 'Ungrouped',
              color: 'grey',
              collapsed: false,
              restorable: true,
              tabs: [{
                snapshotTabId: ${JSON.stringify(SNAPSHOT_IDS.ungrouped)},
                title: ungrouped.title,
                url: urls.ungrouped,
              }],
            },
          ],
        },
      };
      const binding = (tab, snapshotGroupId, snapshotTabId, panelTitle = '') => ({
        tabId: tab.id,
        snapshotGroupId,
        snapshotTabId,
        spaceId: ${JSON.stringify(SPACE_ID)},
        url: tab.url,
        title: tab.title,
        ...(panelTitle ? { panelTitle } : {}),
        windowId: tab.windowId,
        groupId: tab.groupId,
        index: tab.index,
        pinned: false,
        trackingMode: 'live',
        sessionId: ${JSON.stringify(BEFORE_SESSION_ID)},
      });
      state.tabLifecycle = {
        [String(unique.id)]: binding(unique, ${JSON.stringify(SNAPSHOT_IDS.group)}, ${JSON.stringify(SNAPSHOT_IDS.unique)}, ${JSON.stringify(PANEL_ALIAS)}),
        [String(duplicateA.id)]: binding(duplicateA, ${JSON.stringify(SNAPSHOT_IDS.group)}, ${JSON.stringify(SNAPSHOT_IDS.duplicateA)}),
        [String(duplicateB.id)]: binding(duplicateB, ${JSON.stringify(SNAPSHOT_IDS.group)}, ${JSON.stringify(SNAPSHOT_IDS.duplicateB)}),
        [String(ungrouped.id)]: binding(ungrouped, ${JSON.stringify(SNAPSHOT_IDS.ungroupedGroup)}, ${JSON.stringify(SNAPSHOT_IDS.ungrouped)}),
      };
      await chrome.storage.local.set({ spaceTabsState: state });
      await chrome.storage.session.set({
        spaceTabsBrowserSession: ${JSON.stringify(BEFORE_SESSION_ID)},
        spaceTabsWindowState: { activeSpaceIds: { [String(window.id)]: ${JSON.stringify(SPACE_ID)} } },
        spaceTabsSecrets: {
          ai: {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            apiKey: ${JSON.stringify(SESSION_KEY_SENTINEL)},
          },
        },
      });
      return {
        windowId: window.id,
        groupId,
        tabIds: tabs.map((tab) => tab.id),
      };
    })()`);

    workbench = await attachPage(client, workbenchUrl);
    await expandSavedOnlyGroup(client, workbench.sessionId);
    const baseline = await waitFor(
      client,
      workbench.sessionId,
      `(async () => {
        const captured = await (${panelStateExpression(fixtureServer.urls)});
        return captured.ready && captured.pendingLifecycleKeys.length === 0 ? captured : null;
      })()`,
      20000,
    );
    assertPanelState({ state: baseline, fixture, urls: fixtureServer.urls, expectedPortable });
    assert(baseline.browserSessionId === BEFORE_SESSION_ID &&
      baseline.sessionBrowserId === BEFORE_SESSION_ID,
    'First process did not use the seeded browser session identity', baseline);
    assert(baseline.hasSecret && baseline.sessionKey === SESSION_KEY_SENTINEL,
      'First process did not retain the session-only API key fixture', baseline);
    assert(baseline.windowState?.activeSpaceIds?.[String(fixture.windowId)] === SPACE_ID,
      'First process did not retain its window binding fixture', baseline.windowState);

    progress('closing extension pages and fully exiting the first Chrome process');
    await closeTarget(client, workbench.targetId);
    await closeTarget(client, probe.targetId);
    workbench = null;
    probe = null;
    await stopChromeGracefully(client, chrome);
    firstChromeStopped = true;
    chrome = null;
    client = null;

    progress('starting a second Chrome process with the same profile and extension fixture');
    chrome = await startChromeWithProfile({ executable, userDataDir, restoreLastSession: true });
    client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
    const reloadedExtension = await client.send('Extensions.loadUnpacked', { path: extensionFixture });
    assert(reloadedExtension.id === extensionId,
      'Reloading the same unpacked fixture changed its extension id', reloadedExtension);
    probe = await attachPage(client, probeUrl);

    const prePanelRestart = await evaluate(client, probe.sessionId, `(async () => {
      const [session, stored, tabs] = await Promise.all([
        chrome.storage.session.get(null),
        chrome.storage.local.get('spaceTabsState'),
        chrome.tabs.query({}),
      ]);
      return {
        runtimeId: chrome.runtime.id,
        hasSecret: Object.hasOwn(session, 'spaceTabsSecrets'),
        hasWindowState: Object.hasOwn(session, 'spaceTabsWindowState'),
        sessionBrowserId: session.spaceTabsBrowserSession || '',
        portable: (${portableProjectionExpression()})(stored.spaceTabsState || {}),
        fixtureUrls: tabs.map((tab) => tab.url || tab.pendingUrl || '')
          .filter((url) => Object.values(${JSON.stringify(fixtureServer.urls)}).includes(url)),
      };
    })()`);
    assert(prePanelRestart.runtimeId === extensionId,
      'The same unpacked extension fixture did not reopen with its original id', prePanelRestart);
    assert(!prePanelRestart.hasSecret && !prePanelRestart.hasWindowState,
      'Session API key or window binding survived before the app reopened', prePanelRestart);
    assert(prePanelRestart.sessionBrowserId !== BEFORE_SESSION_ID,
      'The old browser session id survived full Chrome exit', prePanelRestart);
    assert(JSON.stringify(prePanelRestart.portable) === JSON.stringify(expectedPortable),
      'Portable state changed before the app reopened', prePanelRestart.portable);
    assert(prePanelRestart.fixtureUrls.filter((url) => url === fixtureServer.urls.unique).length === 1 &&
      prePanelRestart.fixtureUrls.filter((url) => url === fixtureServer.urls.duplicate).length === 2 &&
      prePanelRestart.fixtureUrls.filter((url) => url === fixtureServer.urls.ungrouped).length === 1 &&
      !prePanelRestart.fixtureUrls.includes(fixtureServer.urls.savedOnly),
    'Chrome did not restore the expected live fixture set', prePanelRestart.fixtureUrls);

    workbench = await attachPage(client, workbenchUrl);
    await expandSavedOnlyGroup(client, workbench.sessionId);
    const restarted = await waitFor(
      client,
      workbench.sessionId,
      `(async () => {
        const captured = await (${panelStateExpression(fixtureServer.urls)});
        return captured.ready && captured.pendingLifecycleKeys.length === 0 &&
          captured.browserSessionId &&
          captured.browserSessionId !== ${JSON.stringify(BEFORE_SESSION_ID)} &&
          JSON.stringify(captured.portable) === ${JSON.stringify(JSON.stringify(expectedPortable))}
          ? captured : null;
      })()`,
      30000,
    );
    assertPanelState({
      state: restarted,
      fixture,
      urls: fixtureServer.urls,
      expectedPortable,
      previousIds: fixture,
    });

    await client.send('Page.reload', {}, workbench.sessionId);
    await waitFor(client, workbench.sessionId, `document.readyState === 'complete'`, 10000);
    await expandSavedOnlyGroup(client, workbench.sessionId);
    const reloaded = await waitFor(
      client,
      workbench.sessionId,
      `(async () => {
        if (document.readyState !== 'complete') return null;
        const captured = await (${panelStateExpression(fixtureServer.urls)});
        return captured.ready && captured.pendingLifecycleKeys.length === 0 &&
          JSON.stringify(captured.portable) === ${JSON.stringify(JSON.stringify(expectedPortable))}
          ? captured : null;
      })()`,
      20000,
    );
    assertPanelState({
      state: reloaded,
      fixture,
      urls: fixtureServer.urls,
      expectedPortable,
      previousIds: fixture,
    });
    assert(reloaded.browserSessionId === restarted.browserSessionId,
      'A panel reload incorrectly rotated the browser session id', {
        beforeReload: restarted.browserSessionId,
        afterReload: reloaded.browserSessionId,
      });

    progress('same-profile full Chrome restart recovery passed');
    console.log(JSON.stringify({
      mode: 'real-extension-full-restart',
      extensionId,
      summary: { passed: 1, failed: 0, total: 1 },
      result: {
        name: 'Full Chrome restart restores portable identity and clears session bindings',
        ok: true,
      },
    }, null, 2));
  } finally {
    await closeTarget(client, workbench?.targetId).catch(() => null);
    await closeTarget(client, probe?.targetId).catch(() => null);
    if (chrome && !chrome.exitRecord) {
      if (firstChromeStopped) await stopChromeGracefully(client, chrome).catch(() => null);
      else {
        chrome.child.kill('SIGTERM');
        await chrome.exited.catch(() => null);
        client?.close();
      }
    }
    await fixtureServer.close().catch(() => null);
    await rm(extensionFixture, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
