import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.CDP_PORT || 9223);
const extensionId = process.env.EXT_ID || 'fignfifoniblkonapihmkfakmlgkbkcf';
const preview = process.env.PREVIEW !== '0';
const previewPort = Number(process.env.PREVIEW_PORT || 8765);
const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const base = `http://127.0.0.1:${port}`;
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
  const target = await sidepanelTarget();
  const client = createClient(target.webSocketDebuggerUrl);
  try {
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
      const [tree] = await chrome.bookmarks.getTree();
      const parent = tree.children?.find((node) => node.id === '2') || tree.children?.find((node) => !node.url) || tree;
      const existingRoot = parent.children?.find((node) => !node.url && node.title === 'Space Tabs');
      if (existingRoot) await chrome.bookmarks.removeTree(existingRoot.id);
      const root = await chrome.bookmarks.create({ parentId: parent.id, title: 'Space Tabs' });
      const space = await chrome.bookmarks.create({ parentId: root.id, title: 'Folder Demo [space:folder-demo]' });
      const work = await chrome.bookmarks.create({ parentId: space.id, title: 'Work' });
      const client = await chrome.bookmarks.create({ parentId: work.id, title: 'Client' });
      const docs = await chrome.bookmarks.create({ parentId: client.id, title: 'Docs' });
      await chrome.bookmarks.create({ parentId: docs.id, title: 'Nested Spec', url: 'https://example.com/nested-spec' });
      await chrome.bookmarks.create({ parentId: docs.id, title: 'Nested Plan', url: 'https://example.com/nested-plan' });
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
  await waitFor(client, `document.querySelector('#syncStatus')?.textContent.includes('E2E Space')`);
  const newTabRows = await evaluate(client, `document.querySelectorAll('.tab-row').length`);
  record('New Tab row creates a tab owned by active Space', newTabRows >= 1, `${newTabRows} rows`);

  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `document.querySelector('#spaceSearch')?.hidden === true`);
  await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
  await waitFor(client, `document.querySelector('#spaceSearch')?.hidden === false`);
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
    bugs.push('Multi-level bookmark folders are flattened into one Group header ("Work / Client / Docs") instead of a visible folder tree.');
  }
  record(
    'multi-level folders render as visible nested folder tree',
    folderState.folders.join(' / ') === 'Work / Client' && folderState.headers.includes('Docs'),
    JSON.stringify(folderState)
  );

    console.log(JSON.stringify({ results, bugs }, null, 2));
  } finally {
    client.close();
    await new Promise((resolve) => previewServer?.close(resolve) ?? resolve());
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
