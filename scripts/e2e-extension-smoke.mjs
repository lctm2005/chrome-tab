import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
let activePipeSessionId = '';

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
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Timed out waiting for Chrome CDP method: ${method}`));
        }, 45000);
        pending.set(requestId, { resolve, reject, timeout });
        pipeWrite.write(`${JSON.stringify(message)}\0`);
      });
    },
    close() {
      rejectPending(new Error('Chrome DevTools pipe client closed.'));
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
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
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

async function waitForTarget(client, predicate, timeoutMs = 8000) {
  const started = Date.now();
  let lastTargetInfos = [];
  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await client.send('Target.getTargets', {}, '');
    lastTargetInfos = targetInfos;
    const target = targetInfos.find(predicate);
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const summary = lastTargetInfos
    .filter((target) => target.type === 'page')
    .map((target) => `${target.title || '(untitled)'} <${target.url || '(blank)'}>`)
    .join(', ');
  throw new Error(`Timed out waiting for a matching Chrome target. Pages: ${summary || '(none)'}`);
}

async function createLoadedTarget(client, url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { targetId } = await client.send('Target.createTarget', { url }, '');
    try {
      await waitForTarget(
        client,
        (target) => target.targetId === targetId && String(target.url || '').startsWith(url),
        5000,
      );
      return targetId;
    } catch (error) {
      lastError = error;
      await client.send('Target.closeTarget', { targetId }, '').catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Could not load extension page ${url}: ${lastError?.message || 'unknown error'}`);
}

