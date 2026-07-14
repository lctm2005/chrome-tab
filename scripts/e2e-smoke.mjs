import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArcImportPlan } from '../src/shared/arc-import.js';

const port = Number(process.env.CDP_PORT || 9223);
const extensionId = process.env.EXT_ID || 'fignfifoniblkonapihmkfakmlgkbkcf';
const preview = process.env.PREVIEW !== '0';
const previewPort = Number(process.env.PREVIEW_PORT || 8765);
const arcImportFile = process.env.ARC_IMPORT_FILE || '';
const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const base = `http://127.0.0.1:${port}`;
const autoChrome = process.env.E2E_AUTO_CHROME !== '0';
const sidepanelUrl = preview
  ? (process.env.PREVIEW_URL || `http://127.0.0.1:${previewPort}/sidepanel.html`)
  : `chrome-extension://${extensionId}/sidepanel.html`;
const dormantSwitchMutationCommands = [
  'tabs:create',
  'tabs:focus',
  'tabs:discard',
  'tabs:close',
  'tabs:group',
  'tabs:ungroup',
  'tabs:groupExisting',
  'tabs:move',
  'groups:move',
  'groups:update',
];
const carrierMutationCommands = ['tabs:create', 'tabs:close'];

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
      if (pathname === '/config.local.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end('window.SPACE_TABS_CONFIG = {};');
        return;
      }
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
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
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
    throw new Error(`${error.message}${stderr ? `\nChrome stderr:\n${stderr}` : ''}`);
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

