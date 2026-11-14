// Depth-cap repro: 3-level tree, drag depth-2 group into depth-3 target
import { mkdtemp, cp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { RUNTIME_FILES } from './release-files.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
let activePipeSessionId = null;

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
  throw new Error('Could not find Chrome. Set CHROME_PATH and rerun npm run e2e:smoke.');
}

async function startChromeWithPipe() {
  const executable = await findChromeExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), 'space-extension-e2e-'));
  const child = spawn(executable, [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    // macOS occludes stacked auxiliary windows even while they hold focus,
    // which leaves their renderers visibilityState === 'hidden' and stalls the
    // per-window panel scenarios.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

  return {
    child,
    pipeWrite: child.stdio[3],
    pipeRead: child.stdio[4],
    async close() {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}
function createPipeClient(pipeWrite, pipeRead, child) {
  let id = 0;
  let buffer = Buffer.alloc(0);
  let closed = false;
  const pending = new Map();
  const eventListeners = new Set();

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
      if (!request) {
        if (!Object.hasOwn(message, 'id')) {
          for (const listener of eventListeners) listener(message);
        }
        continue;
      }
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });

  const rejectPending = (error) => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  pipeRead.on('error', rejectPending);
  pipeRead.on('close', () => rejectPending(new Error('Chrome closed the DevTools pipe.')));
  child.once('exit', (code, signal) => rejectPending(new Error(`Chrome exited before E2E completed: code=${code ?? 'null'} signal=${signal ?? 'null'}.`)));

  return {
    ready: Promise.resolve(),
    send(method, params = {}, sessionId = activePipeSessionId) {
      if (closed) return Promise.reject(new Error('Chrome DevTools pipe is closed.'));
      const requestId = ++id;
      const message = { id: requestId, method, params };
      if (sessionId) message.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        // Runtime.evaluate awaits in-page promises such as shared-state lock
        // acquisitions. Coverage profiling slows the panel's transaction
        // chains, so give those evaluates a larger budget than transport
        // methods before declaring the pipe call stuck.
        const timeoutMs = method === 'Runtime.evaluate' ? 120000 : 45000;
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          if (method === 'Runtime.evaluate') {
            console.error(`[cdp-evaluate-timeout] session=${sessionId || 'default'} ` +
              `expr=${String(params.expression || '').slice(0, 400).replace(/\s+/g, ' ')}`);
          }
          reject(new Error(`Timed out waiting for Chrome CDP method: ${method}`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timeout });
        pipeWrite.write(`${JSON.stringify(message)}\0`);
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close() {
      eventListeners.clear();
      rejectPending(new Error('Chrome DevTools pipe client closed.'));
    },
  };
}

async function evaluateInSession(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function evaluate(client, expression) {
  return evaluateInSession(client, activePipeSessionId, expression);
}

async function waitFor(client, expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function pressKeyWithCDP(client, key, code, modifiers = 0) {
  const definition = {
    ' ': { windowsVirtualKeyCode: 32, text: ' ' },
    Enter: { windowsVirtualKeyCode: 13, text: '\r' },
    Escape: { windowsVirtualKeyCode: 27 },
    ArrowDown: { windowsVirtualKeyCode: 40 },
    ArrowUp: { windowsVirtualKeyCode: 38 },
    ArrowLeft: { windowsVirtualKeyCode: 37 },
    ArrowRight: { windowsVirtualKeyCode: 39 },
    Home: { windowsVirtualKeyCode: 36 },
    End: { windowsVirtualKeyCode: 35 },
    F10: { windowsVirtualKeyCode: 121 },
  }[key] || {};
  await client.send('Input.dispatchKeyEvent', {
    type: definition.text ? 'keyDown' : 'rawKeyDown',
    key,
    code,
    modifiers,
    ...definition,
    ...(definition.text ? { unmodifiedText: definition.text } : {}),
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    ...(definition.windowsVirtualKeyCode
      ? { windowsVirtualKeyCode: definition.windowsVirtualKeyCode }
      : {}),
  });
}

async function dragElementThroughUI(client, sourceSelector, targetSelector, options = {}) {
  const targetYRatio = Number.isFinite(Number(options.targetYRatio))
    ? Math.max(0, Math.min(1, Number(options.targetYRatio)))
    : 0.5;
  const result = await evaluate(client, `(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)});
    const target = document.querySelector(${JSON.stringify(targetSelector)});
    if (!source || !target) return null;
    const dataTransfer = new DataTransfer();
    const point = target.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: point.left + point.width / 2,
      clientY: point.top + point.height * ${JSON.stringify(targetYRatio)},
    };
    const dragStarted = source.dispatchEvent(new DragEvent('dragstart', eventOptions));
    target.dispatchEvent(new DragEvent('dragenter', eventOptions));
    const dragOverAccepted = !target.dispatchEvent(new DragEvent('dragover', eventOptions));
    const dropAccepted = !target.dispatchEvent(new DragEvent('drop', eventOptions));
    source.dispatchEvent(new DragEvent('dragend', eventOptions));
    return {
      sourceDraggable: source.draggable,
      dragStarted,
      dragOverAccepted,
      dropAccepted,
    };
  })()`);
  if (!result?.sourceDraggable || !result.dragOverAccepted || !result.dropAccepted) {
    throw new Error(`Could not complete UI drag: ${JSON.stringify(result)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const chrome = await startChromeWithPipe();
const client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
const fixtureDir = await mkdtemp(join(tmpdir(), 'space-debug-extension-'));
for (const entry of RUNTIME_FILES) {
  const destination = join(fixtureDir, entry);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(repoRoot, entry), destination, { recursive: true });
}
await writeFile(join(fixtureDir, 'config.local.js'), '// debug\nwindow.SPACE_TABS_CONFIG = {};\n');
const { id: extensionId } = await client.send('Extensions.loadUnpacked', { path: fixtureDir });
await new Promise((resolve) => setTimeout(resolve, 500));
const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
const { targetId } = await client.send('Target.createTarget', { url: sidepanelUrl });
const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
activePipeSessionId = sessionId;
await client.send('Runtime.enable');
await waitFor(client, `document.documentElement.dataset.initialized === 'true'`, 20000);

// Seed: parent(New Group) → live child(第2层) → third(第3层)，以及 depth-2 的 child
const seed = await evaluate(client, `(async () => {
  const mk = async (url, title) => {
    const tab = await chrome.tabs.create({ url, active: false });
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title, color: 'blue' });
    return { tabId: tab.id, groupId, title };
  };
  const parent = await mk('https://example.com/dbg-parent', 'Dbg Parent');
  const live = await mk('https://example.com/dbg-live', 'Dbg Live Child');
  const third = await mk('https://example.com/dbg-third', 'Dbg Third');
  const child = await mk('https://example.com/dbg-child', 'Dbg Child');
  return { parent, live, third, child };
})()`);
await new Promise((resolve) => setTimeout(resolve, 1500));

// 建层级：live → parent；third → live；child 留在顶层（depth 2 的 key 域？child 有身份）
await evaluate(client, `(async () => navigator.locks.request('space-tabs-shared-state', { mode: 'exclusive' }, async () => {
  const stored = await chrome.storage.local.get('spaceTabsState');
  const saved = stored.spaceTabsState || {};
  const snap = saved.spaceSnapshots?.default;
  const sgidOf = (title) => 'sgid:' + (snap?.groups || []).find((g) => g.title === title)?.snapshotGroupId;
  saved.groupParents = saved.groupParents || {};
  saved.groupParents.default = {
    ...(saved.groupParents?.default || {}),
    [sgidOf('Dbg Live Child')]: sgidOf('Dbg Parent'),
    [sgidOf('Dbg Third')]: sgidOf('Dbg Live Child'),
  };
  await chrome.storage.local.set({ spaceTabsState: saved });
  return true;
}))()`);
await evaluate(client, 'location.reload()');
await waitFor(client, `document.documentElement.dataset.initialized === 'true'`, 20000);

const liveKey = await waitFor(client, `(() => {
  const card = [...document.querySelectorAll('#groupsList .group-card')]
    .find((node) => node.querySelector('h2')?.textContent === 'Dbg Live Child');
  return card?.dataset.groupKey || '';
})()`, 15000);
const thirdKey = await waitFor(client, `(() => {
  const card = [...document.querySelectorAll('#groupsList .group-card')]
    .find((node) => node.querySelector('h2')?.textContent === 'Dbg Third');
  const live = [...document.querySelectorAll('#groupsList .group-card')]
    .find((node) => node.querySelector('h2')?.textContent === 'Dbg Live Child');
  if (!card || !live) return '';
  return live.querySelector('.group-children')?.contains(card) ? card.dataset.groupKey : '';
})()`, 15000);
console.log('TREE:', JSON.stringify({ liveKey, thirdKey }));

// 拖 depth-2 的 child 到 depth-3 的 third inside
const childKey = await waitFor(client, `(() => {
  const card = [...document.querySelectorAll('#groupsList > .group-card')]
    .find((node) => node.querySelector('h2')?.textContent === 'Dbg Child');
  return card?.dataset.groupKey || '';
})()`, 15000);
console.log('CHILD KEY:', childKey);
await dragElementThroughUI(
  client,
  `.group-card[data-group-key="${childKey}"] > .group-header`,
  `.group-card[data-group-key="${thirdKey}"] > .group-header`,
  { targetYRatio: 0.5 },
);
await new Promise((resolve) => setTimeout(resolve, 1500));
const probe = await evaluate(client, `(async () => {
  const stored = await chrome.storage.local.get('spaceTabsState');
  const saved = stored.spaceTabsState || {};
  const third = document.querySelector('.group-card[data-group-key="' + ${JSON.stringify(thirdKey)} + '"]');
  const childInsideThird = Boolean(third?.querySelector('.group-children .group-card[data-group-key="' + ${JSON.stringify(childKey)} + '"]'));
  return {
    parents: saved.groupParents?.default || null,
    childInsideThird,
    status: document.querySelector('#syncStatus')?.textContent || '',
  };
})()`);
console.log('PROBE:', JSON.stringify(probe, null, 1));
await chrome.close();
process.exit(0);
