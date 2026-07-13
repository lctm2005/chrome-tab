import { spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
let activePipeSessionId = '';

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
  throw new Error('Could not find Chrome. Set CHROME_PATH and rerun npm run e2e:smoke.');
}

async function createExtensionFixture() {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'space-extension-files-'));
  for (const entry of runtimeEntries) {
    const destination = join(fixtureDir, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repoRoot, entry), destination, { recursive: true });
  }
  await writeFile(
    join(fixtureDir, 'config.local.js'),
    '// Isolated E2E fixture. Never load developer secrets.\nwindow.SPACE_TABS_CONFIG = {};\n',
  );
  return {
    path: fixtureDir,
    close: () => rm(fixtureDir, { recursive: true, force: true }),
  };
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
  progress('building an isolated extension fixture without local secrets');
  const extensionFixture = await createExtensionFixture();
  let chrome;
  let client;
  try {
    progress('starting isolated Chrome with a DevTools pipe');
    chrome = await startChromeWithPipe();
    client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
    await client.ready;
    progress('loading the unpacked extension through CDP');
    const { id: extensionId } = await client.send('Extensions.loadUnpacked', { path: extensionFixture.path });
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

    await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      return stored.spaceTabsState?.groupSpaces?.[${JSON.stringify(realGroup.group.id)}] === 'default';
    })()`, 10000);

    const autoGroupBefore = await evaluate(client, `(async () => {
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      return {
        url: location.href,
        groups: (listed.groups || []).map((group) => ({ id: group.id, title: group.title })),
      };
    })()`);
    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    await waitFor(client, `document.querySelector('#syncStatus')?.textContent?.includes('Auto Group needs a configured AI provider')`);
    const autoGroupMissingKeyState = await evaluate(client, `(async () => {
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      return {
        url: location.href,
        status: document.querySelector('#syncStatus')?.textContent || '',
        toast: document.querySelector('#workbenchToast')?.textContent || '',
        previewOpen: Boolean(document.querySelector('#actionDialog')?.open),
        groups: (listed.groups || []).map((group) => ({ id: group.id, title: group.title })),
      };
    })()`);
    record(
      'Workbench Auto Group reports missing BYOK without navigation or mutations',
      autoGroupMissingKeyState.url === autoGroupBefore.url &&
        autoGroupMissingKeyState.status.includes('Auto Group needs a configured AI provider') &&
        autoGroupMissingKeyState.toast.includes('Auto Group needs a configured AI provider') &&
        !autoGroupMissingKeyState.previewOpen &&
        JSON.stringify(autoGroupMissingKeyState.groups) === JSON.stringify(autoGroupBefore.groups),
      JSON.stringify(autoGroupMissingKeyState),
    );

    const tidyDuplicate = await evaluate(client, `(async () => {
      const duplicated = await chrome.runtime.sendMessage({
        type: 'tabs:duplicate',
        tabId: ${JSON.stringify(realGroup.tabIds[0])},
      });
      return duplicated.tab;
    })()`);
    await waitFor(client, `document.querySelector('.tab-row[data-tab-id="${tidyDuplicate.id}"]')`, 10000);
    await evaluate(client, `document.querySelector('#tidyNamesButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Preview Tidy Names'`, 12000);
    const tidyPreviewState = await evaluate(client, `({
      previewItems: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
      confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
      activeSpaceId: document.querySelector('.space.active')?.title || '',
    })`);
    record(
      'Workbench Tidy Names shows a preview before changing tabs',
      tidyPreviewState.previewItems > 0 && tidyPreviewState.confirmText === 'Apply tidy',
      JSON.stringify(tidyPreviewState),
    );
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);
    const tidyCancelState = await waitFor(client, `(async () => {
      if (document.querySelector('#actionDialog')?.open) return null;
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const duplicates = (listed.tabs || []).filter((tab) =>
        String(tab.url || '').startsWith('https://example.com/e2e-one'));
      return duplicates.length >= 2 ? { count: duplicates.length, duplicateId: ${JSON.stringify(tidyDuplicate.id)} } : null;
    })()`);
    record(
      'Workbench Tidy Names Cancel leaves real Chrome tabs unchanged',
      tidyCancelState.count >= 2 && Number.isFinite(tidyCancelState.duplicateId),
      JSON.stringify(tidyCancelState),
    );

    await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
    const collapsedState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      if (!document.querySelector('#groupsList')?.classList.contains('groups-collapsed')) return null;
      return {
        collapsed: stored.spaceTabsState?.collapsedSpaceGroups?.default === true,
        buttonTitle: document.querySelector('#collapseGroupsButton')?.title || '',
      };
    })()`);
    await evaluate(client, `document.querySelector('#collapseGroupsButton').click()`);
    await waitFor(client, `!document.querySelector('#groupsList')?.classList.contains('groups-collapsed')`);
    record(
      'Workbench collapse control persists and restores the group view',
      collapsedState.collapsed && collapsedState.buttonTitle === 'Expand groups',
      JSON.stringify(collapsedState),
    );

    await createLoadedTarget(client, sidepanelUrl);
    await evaluate(client, `chrome.tabs.update(${JSON.stringify(createdTab.id)}, {
      url: 'https://example.com/workbench-space-source',
      active: true,
    })`);
    await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      return (stored.spaceTabsState?.spaceSnapshots?.default?.groups || [])
        .some((group) => (group.tabs || []).some((tab) => tab.url === 'https://example.com/workbench-space-source'));
    })()`, 10000);
    await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const next = structuredClone(stored.spaceTabsState);
      next.spaces.push({ id: 'remote-current', name: 'Remote Current', icon: 'R', color: 'green' });
      next.activeSpaceId = 'remote-current';
      next.spaceSnapshots['remote-current'] = {
        version: 1,
        groups: [{
          title: 'Remote Saved',
          color: 'green',
          tabs: [{ title: 'Remote Saved Tab', url: 'https://example.net/remote-saved' }],
        }],
      };
      await chrome.storage.local.set({ spaceTabsState: next });
    })()`);
    await evaluate(client, `document.querySelector('.add-space').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'New Space'`);
    await evaluate(client, `(() => {
      document.querySelector('#actionDialogInput').value = 'Workbench E2E';
      document.querySelector('#actionDialogConfirm').click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const workbenchCreateState = await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      return {
        activeSpaceId: saved.activeSpaceId || '',
        spaces: (saved.spaces || []).map((space) => ({ id: space.id, name: space.name })),
        defaultUrls: (saved.spaceSnapshots?.default?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
        remoteUrls: (saved.spaceSnapshots?.['remote-current']?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
        activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
        visibleSpaces: [...document.querySelectorAll('.space')].map((button) => button.title),
      };
    })()`);
    record(
      'Workbench creates a persistent Space without losing the current Space snapshot',
      workbenchCreateState.spaces.some((space) => space.name === 'Workbench E2E') &&
        workbenchCreateState.spaces.some((space) => space.name === 'Remote Current') &&
        workbenchCreateState.defaultUrls.includes('https://example.com/workbench-space-source') &&
        workbenchCreateState.remoteUrls.includes('https://example.net/remote-saved') &&
        workbenchCreateState.activeSpaceName === 'Workbench E2E' &&
        workbenchCreateState.visibleSpaces.includes('Workbench E2E'),
      JSON.stringify(workbenchCreateState),
    );

    await evaluate(client, `[...document.querySelectorAll('.space')]
      .find((button) => button.title === 'Remote Current')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    let restoredRemoteState = await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const visibleText = document.querySelector('#groupsList')?.textContent || '';
      return {
        activeSpaceId: stored.spaceTabsState?.activeSpaceId || '',
        activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
        visibleText,
        dormantRows: document.querySelectorAll('.tab-row.dormant').length,
        spaces: (stored.spaceTabsState?.spaces || []).map((space) => space.name),
        remoteSnapshot: stored.spaceTabsState?.spaceSnapshots?.['remote-current'] || null,
      };
    })()`);
    if (restoredRemoteState.dormantRows === 0 && restoredRemoteState.visibleText.includes('Remote Saved')) {
      await evaluate(client, `[...document.querySelectorAll('.group-header')]
        .find((header) => header.textContent.includes('Remote Saved'))?.click()`);
      await waitFor(client, `document.querySelector('.tab-row.dormant')`);
      restoredRemoteState = await evaluate(client, `({
        ...${JSON.stringify(restoredRemoteState)},
        visibleText: document.querySelector('#groupsList')?.textContent || '',
        dormantRows: document.querySelectorAll('.tab-row.dormant').length,
      })`);
    }
    let openedRemoteTab = null;
    if (restoredRemoteState.dormantRows > 0) {
      await evaluate(client, `document.querySelector('.tab-row.dormant').click()`);
      openedRemoteTab = await waitFor(client, `(async () => {
        const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
        return (listed.tabs || []).find((tab) =>
          String(tab.url || '').startsWith('https://example.net/remote-saved')) || null;
      })()`, 12000);
    }
    record(
      'Workbench switching shows dormant data and opens it only on user action',
      restoredRemoteState.activeSpaceName === 'Remote Current' &&
        restoredRemoteState.visibleText.includes('Remote Saved Tab') &&
        Number.isFinite(openedRemoteTab.id),
      JSON.stringify({ restoredRemoteState, openedRemoteTab }),
    );

    await evaluate(client, `[...document.querySelectorAll('.space')]
      .find((button) => button.title === 'Workbench E2E')?.click()`);
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Workbench E2E'`);
    await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.space')]
        .find((item) => item.title === 'Workbench E2E');
      button.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 24, clientY: 24,
      }));
    })()`);
    await waitFor(client, `!document.querySelector('#contextMenu')?.hidden &&
      [...document.querySelectorAll('#contextMenu button')].some((button) => button.textContent === 'Rename Space')`);
    await evaluate(client, `[...document.querySelectorAll('#contextMenu button')]
      .find((button) => button.textContent === 'Rename Space')?.click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Rename Space'`);
    await evaluate(client, `(() => {
      document.querySelector('#actionDialogInput').value = 'Workbench Renamed';
      document.querySelector('#actionDialogConfirm').click();
    })()`);
    const renamedSpaceState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const renamed = (stored.spaceTabsState?.spaces || []).find((space) => space.id === 'workbench-e2e');
      if (renamed?.name !== 'Workbench Renamed') return null;
      return {
        storedName: renamed.name,
        activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
        visible: [...document.querySelectorAll('.space')].some((button) => button.title === 'Workbench Renamed'),
      };
    })()`);
    record(
      'Workbench renames a Space in storage and the visible rail',
      renamedSpaceState.activeSpaceName === 'Workbench Renamed' && renamedSpaceState.visible,
      JSON.stringify(renamedSpaceState),
    );

    await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.space')]
        .find((item) => item.title === 'Workbench Renamed');
      button.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 24, clientY: 24,
      }));
    })()`);
    await waitFor(client, `!document.querySelector('#contextMenu')?.hidden &&
      [...document.querySelectorAll('#contextMenu button')].some((button) => button.textContent === 'Delete Space')`);
    await evaluate(client, `[...document.querySelectorAll('#contextMenu button')]
      .find((button) => button.textContent === 'Delete Space')?.click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Delete Space'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const deletedSpaceState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      if ((saved.spaces || []).some((space) => space.id === 'workbench-e2e')) return null;
      return {
        activeSpaceId: saved.activeSpaceId || '',
        spaces: (saved.spaces || []).map((space) => space.name),
        defaultUrls: (saved.spaceSnapshots?.default?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
        remoteUrls: (saved.spaceSnapshots?.['remote-current']?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
      };
    })()`, 12000);
    record(
      'Workbench deletes only the selected Space and preserves other Space data',
      deletedSpaceState.activeSpaceId !== 'workbench-e2e' &&
        deletedSpaceState.spaces.includes('Default') &&
        deletedSpaceState.spaces.includes('Remote Current') &&
        deletedSpaceState.defaultUrls.includes('https://example.com/workbench-space-source') &&
        deletedSpaceState.remoteUrls.includes('https://example.net/remote-saved'),
      JSON.stringify(deletedSpaceState),
    );

    await waitFor(client, `document.querySelector('.ask-space')`);
    const reducedAIUI = await evaluate(client, `({
      hasContext: Boolean(document.querySelector('#contextView, .context-space')),
      hasSummary: Boolean(document.querySelector('#summarizePageButton')),
      hasAsk: Boolean(document.querySelector('.ask-space')),
    })`);
    record('Context and Summary are removed while Ask remains', !reducedAIUI.hasContext && !reducedAIUI.hasSummary && reducedAIUI.hasAsk, JSON.stringify(reducedAIUI));

    await evaluate(client, `document.querySelector('.ask-space').click()`);
    const askSpaceState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const activeSpaceId = stored.spaceTabsState?.activeSpaceId || '';
      const sessionKey = \`space:\${activeSpaceId}\`;
      if (document.querySelector('#askPageView')?.hidden ||
          stored.spaceTabsState?.activeAskSessionKey !== sessionKey ||
          !stored.spaceTabsState?.askSessions?.[sessionKey]) return null;
      return {
        activeSpaceId,
        sessionKey,
        scope: document.querySelector('#askScope')?.textContent || '',
        placeholder: document.querySelector('#askPagePrompt')?.placeholder || '',
      };
    })()`);
    record(
      'Workbench Ask uses one persisted conversation per active Space',
      askSpaceState.sessionKey === `space:${askSpaceState.activeSpaceId}` &&
        askSpaceState.placeholder === 'Ask this Space' &&
        !askSpaceState.scope.includes('Context'),
      JSON.stringify(askSpaceState),
    );

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open && document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]')`);
    const defaultAISettings = await evaluate(client, `({
      maxTokens: document.querySelector('#maxTokensInput').value,
      keyStatus: document.querySelector('#apiKeyStatus')?.textContent || '',
      providerOptions: document.querySelector('#providerInput')?.options.length || 0,
      modelOptions: document.querySelector('#modelInput')?.options.length || 0,
    })`);
    record(
      'fresh BYOK settings start at 10K with no bundled API key',
      defaultAISettings.maxTokens === '10' &&
        defaultAISettings.keyStatus === 'No API key configured.' &&
        defaultAISettings.providerOptions > 1 &&
        defaultAISettings.modelOptions > 0,
      JSON.stringify(defaultAISettings),
    );
    await evaluate(client, `(() => {
      const input = document.querySelector('#maxTokensInput');
      input.value = '129';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    const invalidMaxTokenState = await waitFor(client, `(async () => {
      if (!document.querySelector('#workbenchToast')?.textContent?.includes('Enter 0.001-128 K tokens')) return null;
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
      document.querySelector('#apiKeyInput').value = 'e2e-session-key';
      const input = document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]');
      input.dataset.shortcut = 'Control+Alt+K';
      input.value = 'Ctrl + Alt + K';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    await waitFor(client, `document.querySelector('#workbenchToast')?.textContent === 'Settings saved.' && !document.querySelector('#workbenchToast')?.hidden`);
    const byokStorageState = await evaluate(client, `(async () => {
      const [local, session] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.storage.session.get('spaceTabsSecrets'),
      ]);
      return {
        localKeyLength: String(local.spaceTabsState?.ai?.apiKey || '').length,
        sessionKeyLength: String(session.spaceTabsSecrets?.ai?.apiKey || '').length,
        keyStatus: document.querySelector('#apiKeyStatus')?.textContent || '',
      };
    })()`);
    record(
      'Workbench BYOK keeps the API key in session storage only',
      byokStorageState.localKeyLength === 0 &&
        byokStorageState.sessionKeyLength > 0 &&
        byokStorageState.keyStatus.includes('configured for this Chrome session'),
      JSON.stringify(byokStorageState),
    );
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
    record('real Workbench Save shows feedback and applies shortcuts immediately', true);
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);

    await evaluate(client, `document.querySelector('#clearApiKeyButton').click()`);
    const clearedKeyState = await waitFor(client, `(async () => {
      const session = await chrome.storage.session.get('spaceTabsSecrets');
      const keyLength = String(session.spaceTabsSecrets?.ai?.apiKey || '').length;
      if (keyLength !== 0 || !document.querySelector('#workbenchToast')?.textContent?.includes('API key cleared')) return null;
      return {
        keyLength,
        keyStatus: document.querySelector('#apiKeyStatus')?.textContent || '',
        toast: document.querySelector('#workbenchToast')?.textContent || '',
      };
    })()`);
    record(
      'Workbench clears the session API key with visible feedback',
      clearedKeyState.keyLength === 0 && clearedKeyState.keyStatus === 'No API key configured.',
      JSON.stringify(clearedKeyState),
    );

    await evaluate(client, `document.querySelector('#runOnboardingButton').click()`);
    const setupReentryState = await waitFor(client, `(() => {
      if (!document.querySelector('#onboardingDialog')?.open) return null;
      return {
        chooseVisible: !document.querySelector('#onboardingChooseStep')?.hidden,
        step: document.querySelector('#onboardingStepLabel')?.textContent || '',
        settingsOpen: Boolean(document.querySelector('#settingsDialog')?.open),
      };
    })()`);
    record(
      'Workbench Settings can reopen setup after onboarding is complete',
      setupReentryState.chooseVisible && setupReentryState.step === 'Step 1 of 3' && !setupReentryState.settingsOpen,
      JSON.stringify(setupReentryState),
    );
    await evaluate(client, `document.querySelector('#onboardingDialog')
      .dispatchEvent(new Event('cancel', { cancelable: true }))`);
    await waitFor(client, `!document.querySelector('#onboardingDialog')?.open`);

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
    await evaluate(client, `document.querySelector('#exportSpaceDataButton').click()`);
    const exportFeedbackState = await waitFor(client, `(() => {
      const status = document.querySelector('#spaceBackupStatus')?.textContent || '';
      if (!status.startsWith('Exported ')) return null;
      return {
        status,
        toast: document.querySelector('#workbenchToast')?.textContent || '',
      };
    })()`);
    record(
      'Workbench backup export confirms that API keys are excluded',
      exportFeedbackState.status.includes('API keys were excluded') &&
        exportFeedbackState.toast.includes('API keys were excluded'),
      JSON.stringify(exportFeedbackState),
    );

    await evaluate(client, `(() => {
      const backup = {
        format: 'space-context-workspaces',
        version: 1,
        exportedAt: new Date().toISOString(),
        activeSpaceId: 'backup-restored',
        spaces: [{ id: 'backup-restored', name: 'Backup Restored', icon: 'B', color: 'cyan' }],
        spaceContexts: {},
        spaceSnapshots: {
          'backup-restored': {
            version: 1,
            updatedAt: Date.now(),
            groups: [{
              title: 'Recovered',
              color: 'cyan',
              collapsed: false,
              tabs: [{ title: 'Recovered Tab', url: 'https://example.com/recovered' }],
            }],
          },
        },
        askSessions: {},
        collapsedSpaceGroups: {},
      };
      const file = new File([JSON.stringify(backup)], 'space-backup-e2e.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector('#spaceBackupInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const backupPreviewState = await waitFor(client, `(() => {
      const status = document.querySelector('#spaceBackupStatus')?.textContent || '';
      if (document.querySelector('#restoreSpaceDataButton')?.disabled || !status.startsWith('Ready to restore ')) return null;
      return { status, restoreEnabled: true };
    })()`);
    record(
      'Workbench validates a backup before enabling Restore',
      backupPreviewState.restoreEnabled && backupPreviewState.status.includes('1 Spaces and 1 saved tabs'),
      JSON.stringify(backupPreviewState),
    );
    await evaluate(client, `document.querySelector('#restoreSpaceDataButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Restore Space Data'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const restoredBackupState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const urls = (saved.spaceSnapshots?.['backup-restored']?.groups || [])
        .flatMap((group) => (group.tabs || []).map((tab) => tab.url));
      if (saved.activeSpaceId !== 'backup-restored' ||
          !(saved.spaces || []).some((space) => space.name === 'Backup Restored') ||
          !urls.includes('https://example.com/recovered')) return null;
      return {
        activeSpaceId: saved.activeSpaceId,
        spaces: saved.spaces.map((space) => space.name),
        urls,
        maxTokens: saved.ai?.maxTokens,
        addSpaceShortcut: saved.shortcuts?.addSpace,
        restoreDisabled: document.querySelector('#restoreSpaceDataButton')?.disabled,
      };
    })()`, 12000);
    record(
      'Workbench restore replaces Space data but preserves local AI and shortcuts',
      restoredBackupState.maxTokens === 10_240 &&
        restoredBackupState.addSpaceShortcut === 'Control+Alt+K' &&
        restoredBackupState.restoreDisabled,
      JSON.stringify(restoredBackupState),
    );

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

    const { targetId: finalActionTargetId } = await client.send('Target.createTarget', {
      url: 'about:blank',
      forTab: true,
    }, '');
    progress(`triggering ${extensionId} toolbar action`);
    await client.send('Extensions.triggerAction', { id: extensionId, targetId: finalActionTargetId }, '');
    record('toolbar action runs on a real Chrome tab', true, JSON.stringify({ actionTargetId: finalActionTargetId }));

    console.log(JSON.stringify({ mode: 'real-extension', extensionId, results }, null, 2));
    const failures = results.filter((result) => !result.ok);
    if (failures.length) throw new Error(`Extension E2E smoke failed: ${failures.map((result) => result.name).join(', ')}`);
  } finally {
    client?.close();
    await chrome?.close();
    await extensionFixture.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