async function waitForCdp(timeoutMs = 20000) {
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
    await client.send('Page.navigate', { url: sidepanelUrl });
    await waitFor(client, `location.href === ${JSON.stringify(sidepanelUrl)}`);

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
      sessionStorage.clear();
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
        model: 'glm-5.2',
        apiKey: '',
        thinking: 'disabled',
        language: 'zh-CN',
        temperature: 0.6,
      },
    };
    state.spaces = [
      { id: 'default', name: 'Default', icon: 'D', color: 'blue' },
      { id: 'folder-demo', name: 'Folder Demo', icon: 'F', color: 'green' },
      { id: 'dormant-demo', name: 'Dormant Demo', icon: 'D', color: 'purple' },
      { id: 'drag-demo', name: 'Drag Demo', icon: 'R', color: 'pink' },
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
          { title: 'Untitled' },
          { title: 'New Tab', url: 'chrome://newtab' },
        ],
      }],
    };
    state.spaceSnapshots['drag-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [
        {
          title: 'Alpha',
          color: 'blue',
          collapsed: true,
          tabs: [{ title: 'Alpha Tab', url: 'https://example.com/alpha' }],
        },
        {
          title: 'Beta',
          color: 'green',
          collapsed: true,
          tabs: [{ title: 'Beta Tab', url: 'https://example.com/beta' }],
        },
        {
          title: 'Gamma',
          color: 'purple',
          collapsed: true,
          tabs: [{ title: 'Gamma Tab', url: 'https://example.com/gamma' }],
        },
      ],
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
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default' && document.querySelector('.add-space')`);
    record('cold boot renders default Space', true);

    if (arcImportFile) {
      const arcImportText = await readFile(arcImportFile, 'utf8');
      const existingSpaces = await evaluate(client, `(() => {
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        return stored.spaces || [];
      })()`);
      const arcPlan = createArcImportPlan(arcImportText, { existingSpaces, now: 1779000000000 });
      await evaluate(client, `(() => {
        const STORAGE_KEY = 'spaceTabsState';
        const plan = ${JSON.stringify(arcPlan)};
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').spaceTabsState || {};
        stored.spaces = [...(stored.spaces || []), ...plan.spaces];
        stored.spaceSnapshots = { ...(stored.spaceSnapshots || {}), ...(plan.spaceSnapshots || {}) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: stored }));
        location.reload();
        return true;
      })()`);
      await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
      for (const space of arcPlan.spaces) {
        await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
        await evaluate(client, `(() => {
          const title = ${JSON.stringify(space.name)};
          const button = [...document.querySelectorAll('.space')]
            .find((node) => node.title === title);
          button?.click();
          return Boolean(button);
        })()`);
        const arcSwitchState = await waitFor(client, `(() => {
          const title = ${JSON.stringify(space.name)};
          if (document.querySelector('#activeSpaceName')?.textContent !== title) return null;
          const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
          const snapshot = stored.spaceSnapshots?.[${JSON.stringify(space.id)}] || null;
          const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
            text: row.textContent,
            dormant: row.classList.contains('dormant'),
          }));
          const visibleGroupLabels = [
            ...[...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
            ...[...document.querySelectorAll('.folder-header strong')].map((node) => node.textContent),
          ];
          const mutationCommands = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
          const chromeMutations = (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
            .filter((command) => mutationCommands.has(command.type));
          return {
            activeSpaceId: stored.activeSpaceId,
            rows: rows.length,
            dormantRows: rows.filter((row) => row.dormant).length,
            visibleGroupLabels,
            snapshotGroups: (snapshot?.groups || []).length,
            snapshotTabs: (snapshot?.groups || []).reduce((sum, group) => sum + (group.tabs || []).length, 0),
            ephemeralTabIds: stored.ephemeralTabIds || [],
            chromeMutations,
            leakedPlaceholders: rows
              .map((row) => row.text)
              .filter((text) => /Untitled|New Tab/i.test(text)),
          };
        })()`);
        const hasSnapshotTabs = arcSwitchState.snapshotTabs > 0;
        record(
          `Arc imported Space activates: ${space.name}`,
          arcSwitchState.activeSpaceId === space.id &&
            (hasSnapshotTabs
              ? arcSwitchState.visibleGroupLabels.length > 0 &&
                arcSwitchState.leakedPlaceholders.length === 0 &&
                arcSwitchState.ephemeralTabIds.length === 0 &&
                arcSwitchState.chromeMutations.length === 0
              : arcSwitchState.rows === 0 &&
                arcSwitchState.dormantRows === 0 &&
                arcSwitchState.ephemeralTabIds.length === 0 &&
                arcSwitchState.chromeMutations.length === 0 &&
                arcSwitchState.leakedPlaceholders.length === 0),
          JSON.stringify(arcSwitchState)
        );
      }
      await evaluate(client, `(() => {
        const button = [...document.querySelectorAll('.space')]
          .find((node) => node.title === 'Default');
        button.click();
        return true;
      })()`);
      await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
    }

  await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
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
  const newEmptySpaceState = await waitFor(client, `(() => {
    if (document.querySelector('#activeSpaceName')?.textContent !== 'E2E Space') return null;
    const mutationCommands = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
    return {
      rows: document.querySelectorAll('.tab-row').length,
      chromeMutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => mutationCommands.has(command.type)),
    };
  })()`);
  record(
    'add Space dialog activates a new Space with a fallback tab and closes previous Space tags',
    newEmptySpaceState.rows === 1 &&
      newEmptySpaceState.chromeMutations.some((command) => command.type === 'tabs:create') &&
      newEmptySpaceState.chromeMutations.some((command) => command.type === 'tabs:close'),
    JSON.stringify(newEmptySpaceState)
  );

  await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    buttons.find((button) => button.title === 'Default').click();
    return true;
  })()`);
  const emptySpaceSwitchState = await waitFor(client, `(() => {
    if (document.querySelector('#activeSpaceName')?.textContent !== 'Default') return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const rows = [...document.querySelectorAll('.tab-row')].map((row) => row.textContent);
    const carrierMutations = new Set(${JSON.stringify(carrierMutationCommands)});
    return {
      rows,
      ephemeralTabIds: stored.ephemeralTabIds || [],
      defaultSnapshotGroups: (stored.spaceSnapshots?.default?.groups || []).map((group) => group.title),
      e2eSnapshot: stored.spaceSnapshots?.['e2e-space'] || null,
      carrierMutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => carrierMutations.has(command.type)),
    };
  })()`);
  record(
    'switching away from a brand-new Space reuses its fallback tab for the target Space',
    emptySpaceSwitchState.ephemeralTabIds.length === 1 &&
      ['Research', 'Build', 'Inbox'].every((title) => emptySpaceSwitchState.defaultSnapshotGroups.includes(title)) &&
      !emptySpaceSwitchState.e2eSnapshot &&
      emptySpaceSwitchState.carrierMutations.length === 0 &&
      !emptySpaceSwitchState.rows.some((text) => /Untitled|New Tab/i.test(text)),
    JSON.stringify(emptySpaceSwitchState)
  );

  await evaluate(client, `document.querySelector('.new-tab-row').click()`);
  await waitFor(client, `document.querySelectorAll('.tab-row').length >= 1`);
  const newTabRows = await evaluate(client, `document.querySelectorAll('.tab-row').length`);
  record('New Tab row creates a tab owned by active Space', newTabRows >= 1, `${newTabRows} rows`);

  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `document.querySelector('#groupsList')?.classList.contains('groups-collapsed')`);
  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `!document.querySelector('#groupsList')?.classList.contains('groups-collapsed')`);
  record('Space collapse toggle hides and restores group content', true);

  const settingsUrl = new URL(sidepanelUrl);
  settingsUrl.searchParams.set('layout', 'workbench');
  settingsUrl.searchParams.set('view', 'settings');
  await client.send('Page.navigate', { url: settingsUrl.toString() });
  await waitFor(client, `document.documentElement.dataset.layout === 'workbench' && document.querySelector('#settingsDialog')?.open`);
  const settingsState = await evaluate(client, `(() => ({
    api: document.querySelector('#apiKeyStatus')?.textContent,
    exportBackup: Boolean(document.querySelector('#exportSpaceDataButton')),
    restoreBackup: Boolean(document.querySelector('#restoreSpaceDataButton')),
    workbench: document.documentElement.dataset.layout === 'workbench',
    inShell: document.querySelector('#settingsDialog')?.parentElement?.classList.contains('shell'),
    position: getComputedStyle(document.querySelector('#settingsDialog')).position,
  }))()`);
  record(
    'Workbench Settings uses the full page with local backup controls',
    settingsState.api === 'No API key configured.'
      && settingsState.exportBackup
      && settingsState.restoreBackup
      && settingsState.workbench
      && settingsState.inShell
      && settingsState.position === 'static',
    JSON.stringify(settingsState),
  );
  await evaluate(client, `(() => {
    const input = document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]');
    input.dataset.shortcut = 'Control+Alt+K';
    input.value = 'Ctrl + Alt + K';
    document.querySelector('#saveSettingsButton').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#workbenchToast')?.textContent === 'Settings saved.' && !document.querySelector('#workbenchToast')?.hidden`);
  const toastState = await evaluate(client, `(() => {
    const toast = document.querySelector('#workbenchToast');
    const rect = toast.getBoundingClientRect();
    const style = getComputedStyle(toast);
    return {
      tone: toast.dataset.tone,
      top: rect.top,
      centerDelta: Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2),
      fontSize: parseFloat(style.fontSize),
      width: rect.width,
    };
  })()`);
  record(
    'Workbench Save feedback is prominent and top centered',
    toastState.tone === 'success' && toastState.top <= 24 && toastState.centerDelta <= 2 &&
      toastState.fontSize >= 13 && toastState.width >= 280,
    JSON.stringify(toastState),
  );
  await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
  }))`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'New Space'`);
  record('saved Workbench shortcuts apply immediately and Save shows visible feedback', true);
  await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);
  await client.send('Page.navigate', { url: sidepanelUrl });
  await waitFor(client, `location.href === ${JSON.stringify(sidepanelUrl)} && document.querySelector('#activeSpaceName')?.textContent === 'Default' && document.querySelector('.ask-space')`);

  await evaluate(client, `document.querySelector('.ask-space').click()`);
  await waitFor(client, `!document.querySelector('#askPageView')?.hidden`);
  const askSpaceState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    if (stored.activeAskSessionKey !== 'space:default') return null;
    return {
      key: stored.activeAskSessionKey,
      scope: document.querySelector('#askScope')?.textContent || '',
      spaceId: stored.askSessions?.['space:default']?.spaceId || '',
    };
  })()`);
  record(
    'Ask Space uses one conversation session for the active Space',
    askSpaceState.key === 'space:default' && askSpaceState.spaceId === 'default' && !askSpaceState.scope.includes('Context'),
    JSON.stringify(askSpaceState),
  );

  await evaluate(client, `(() => {
    [...document.querySelectorAll('.space')].find((button) => button.title === 'Default')?.click();
    return true;
  })()`);
  await waitFor(client, `!document.querySelector('#groupsList')?.hidden`);

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
    const workHeader = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    workHeader.click();
    return true;
  })()`);
  const collapsedFolderState = await waitFor(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    if (!workSection?.classList.contains('collapsed')) return null;
    return {
      collapsed: workSection.classList.contains('collapsed'),
      expanded: workSection.querySelector(':scope > .folder-header')?.getAttribute('aria-expanded'),
      childFolders: workSection.querySelectorAll(':scope > .folder-children > .folder-section').length,
      groupHeaders: [...workSection.querySelectorAll(':scope > .folder-children .group-header h2')]
        .map((node) => node.textContent),
    };
  })()`);
  record(
    'folder collapse click updates nested folder DOM',
    collapsedFolderState.collapsed &&
      collapsedFolderState.expanded === 'false' &&
      collapsedFolderState.childFolders === 0 &&
      collapsedFolderState.groupHeaders.length === 0,
    JSON.stringify(collapsedFolderState)
  );

  await evaluate(client, `(() => {
    const workHeader = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    workHeader.click();
    return true;
  })()`);
  const expandedFolderState = await waitFor(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    if (!workSection || workSection.classList.contains('collapsed')) return null;
    return {
      expanded: workSection.querySelector(':scope > .folder-header')?.getAttribute('aria-expanded'),
      folders: [...workSection.querySelectorAll('.folder-header strong')].map((node) => node.textContent),
      groupHeaders: [...workSection.querySelectorAll('.group-header h2')].map((node) => node.textContent),
    };
  })()`);
  record(
    'folder expand click restores nested folder DOM',
    expandedFolderState.expanded === 'true' &&
      expandedFolderState.folders.includes('Client') &&
      expandedFolderState.groupHeaders.includes('Docs'),
    JSON.stringify(expandedFolderState)
  );
  const dormantGroupContextMenuState = await evaluate(client, `(() => {
    const header = [...document.querySelectorAll('.group-header')]
      .find((node) => node.querySelector('h2')?.textContent === 'Docs');
    const rect = header.getBoundingClientRect();
    const x = Math.round(rect.left + Math.min(24, Math.max(1, rect.width / 2)));
    const y = Math.round(rect.top + Math.max(1, rect.height / 2));
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: x,
      clientY: y,
    });
    const mouseDownResult = header.dispatchEvent(mouseDown);
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: x,
      clientY: y,
    });
    const dispatchResult = header.dispatchEvent(event);
    const menu = document.querySelector('#contextMenu');
    return {
      mouseDownPrevented: mouseDown.defaultPrevented || mouseDownResult === false,
      prevented: event.defaultPrevented || dispatchResult === false,
      menuHidden: menu?.hidden,
      menuText: menu?.textContent || '',
    };
  })()`);
  record(
    'dormant imported group right-click opens custom menu',
    dormantGroupContextMenuState.mouseDownPrevented &&
      dormantGroupContextMenuState.prevented &&
      dormantGroupContextMenuState.menuHidden === false &&
      dormantGroupContextMenuState.menuText.includes('Rename'),
    JSON.stringify(dormantGroupContextMenuState)
  );
  await evaluate(client, `document.body.click()`);
  const folderContextMenuState = await evaluate(client, `(() => {
    const header = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 24,
      clientY: 24,
    });
    const mouseDownResult = header.dispatchEvent(mouseDown);
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 24,
      clientY: 24,
    });
    const dispatchResult = header.dispatchEvent(event);
    const menu = document.querySelector('#contextMenu');
    return {
      mouseDownPrevented: mouseDown.defaultPrevented || mouseDownResult === false,
      prevented: event.defaultPrevented || dispatchResult === false,
      menuHidden: menu?.hidden,
      menuText: menu?.textContent || '',
    };
  })()`);
  record(
    'folder header right-click opens custom menu and suppresses Chrome menu',
    folderContextMenuState.mouseDownPrevented &&
      folderContextMenuState.prevented &&
      folderContextMenuState.menuHidden === false &&
      folderContextMenuState.menuText.includes('Rename'),
    JSON.stringify(folderContextMenuState)
  );

  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const space = buttons.find((button) => button.title === 'Default');
    space.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
  await waitFor(client, `(() => {
    const headers = [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent);
    return headers.includes('Research') && headers.includes('Build') && headers.includes('Inbox');
  })()`);
  const groupContextMenuState = await evaluate(client, `(() => {
    return [...document.querySelectorAll('.group-header')].map((header, index) => {
      const rect = header.getBoundingClientRect();
      const x = Math.round(rect.left + Math.min(24, Math.max(1, rect.width / 2)));
      const y = Math.round(rect.top + Math.max(1, rect.height / 2));
      const mouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: x,
        clientY: y,
      });
      const mouseDownResult = header.dispatchEvent(mouseDown);
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: x,
        clientY: y,
      });
      const dispatchResult = header.dispatchEvent(event);
      const menu = document.querySelector('#contextMenu');
      const result = {
        index,
        title: header.querySelector('h2')?.textContent || '',
        mouseDownPrevented: mouseDown.defaultPrevented || mouseDownResult === false,
        prevented: event.defaultPrevented || dispatchResult === false,
        menuHidden: menu?.hidden,
        menuText: menu?.textContent || '',
      };
      document.body.click();
      return result;
    });
  })()`);
  record(
    'all group header right-clicks open custom menu and suppress Chrome menu',
    groupContextMenuState.length >= 3 &&
      groupContextMenuState.every((item) => (
        item.mouseDownPrevented &&
        item.prevented &&
        item.menuHidden === false &&
        item.menuText.includes('Rename')
      )),
    JSON.stringify(groupContextMenuState)
  );
  await evaluate(client, `document.body.click()`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    buttons.find((button) => button.title === 'Drag Demo').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drag Demo'`);
  const dormantDragSetup = await waitFor(client, `(() => {
    const headers = [...document.querySelectorAll('.group-header')].map((header) => ({
      title: header.querySelector('h2')?.textContent || '',
      draggable: header.draggable,
    }));
    return headers.some((header) => header.title === 'Alpha') &&
      headers.some((header) => header.title === 'Beta') &&
      headers.some((header) => header.title === 'Gamma')
      ? headers
      : null;
  })()`);
  record(
    'dormant imported groups expose group dragging',
    dormantDragSetup
      .filter((header) => ['Alpha', 'Beta', 'Gamma'].includes(header.title))
      .every((header) => header.draggable),
    JSON.stringify(dormantDragSetup)
  );
  await evaluate(client, `(() => {
    function headerForTitle(title) {
      return [...document.querySelectorAll('.group-header')]
        .find((header) => header.querySelector('h2')?.textContent === title);
    }
    function dragGroup(sourceTitle, targetTitle, ratio) {
      const source = headerForTitle(sourceTitle);
      const target = headerForTitle(targetTitle);
      const dataTransfer = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
      const clientY = Math.round(rect.top + Math.max(1, rect.height * ratio));
      source.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX,
        clientY,
      }));
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX,
        clientY,
      }));
      target.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX,
        clientY,
      }));
      source.dispatchEvent(new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX,
        clientY,
      }));
    }
    dragGroup('Beta', 'Alpha', 0.1);
    return true;
  })()`);
  const dormantSortState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const titles = (stored.spaceSnapshots?.['drag-demo']?.groups || []).map((group) => group.title);
    return titles[0] === 'Beta' ? { titles } : null;
  })()`);
  record(
    'dormant imported groups can be drag-sorted',
    dormantSortState.titles.join(' > ') === 'Beta > Alpha > Gamma',
    JSON.stringify(dormantSortState)
  );
  await evaluate(client, `(() => {
    function headerForTitle(title) {
      return [...document.querySelectorAll('.group-header')]
        .find((header) => header.querySelector('h2')?.textContent === title);
    }
    const source = headerForTitle('Gamma');
    const target = headerForTitle('Beta');
    const dataTransfer = new DataTransfer();
    const rect = target.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
    const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    source.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    return true;
  })()`);
  const dormantNestState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const titles = (stored.spaceSnapshots?.['drag-demo']?.groups || []).map((group) => group.title);
    return titles.includes('Beta / Gamma') ? { titles } : null;
  })()`);
  record(
    'dormant imported groups can be dragged into another group',
    dormantNestState.titles.join(' > ') === 'Beta > Beta / Gamma > Alpha',
    JSON.stringify(dormantNestState)
  );
  await evaluate(client, `(() => {
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const state = raw.spaceTabsState || {};
    state.spaces = state.spaces || [];
    if (!state.spaces.some((space) => space.id === 'drop-demo')) {
      state.spaces.push({ id: 'drop-demo', name: 'Drop Demo', icon: 'P', color: 'cyan' });
    }
    state.activeSpaceId = 'drop-demo';
    state.groupSpaces = state.groupSpaces || {};
    state.tabSpaces = state.tabSpaces || {};
    state.tabGroups = state.tabGroups || {};
    state.virtualGroups = state.virtualGroups || {};
    state.spaceSnapshots = state.spaceSnapshots || {};
    state.groupSpaces[1] = 'drop-demo';
    state.tabSpaces[2] = 'drop-demo';
    delete state.tabGroups[2];
    state.spaceSnapshots['drop-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [{
        title: 'Research',
        color: 'blue',
        collapsed: false,
        tabs: [
          { title: 'Browser Spaces Guide', url: 'https://example.com/spaces-guide' },
          { title: 'Saved Doc', url: 'https://example.com/drop-saved' },
        ],
      }],
    };
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: state }));
    sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify({
      tabs: [{
        id: 2,
        title: 'Browser Spaces Guide',
        url: 'https://example.com/spaces-guide',
        favIconUrl: '',
        pinned: false,
        muted: false,
        active: true,
        groupId: 1,
        index: 0,
        windowId: 1,
        audible: false,
      }],
      groups: [{ id: 1, title: 'Research', color: 'blue', collapsed: false }],
      nextId: 6,
      nextGroupId: 4,
    }));
    return true;
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  await evaluate(client, `(() => {
    for (const header of document.querySelectorAll('.group-card.collapsed .group-header')) {
      header.click();
    }
    return true;
  })()`);
  await waitFor(client, `(() => {
    const source = [...document.querySelectorAll('.tab-row:not(.dormant)')]
      .some((row) => row.textContent.includes('Browser Spaces Guide'));
    const target = [...document.querySelectorAll('.group-header h2')]
      .some((node) => node.textContent === 'Research');
    return source && target;
  })()`);
  const dormantTabDropDispatchState = await evaluate(client, `(() => {
    const source = [...document.querySelectorAll('.tab-row:not(.dormant)')]
      .find((row) => row.textContent.includes('Browser Spaces Guide'));
    const target = [...document.querySelectorAll('.group-card')]
      .find((card) => card.querySelector('.group-header h2')?.textContent === 'Research');
    const header = target?.querySelector('.group-header');
    if (!source || !header) return { ok: false };
    const dataTransfer = new DataTransfer();
    const rect = header.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
    const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    const over = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    });
    const overResult = header.dispatchEvent(over);
    const drop = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    });
    const dropResult = header.dispatchEvent(drop);
    source.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX,
      clientY,
    }));
    return {
      ok: true,
      overPrevented: over.defaultPrevented || overResult === false,
      dropPrevented: drop.defaultPrevented || dropResult === false,
    };
  })()`);
  const dormantTabDropState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (card?.classList.contains('collapsed')) {
      card.querySelector('.group-header')?.click();
      return null;
    }
    const groupKey = card?.dataset.groupKey || '';
    const groupId = groupKey.match(/^group:(\\d+)$/)?.[1] || '';
    const rows = [...(card?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    const syntheticStateKeys = [
      ...Object.keys(stored.tabSpaces || {}),
      ...Object.keys(stored.tabGroups || {}),
    ].filter((key) => key.startsWith('snapshot:'));
    return groupId && stored.groupSpaces?.[groupId] === 'drop-demo' && rows.length ? {
      groupKey,
      rows,
      snapshotUrls,
      syntheticStateKeys,
    } : null;
  })()`);
  record(
    'live tabs can drop onto imported group headers without leaving dormant residue',
    dormantTabDropDispatchState.ok &&
      dormantTabDropDispatchState.overPrevented &&
      dormantTabDropDispatchState.dropPrevented &&
      dormantTabDropState.rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      dormantTabDropState.rows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      !dormantTabDropState.rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      dormantTabDropState.snapshotUrls
        .filter((url) => url === 'https://example.com/spaces-guide').length === 1 &&
      dormantTabDropState.snapshotUrls.includes('https://example.com/drop-saved') &&
      dormantTabDropState.syntheticStateKeys.length === 0,
    JSON.stringify({ dormantTabDropDispatchState, dormantTabDropState })
  );
  await evaluate(client, `(() => {
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const state = raw.spaceTabsState || {};
    const group = state.spaceSnapshots?.['drop-demo']?.groups?.find((item) => item.title === 'Research');
    group.tabs.push({
      title: 'Browser Spaces Guide',
      url: 'https://example.com/spaces-guide#stale-dormant-row',
    });
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: state }));
    return true;
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  const activatedTagResidueState = await waitFor(client, `(() => {
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (card?.classList.contains('collapsed')) {
      card.querySelector('.group-header')?.click();
      return null;
    }
    const rows = [...(card?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    return rows.length ? { rows } : null;
  })()`);
  record(
    'activated group tags preserve distinct URL-variant history',
    activatedTagResidueState.rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      activatedTagResidueState.rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')),
    JSON.stringify(activatedTagResidueState)
  );
  await evaluate(client, `(() => {
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const state = raw.spaceTabsState || {};
    const group = state.spaceSnapshots?.['drop-demo']?.groups?.find((item) => item.title === 'Research');
    if (group) {
      group.tabs = (group.tabs || []).filter((tab) => tab.url !== 'https://example.com/spaces-guide');
    }
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: state }));
    return true;
  })()`);
  const closeGroupTagDispatchState = await evaluate(client, `(() => {
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    const row = [...(card?.querySelectorAll('.tab-row') || [])]
      .find((node) => !node.classList.contains('dormant') && node.textContent.includes('Browser Spaces Guide'));
    const closeButton = row?.querySelector('button[aria-label="Close"]');
    closeButton?.click();
    return {
      clicked: Boolean(closeButton),
      rowText: row?.textContent || '',
    };
  })()`);
  const closeGroupTagResidueState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (card?.classList.contains('collapsed')) {
      card.querySelector('.group-header')?.click();
      return null;
    }
    const rows = [...(card?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    if (rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide'))) return null;
    if (!rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide'))) return null;
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    return { rows, snapshotUrls };
  })()`);
  record(
    'closing a live group tag keeps its distinct URL-variant history',
    closeGroupTagDispatchState.clicked &&
      !closeGroupTagResidueState.rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      closeGroupTagResidueState.rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      closeGroupTagResidueState.snapshotUrls.includes('https://example.com/drop-saved') &&
      closeGroupTagResidueState.snapshotUrls.includes('https://example.com/spaces-guide#stale-dormant-row') &&
      !closeGroupTagResidueState.snapshotUrls.includes('https://example.com/spaces-guide'),
    JSON.stringify({ closeGroupTagDispatchState, closeGroupTagResidueState })
  );
  await evaluate(client, `new Promise((resolve) => setTimeout(resolve, 400))`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const folder = buttons.find((button) => button.title === 'Folder Demo');
    folder.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Folder Demo'`);
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.space')];
    const space = buttons.find((button) => button.title === 'Default');
    space.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
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
      buttons.find((button) => button.title === 'Default').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
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
    const allRowText = rows.map((row) => row.text);
    return {
      snapshotUrls: (searchSnapshot?.tabs || []).map((tab) => tab.url),
      searchRows,
      dormantRows: rows.filter((row) => row.dormant).length,
      allRowText,
      virtualGroups: Object.values(stored.virtualGroups || {}).map((group) => group.title),
      tabGroupCount: Object.keys(stored.tabGroups || {}).length,
      groupSpaces: stored.groupSpaces || {},
      groupHeaders: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
      ephemeralTabIds: stored.ephemeralTabIds || [],
    };
  })()`);
  record(
    'opening one dormant grouped tab uses Chrome grouping without leaked new tabs',
    firstDormantOpenState.snapshotUrls.length === 2 &&
      new Set(firstDormantOpenState.snapshotUrls).size === 2 &&
      firstDormantOpenState.searchRows.length === 2 &&
      firstDormantOpenState.dormantRows === 1 &&
      firstDormantOpenState.groupHeaders.includes('Search') &&
      Object.values(firstDormantOpenState.groupSpaces).includes('dormant-demo') &&
      firstDormantOpenState.virtualGroups.length === 0 &&
      firstDormantOpenState.tabGroupCount === 0 &&
      firstDormantOpenState.ephemeralTabIds.length === 0 &&
      !firstDormantOpenState.allRowText.some((text) => /Untitled|New Tab|chrome/i.test(text)),
    JSON.stringify(firstDormantOpenState)
  );
  if (
    firstDormantOpenState.searchRows.length !== 2 ||
    firstDormantOpenState.dormantRows !== 1 ||
    firstDormantOpenState.ephemeralTabIds.length !== 0 ||
    firstDormantOpenState.allRowText.some((text) => /Untitled|New Tab|chrome/i.test(text))
  ) {
    bugs.push('Opening a dormant grouped tab left duplicate dormant/live rows or leaked a new-tab carrier.');
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
    const allRowText = rows.map((row) => row.text);
    return {
      snapshotUrls: (searchSnapshot?.tabs || []).map((tab) => tab.url),
      searchRows,
      dormantRows: rows.filter((row) => row.dormant).length,
      allRowText,
      virtualGroups: Object.values(stored.virtualGroups || {}).map((group) => group.title),
      tabGroupCount: Object.keys(stored.tabGroups || {}).length,
      groupSpaces: stored.groupSpaces || {},
      groupHeaders: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
      ephemeralTabIds: stored.ephemeralTabIds || [],
    };
  })()`);
  record(
    'opening all dormant grouped tabs leaves only live rows',
    allDormantOpenState.snapshotUrls.length === 2 &&
      new Set(allDormantOpenState.snapshotUrls).size === 2 &&
      allDormantOpenState.searchRows.length === 2 &&
      allDormantOpenState.dormantRows === 0 &&
      allDormantOpenState.groupHeaders.includes('Search') &&
      Object.values(allDormantOpenState.groupSpaces).includes('dormant-demo') &&
      allDormantOpenState.virtualGroups.length === 0 &&
      allDormantOpenState.tabGroupCount === 0 &&
      allDormantOpenState.ephemeralTabIds.length === 0 &&
      !allDormantOpenState.allRowText.some((text) => /Untitled|New Tab|chrome/i.test(text)),
    JSON.stringify(allDormantOpenState)
  );
  if (
    allDormantOpenState.searchRows.length !== 2 ||
    allDormantOpenState.dormantRows !== 0 ||
    allDormantOpenState.ephemeralTabIds.length !== 0 ||
    allDormantOpenState.allRowText.some((text) => /Untitled|New Tab|chrome/i.test(text))
  ) {
    bugs.push('Opening all dormant grouped tabs did not fully drain the dormant snapshot or leaked a new-tab carrier.');
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
      buttons.find((button) => button.title === 'Default').click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);
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

  if (preview) {
    await evaluate(client, `(() => {
      const STORAGE_KEY = 'spaceTabsState';
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')[STORAGE_KEY] || {};
      state.version = 4;
      state.activeSpaceId = 'default';
      state.spaces = [
        { id: 'default', name: 'Default', icon: 'D', color: 'blue' },
        { id: 'move-target', name: 'Move Target', icon: 'M', color: 'cyan' },
      ];
      state.groupSpaces = { 20: 'default' };
      state.tabSpaces = {};
      state.virtualGroups = {};
      state.tabGroups = {};
      state.ephemeralTabIds = [];
      state.renamedTabs = {};
      state.groupOrder = { default: ['group:20'], 'move-target': [] };
      state.tabOrder = {};
      state.collapsedGroups = { 'group:20': false };
      state.collapsedSpaceGroups = {};
      state.spaceSnapshots = {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: state }));
      sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify({
        tabs: [
          {
            id: 201,
            title: 'Move Alpha',
            url: 'https://example.com/move-alpha',
            favIconUrl: '',
            pinned: false,
            muted: false,
            active: true,
            groupId: 20,
            index: 0,
            windowId: 1,
            audible: false,
          },
          {
            id: 202,
            title: 'Move Beta',
            url: 'https://example.com/move-beta',
            favIconUrl: '',
            pinned: false,
            muted: false,
            active: false,
            groupId: 20,
            index: 1,
            windowId: 1,
            audible: false,
          },
        ],
        groups: [{ id: 20, title: 'Move Source', color: 'blue', collapsed: false }],
        nextId: 203,
        nextGroupId: 21,
      }));
      location.reload();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default' && document.querySelectorAll('.tab-row').length === 2`);
    await evaluate(client, `(() => {
      const row = document.querySelectorAll('.tab-row')[0];
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return true;
    })()`);
    await waitFor(client, `document.querySelectorAll('.tab-row.selected').length === 1`);
    await evaluate(client, `(() => {
      const row = document.querySelectorAll('.tab-row')[1];
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
      return true;
    })()`);
    const moveShiftSelectionState = await waitFor(client, `(() => {
      const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
        title: row.querySelector('.tab-title')?.textContent || '',
        selected: row.classList.contains('selected'),
        ariaSelected: row.getAttribute('aria-selected'),
      }));
      return rows.filter((row) => row.selected).length === 2 ? rows : null;
    })()`);
    record(
      'Shift multi-select updates visible tab rows',
      moveShiftSelectionState.length === 2 &&
        moveShiftSelectionState.every((row) => row.selected && row.ariaSelected === 'true'),
      JSON.stringify(moveShiftSelectionState)
    );

    await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
    await evaluate(client, `(() => {
      const row = document.querySelectorAll('.tab-row')[1];
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 120,
      }));
      return true;
    })()`);
    await waitFor(client, `!document.querySelector('#contextMenu')?.hidden && [...document.querySelectorAll('#contextMenu button')].some((button) => button.textContent === 'Move Target')`);
    await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('#contextMenu button')]
        .find((node) => node.textContent === 'Move Target');
      button.click();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Move Target'`);
    await evaluate(client, `(() => {
      const header = [...document.querySelectorAll('.group-header')]
        .find((node) => node.querySelector('h2')?.textContent === 'Move Source');
      if (header?.closest('.collapsed')) header.click();
      return Boolean(header);
    })()`);
    const moveToState = await waitFor(client, `(() => {
      if (document.querySelector('#activeSpaceName')?.textContent !== 'Move Target') return null;
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
        title: row.querySelector('.tab-title')?.textContent || '',
        selected: row.classList.contains('selected'),
        dormant: row.classList.contains('dormant'),
      }));
      if (rows.length < 2) return null;
      const commands = window.__SPACE_TABS_PREVIEW_COMMANDS__ || [];
      return {
        activeSpaceId: stored.activeSpaceId,
        rows,
        headers: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
        groupSpaces: stored.groupSpaces || {},
        tabSpaces: stored.tabSpaces || {},
        tabGroups: stored.tabGroups || {},
        closedMovedTabIds: commands
          .filter((command) => command.type === 'tabs:close')
          .map((command) => command.payload?.tabId)
          .filter((tabId) => tabId === 201 || tabId === 202),
        ungroupedTabIds: commands
          .filter((command) => command.type === 'tabs:ungroup')
          .flatMap((command) => command.payload?.tabIds || []),
      };
    })()`, 7000);
    const movedTitles = moveToState.rows.map((row) => row.title);
    const moveToWorked = moveToState.activeSpaceId === 'move-target' &&
      moveToState.headers.includes('Move Source') &&
      ['Move Alpha', 'Move Beta'].every((title) => movedTitles.includes(title)) &&
      moveToState.rows.filter((row) => row.selected).length === 2 &&
      Object.values(moveToState.groupSpaces).includes('move-target') &&
      moveToState.closedMovedTabIds.length === 0 &&
      [201, 202].every((tabId) => moveToState.ungroupedTabIds.includes(tabId));
    record(
      'Move to moves selected tabs, switches Space, and keeps grouping',
      moveToWorked,
      JSON.stringify(moveToState)
    );
    if (!moveToWorked) {
      bugs.push('Move to failed to move selected tabs into the target Space with grouping intact.');
    }

    await evaluate(client, `(() => {
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      if (runtime.tabs?.[0]) {
        runtime.tabs[0].title = 'Move Alpha planning document with a deliberately long browser title for tidy preview';
      }
      sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify(runtime));
      location.reload();
      return true;
    })()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Move Target' && document.querySelectorAll('.tab-row').length >= 2`);
    await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
    await evaluate(client, `document.querySelector('#tidyNamesButton').click()`);
    const tidyPreview = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open) return null;
      if (document.querySelector('#actionDialogTitle')?.textContent !== 'Preview Tidy Names') return null;
      return {
        items: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
        commands: window.__SPACE_TABS_PREVIEW_COMMANDS__ || [],
      };
    })()`);
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);
    await waitFor(client, `!document.querySelector('#actionDialog')?.open`);
    const tidyCancelState = await evaluate(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      return {
        renamedTabs: stored.renamedTabs || {},
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => ['tabs:close', 'tabs:group', 'tabs:groupExisting'].includes(command.type)),
      };
    })()`);
    record(
      'Tidy Names previews before mutation and Cancel has no side effects',
      tidyPreview.items > 0 && tidyCancelState.mutations.length === 0 && Object.keys(tidyCancelState.renamedTabs).length === 0,
      JSON.stringify({ tidyPreview, tidyCancelState })
    );

    await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    const autoGroupDisclosure = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open) return null;
      if (document.querySelector('#actionDialogTitle')?.textContent !== 'Generate Auto Group preview?') return null;
      return {
        message: document.querySelector('#actionDialogMessage')?.textContent || '',
        sectionTitle: document.querySelector('#actionDialogPreview h3 span')?.textContent || '',
        items: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
        confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
        providerRequests: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => command.type === 'ai:chat').length,
      };
    })()`);
    record(
      'Auto Group discloses exact metadata before proposal generation',
      autoGroupDisclosure.message.includes('Nothing is sent until you choose Generate preview') &&
        autoGroupDisclosure.sectionTitle.includes('title, full URL, domain, current Tag, and live/saved status') &&
        autoGroupDisclosure.items > 0 &&
        autoGroupDisclosure.confirmText === 'Generate preview' &&
        autoGroupDisclosure.providerRequests === 0,
      JSON.stringify(autoGroupDisclosure)
    );
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);
    await waitFor(client, `!document.querySelector('#actionDialog')?.open && !document.querySelector('#autoGroupButton')?.disabled`);
    const autoGroupPreSendCancel = await evaluate(client, `({
      providerRequests: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => command.type === 'ai:chat').length,
      mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => ['tabs:group', 'tabs:groupExisting', 'tabs:ungroup'].includes(command.type)).length,
    })`);
    record(
      'Auto Group pre-send Cancel has no provider traffic or mutations',
      autoGroupPreSendCancel.providerRequests === 0 && autoGroupPreSendCancel.mutations === 0,
      JSON.stringify(autoGroupPreSendCancel)
    );

    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'Generate Auto Group preview?'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const groupPreview = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open) return null;
      if (document.querySelector('#actionDialogTitle')?.textContent !== 'Auto Group Preview') return null;
      return {
        items: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
        sourceLabels: document.querySelectorAll('#actionDialogPreview .group-plan-source').length,
        groupCards: document.querySelectorAll('#actionDialogPreview .group-plan-section').length,
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => ['tabs:group', 'tabs:groupExisting', 'tabs:ungroup'].includes(command.type)),
      };
    })()`);
    record(
      'Auto Group previews regrouping before Chrome mutations',
      groupPreview.items > 0 && groupPreview.sourceLabels > 0 && groupPreview.groupCards > 0 && groupPreview.mutations.length === 0,
      JSON.stringify(groupPreview)
    );
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const groupApplyState = await waitFor(client, `(() => {
      if (document.querySelector('#actionDialog')?.open) return null;
      const mutations = (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => ['tabs:group', 'tabs:groupExisting'].includes(command.type));
      return mutations.length > 0 ? { mutations } : null;
    })()`);
    record(
      'Auto Group applies only after preview confirmation',
      groupApplyState.mutations.length > 0,
      JSON.stringify(groupApplyState)
    );
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