async function main() {
  const progress = (step) => process.stderr.write(`[e2e] ${step}\n`);
  progress('starting isolated Chrome with a DevTools pipe');
  const chrome = await startChromeWithPipe();
  let client;
  try {
    client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
    await client.ready;
    progress('loading the unpacked extension through CDP');
    const { id: extensionId } = await client.send('Extensions.loadUnpacked', { path: repoRoot });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
    const { targetId: actionTargetId } = await client.send('Target.createTarget', {
      url: 'about:blank',
      forTab: true,
    }, '');
    const workbenchUrl = `${sidepanelUrl}?layout=workbench`;
    const workbenchTargetId = await createLoadedTarget(client, workbenchUrl);
    const { sessionId: workbenchSessionId } = await client.send('Target.attachToTarget', {
      targetId: workbenchTargetId,
      flatten: true,
    }, '');
    activePipeSessionId = workbenchSessionId;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    const attachedWorkbenchUrl = await evaluate(client, 'location.href');
    progress(`attached Workbench URL: ${attachedWorkbenchUrl}`);
    if (!String(attachedWorkbenchUrl).startsWith(workbenchUrl)) {
      await client.send('Page.navigate', { url: workbenchUrl });
    }
    await waitFor(client, `location.href.startsWith(${JSON.stringify(workbenchUrl)})`);
    const loadedUrl = await evaluate(client, 'location.href');
    if (!loadedUrl.startsWith(workbenchUrl)) {
      throw new Error(`Expected Workbench page ${workbenchUrl}, got ${loadedUrl || '(blank)'}.`);
    }
    progress('running extension and Chrome API assertions');
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default'`);

    const results = [];
    const record = (name, ok, detail = '') => results.push({ name, ok, detail });
    const initialOnboardingOpen = await waitFor(client, `document.querySelector('#onboardingDialog')?.open`);
    record('fresh Workbench opens setup', Boolean(initialOnboardingOpen));
    await evaluate(client, `document.querySelector('#onboardingDialog').dispatchEvent(new Event('cancel', { cancelable: true }))`);
    await waitFor(client, `!document.querySelector('#onboardingDialog')?.open && document.querySelector('.setup-space')`);
    record('unfinished setup remains available after dismissal', true);
    await evaluate(client, `document.querySelector('.setup-space').click()`);
    await waitFor(client, `document.querySelector('#onboardingDialog')?.open`);
    await evaluate(client, `document.querySelector('#skipOnboardingButton').click()`);
    const skippedSetup = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      return stored.spaceTabsState?.onboarding?.completed === true
        && !document.querySelector('#onboardingDialog')?.open
        && !document.querySelector('.setup-space');
    })()`);
    record('explicit Skip setup completes onboarding and removes the reminder', Boolean(skippedSetup));

    const openedWorkbench = await waitFor(client, `(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => String(tab.url || '').includes('sidepanel.html?layout=workbench')) || null;
    })()`, 8000);
    record(
      'fresh Workbench starts with Default',
      Boolean(openedWorkbench),
      JSON.stringify(openedWorkbench),
    );

    const runtime = await evaluate(client, `({
      id: chrome.runtime?.id || '',
      storage: Boolean(chrome.storage?.local),
      url: location.protocol,
    })`);
    record(
      'Workbench runs as a loaded Chrome extension',
      Boolean(runtime.id) && runtime.storage && runtime.url === 'chrome-extension:',
      JSON.stringify(runtime),
    );

    const bridge = await evaluate(client, `(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const ownPrefix = chrome.runtime.getURL('');
      return {
        ok: response?.ok,
        tabs: response?.tabs?.length || 0,
        groups: response?.groups?.length || 0,
        ownPages: (response?.tabs || []).filter((tab) => String(tab.url || '').startsWith(ownPrefix)).length,
      };
    })()`);
    record(
      'Workbench reaches the real background service worker',
      bridge.ok === true && bridge.tabs >= 1,
      JSON.stringify(bridge),
    );
    record(
      'tabs:list excludes extension-owned Workbench pages',
      bridge.ownPages === 0,
      JSON.stringify(bridge),
    );

    await waitFor(client, `document.querySelector('.new-tab-row')`);
    await evaluate(client, `document.querySelector('.new-tab-row').click()`);
    const createdTab = await waitFor(client, `(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      return response.tabs.find((tab) => String(tab.url || '').startsWith('chrome://newtab')) || null;
    })()`);
    record(
      'New Tab UI creates a real Chrome tab through the extension background',
      Number.isFinite(createdTab?.id),
      JSON.stringify(createdTab),
    );

    const realGroup = await evaluate(client, `(async () => {
      const first = await chrome.runtime.sendMessage({ type: 'tabs:create', url: 'https://example.com/e2e-one', active: false });
      const second = await chrome.runtime.sendMessage({ type: 'tabs:create', url: 'https://example.org/e2e-two', active: false });
      const grouped = await chrome.runtime.sendMessage({
        type: 'tabs:group',
        tabIds: [first.tab.id, second.tab.id],
        title: 'E2E Group',
        color: 'blue',
      });
      const group = await chrome.tabGroups.get(grouped.groupId);
      const tabs = await chrome.tabs.query({ groupId: grouped.groupId });
      return { group, tabIds: tabs.map((tab) => tab.id) };
    })()`);
    record(
      'background grouping mutates real Chrome tab groups',
      realGroup.group?.title === 'E2E Group' && realGroup.tabIds.length === 2,
      JSON.stringify(realGroup),
    );

    await waitFor(client, `document.querySelector('.ask-space')`);
    const reducedAIUI = await evaluate(client, `({
      hasContext: Boolean(document.querySelector('#contextView, .context-space')),
      hasSummary: Boolean(document.querySelector('#summarizePageButton')),
      hasAsk: Boolean(document.querySelector('.ask-space')),
    })`);
    record('Context and Summary are removed while Ask remains', !reducedAIUI.hasContext && !reducedAIUI.hasSummary && reducedAIUI.hasAsk, JSON.stringify(reducedAIUI));

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open && document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]')`);
    const defaultMaxTokens = await evaluate(client, `document.querySelector('#maxTokensInput').value`);
    record('fresh BYOK max tokens displays 10K', defaultMaxTokens === '10', defaultMaxTokens);
    await evaluate(client, `(() => {
      const input = document.querySelector('#maxTokensInput');
      input.value = '129';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    const invalidMaxTokenState = await waitFor(client, `(async () => {
      if (!document.querySelector('#workbenchToast')?.textContent?.includes('between 0.001K and 128K')) return null;
      const stored = await chrome.storage.local.get('spaceTabsState');
      return { maxTokens: stored.spaceTabsState?.ai?.maxTokens };
    })()`);
    record(
      'max output tokens rejects values above the API limit',
      invalidMaxTokenState.maxTokens === 10_240,
      JSON.stringify(invalidMaxTokenState),
    );
    await evaluate(client, `(() => {
      document.querySelector('#maxTokensInput').value = '10';
      const input = document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]');
      input.dataset.shortcut = 'Control+Alt+K';
      input.value = 'Ctrl + Alt + K';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    await waitFor(client, `document.querySelector('#workbenchToast')?.textContent === 'Settings saved.' && !document.querySelector('#workbenchToast')?.hidden`);
    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }))`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'New Space'`);
    record('real Workbench Save shows feedback and applies shortcuts immediately', true);
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);

    const openUniqueResults = await evaluate(client, `(async () => {
      const url = chrome.runtime.getURL('sidepanel.html?layout=workbench&view=settings');
      const matchUrl = chrome.runtime.getURL('sidepanel.html?layout=workbench');
      history.replaceState(null, '', url);
      await chrome.tabs.create({ url: matchUrl, active: false, index: 0 });
      const first = await chrome.runtime.sendMessage({ type: 'tabs:openUnique', url, matchUrl });
      const second = await chrome.runtime.sendMessage({ type: 'tabs:openUnique', url, matchUrl });
      return { first, second };
    })()`);
    const workbenchState = await waitFor(client, `(async () => {
      const tabs = (await chrome.tabs.query({}))
        .filter((tab) => String(tab.url || '').includes('sidepanel.html?layout=workbench'));
      return { count: tabs.length, tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, active: tab.active })) };
    })()`);
    record(
      'Open Workbench reuses one tab and closes old duplicates',
      workbenchState.count === 1,
      JSON.stringify({ openUniqueResults, workbenchState }),
    );

    progress(`triggering ${extensionId} toolbar action`);
    await client.send('Extensions.triggerAction', { id: extensionId, targetId: actionTargetId }, '');
    record('toolbar action runs on a real Chrome tab', true, JSON.stringify({ actionTargetId }));

    console.log(JSON.stringify({ mode: 'real-extension', extensionId, results }, null, 2));
    const failures = results.filter((result) => !result.ok);
    if (failures.length) throw new Error(`Extension E2E smoke failed: ${failures.map((result) => result.name).join(', ')}`);
  } finally {
    client?.close();
    await chrome.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
