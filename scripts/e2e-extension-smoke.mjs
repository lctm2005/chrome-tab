import { spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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

async function createExtensionFixture(options = {}) {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'space-extension-files-'));
  for (const entry of runtimeEntries) {
    const destination = join(fixtureDir, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repoRoot, entry), destination, { recursive: true });
  }
  if (options.hostPermissions?.length) {
    const manifestPath = join(fixtureDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = [...new Set([
      ...(manifest.host_permissions || []),
      ...options.hostPermissions,
    ])];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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

async function waitForJsonDownload(directory, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    const completed = names.filter((name) => !name.endsWith('.crdownload'));
    for (const name of completed) {
      const path = join(directory, name);
      const text = await readFile(path, 'utf8').catch(() => '');
      if (!text) continue;
      try {
        return { name, path, text, parsed: JSON.parse(text) };
      } catch {
        // Chrome may expose the final filename just before the final write lands.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for a JSON download in ${directory}.`);
}

async function clickElementWithCDP(client, selector) {
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Could not click missing or hidden element: ${selector}`);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function setFileInputWithCDP(client, selector, filePath) {
  const { root } = await client.send('DOM.getDocument', { depth: 0, pierce: true });
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`Could not find file input: ${selector}`);
  await client.send('DOM.setFileInputFiles', {
    nodeId,
    files: [filePath],
  });
  await evaluate(client, `document.querySelector(${JSON.stringify(selector)})
    ?.dispatchEvent(new Event('change', { bubbles: true }))`);
}

async function startAskFixtureServer() {
  const requests = [];
  const pageHits = [];
  const sockets = new Set();
  const timers = new Set();
  const autoGroupDormantUrl = 'https://example.net/saved-auto-group-e2e';
  const autoGroupTargetTitle = 'Auto Group E2E Proposal';
  const tidyPrimaryTitle = 'Tidy Names E2E planning document with a deliberately long stable title';
  const tidySecondaryTitle = 'Tidy Names E2E companion reference with another deliberately long stable title';

  const schedule = (callback, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timer.unref?.();
    timers.add(timer);
    return timer;
  };

  const sourcePages = {
    '/source-alpha': {
      title: 'Ask Source Alpha',
      body: 'ALPHA_E2E_CONTENT: The launch checkpoint is Tuesday and Ada owns the rollout.',
    },
    '/source-beta': {
      title: 'Ask Source Beta',
      body: 'BETA_E2E_CONTENT: The support review is Thursday and Ben owns the checklist.',
    },
    '/tidy-primary': {
      title: tidyPrimaryTitle,
      body: 'A deterministic local page used to keep Tidy Names title fingerprints stable.',
    },
    '/tidy-secondary': {
      title: tidySecondaryTitle,
      body: 'A second deterministic local page for the real Chrome grouping fixture.',
    },
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && sourcePages[url.pathname]) {
      const page = sourcePages[url.pathname];
      pageHits.push({ path: url.pathname, at: Date.now() });
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(`<!doctype html><html><head><title>${page.title}</title></head><body><article><h1>${page.title}</h1><p>${page.body}</p></article></body></html>`);
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      });
      response.end();
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = {};
      }
      const lastUserMessage = [...(body.messages || [])]
        .reverse()
        .find((message) => message?.role === 'user')?.content || '';
      const systemText = (body.messages || [])
        .filter((message) => message?.role === 'system')
        .map((message) => String(message?.content || ''))
        .join('\n');
      if (lastUserMessage.includes('Reply with one short sentence: AI is connected.')) {
        requests.push({
          mode: 'test-ai',
          body,
          receivedAt: Date.now(),
        });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        response.end(JSON.stringify({
          choices: [{ message: { content: 'AI is connected.' }, finish_reason: 'stop' }],
        }));
        return;
      }
      if (systemText.includes('Rename browser tabs for a compact sidebar')) {
        let candidates = [];
        try {
          const parsed = JSON.parse(lastUserMessage);
          candidates = Array.isArray(parsed) ? parsed : [];
        } catch {
          candidates = [];
        }
        const names = candidates.map((candidate, index) => ({
          id: Number(candidate.id),
          title: `E2E tidy ${index + 1}`,
        }));
        requests.push({
          mode: 'tidy-names',
          body,
          receivedAt: Date.now(),
          candidates,
          names,
        });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(names) }, finish_reason: 'stop' }],
        }));
        return;
      }
      if (systemText.includes('Group browser tabs into concise topic/work buckets')) {
        let candidates = [];
        try {
          const parsed = JSON.parse(lastUserMessage);
          candidates = Array.isArray(parsed) ? parsed : [];
        } catch {
          candidates = [];
        }
        const liveCandidate = candidates.find((candidate) => (
          String(candidate?.url || '').endsWith('/source-alpha') && candidate?.status === 'live'
        ));
        const savedCandidate = candidates.find((candidate) => (
          candidate?.url === autoGroupDormantUrl && candidate?.status === 'saved'
        ));
        const plan = liveCandidate && savedCandidate
          ? [{
              title: autoGroupTargetTitle,
              color: 'green',
              tabIds: [Number(liveCandidate.id), Number(savedCandidate.id)],
            }]
          : [];
        requests.push({
          mode: 'auto-group',
          body,
          receivedAt: Date.now(),
          candidates,
          liveCandidate: liveCandidate || null,
          savedCandidate: savedCandidate || null,
          plan,
        });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        response.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(plan) } }],
        }));
        return;
      }
      const mode = lastUserMessage.includes('E2E stop stream') ? 'stop' : 'complete';
      const record = {
        mode,
        body,
        receivedAt: Date.now(),
        sourceCount: (lastUserMessage.match(/^Source \[\d+\]:/gm) || []).length,
        includesAlpha: lastUserMessage.includes('ALPHA_E2E_CONTENT'),
        includesBeta: lastUserMessage.includes('BETA_E2E_CONTENT'),
        historyIncludesCompletedAnswer: (body.messages || []).slice(1, -1).some((message) =>
          String(message?.content || '').includes('Alpha sets the Tuesday checkpoint')),
        historyIncludesInlineCitationLink: (body.messages || []).slice(1, -1).some((message) =>
          /\[\[1\]\]\(http/.test(String(message?.content || ''))),
        historyIncludesSourcesAppendix: (body.messages || []).slice(1, -1).some((message) =>
          /### Sources/i.test(String(message?.content || ''))),
        firstChunkAt: 0,
        doneSentAt: 0,
        clientClosedAt: 0,
        serverEndCalledAt: 0,
      };
      requests.push(record);

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      response.flushHeaders?.();

      const responseTimers = [];
      const responseSchedule = (callback, delay) => {
        const timer = schedule(callback, delay);
        responseTimers.push(timer);
        return timer;
      };
      response.on('close', () => {
        record.clientClosedAt = Date.now();
        for (const timer of responseTimers) {
          clearTimeout(timer);
          timers.delete(timer);
        }
      });
      const sendDelta = (text) => {
        if (response.destroyed || response.writableEnded) return;
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      };

      record.firstChunkAt = Date.now();
      if (mode === 'stop') {
        sendDelta('Partial answer from Alpha [1]');
        responseSchedule(() => sendDelta(' while the provider is still streaming'), 180);
        responseSchedule(() => {
          if (response.destroyed || response.writableEnded) return;
          record.serverEndCalledAt = Date.now();
          response.end();
        }, 30_000);
        return;
      }

      sendDelta('Alpha sets the Tuesday checkpoint [1]');
      responseSchedule(() => {
        if (response.destroyed || response.writableEnded) return;
        record.doneSentAt = Date.now();
        response.write('data: [DONE]\n\n');
      }, 160);
      responseSchedule(() => {
        if (response.destroyed || response.writableEnded) return;
        record.serverEndCalledAt = Date.now();
        response.end();
      }, 10_000);
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    baseUrl: `${origin}/v1`,
    sourceAlphaUrl: `${origin}/source-alpha`,
    sourceBetaUrl: `${origin}/source-beta`,
    tidyPrimaryUrl: `${origin}/tidy-primary`,
    tidySecondaryUrl: `${origin}/tidy-secondary`,
    tidyPrimaryTitle,
    tidySecondaryTitle,
    originPattern: 'http://127.0.0.1/*',
    autoGroupDormantUrl,
    autoGroupTargetTitle,
    requests,
    pageHits,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1500);
        server.close(() => {
          clearTimeout(timeout);
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
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
  const arcSidebarFixturePath = join(repoRoot, 'tests/fixtures/arc-sidebar.json');
  progress('starting local Ask Page fixtures and OpenAI-compatible SSE fixture');
  const askFixtureServer = await startAskFixtureServer();
  progress('building an isolated extension fixture without local secrets');
  const extensionFixture = await createExtensionFixture({
    hostPermissions: ['https://*/*', 'http://*/*'],
  });
  const downloadDir = await mkdtemp(join(tmpdir(), 'space-extension-downloads-'));
  let chrome;
  let client;
  try {
    progress('starting isolated Chrome with a DevTools pipe');
    chrome = await startChromeWithPipe();
    client = createPipeClient(chrome.pipeWrite, chrome.pipeRead, chrome.child);
    await client.ready;
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    }, '');
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
    await evaluate(client, `document.querySelector('[data-onboarding-path="arc"]').click()`);
    await waitFor(client, `!document.querySelector('#onboardingArcStep')?.hidden &&
      document.querySelector('#onboardingStepLabel')?.textContent === 'Step 2 of 3'`);
    const arcPickerCancelState = await evaluate(client, `(async () => {
      const input = document.querySelector('#onboardingArcInput');
      let nativeInputClicks = 0;
      input.click = () => {
        nativeInputClicks += 1;
        input.dispatchEvent(new Event('cancel', { bubbles: true }));
      };
      document.querySelector('#onboardingArcChooseButton').click();
      await Promise.resolve();
      const stored = await chrome.storage.local.get('spaceTabsState');
      return {
        nativeInputClicks,
        isFileInput: input instanceof HTMLInputElement && input.type === 'file',
        acceptsJson: input.accept.includes('.json'),
        dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
        arcStepVisible: !document.querySelector('#onboardingArcStep')?.hidden,
        stepLabel: document.querySelector('#onboardingStepLabel')?.textContent || '',
        completed: stored.spaceTabsState?.onboarding?.completed === true,
        nextDisabled: Boolean(document.querySelector('#onboardingNextButton')?.disabled),
      };
    })()`);
    record(
      'Arc uses the native file input and Cancel does not dismiss or complete setup',
      arcPickerCancelState.nativeInputClicks === 1 &&
        arcPickerCancelState.isFileInput &&
        arcPickerCancelState.acceptsJson &&
        arcPickerCancelState.dialogOpen &&
        arcPickerCancelState.arcStepVisible &&
        arcPickerCancelState.stepLabel === 'Step 2 of 3' &&
        !arcPickerCancelState.completed &&
        arcPickerCancelState.nextDisabled,
      JSON.stringify(arcPickerCancelState),
    );
    await setFileInputWithCDP(client, '#onboardingArcInput', arcSidebarFixturePath);
    const arcPreviewState = await waitFor(client, `(() => {
      const rows = [...document.querySelectorAll('#onboardingArcSpaces .onboarding-space-option')];
      const status = document.querySelector('#onboardingArcStatus')?.textContent || '';
      if (rows.length !== 2 || !status.includes('Preview: 2 Spaces, 1 folders, 3 tabs')) return null;
      return {
        status,
        nextText: document.querySelector('#onboardingNextButton')?.textContent || '',
        nextDisabled: Boolean(document.querySelector('#onboardingNextButton')?.disabled),
        rows: rows.map((row) => ({
          name: row.querySelector('strong')?.textContent || '',
          detail: row.querySelector('small')?.textContent || '',
          checked: Boolean(row.querySelector('input')?.checked),
          conflict: Boolean(row.querySelector('small')?.classList.contains('conflict')),
        })),
      };
    })()`);
    const arcConflictRow = arcPreviewState.rows.find((row) => row.name === 'Default (Arc)');
    const arcPersonalRow = arcPreviewState.rows.find((row) => row.name === 'Arc Personal');
    record(
      'Arc setup previews per-Space counts and resolved naming conflicts',
      arcPreviewState.status === 'arc-sidebar.json · Preview: 2 Spaces, 1 folders, 3 tabs from sidebarSyncState. 1 naming conflict was resolved and shown below.' &&
        arcPreviewState.nextText === 'Import selected Spaces' &&
        !arcPreviewState.nextDisabled &&
        arcConflictRow?.checked === true &&
        arcConflictRow?.conflict === true &&
        arcConflictRow?.detail === '1 folders · 2 tabs · Default → Default (Arc)' &&
        arcPersonalRow?.checked === true &&
        arcPersonalRow?.detail === '0 folders · 1 tabs',
      JSON.stringify(arcPreviewState),
    );

    await evaluate(client, `document.querySelector('#onboardingBackButton').click()`);
    await waitFor(client, `!document.querySelector('#onboardingChooseStep')?.hidden &&
      document.querySelector('#onboardingStepLabel')?.textContent === 'Step 1 of 3'`);
    await evaluate(client, `document.querySelector('[data-onboarding-path="arc"]').click()`);
    const clearedArcPreviewState = await waitFor(client, `(() => {
      const input = document.querySelector('#onboardingArcInput');
      if (document.querySelector('#onboardingArcStep')?.hidden ||
          document.querySelector('#onboardingStepLabel')?.textContent !== 'Step 2 of 3') return null;
      return {
        status: document.querySelector('#onboardingArcStatus')?.textContent || '',
        rows: document.querySelectorAll('#onboardingArcSpaces .onboarding-space-option').length,
        selectedFiles: input?.files?.length || 0,
        nextDisabled: Boolean(document.querySelector('#onboardingNextButton')?.disabled),
        chooseText: document.querySelector('#onboardingArcChooseButton')?.textContent || '',
      };
    })()`);
    record(
      'Arc Back clears the valid preview before the user re-enters the import step',
      clearedArcPreviewState.status === 'No Arc file selected.' &&
        clearedArcPreviewState.rows === 0 &&
        clearedArcPreviewState.selectedFiles === 0 &&
        clearedArcPreviewState.nextDisabled &&
        clearedArcPreviewState.chooseText === 'Choose Arc file',
      JSON.stringify(clearedArcPreviewState),
    );
    await setFileInputWithCDP(client, '#onboardingArcInput', arcSidebarFixturePath);
    await waitFor(client, `document.querySelectorAll('#onboardingArcSpaces .onboarding-space-option').length === 2 &&
      document.querySelector('#onboardingArcStatus')?.textContent.includes('Preview: 2 Spaces, 1 folders, 3 tabs')`);

    const arcSelectionState = await evaluate(client, `(() => {
      const rows = [...document.querySelectorAll('#onboardingArcSpaces .onboarding-space-option')];
      const personal = rows.find((row) => row.querySelector('strong')?.textContent === 'Arc Personal');
      personal.querySelector('input').click();
      return {
        selected: rows
          .filter((row) => row.querySelector('input')?.checked)
          .map((row) => row.querySelector('strong')?.textContent || ''),
        nextDisabled: Boolean(document.querySelector('#onboardingNextButton')?.disabled),
      };
    })()`);
    record(
      'Arc setup lets the user import only selected Spaces',
      JSON.stringify(arcSelectionState.selected) === JSON.stringify(['Default (Arc)']) &&
        !arcSelectionState.nextDisabled,
      JSON.stringify(arcSelectionState),
    );

    await evaluate(client, `document.querySelector('#onboardingNextButton').click()`);
    const pendingArcAISetup = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const imported = (saved.spaces || []).find((space) => space.name === 'Default (Arc)');
      const snapshot = imported ? saved.spaceSnapshots?.[imported.id] : null;
      const importedTabs = (snapshot?.groups || [])
        .reduce((sum, group) => sum + (group.tabs || []).length, 0);
      if (!imported || document.querySelector('#onboardingFinishStep')?.hidden) return null;
      return {
        imported,
        importedTabs,
        unselectedImported: (saved.spaces || []).some((space) => space.name === 'Arc Personal'),
        completed: saved.onboarding?.completed === true,
        onboardingStage: saved.onboarding?.stage || '',
        stepLabel: document.querySelector('#onboardingStepLabel')?.textContent || '',
        lastArcImport: saved.lastArcImport,
        finishMessage: document.querySelector('#onboardingFinishMessage')?.textContent || '',
        aiStepVisible: !document.querySelector('#onboardingFinishStep')?.hidden,
        providerOptions: document.querySelector('#onboardingProviderInput')?.options.length || 0,
        removedControlsAbsent: [
          '#onboardingSkipAIButton',
          '#onboardingExportButton',
          '#onboardingUndoArcButton',
        ].every((selector) => !document.querySelector(selector)),
        saveText: document.querySelector('#onboardingOpenWorkbenchButton')?.textContent || '',
        saveDisabled: Boolean(document.querySelector('#onboardingOpenWorkbenchButton')?.disabled),
      };
    })()`, 12000);
    record(
      'Arc import reaches optional AI step without completing onboarding early',
      pendingArcAISetup.importedTabs === 2 &&
        !pendingArcAISetup.unselectedImported &&
        !pendingArcAISetup.completed &&
        pendingArcAISetup.onboardingStage === 'ai' &&
        pendingArcAISetup.stepLabel === 'Step 3 of 3' &&
        pendingArcAISetup.aiStepVisible &&
        pendingArcAISetup.providerOptions > 1 &&
        pendingArcAISetup.removedControlsAbsent &&
        pendingArcAISetup.saveText === 'Save' &&
        !pendingArcAISetup.saveDisabled &&
        JSON.stringify(pendingArcAISetup.lastArcImport?.spaceIds) === JSON.stringify([pendingArcAISetup.imported.id]) &&
        pendingArcAISetup.finishMessage === 'Imported 1 Arc Spaces and 2 saved tabs. Your current Space stayed open.',
      JSON.stringify(pendingArcAISetup),
    );

    await evaluate(client, `document.querySelector('#onboardingOpenWorkbenchButton').click()`);
    const completedArcSetup = await waitFor(client, `(async () => {
      const [stored, secret] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.storage.session.get('spaceTabsSecrets'),
      ]);
      const saved = stored.spaceTabsState || {};
      if (document.querySelector('#onboardingDialog')?.open ||
          saved.onboarding?.completed !== true || saved.onboarding?.stage !== 'done') return null;
      return {
        completed: saved.onboarding.completed,
        stage: saved.onboarding.stage,
        importedPresent: (saved.spaces || []).some((space) =>
          space.id === ${JSON.stringify(pendingArcAISetup.imported.id)}),
        setupReminder: Boolean(document.querySelector('.setup-space')),
        aiBaseUrl: saved.ai?.baseUrl || '',
        aiModel: saved.ai?.model || '',
        sessionKeyLength: String(secret.spaceTabsSecrets?.ai?.apiKey || '').length,
      };
    })()`);
    record(
      'The sole Save action completes optional AI setup without a provider',
      completedArcSetup.completed && completedArcSetup.stage === 'done' &&
        completedArcSetup.importedPresent && !completedArcSetup.setupReminder &&
        !completedArcSetup.aiBaseUrl && !completedArcSetup.aiModel && completedArcSetup.sessionKeyLength === 0,
      JSON.stringify(completedArcSetup),
    );

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open &&
      !document.querySelector('#undoArcImportButton')?.disabled`);
    await evaluate(client, `document.querySelector('#undoArcImportButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Undo Arc Import' &&
      document.querySelector('#actionDialogConfirm')?.textContent === 'Undo Import'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const undoneArcSetup = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const importedId = ${JSON.stringify(pendingArcAISetup.imported.id)};
      const toast = document.querySelector('#workbenchToast')?.textContent || '';
      if (saved.lastArcImport ||
          (saved.spaces || []).some((space) => space.id === importedId) ||
          saved.spaceSnapshots?.[importedId] ||
          !toast.includes('Removed 1 imported Arc Spaces')) return null;
      return {
        completed: saved.onboarding?.completed === true,
        originalDefaultCount: (saved.spaces || []).filter((space) => space.id === 'default' && space.name === 'Default').length,
        setupReminder: Boolean(document.querySelector('.setup-space')),
        toast,
      };
    })()`, 12000);
    record(
      'Arc setup Undo removes only the import and keeps onboarding complete',
      undoneArcSetup.completed &&
        undoneArcSetup.originalDefaultCount === 1 &&
        !undoneArcSetup.setupReminder &&
        undoneArcSetup.toast === 'Removed 1 imported Arc Spaces. Open tabs were kept.',
      JSON.stringify(undoneArcSetup),
    );
    await evaluate(client, `document.querySelector('#settingsDialog button[value="cancel"]').click()`);
    await waitFor(client, `!document.querySelector('#settingsDialog')?.open`);

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

    await evaluate(client, `navigator.locks.request('space-tabs-shared-state', { mode: 'exclusive' }, async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState;
      saved.spaceSnapshots = saved.spaceSnapshots || {};
      const snapshot = saved.spaceSnapshots.default || { version: 1, updatedAt: Date.now(), groups: [] };
      snapshot.updatedAt = Date.now();
      snapshot.groups = [
        ...(snapshot.groups || []).filter((group) => group.title !== 'Historical Tag E2E'),
        {
          title: 'Historical Tag E2E',
          color: 'purple',
          tabs: [{ title: 'Saved History E2E', url: 'https://example.net/saved-history-e2e' }],
        },
      ];
      saved.spaceSnapshots.default = snapshot;
      await chrome.storage.local.set({ spaceTabsState: saved });
    })`);
    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    const dormantAutoGroupState = await waitFor(client, `(async () => {
      const message = 'Auto Group needs a configured AI provider. Add your API key in Settings.';
      const status = document.querySelector('#syncStatus')?.textContent || '';
      const toast = document.querySelector('#workbenchToast')?.textContent || '';
      if (status !== message || toast !== message) return null;
      const stored = await chrome.storage.local.get('spaceTabsState');
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const savedGroups = stored.spaceTabsState?.spaceSnapshots?.default?.groups || [];
      return {
        status,
        toast,
        tone: document.querySelector('#workbenchToast')?.dataset?.tone || '',
        previewOpen: Boolean(document.querySelector('#actionDialog')?.open),
        liveHttpTabs: (listed.tabs || []).filter((tab) => /^https?:/.test(tab.url || '')).length,
        savedTagStored: savedGroups.some((group) => group.title === 'Historical Tag E2E' &&
          (group.tabs || []).some((tab) => tab.url === 'https://example.net/saved-history-e2e')),
      };
    })()`);
    record(
      'Workbench Auto Group includes saved historical Tags before checking BYOK',
      dormantAutoGroupState.tone === 'error' &&
        dormantAutoGroupState.liveHttpTabs === 0 &&
        dormantAutoGroupState.savedTagStored &&
        !dormantAutoGroupState.previewOpen &&
        !dormantAutoGroupState.status.includes('Open saved tabs'),
      JSON.stringify(dormantAutoGroupState),
    );
    await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState;
      const snapshot = saved.spaceSnapshots?.default;
      if (snapshot) {
        snapshot.groups = (snapshot.groups || []).filter((group) => group.title !== 'Historical Tag E2E');
        if (snapshot.groups.length === 0) delete saved.spaceSnapshots.default;
      }
      await chrome.storage.local.set({ spaceTabsState: saved });
    })()`);

    const realGroup = await evaluate(client, `(async () => {
      const fixtures = [
        { url: ${JSON.stringify(askFixtureServer.tidyPrimaryUrl)}, title: ${JSON.stringify(askFixtureServer.tidyPrimaryTitle)} },
        { url: ${JSON.stringify(askFixtureServer.tidySecondaryUrl)}, title: ${JSON.stringify(askFixtureServer.tidySecondaryTitle)} },
      ];
      const first = await chrome.runtime.sendMessage({ type: 'tabs:create', url: fixtures[0].url, active: false });
      const second = await chrome.runtime.sendMessage({ type: 'tabs:create', url: fixtures[1].url, active: false });
      const createdIds = [first.tab.id, second.tab.id];
      const startedAt = Date.now();
      let stableTabs = [];
      while (Date.now() - startedAt < 10000) {
        stableTabs = await Promise.all(createdIds.map((tabId) => chrome.tabs.get(tabId)));
        if (stableTabs.every((tab, index) =>
          tab.status === 'complete' && tab.url === fixtures[index].url && tab.title === fixtures[index].title)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!stableTabs.every((tab, index) =>
        tab.status === 'complete' && tab.url === fixtures[index].url && tab.title === fixtures[index].title)) {
        throw new Error('Local Tidy fixture tabs did not reach a stable title and URL.');
      }
      const grouped = await chrome.runtime.sendMessage({
        type: 'tabs:group',
        tabIds: createdIds,
        title: 'E2E Group',
        color: 'blue',
      });
      const group = await chrome.tabGroups.get(grouped.groupId);
      const tabs = await chrome.tabs.query({ groupId: grouped.groupId });
      return {
        group,
        tabIds: tabs.map((tab) => tab.id),
        primaryTabId: first.tab.id,
        fixtures: stableTabs.map((tab) => ({ id: tab.id, status: tab.status, title: tab.title, url: tab.url })),
      };
    })()`);
    record(
      'background grouping mutates real Chrome tab groups',
      realGroup.group?.title === 'E2E Group' && realGroup.tabIds.length === 2 &&
        realGroup.fixtures.every((tab) => tab.status === 'complete'),
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
        tabId: ${JSON.stringify(realGroup.primaryTabId)},
      });
      return duplicated.tab;
    })()`);
    const stableTidyDuplicate = await waitFor(client, `(async () => {
      const tab = await chrome.tabs.get(${JSON.stringify(tidyDuplicate.id)});
      const row = document.querySelector('.tab-row[data-tab-id="${tidyDuplicate.id}"]');
      if (tab.status !== 'complete' ||
          tab.url !== ${JSON.stringify(askFixtureServer.tidyPrimaryUrl)} ||
          tab.title !== ${JSON.stringify(askFixtureServer.tidyPrimaryTitle)} ||
          row?.querySelector('.tab-title')?.textContent !== ${JSON.stringify(askFixtureServer.tidyPrimaryTitle)}) return null;
      return { id: tab.id, status: tab.status, title: tab.title, url: tab.url };
    })()`, 12000);
    record(
      'Tidy Names duplicate reaches a stable local title and URL before preview',
      stableTidyDuplicate.status === 'complete' &&
        stableTidyDuplicate.url === askFixtureServer.tidyPrimaryUrl &&
        stableTidyDuplicate.title === askFixtureServer.tidyPrimaryTitle,
      JSON.stringify(stableTidyDuplicate),
    );
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
      if (document.querySelector('#actionDialog')?.open ||
          document.querySelector('#tidyNamesButton')?.disabled) return null;
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const expectedIds = [${JSON.stringify(realGroup.primaryTabId)}, ${JSON.stringify(tidyDuplicate.id)}];
      const retainedIds = expectedIds.filter((id) => (listed.tabs || []).some((tab) => Number(tab.id) === id));
      return retainedIds.length === expectedIds.length
        ? { count: retainedIds.length, duplicateId: ${JSON.stringify(tidyDuplicate.id)} }
        : null;
    })()`);
    record(
      'Workbench Tidy Names Cancel leaves real Chrome tabs unchanged',
      tidyCancelState.count >= 2 && Number.isFinite(tidyCancelState.duplicateId),
      JSON.stringify(tidyCancelState),
    );

    const tidyBeforeApply = await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      return {
        renamedTabs: { ...(stored.spaceTabsState?.renamedTabs || {}) },
        chromeTabs: Object.fromEntries((listed.tabs || []).map((tab) => [String(tab.id), {
          title: tab.title || '',
          url: tab.url || '',
        }])),
      };
    })()`);
    await evaluate(client, `document.querySelector('#tidyNamesButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Preview Tidy Names' &&
      document.querySelector('#actionDialogConfirm')?.textContent === 'Apply tidy'`, 12000);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const tidyAppliedState = await waitFor(client, `(async () => {
      if (document.querySelector('#actionDialog')?.open ||
          document.querySelector('#tidyNamesButton')?.disabled) return null;
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const operation = [...(saved.operationHistory || [])].reverse()
        .find((item) => item?.type === 'tidy-names');
      const targetIds = Object.keys(operation?.after?.renamedTabs || {});
      if (operation?.status !== 'applied' || targetIds.length === 0) return null;
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const chromeTabs = Object.fromEntries((listed.tabs || [])
        .filter((tab) => targetIds.includes(String(tab.id)))
        .map((tab) => [String(tab.id), { title: tab.title || '', url: tab.url || '' }]));
      const panelNames = Object.fromEntries(targetIds.map((tabId) => [
        tabId,
        document.querySelector(\`.tab-row[data-tab-id="\${tabId}"] .tab-title\`)?.textContent || '',
      ]));
      const actualNames = Object.fromEntries(targetIds.map((tabId) => [
        tabId,
        saved.renamedTabs?.[tabId] || '',
      ]));
      if (!targetIds.every((tabId) =>
        actualNames[tabId] === operation.after.renamedTabs[tabId] &&
        panelNames[tabId] === operation.after.renamedTabs[tabId])) return null;
      return {
        operation,
        targetIds,
        actualNames,
        panelNames,
        chromeTabs,
        recordText: document.querySelector('#operationRecordText')?.textContent || '',
        undoText: document.querySelector('#undoOrganizationButton')?.textContent || '',
        operationRecordHidden: Boolean(document.querySelector('#operationRecord')?.hidden),
        status: document.querySelector('#syncStatus')?.textContent || '',
      };
    })()`, 15000);
    const tidyExpectedBefore = Object.fromEntries(tidyAppliedState.targetIds.map((tabId) => [
      tabId,
      Object.hasOwn(tidyBeforeApply.renamedTabs, tabId)
        ? tidyBeforeApply.renamedTabs[tabId]
        : null,
    ]));
    const tidyChromeBefore = Object.fromEntries(tidyAppliedState.targetIds.map((tabId) => [
      tabId,
      tidyBeforeApply.chromeTabs[tabId],
    ]));
    record(
      'Workbench Tidy Names Apply changes panel-only names and records a reversible operation',
      JSON.stringify(tidyAppliedState.operation.before?.renamedTabs) === JSON.stringify(tidyExpectedBefore) &&
        JSON.stringify(tidyAppliedState.chromeTabs) === JSON.stringify(tidyChromeBefore) &&
        tidyAppliedState.recordText === tidyAppliedState.operation.summary &&
        tidyAppliedState.undoText === 'Undo' &&
        !tidyAppliedState.operationRecordHidden &&
        tidyAppliedState.status.includes('in the panel only'),
      JSON.stringify({
        operation: {
          id: tidyAppliedState.operation.id,
          status: tidyAppliedState.operation.status,
          summary: tidyAppliedState.operation.summary,
        },
        targetIds: tidyAppliedState.targetIds,
        actualNames: tidyAppliedState.actualNames,
        panelNames: tidyAppliedState.panelNames,
        chromeTabsUnchanged: JSON.stringify(tidyAppliedState.chromeTabs) === JSON.stringify(tidyChromeBefore),
        status: tidyAppliedState.status,
      }),
    );

    const expiredTidyUndoState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const operation = (stored.spaceTabsState?.operationHistory || []).find((item) =>
        item?.id === ${JSON.stringify(tidyAppliedState.operation.id)});
      const elapsedMs = Date.now() - Number(operation?.createdAt || 0);
      if (operation?.status !== 'applied' || elapsedMs < 9_800 ||
          !document.querySelector('#operationRecord')?.hidden) return null;
      return {
        elapsedMs,
        operationStatus: operation.status,
        operationStillStored: true,
        bannerHidden: Boolean(document.querySelector('#operationRecord')?.hidden),
      };
    })()`, 13000);
    record(
      'Undo banner expires after 10 seconds while the operation record remains stored',
      expiredTidyUndoState.elapsedMs >= 9_800 &&
        expiredTidyUndoState.elapsedMs < 13_000 &&
        expiredTidyUndoState.operationStatus === 'applied' &&
        expiredTidyUndoState.operationStillStored &&
        expiredTidyUndoState.bannerHidden,
      JSON.stringify(expiredTidyUndoState),
    );

    // Re-age the persisted record only for the independent Undo-path check.
    // The expiry assertion above already exercised the real 10-second timer;
    // clicking a control inside a hidden banner is intentionally unsupported.
    await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const operation = (saved.operationHistory || []).find((item) =>
        item?.id === ${JSON.stringify(tidyAppliedState.operation.id)});
      if (operation) operation.createdAt = Date.now();
      await chrome.storage.local.set({ spaceTabsState: saved });
    })()`);
    await waitFor(client, `!document.querySelector('#operationRecord')?.hidden &&
      document.querySelector('#operationRecordText')?.textContent ===
        ${JSON.stringify(tidyAppliedState.operation.summary)}`, 6000);
    await clickElementWithCDP(client, '#undoOrganizationButton');
    const tidyUndoneState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const operation = (saved.operationHistory || []).find((item) =>
        item?.id === ${JSON.stringify(tidyAppliedState.operation.id)});
      if (operation?.status !== 'undone') return null;
      const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
      const targetIds = ${JSON.stringify(tidyAppliedState.targetIds)};
      return {
        operation,
        renamedTabs: { ...(saved.renamedTabs || {}) },
        chromeTabs: Object.fromEntries((listed.tabs || [])
          .filter((tab) => targetIds.includes(String(tab.id)))
          .map((tab) => [String(tab.id), { title: tab.title || '', url: tab.url || '' }])),
        status: document.querySelector('#syncStatus')?.textContent || '',
        toast: document.querySelector('#workbenchToast')?.textContent || '',
        operationRecordText: document.querySelector('#operationRecordText')?.textContent || '',
        operationRecordHidden: Boolean(document.querySelector('#operationRecord')?.hidden),
      };
    })()`, 15000);
    record(
      'Workbench Tidy Names Undo restores the exact prior names without changing Chrome tabs',
      JSON.stringify(tidyUndoneState.renamedTabs) === JSON.stringify(tidyBeforeApply.renamedTabs) &&
        JSON.stringify(tidyUndoneState.chromeTabs) === JSON.stringify(tidyChromeBefore) &&
        tidyUndoneState.status === `Undid: ${tidyAppliedState.operation.summary}.` &&
        tidyUndoneState.toast === `Undid: ${tidyAppliedState.operation.summary}.` &&
        (tidyUndoneState.operationRecordHidden ||
          tidyUndoneState.operationRecordText !== tidyAppliedState.operation.summary),
      JSON.stringify({
        operationStatus: tidyUndoneState.operation.status,
        namesRestored: JSON.stringify(tidyUndoneState.renamedTabs) ===
          JSON.stringify(tidyBeforeApply.renamedTabs),
        chromeTabsUnchanged: JSON.stringify(tidyUndoneState.chromeTabs) === JSON.stringify(tidyChromeBefore),
        status: tidyUndoneState.status,
        toast: tidyUndoneState.toast,
      }),
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
    const workbenchCreateState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const activeSpaceName = document.querySelector('#activeSpaceName')?.textContent || '';
      const visibleSpaces = [...document.querySelectorAll('.space')].map((button) => button.title);
      const locks = await navigator.locks.query();
      if (document.querySelector('#actionDialog')?.open ||
          activeSpaceName !== 'Workbench E2E' ||
          saved.activeSpaceId !== 'workbench-e2e' ||
          !visibleSpaces.includes('Remote Current') ||
          locks.held.some((lock) => lock.name === 'space-tabs-shared-state')) return null;
      return {
        activeSpaceId: saved.activeSpaceId || '',
        spaces: (saved.spaces || []).map((space) => ({ id: space.id, name: space.name })),
        defaultUrls: (saved.spaceSnapshots?.default?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
        remoteUrls: (saved.spaceSnapshots?.['remote-current']?.groups || [])
          .flatMap((group) => (group.tabs || []).map((tab) => tab.url)),
        activeSpaceName,
        visibleSpaces,
      };
    })()`, 15000);
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

    await evaluate(client, `chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true })`);
    const paletteActiveTabBefore = await waitFor(client, `(async () => {
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      return active.id === ${JSON.stringify(openedWorkbench.id)} ? active.id : null;
    })()`);
    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true, cancelable: true,
    }))`);
    await waitFor(client, `document.querySelector('#commandPaletteDialog')?.open`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#commandPaletteInput');
      input.value = '';
      input.focus();
    })()`);
    await client.send('Input.insertText', { text: 'Remote Current' });
    await waitFor(client, `(() => {
      const first = document.querySelector('#commandPaletteResults [data-command-index="0"]');
      return document.activeElement === document.querySelector('#commandPaletteInput') &&
        first?.querySelector('strong')?.textContent === 'Remote Current' &&
        first?.getAttribute('aria-selected') === 'true';
    })()`);
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
    });
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
    });
    const paletteSpaceSwitchState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      if (document.querySelector('#commandPaletteDialog')?.open ||
          stored.spaceTabsState?.activeSpaceId !== 'remote-current') return null;
      const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      return {
        activeSpaceId: stored.spaceTabsState.activeSpaceId,
        activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
        activeBrowserTabId: activeTab.id,
      };
    })()`, 20000);
    record(
      'Command Palette keyboard shortcut switches Spaces without stealing browser focus',
      paletteSpaceSwitchState.activeSpaceName === 'Remote Current' &&
        paletteSpaceSwitchState.activeBrowserTabId === paletteActiveTabBefore,
      JSON.stringify(paletteSpaceSwitchState),
    );
    progress('Command Palette Space switch passed');

    await evaluate(client, `chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true })`);
    await waitFor(client, `(async () => {
      const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      return activeTab.id === ${JSON.stringify(openedWorkbench.id)};
    })()`);
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
        activeBrowserTab: (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null,
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
      await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k', metaKey: true, bubbles: true, cancelable: true,
      }))`);
      await waitFor(client, `document.querySelector('#commandPaletteDialog')?.open`);
      await evaluate(client, `(() => {
        const input = document.querySelector('#commandPaletteInput');
        input.value = 'Remote Saved Tab';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      })()`);
      openedRemoteTab = await waitFor(client, `(async () => {
        const listed = await chrome.runtime.sendMessage({ type: 'tabs:list' });
        return (listed.tabs || []).find((tab) =>
          String(tab.url || '').startsWith('https://example.net/remote-saved')) || null;
      })()`, 12000);
    }
    record(
      'Workbench switching stays active and Command Palette opens a dormant saved tab only on user action',
      restoredRemoteState.activeSpaceName === 'Remote Current' &&
        restoredRemoteState.activeBrowserTab?.id === openedWorkbench.id &&
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

    await waitFor(client, `document.querySelector('.ask-page')`);
    const reducedAIUI = await evaluate(client, `({
      hasContext: Boolean(document.querySelector('#contextView, .context-space')),
      hasSummary: Boolean(document.querySelector('#summarizePageButton')),
      hasAsk: Boolean(document.querySelector('.ask-page')),
    })`);
    record('Context and Summary are removed while Ask remains', !reducedAIUI.hasContext && !reducedAIUI.hasSummary && reducedAIUI.hasAsk, JSON.stringify(reducedAIUI));

    const restrictedAskTab = await evaluate(client, `(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://newtab', active: true });
      await chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true });
      return { id: tab.id, url: tab.url || tab.pendingUrl || '' };
    })()`);
    await waitFor(client, `document.querySelector('#askSourceSummary')?.textContent === 'No readable page'`, 12000);

    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true, cancelable: true,
    }))`);
    await waitFor(client, `document.querySelector('#commandPaletteDialog')?.open`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#commandPaletteInput');
      input.value = 'Ask Page';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    const askPageState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const sessionKey = stored.spaceTabsState?.activeAskSessionKey || '';
      const session = stored.spaceTabsState?.askSessions?.[sessionKey];
      if (document.querySelector('#askPageView')?.hidden ||
          !session || session.tabId !== ${JSON.stringify(restrictedAskTab.id)}) return null;
      return {
        sessionKey,
        tabId: session.tabId,
        url: session.url,
        scope: document.querySelector('#askScope')?.textContent || '',
        placeholder: document.querySelector('#askPagePrompt')?.placeholder || '',
        sourceSummary: document.querySelector('#askSourceSummary')?.textContent || '',
      };
    })()`);
    record(
      'Command Palette opens a tab-and-URL-scoped Ask Page conversation',
      askPageState.sessionKey.startsWith(`tab:${restrictedAskTab.id}:chrome://newtab`) &&
        askPageState.placeholder === 'Ask about the current page' &&
        askPageState.sourceSummary === 'No readable page' &&
        !askPageState.scope.includes('Context'),
      JSON.stringify(askPageState),
    );
    await evaluate(client, `(() => {
      const input = document.querySelector('#askPagePrompt');
      input.value = 'Restricted pages must not be read';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#askAIButton').click();
    })()`);
    const restrictedAskState = await waitFor(client, `(() => {
      const message = 'Switch to an http or https page before using Ask Page.';
      const status = document.querySelector('#syncStatus')?.textContent || '';
      const toast = document.querySelector('#workbenchToast')?.textContent || '';
      if (status !== message || toast !== message) return null;
      return {
        status,
        toast,
        reviewOpen: Boolean(document.querySelector('#actionDialog')?.open),
        button: document.querySelector('#askAIButton')?.textContent || '',
      };
    })()`);
    record(
      'Ask Page rejects a restricted current page before reading or sending content',
      !restrictedAskState.reviewOpen && restrictedAskState.button === 'Ask Page' && askFixtureServer.requests.length === 0,
      JSON.stringify(restrictedAskState),
    );
    await evaluate(client, `(async () => {
      document.querySelector('#askPagePrompt').value = '';
      await chrome.tabs.remove(${JSON.stringify(restrictedAskTab.id)});
    })()`);

    const originalAskAIState = await evaluate(client, `(async () => {
      const [stored, secret] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.storage.session.get('spaceTabsSecrets'),
      ]);
      return {
        ai: stored.spaceTabsState?.ai || null,
        secret: secret.spaceTabsSecrets || null,
      };
    })()`);
    await evaluate(client, `chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true })`);
    await waitFor(client, `(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ===
        ${JSON.stringify(openedWorkbench.id)})()`);
    const askSourceTabs = await evaluate(client, `(async () => {
      const alpha = await chrome.runtime.sendMessage({
        type: 'tabs:create',
        url: ${JSON.stringify(askFixtureServer.sourceAlphaUrl)},
        active: false,
      });
      const beta = await chrome.runtime.sendMessage({
        type: 'tabs:create',
        url: ${JSON.stringify(askFixtureServer.sourceBetaUrl)},
        active: false,
      });
      return { alpha: alpha.tab, beta: beta.tab };
    })()`);
    await evaluate(client, `[...document.querySelectorAll('.space')]
      .find((button) => button.title === 'Default')?.click()`);
    await waitFor(client, `(async () => {
      const alpha = await chrome.tabs.get(${JSON.stringify(askSourceTabs.alpha.id)}).catch(() => null);
      const beta = await chrome.tabs.get(${JSON.stringify(askSourceTabs.beta.id)}).catch(() => null);
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      return alpha?.status === 'complete' && beta?.status === 'complete' &&
        document.querySelector('.tab-row[data-tab-id="${askSourceTabs.alpha.id}"]') &&
        document.querySelector('.tab-row[data-tab-id="${askSourceTabs.beta.id}"]') &&
        active?.id === ${JSON.stringify(openedWorkbench.id)};
    })()`, 12000);
    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true, cancelable: true,
    }))`);
    await waitFor(client, `document.querySelector('#commandPaletteDialog')?.open`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#commandPaletteInput');
      input.value = 'Ask Source Alpha';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    const paletteLiveTabState = await waitFor(client, `(async () => {
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      if (active.id !== ${JSON.stringify(askSourceTabs.alpha.id)}) return null;
      return { id: active.id, url: active.url, title: active.title };
    })()`);
    record(
      'Command Palette finds and focuses a live tab by title',
      paletteLiveTabState.url === askFixtureServer.sourceAlphaUrl,
      JSON.stringify(paletteLiveTabState),
    );
    progress('Command Palette live and dormant tab paths passed');
    await evaluate(client, `chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true })`);
    await waitFor(client, `(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ===
        ${JSON.stringify(openedWorkbench.id)})()`);
    await evaluate(client, `(() => {
      const selectedIds = [...document.querySelectorAll('.tab-row.selected')]
        .map((row) => row.dataset.tabId)
        .filter(Boolean);
      for (const tabId of selectedIds) {
        document.querySelector('.tab-row[data-tab-id="' + tabId + '"]')?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
      }
      for (const tabId of [${JSON.stringify(askSourceTabs.alpha.id)}, ${JSON.stringify(askSourceTabs.beta.id)}]) {
        document.querySelector('.tab-row[data-tab-id="' + tabId + '"]')?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
      }
    })()`);
    const askPageDisclosure = await waitFor(client, `(() => {
      const chips = [...document.querySelectorAll('#askSourceList .ask-source-chip')];
      if (document.querySelector('#askSourceSummary')?.textContent !== 'Current page' || chips.length !== 1) return null;
      return {
        summary: document.querySelector('#askSourceSummary')?.textContent || '',
        hint: document.querySelector('#askSourceHint')?.textContent || '',
        chips: chips.map((chip) => chip.textContent || ''),
        selectedIds: [...document.querySelectorAll('.tab-row.selected')].map((row) => Number(row.dataset.tabId)),
      };
    })()`);

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
    await evaluate(client, `(() => {
      const provider = document.querySelector('#providerInput');
      provider.value = 'openai-compatible';
      provider.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#baseUrlInput').value = ${JSON.stringify(askFixtureServer.baseUrl)};
      const model = document.querySelector('#modelInput');
      model.value = '__custom__';
      model.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#customModelInput').value = 'ask-e2e-model';
      document.querySelector('#languageInput').value = 'en';
      document.querySelector('#apiKeyInput').value = '';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    const configuredAskSettingsState = await waitFor(client, `(async () => {
      const [stored, secret] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.storage.session.get('spaceTabsSecrets'),
      ]);
      const ai = stored.spaceTabsState?.ai || {};
      if (ai.provider !== 'openai-compatible' ||
          ai.baseUrl !== ${JSON.stringify(askFixtureServer.baseUrl)} ||
          ai.model !== 'ask-e2e-model' ||
          document.querySelector('#settingsStatus')?.textContent !== 'Settings saved.') return null;
      return {
        provider: ai.provider,
        baseUrl: ai.baseUrl,
        model: ai.model,
        language: ai.language,
        sessionKeyLength: String(secret.spaceTabsSecrets?.ai?.apiKey || '').length,
      };
    })()`);
    record(
      'Workbench Settings configures the local Custom OpenAI-compatible Ask endpoint',
      configuredAskSettingsState.language === 'en' && configuredAskSettingsState.sessionKeyLength === 0,
      JSON.stringify(configuredAskSettingsState),
    );
    record(
      'Ask Page ignores selected rows and discloses only the previously active current page',
      askPageDisclosure.hint === 'Only this current page will be read after confirmation.' &&
        askPageDisclosure.chips.length === 1 &&
        askPageDisclosure.chips[0].includes('Ask Source Alpha') &&
        askPageDisclosure.selectedIds.includes(askSourceTabs.alpha.id) &&
        askPageDisclosure.selectedIds.includes(askSourceTabs.beta.id),
      JSON.stringify(askPageDisclosure),
    );

    await evaluate(client, `document.querySelector('.ask-page').click()`);
    await waitFor(client, `!document.querySelector('#askPageView')?.hidden &&
      !document.querySelector('#settingsDialog')?.open &&
      document.querySelector('#askProvider')?.textContent ===
        'Custom OpenAI-compatible · ask-e2e-model'`);
    await evaluate(client, `(() => {
      window.__askE2ECalls = { permissionRequests: 0, pageExtractions: 0, aiChats: [] };
      const requestPermission = chrome.permissions.request;
      const sendMessage = chrome.runtime.sendMessage;
      window.__askE2EOriginals = { requestPermission, sendMessage };
      chrome.permissions.request = (...args) => {
        window.__askE2ECalls.permissionRequests += 1;
        return requestPermission.apply(chrome.permissions, args);
      };
      chrome.runtime.sendMessage = (message, ...args) => {
        if (message?.type === 'pages:extract') window.__askE2ECalls.pageExtractions += 1;
        if (message?.type === 'ai:chat') {
          window.__askE2ECalls.aiChats.push({
            purpose: message.purpose || '',
            itemCount: Number.isInteger(message.itemCount) ? message.itemCount : null,
            stream: message.stream === true,
          });
        }
        return sendMessage.call(chrome.runtime, message, ...args);
      };
    })()`);
    const missingKeyBefore = await evaluate(client, `(async () => ({
      permission: await chrome.permissions.contains({ origins: [${JSON.stringify(askFixtureServer.originPattern)}] }),
      messages: document.querySelectorAll('#askMessages .ask-message').length,
      calls: { ...window.__askE2ECalls },
    }))()`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#askPagePrompt');
      input.value = 'E2E missing key must not read sources';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await clickElementWithCDP(client, '#askAIButton');
    const missingKeyAskState = await waitFor(client, `(async () => {
      const message = 'AI API key is missing. Add it in Settings before reading the current page.';
      const status = document.querySelector('#syncStatus')?.textContent || '';
      const toast = document.querySelector('#workbenchToast')?.textContent || '';
      if (status !== message || toast !== message) return null;
      return {
        status,
        toast,
        permission: await chrome.permissions.contains({ origins: [${JSON.stringify(askFixtureServer.originPattern)}] }),
        messages: document.querySelectorAll('#askMessages .ask-message').length,
        reviewOpen: Boolean(document.querySelector('#actionDialog')?.open),
        button: document.querySelector('#askAIButton')?.textContent || '',
        calls: { ...window.__askE2ECalls },
      };
    })()`);
    record(
      'Ask Page rejects a missing API key before permission, extraction, or provider traffic',
      missingKeyBefore.permission &&
        missingKeyAskState.permission &&
        missingKeyBefore.calls.permissionRequests === 0 &&
        missingKeyBefore.calls.pageExtractions === 0 &&
        missingKeyAskState.calls.permissionRequests === 0 &&
        missingKeyAskState.calls.pageExtractions === 0 &&
        missingKeyAskState.messages === missingKeyBefore.messages &&
        !missingKeyAskState.reviewOpen &&
        missingKeyAskState.button === 'Ask Page' &&
        askFixtureServer.requests.length === 0,
      JSON.stringify({ missingKeyBefore, missingKeyAskState, mockRequests: askFixtureServer.requests.length }),
    );

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
    await evaluate(client, `(() => {
      document.querySelector('#apiKeyInput').value = 'ask-e2e-key';
      document.querySelector('#saveSettingsButton').click();
    })()`);
    await waitFor(client, `(async () => {
      const secret = await chrome.storage.session.get('spaceTabsSecrets');
      return secret.spaceTabsSecrets?.ai?.apiKey === 'ask-e2e-key' &&
        document.querySelector('#settingsStatus')?.textContent === 'Settings saved.';
    })()`);

    const testAIRequestsBefore = askFixtureServer.requests
      .filter((request) => request.mode === 'test-ai').length;
    await clickElementWithCDP(client, '#testAIButton');
    await waitFor(client, `document.querySelector('#settingsStatus')?.textContent === 'AI is connected.'`, 12000);
    const testAIRequest = askFixtureServer.requests
      .filter((request) => request.mode === 'test-ai')[testAIRequestsBefore];
    const testAIChat = await evaluate(client, `window.__askE2ECalls.aiChats
      .filter((request) => request.purpose === 'test-ai').at(-1)`);
    record(
      'Test AI uses its fixed 1K output budget',
      testAIRequest?.body?.stream === false &&
        testAIRequest?.body?.max_tokens === 1_024 &&
        testAIChat?.purpose === 'test-ai' &&
        testAIChat?.itemCount === null,
      JSON.stringify({ request: {
        stream: testAIRequest?.body?.stream,
        maxTokens: testAIRequest?.body?.max_tokens,
      }, chat: testAIChat }),
    );

    await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = structuredClone(stored.spaceTabsState);
      saved.ai = saved.ai || {};
      saved.ai.maxTokens = 1;
      const snapshot = saved.spaceSnapshots?.default || {
        version: 1,
        updatedAt: Date.now(),
        groups: [],
      };
      snapshot.groups = (snapshot.groups || []).filter((group) =>
        group.title !== 'Historical Tag E2E' &&
        group.title !== ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)});
      snapshot.groups.push({
        title: 'Historical Tag E2E',
        color: 'purple',
        collapsed: false,
        tabs: [{
          title: 'Saved Historical Auto Group E2E',
          url: ${JSON.stringify(askFixtureServer.autoGroupDormantUrl)},
        }],
      });
      // Two same-named empty historical Tags recreate the persisted shadow
      // that used to render beside the real group created by Auto Group.
      snapshot.groups.push(
        {
          title: ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)},
          color: 'green',
          collapsed: false,
          tabs: [],
        },
        {
          title: ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)},
          color: 'green',
          collapsed: false,
          tabs: [],
        },
      );
      saved.spaceSnapshots = saved.spaceSnapshots || {};
      saved.spaceSnapshots.default = snapshot;
      await chrome.storage.local.set({ spaceTabsState: saved });
    })()`);
    await evaluate(client, `[...document.querySelectorAll('.space')]
      .find((button) => button.title === 'Default')?.click()`);
    await waitFor(client, `!document.querySelector('#settingsDialog')?.open &&
      !document.querySelector('#askPageView')?.hidden &&
      [...document.querySelectorAll('.group-header h2')]
        .some((heading) => heading.textContent === 'Historical Tag E2E')`, 12000);
    await evaluate(client, `window.__captureAutoGroupE2E = async () => {
      const [stored, listed] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.runtime.sendMessage({ type: 'tabs:list' }),
      ]);
      const saved = structuredClone(stored.spaceTabsState || {});
      const snapshot = structuredClone(saved.spaceSnapshots?.default || { version: 1, groups: [] });
      delete snapshot.updatedAt;
      const tabs = (listed.tabs || [])
        .map((tab) => ({
          id: Number(tab.id),
          title: tab.title || '',
          url: tab.url || '',
          groupId: Number(tab.groupId),
          index: Number(tab.index),
        }))
        .sort((left, right) => left.id - right.id);
      const groups = (listed.groups || [])
        .map((group) => ({
          id: Number(group.id),
          title: group.title || '',
          color: group.color || '',
          collapsed: Boolean(group.collapsed),
        }))
        .sort((left, right) => left.id - right.id);
      const semanticGroups = groups.map((group) => ({
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        urls: tabs
          .filter((tab) => tab.groupId === group.id)
          .map((tab) => tab.url)
          .sort(),
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const validGroupIds = new Set(groups.map((group) => group.id));
      return {
        storage: {
          snapshot,
          ai: structuredClone(saved.ai || {}),
          operationHistory: structuredClone(saved.operationHistory || []),
          groupSpaces: structuredClone(saved.groupSpaces || {}),
          tabSpaces: structuredClone(saved.tabSpaces || {}),
          tabGroups: structuredClone(saved.tabGroups || {}),
          groupOrder: structuredClone(saved.groupOrder || {}),
          virtualGroups: structuredClone(saved.virtualGroups || {}),
        },
        chrome: { tabs, groups },
        layout: {
          groups: semanticGroups,
          ungroupedUrls: tabs
            .filter((tab) => tab.groupId < 0)
            .map((tab) => tab.url)
            .sort(),
        },
        orphanGroupSpaceIds: Object.keys(saved.groupSpaces || {})
          .map(Number)
          .filter((groupId) => !validGroupIds.has(groupId))
          .sort((left, right) => left - right),
      };
    }`);
    const autoGroupFixtureBefore = await evaluate(client, `window.__captureAutoGroupE2E()`);
    const autoGroupRequestsBefore = askFixtureServer.requests
      .filter((request) => request.mode === 'auto-group').length;
    const autoGroupPermissionRequestsBefore = await evaluate(client,
      `window.__askE2ECalls.permissionRequests`);

    await evaluate(client, `(() => {
      window.__autoGroupPreviewTitles = [];
      window.__autoGroupPreviewObserver?.disconnect();
      const title = document.querySelector('#actionDialogTitle');
      window.__autoGroupPreviewObserver = new MutationObserver(() => {
        const value = title?.textContent || '';
        if (value) window.__autoGroupPreviewTitles.push(value);
      });
      window.__autoGroupPreviewObserver.observe(title, { childList: true, subtree: true, characterData: true });
    })()`);
    await clickElementWithCDP(client, '#autoGroupButton');
    let autoGroupMixedPreview;
    try {
      autoGroupMixedPreview = await waitFor(client, `(() => {
        if (!document.querySelector('#actionDialog')?.open ||
            document.querySelector('#actionDialogTitle')?.textContent !== 'Auto Group Preview') return null;
        const sections = [...document.querySelectorAll('#actionDialogPreview .action-preview-section')]
          .map((section) => ({
            title: section.querySelector('h3 span')?.textContent || '',
            count: section.querySelector('.action-preview-count')?.textContent || '',
            rows: [...section.querySelectorAll('.action-preview-item')].map((row) => ({
              title: row.querySelector('.action-preview-title')?.textContent || '',
              meta: row.querySelector('.action-preview-meta')?.textContent || '',
              badge: row.querySelector('.action-preview-badge')?.textContent || '',
              source: row.querySelector('.group-plan-source')?.textContent || '',
            })),
          }));
        const proposal = sections.find((section) =>
          section.title === ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)});
        if (!proposal) return null;
        const dialog = document.querySelector('#actionDialog');
        const form = dialog?.querySelector('.action-form');
        const preview = document.querySelector('#actionDialogPreview');
        return {
          message: document.querySelector('#actionDialogMessage')?.textContent || '',
          confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
          titles: [...new Set(window.__autoGroupPreviewTitles || [])],
          disclosure: document.querySelector('#autoGroupButton')?.getAttribute('aria-label') || '',
          scroll: {
            dialogOverflowY: dialog ? getComputedStyle(dialog).overflowY : '',
            formOverflowY: form ? getComputedStyle(form).overflowY : '',
            previewOverflowY: preview ? getComputedStyle(preview).overflowY : '',
            dialogScrollable: Boolean(dialog && dialog.scrollHeight > dialog.clientHeight + 1 &&
              /^(auto|scroll)$/.test(getComputedStyle(dialog).overflowY)),
            formScrollable: Boolean(form && form.scrollHeight > form.clientHeight + 1 &&
              /^(auto|scroll)$/.test(getComputedStyle(form).overflowY)),
          },
          sections,
          proposal,
        };
      })()`, 12000);
    } catch (error) {
      const browserState = await evaluate(client, `({
        dialogOpen: Boolean(document.querySelector('#actionDialog')?.open),
        dialogTitle: document.querySelector('#actionDialogTitle')?.textContent || '',
        confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
        status: document.querySelector('#syncStatus')?.textContent || '',
        toast: document.querySelector('#workbenchToast')?.textContent || '',
        calls: { ...window.__askE2ECalls },
      })`);
      const providerState = askFixtureServer.requests
        .filter((request) => request.mode === 'auto-group')
        .map((request) => ({
          candidateCount: request.candidates?.length || 0,
          liveCandidate: request.liveCandidate,
          savedCandidate: request.savedCandidate,
          plan: request.plan,
        }));
      throw new Error(`${error.message}\nAuto Group debug: ${JSON.stringify({ browserState, providerState })}`);
    }
    const autoGroupPreviewRequest = askFixtureServer.requests
      .filter((request) => request.mode === 'auto-group')[autoGroupRequestsBefore];
    const autoGroupChat = await evaluate(client, `window.__askE2ECalls.aiChats
      .filter((request) => request.purpose === 'auto-group').at(-1)`);
    const previewSavedRow = autoGroupMixedPreview.proposal.rows.find((row) =>
      row.title === 'Saved Historical Auto Group E2E');
    const previewLiveRow = autoGroupMixedPreview.proposal.rows.find((row) =>
      row.title === 'Ask Source Alpha');
    const previewNotSentSection = autoGroupMixedPreview.sections.find((section) =>
      section.title === 'Untouched');
    record(
      'Auto Group directly opens one concise final preview with a single scroll region',
      autoGroupMixedPreview.message.includes('2 tabs → 1 group') &&
        autoGroupMixedPreview.message.length <= 72 &&
        /(?:\d+ ms|\d+(?:\.\d+)? s)$/.test(autoGroupMixedPreview.message) &&
        !autoGroupMixedPreview.message.includes('AI proposal') &&
        !autoGroupMixedPreview.message.includes('Custom OpenAI-compatible') &&
        !autoGroupMixedPreview.message.includes('sent ') &&
        !autoGroupMixedPreview.message.includes('generated in') &&
        !autoGroupMixedPreview.message.includes('Nothing is sent until you choose Generate preview') &&
        !autoGroupMixedPreview.titles.includes('Generate Auto Group preview?') &&
        autoGroupMixedPreview.disclosure.includes('titles, simplified URLs, domains, current Tags, and live/saved status') &&
        autoGroupMixedPreview.scroll.dialogOverflowY === 'hidden' &&
        autoGroupMixedPreview.scroll.formOverflowY === 'hidden' &&
        autoGroupMixedPreview.scroll.previewOverflowY === 'auto' &&
        !autoGroupMixedPreview.scroll.dialogScrollable &&
        !autoGroupMixedPreview.scroll.formScrollable &&
        autoGroupMixedPreview.confirmText === 'Apply groups' &&
        autoGroupMixedPreview.proposal.rows.length === 2 &&
        previewSavedRow?.badge === 'Saved' &&
        previewSavedRow?.source === 'From Historical Tag E2E' &&
        previewLiveRow?.badge === 'Live' &&
        previewLiveRow?.source === 'From Ungrouped' &&
        previewNotSentSection?.rows?.some((row) => row.meta.includes('restricted URL')) &&
        autoGroupPreviewRequest?.body?.stream === false &&
        autoGroupPreviewRequest?.body?.max_tokens === 16_384 &&
        autoGroupChat?.purpose === 'auto-group' &&
        autoGroupChat?.itemCount === autoGroupPreviewRequest?.candidates?.length &&
        autoGroupChat.itemCount > 0 &&
        autoGroupChat.itemCount <= 80 &&
        autoGroupPreviewRequest?.liveCandidate?.status === 'live' &&
        autoGroupPreviewRequest?.savedCandidate?.status === 'saved' &&
        autoGroupPreviewRequest?.savedCandidate?.currentGroup === 'Historical Tag E2E' &&
        autoGroupPreviewRequest?.plan?.[0]?.tabIds?.length === 2 &&
        askFixtureServer.requests.filter((request) => request.mode === 'auto-group').length ===
          autoGroupRequestsBefore + 1 &&
        (await evaluate(client, `window.__askE2ECalls.permissionRequests`)) ===
          autoGroupPermissionRequestsBefore + 1,
      JSON.stringify({ preview: autoGroupMixedPreview, request: {
        purpose: autoGroupChat?.purpose,
        itemCount: autoGroupChat?.itemCount,
        maxTokens: autoGroupPreviewRequest?.body?.max_tokens,
        liveCandidate: autoGroupPreviewRequest?.liveCandidate,
        savedCandidate: autoGroupPreviewRequest?.savedCandidate,
        plan: autoGroupPreviewRequest?.plan,
      } }),
    );

    await clickElementWithCDP(client, '#actionDialogCancel');
    const autoGroupApplyPreviewCancelledState = await waitFor(client, `(async () => {
      if (document.querySelector('#actionDialog')?.open ||
          document.querySelector('#autoGroupButton')?.disabled) return null;
      return window.__captureAutoGroupE2E();
    })()`);
    record(
      'Auto Group generated-preview Cancel leaves real Chrome organization and relevant storage unchanged',
      askFixtureServer.requests.filter((request) => request.mode === 'auto-group').length ===
          autoGroupRequestsBefore + 1 &&
        JSON.stringify(autoGroupApplyPreviewCancelledState.chrome) === JSON.stringify(autoGroupFixtureBefore.chrome) &&
        JSON.stringify(autoGroupApplyPreviewCancelledState.storage) === JSON.stringify(autoGroupFixtureBefore.storage),
      JSON.stringify({
        providerRequests: askFixtureServer.requests
          .filter((request) => request.mode === 'auto-group').length,
        chromeUnchanged: JSON.stringify(autoGroupApplyPreviewCancelledState.chrome) ===
          JSON.stringify(autoGroupFixtureBefore.chrome),
        storageUnchanged: JSON.stringify(autoGroupApplyPreviewCancelledState.storage) ===
          JSON.stringify(autoGroupFixtureBefore.storage),
      }),
    );

    await clickElementWithCDP(client, '#autoGroupButton');
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Auto Group Preview' &&
      document.querySelector('#actionDialogConfirm')?.textContent === 'Apply groups'`, 12000);
    const autoGroupDynamicTitle = 'Ask Source Alpha (metadata changed after preview)';
    await evaluate(client, `(async () => {
      await chrome.scripting.executeScript({
        target: { tabId: ${JSON.stringify(askSourceTabs.alpha.id)} },
        func: (title) => { document.title = title; },
        args: [${JSON.stringify('Ask Source Alpha (metadata changed after preview)')}],
      });
    })()`);
    const autoGroupTitleChange = await waitFor(client, `(async () => {
      const tab = await chrome.tabs.get(${JSON.stringify(askSourceTabs.alpha.id)});
      if (tab.title !== ${JSON.stringify('Ask Source Alpha (metadata changed after preview)')}) return null;
      return { tabId: tab.id, title: tab.title, url: tab.url, groupId: tab.groupId };
    })()`);
    await clickElementWithCDP(client, '#actionDialogConfirm');
    const appliedAutoGroupState = await waitFor(client, `(async () => {
      const captured = await window.__captureAutoGroupE2E();
      const alpha = captured.chrome.tabs.find((tab) =>
        tab.id === ${JSON.stringify(askSourceTabs.alpha.id)});
      const alphaGroup = captured.chrome.groups.find((group) => group.id === alpha?.groupId);
      const historical = captured.storage.snapshot.groups?.find((group) =>
        group.title === 'Historical Tag E2E');
      const target = captured.storage.snapshot.groups?.find((group) =>
        group.title === ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)});
      const operation = [...(captured.storage.operationHistory || [])].reverse()
        .find((item) => item?.type === 'auto-group');
      const recordText = document.querySelector('#operationRecordText')?.textContent || '';
      const matchingCards = [...document.querySelectorAll('#groupsList .group-card')]
        .filter((card) => card.querySelector('.group-header h2')?.textContent ===
          ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)});
      if (alphaGroup?.title !== ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)} ||
          !historical || !target || operation?.status !== 'applied' ||
          matchingCards.length === 0 ||
          document.querySelector('#operationRecord')?.hidden ||
          recordText !== 'Auto Group organized 2 tabs') return null;
      return {
        captured,
        alphaGroup,
        historical,
        target,
        operation,
        recordText,
        matchingCards: matchingCards.map((card) => ({
          key: card.dataset.groupKey || '',
          rows: card.querySelectorAll('.tab-row').length,
        })),
        undoText: document.querySelector('#undoOrganizationButton')?.textContent || '',
        status: document.querySelector('#syncStatus')?.textContent || '',
      };
    })()`, 15000);
    const appliedSnapshotUrls = (appliedAutoGroupState.captured.storage.snapshot.groups || [])
      .flatMap((group) => (group.tabs || []).map((tab) => tab.url))
      .sort();
    const beforeSnapshotUrls = (autoGroupFixtureBefore.storage.snapshot.groups || [])
      .flatMap((group) => (group.tabs || []).map((tab) => tab.url))
      .sort();
    const autoGroupSnapshotBeforeApply = structuredClone(autoGroupFixtureBefore.storage.snapshot);
    for (const group of autoGroupSnapshotBeforeApply.groups || []) {
      for (const tab of group.tabs || []) {
        if (tab.url === askFixtureServer.sourceAlphaUrl) tab.title = autoGroupDynamicTitle;
      }
    }
    const autoGroupProviderRequestsAfterApply = askFixtureServer.requests
      .filter((request) => request.mode === 'auto-group').length;
    const autoGroupRequestsAfterApply = askFixtureServer.requests
      .filter((request) => request.mode === 'auto-group')
      .slice(autoGroupRequestsBefore, autoGroupRequestsBefore + 2);
    const autoGroupChatsAfterApply = await evaluate(client, `window.__askE2ECalls.aiChats
      .filter((request) => request.purpose === 'auto-group')`);
    const autoGroupPermissionRequestsAfterApply = await evaluate(client,
      `window.__askE2ECalls.permissionRequests`);
    record(
      'Auto Group Apply preserves history without rendering a same-name empty shadow and exposes Undo',
      appliedAutoGroupState.alphaGroup.color === 'green' &&
        appliedAutoGroupState.historical.tabs.length === 0 &&
        appliedAutoGroupState.target.tabs.some((tab) => tab.url === askFixtureServer.sourceAlphaUrl) &&
        appliedAutoGroupState.target.tabs.some((tab) => tab.url === askFixtureServer.autoGroupDormantUrl) &&
        appliedAutoGroupState.matchingCards.length === 1 &&
        appliedAutoGroupState.matchingCards[0].rows === 2 &&
        JSON.stringify(appliedSnapshotUrls) === JSON.stringify(beforeSnapshotUrls) &&
        appliedAutoGroupState.operation.spaceId === 'default' &&
        appliedAutoGroupState.undoText === 'Undo' &&
        appliedAutoGroupState.status.includes('Auto group updated Default') &&
        autoGroupTitleChange.title === autoGroupDynamicTitle &&
        autoGroupTitleChange.url === askFixtureServer.sourceAlphaUrl &&
        autoGroupProviderRequestsAfterApply === autoGroupRequestsBefore + 2 &&
        autoGroupPermissionRequestsAfterApply === autoGroupPermissionRequestsBefore + 2 &&
        !Object.hasOwn(appliedAutoGroupState.captured.storage.ai || {}, 'maxTokens') &&
        autoGroupRequestsAfterApply.length === 2 &&
        autoGroupRequestsAfterApply.every((request) => request.body?.max_tokens === 16_384) &&
        autoGroupChatsAfterApply.length >= 2 &&
        autoGroupChatsAfterApply.slice(-2).every((request) =>
          request.purpose === 'auto-group' && request.itemCount > 0 && request.itemCount <= 80),
      JSON.stringify({
        alphaGroup: appliedAutoGroupState.alphaGroup,
        historical: appliedAutoGroupState.historical,
        target: appliedAutoGroupState.target,
        matchingCards: appliedAutoGroupState.matchingCards,
        operation: {
          type: appliedAutoGroupState.operation.type,
          spaceId: appliedAutoGroupState.operation.spaceId,
          summary: appliedAutoGroupState.operation.summary,
          status: appliedAutoGroupState.operation.status,
        },
        status: appliedAutoGroupState.status,
        titleChangedAfterPreview: autoGroupTitleChange,
        providerRequests: autoGroupProviderRequestsAfterApply,
        permissionRequests: autoGroupPermissionRequestsAfterApply,
        legacyMaxTokensPresent: Object.hasOwn(appliedAutoGroupState.captured.storage.ai || {}, 'maxTokens'),
        outputBudgets: autoGroupRequestsAfterApply.map((request) => request.body?.max_tokens),
        chats: autoGroupChatsAfterApply.slice(-2),
      }),
    );

    const appliedAutoGroupId = appliedAutoGroupState.alphaGroup.id;
    await clickElementWithCDP(client, '#undoOrganizationButton');
    const undoneAutoGroupState = await waitFor(client, `(async () => {
      const captured = await window.__captureAutoGroupE2E();
      const operation = [...(captured.storage.operationHistory || [])].reverse()
        .find((item) => item?.type === 'auto-group');
      const historical = captured.storage.snapshot.groups?.find((group) =>
        group.title === 'Historical Tag E2E');
      const target = captured.storage.snapshot.groups?.find((group) =>
        group.title === ${JSON.stringify(askFixtureServer.autoGroupTargetTitle)});
      const status = document.querySelector('#syncStatus')?.textContent || '';
      if (operation?.status !== 'undone' ||
          status !== 'Undid: Auto Group organized 2 tabs.' ||
          !historical) return null;
      return {
        captured,
        operation,
        historical,
        target: target || null,
        status,
        toast: document.querySelector('#workbenchToast')?.textContent || '',
        operationRecordHidden: Boolean(document.querySelector('#operationRecord')?.hidden),
        sourceSummary: document.querySelector('#askSourceSummary')?.textContent || '',
      };
    })()`, 15000);
    const baselineOrphans = new Set(autoGroupFixtureBefore.orphanGroupSpaceIds || []);
    const newOrphansAfterUndo = (undoneAutoGroupState.captured.orphanGroupSpaceIds || [])
      .filter((groupId) => !baselineOrphans.has(groupId));
    record(
      'Auto Group Undo restores live and saved organization without orphaning or losing Tags',
      JSON.stringify(undoneAutoGroupState.captured.layout) === JSON.stringify(autoGroupFixtureBefore.layout) &&
        JSON.stringify(undoneAutoGroupState.captured.storage.snapshot) ===
          JSON.stringify(autoGroupSnapshotBeforeApply) &&
        undoneAutoGroupState.historical.tabs.some((tab) =>
          tab.url === askFixtureServer.autoGroupDormantUrl) &&
        !undoneAutoGroupState.target &&
        !undoneAutoGroupState.captured.chrome.groups.some((group) =>
          group.id === appliedAutoGroupId || group.title === askFixtureServer.autoGroupTargetTitle) &&
        !Object.hasOwn(undoneAutoGroupState.captured.storage.groupSpaces, String(appliedAutoGroupId)) &&
        newOrphansAfterUndo.length === 0 &&
        undoneAutoGroupState.operationRecordHidden &&
        undoneAutoGroupState.toast === 'Undid: Auto Group organized 2 tabs.' &&
        undoneAutoGroupState.sourceSummary === 'Current page',
      JSON.stringify({
        layoutRestored: JSON.stringify(undoneAutoGroupState.captured.layout) ===
          JSON.stringify(autoGroupFixtureBefore.layout),
        snapshotRestored: JSON.stringify(undoneAutoGroupState.captured.storage.snapshot) ===
          JSON.stringify(autoGroupSnapshotBeforeApply),
        historical: undoneAutoGroupState.historical,
        target: undoneAutoGroupState.target,
        newOrphansAfterUndo,
        operationStatus: undoneAutoGroupState.operation.status,
        status: undoneAutoGroupState.status,
      }),
    );

    const tidyAIRequestsBefore = askFixtureServer.requests
      .filter((request) => request.mode === 'tidy-names').length;
    await evaluate(client, `(() => {
      window.__tidyPreviewTitles = [];
      window.__tidyPreviewObserver?.disconnect();
      const title = document.querySelector('#actionDialogTitle');
      window.__tidyPreviewObserver = new MutationObserver(() => {
        const value = title?.textContent || '';
        if (value) window.__tidyPreviewTitles.push(value);
      });
      window.__tidyPreviewObserver.observe(title, { childList: true, subtree: true, characterData: true });
    })()`);
    await clickElementWithCDP(client, '#tidyNamesButton');
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Preview Tidy Names' &&
      document.querySelector('#actionDialogConfirm')?.textContent === 'Apply tidy'`, 12000);
    const tidyAIRequest = askFixtureServer.requests
      .filter((request) => request.mode === 'tidy-names')[tidyAIRequestsBefore];
    const tidyAIChat = await evaluate(client, `window.__askE2ECalls.aiChats
      .filter((request) => request.purpose === 'tidy-names').at(-1)`);
    const tidyDirectPreviewState = await evaluate(client, `({
      titles: [...new Set(window.__tidyPreviewTitles || [])],
      message: document.querySelector('#actionDialogMessage')?.textContent || '',
      confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
    })`);
    record(
      'Tidy Names directly opens one concise final preview with its fixed 8K budget',
      tidyAIRequest?.body?.stream === false &&
        tidyAIRequest?.body?.max_tokens === 8_192 &&
        tidyAIChat?.purpose === 'tidy-names' &&
        tidyAIChat?.itemCount === tidyAIRequest?.candidates?.length &&
        tidyAIChat.itemCount > 0 &&
        tidyAIChat.itemCount <= 80 &&
        tidyDirectPreviewState.confirmText === 'Apply tidy' &&
        /^\d+ names? · (?:\d+ ms|\d+(?:\.\d+)? s)$/.test(tidyDirectPreviewState.message) &&
        !tidyDirectPreviewState.titles.includes('Generate Tidy Names preview?'),
      JSON.stringify({ request: {
        stream: tidyAIRequest?.body?.stream,
        maxTokens: tidyAIRequest?.body?.max_tokens,
        candidateCount: tidyAIRequest?.candidates?.length,
      }, chat: tidyAIChat, preview: tidyDirectPreviewState }),
    );
    await clickElementWithCDP(client, '#actionDialogCancel');
    await waitFor(client, `!document.querySelector('#actionDialog')?.open &&
      !document.querySelector('#tidyNamesButton')?.disabled`);

    await evaluate(client, `window.__askE2ECalls = {
      permissionRequests: 0,
      pageExtractions: 0,
      aiChats: [],
    }`);

    await evaluate(client, `document.querySelector('.ask-page').click()`);
    await waitFor(client, `!document.querySelector('#askPageView')?.hidden &&
      !document.querySelector('#settingsDialog')?.open &&
      document.querySelector('#askProvider')?.textContent ===
        'Custom OpenAI-compatible · ask-e2e-model'`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#askPagePrompt');
      input.value = 'E2E complete stream: summarize this page';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await clickElementWithCDP(client, '#askAIButton');
    const askReviewState = await waitFor(client, `(async () => {
      if (!document.querySelector('#actionDialog')?.open ||
          document.querySelector('#actionDialogTitle')?.textContent !== 'Review Ask Page') return null;
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      const alpha = await chrome.tabs.get(${JSON.stringify(askSourceTabs.alpha.id)});
      const beta = await chrome.tabs.get(${JSON.stringify(askSourceTabs.beta.id)});
      const stored = await chrome.storage.local.get('spaceTabsState');
      const firstSection = document.querySelector('#actionDialogPreview .action-preview-section');
      return {
        activeTabId: active?.id,
        sourceTabsActive: [Boolean(alpha.active), Boolean(beta.active)],
        permission: await chrome.permissions.contains({ origins: [${JSON.stringify(askFixtureServer.originPattern)}] }),
        provider: document.querySelector('#askProvider')?.textContent || '',
        sourceSummary: document.querySelector('#askSourceSummary')?.textContent || '',
        sessionKey: stored.spaceTabsState?.activeAskSessionKey || '',
        calls: { ...window.__askE2ECalls },
        message: document.querySelector('#actionDialogMessage')?.textContent || '',
        sectionTitle: firstSection?.querySelector('h3 span')?.textContent || '',
        sourceItems: [...(firstSection?.querySelectorAll('.action-preview-item') || [])].map((item) => ({
          title: item.querySelector('.action-preview-title')?.textContent || '',
          chars: item.querySelector('.action-preview-result')?.textContent || '',
          url: item.querySelector('.action-preview-meta')?.textContent || '',
        })),
        confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
      };
    })()`, 12000);
    record(
      'Ask Page reads only the previously active page while Workbench stays active and shows a complete Review',
      askReviewState.activeTabId === openedWorkbench.id &&
        askReviewState.sourceTabsActive.every((active) => !active) &&
        askReviewState.permission &&
        askReviewState.calls.permissionRequests === 1 &&
        askReviewState.calls.pageExtractions === 1 &&
        askReviewState.provider === 'Custom OpenAI-compatible · ask-e2e-model' &&
        askReviewState.sourceSummary === 'Current page' &&
        askReviewState.sessionKey.startsWith(`tab:${askSourceTabs.alpha.id}:${askFixtureServer.sourceAlphaUrl}`) &&
        askReviewState.message.includes('Custom OpenAI-compatible · ask-e2e-model') &&
        /\d+ chars from the current page/.test(askReviewState.message) &&
        askReviewState.sectionTitle === 'Current page' &&
        askReviewState.sourceItems.length === 1 &&
        askReviewState.sourceItems.every((item) => /\d+ chars/.test(item.chars)) &&
        askReviewState.sourceItems[0]?.url === askFixtureServer.sourceAlphaUrl &&
        askReviewState.confirmText === 'Send to provider',
      JSON.stringify({
        askPageDisclosure,
        askReviewState,
        permissionFlow: 'trusted CDP pointer click with temporary unpacked-fixture host preauthorization',
      }),
    );

    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const completedAskState = await waitFor(client, `(() => {
      const messages = [...document.querySelectorAll('#askMessages .ask-message.assistant')];
      const answer = messages.at(-1);
      if (!answer?.textContent?.includes('Alpha sets the Tuesday checkpoint') ||
          document.querySelector('#askAIButton')?.textContent !== 'Ask Page') return null;
      return {
        text: answer.textContent || '',
        links: [...answer.querySelectorAll('a')].map((link) => ({
          href: link.href,
          target: link.target,
          text: link.textContent || '',
        })),
        button: document.querySelector('#askAIButton')?.textContent || '',
      };
    })()`, 12000);
    const completedAskAt = Date.now();
    const completedMockRequest = askFixtureServer.requests.find((request) => request.mode === 'complete');
    const completedAskChat = await evaluate(client, `window.__askE2ECalls.aiChats
      .filter((request) => request.purpose === 'ask-page').at(-1)`);
    record(
      'Ask Page streams a cited result and renders one clickable Source',
      completedAskState.text.includes('Sources') &&
        completedAskState.links.some((link) => link.href === askFixtureServer.sourceAlphaUrl && link.target === '_blank') &&
        !completedAskState.links.some((link) => link.href === askFixtureServer.sourceBetaUrl) &&
        completedAskState.button === 'Ask Page',
      JSON.stringify(completedAskState),
    );
    record(
      'Ask Page sends only the current page to the OpenAI-compatible mock',
      completedMockRequest?.body?.stream === true &&
        completedMockRequest?.body?.max_tokens === 32_768 &&
        completedMockRequest.sourceCount === 1 &&
        completedMockRequest.includesAlpha &&
        !completedMockRequest.includesBeta &&
        completedAskChat?.purpose === 'ask-page' &&
        completedAskChat?.itemCount === null,
      JSON.stringify({
        sourceCount: completedMockRequest?.sourceCount,
        includesAlpha: completedMockRequest?.includesAlpha,
        includesBeta: completedMockRequest?.includesBeta,
        stream: completedMockRequest?.body?.stream,
        maxTokens: completedMockRequest?.body?.max_tokens,
        chat: completedAskChat,
      }),
    );
    record(
      'Ask Page finishes on SSE [DONE] without waiting for the held-open connection',
      completedMockRequest?.doneSentAt > 0 &&
        completedMockRequest.serverEndCalledAt === 0 &&
        completedAskAt - completedMockRequest.doneSentAt < 2500,
      JSON.stringify({
        doneSentAt: completedMockRequest?.doneSentAt,
        completedAskAt,
        elapsedAfterDone: completedMockRequest ? completedAskAt - completedMockRequest.doneSentAt : null,
        clientClosedAt: completedMockRequest?.clientClosedAt,
        serverEndCalledAt: completedMockRequest?.serverEndCalledAt,
      }),
    );

    const tabsBeforeSourceLink = await evaluate(client, `(async () =>
      (await chrome.tabs.query({})).map((tab) => tab.id))()`);
    await clickElementWithCDP(
      client,
      `.ask-message.assistant a[href="${askFixtureServer.sourceAlphaUrl}"]`,
    );
    const openedSourceLinkTab = await waitFor(client, `(async () => {
      const previous = new Set(${JSON.stringify(tabsBeforeSourceLink)});
      return (await chrome.tabs.query({})).find((tab) =>
        !previous.has(tab.id) && tab.url === ${JSON.stringify(askFixtureServer.sourceAlphaUrl)}) || null;
    })()`);
    record(
      'Ask Page source links open the cited page in a real Chrome tab',
      Number.isFinite(openedSourceLinkTab?.id),
      JSON.stringify(openedSourceLinkTab),
    );
    await evaluate(client, `(async () => {
      await chrome.tabs.remove(${JSON.stringify(openedSourceLinkTab.id)});
      await chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true });
    })()`);
    await waitFor(client, `(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id ===
        ${JSON.stringify(openedWorkbench.id)})()`);

    await evaluate(client, `(() => {
      const input = document.querySelector('#askPagePrompt');
      input.value = 'E2E stop stream: keep sending until stopped';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await clickElementWithCDP(client, '#askAIButton');
    const stopAskReview = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open ||
          document.querySelector('#actionDialogTitle')?.textContent !== 'Review Ask Page') return null;
      return { message: document.querySelector('#actionDialogMessage')?.textContent || '' };
    })()`, 12000);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const streamingPartialState = await waitFor(client, `(() => {
      const answers = [...document.querySelectorAll('#askMessages .ask-message.assistant')];
      const answer = answers.at(-1)?.textContent || '';
      return document.querySelector('#askAIButton')?.textContent === 'Stop' &&
        answer.includes('Partial answer from Alpha')
        ? { answer, button: 'Stop' }
        : null;
    })()`, 12000);
    await clickElementWithCDP(client, '#askAIButton');
    const stoppedAskState = await waitFor(client, `(() => {
      const answers = [...document.querySelectorAll('#askMessages .ask-message.assistant')];
      const answer = answers.at(-1);
      const text = answer?.textContent || '';
      if (document.querySelector('#askAIButton')?.textContent !== 'Ask Page' ||
          !text.includes('Partial answer from Alpha') ||
          !text.includes('Request stopped before completion.')) return null;
      return {
        text,
        sourceLinks: [...answer.querySelectorAll('a')].map((link) => link.href),
        status: document.querySelector('#syncStatus')?.textContent || '',
      };
    })()`, 12000);
    const stoppedMockRequest = askFixtureServer.requests.find((request) => request.mode === 'stop');
    record(
      'Ask Page Stop preserves the streamed partial answer and cited Source',
      streamingPartialState.button === 'Stop' &&
        stoppedAskState.status === 'Ask stopped.' &&
        stoppedAskState.sourceLinks.includes(askFixtureServer.sourceAlphaUrl) &&
        !stoppedAskState.sourceLinks.includes(askFixtureServer.sourceBetaUrl) &&
        stoppedMockRequest?.sourceCount === 1 &&
        stopAskReview.message.includes('stored text from 2 recent conversation messages') &&
        stopAskReview.message.includes('generated Sources appendix excluded') &&
        stoppedMockRequest.historyIncludesCompletedAnswer &&
        stoppedMockRequest.historyIncludesInlineCitationLink &&
        !stoppedMockRequest.historyIncludesSourcesAppendix &&
        stoppedMockRequest.clientClosedAt > 0 &&
        stoppedMockRequest.doneSentAt === 0,
      JSON.stringify({ streamingPartialState, stoppedAskState, stoppedMockRequest: {
        sourceCount: stoppedMockRequest?.sourceCount,
        stopAskReview,
        historyIncludesCompletedAnswer: stoppedMockRequest?.historyIncludesCompletedAnswer,
        historyIncludesInlineCitationLink: stoppedMockRequest?.historyIncludesInlineCitationLink,
        historyIncludesSourcesAppendix: stoppedMockRequest?.historyIncludesSourcesAppendix,
        clientClosedAt: stoppedMockRequest?.clientClosedAt,
        doneSentAt: stoppedMockRequest?.doneSentAt,
      } }),
    );

    await evaluate(client, `(async () => {
      await chrome.tabs.remove([
        ${JSON.stringify(askSourceTabs.alpha.id)},
        ${JSON.stringify(askSourceTabs.beta.id)},
      ]).catch(() => null);
      const stored = await chrome.storage.local.get('spaceTabsState');
      stored.spaceTabsState.ai = ${JSON.stringify(originalAskAIState.ai)};
      await chrome.storage.local.set({ spaceTabsState: stored.spaceTabsState });
      const originalSecret = ${JSON.stringify(originalAskAIState.secret)};
      if (originalSecret) await chrome.storage.session.set({ spaceTabsSecrets: originalSecret });
      else await chrome.storage.session.remove('spaceTabsSecrets');
      await chrome.permissions.remove({ origins: [${JSON.stringify(askFixtureServer.originPattern)}] }).catch(() => false);
      if (window.__askE2EOriginals) {
        chrome.permissions.request = window.__askE2EOriginals.requestPermission;
        chrome.runtime.sendMessage = window.__askE2EOriginals.sendMessage;
        delete window.__askE2EOriginals;
      }
    })()`);
    await evaluate(client, `document.querySelector('.ask-page').click()`);
    await waitFor(client, `!document.querySelector('#askPageView')?.hidden &&
      !document.querySelector('#settingsDialog')?.open &&
      document.querySelector('#askProvider')?.textContent !==
        'Custom OpenAI-compatible · ask-e2e-model'`);

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open && document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]')`);
    const defaultAISettings = await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const settingsText = document.querySelector('#settingsDialog')?.textContent || '';
      return {
        maxTokensInputPresent: Boolean(document.querySelector('#maxTokensInput')),
        hasMaxOutputCopy: /Max output/i.test(settingsText),
        storedHasMaxTokens: Object.hasOwn(stored.spaceTabsState?.ai || {}, 'maxTokens'),
        keyStatus: document.querySelector('#apiKeyStatus')?.textContent || '',
        providerOptions: document.querySelector('#providerInput')?.options.length || 0,
        modelOptions: document.querySelector('#modelInput')?.options.length || 0,
      };
    })()`);
    record(
      'AI Settings removes Max output and migrated storage no longer carries the legacy override',
      !defaultAISettings.maxTokensInputPresent &&
        !defaultAISettings.hasMaxOutputCopy &&
        !defaultAISettings.storedHasMaxTokens &&
        defaultAISettings.keyStatus === 'No API key configured.' &&
        defaultAISettings.providerOptions > 1 &&
        defaultAISettings.modelOptions > 0,
      JSON.stringify(defaultAISettings),
    );
    await evaluate(client, `(() => {
      const provider = document.querySelector('#providerInput');
      provider.value = 'openai';
      provider.dispatchEvent(new Event('change', { bubbles: true }));
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

    await evaluate(client, `chrome.tabs.update(${JSON.stringify(openedWorkbench.id)}, { active: true })`);
    await waitFor(client, `(async () => {
      const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      return activeTab.id === ${JSON.stringify(openedWorkbench.id)};
    })()`);
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
    await evaluate(client, `document.querySelector('[data-onboarding-path="fresh"]').click()`);
    await waitFor(client, `!document.querySelector('#onboardingFreshStep')?.hidden &&
      document.querySelector('#onboardingStepLabel')?.textContent === 'Step 2 of 3'`);
    await evaluate(client, `(() => {
      const input = document.querySelector('#onboardingSpaceNameInput');
      input.value = 'Setup E2E';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#onboardingNextButton').click();
    })()`);
    const pendingFreshAISetup = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
      const setupSpace = (stored.spaceTabsState?.spaces || []).find((space) => space.name === 'Setup E2E');
      if (!setupSpace || document.querySelector('#onboardingFinishStep')?.hidden) return null;
      return {
        setupSpace,
        activeSpaceId: stored.spaceTabsState?.activeSpaceId || '',
        completed: stored.spaceTabsState?.onboarding?.completed === true,
        onboardingStage: stored.spaceTabsState?.onboarding?.stage || '',
        stepLabel: document.querySelector('#onboardingStepLabel')?.textContent || '',
        finishMessage: document.querySelector('#onboardingFinishMessage')?.textContent || '',
        provider: document.querySelector('#onboardingProviderInput')?.value || '',
        model: document.querySelector('#onboardingModelInput')?.value || '',
        customModel: document.querySelector('#onboardingCustomModelInput')?.value || '',
        apiKeyLength: document.querySelector('#onboardingApiKeyInput')?.value?.length || 0,
        saveText: document.querySelector('#onboardingOpenWorkbenchButton')?.textContent || '',
        removedControlsAbsent: [
          '#onboardingSkipAIButton',
          '#onboardingExportButton',
          '#onboardingUndoArcButton',
        ].every((selector) => !document.querySelector(selector)),
        saveDisabled: Boolean(document.querySelector('#onboardingOpenWorkbenchButton')?.disabled),
        activeTab,
      };
    })()`, 12000);
    record(
      'Fresh setup reaches the optional AI third step before completion',
      pendingFreshAISetup.activeSpaceId === pendingFreshAISetup.setupSpace.id &&
        !pendingFreshAISetup.completed &&
        pendingFreshAISetup.onboardingStage === 'ai' &&
        pendingFreshAISetup.stepLabel === 'Step 3 of 3' &&
        pendingFreshAISetup.finishMessage === 'Setup E2E is ready.' &&
        pendingFreshAISetup.provider === 'openai' &&
        pendingFreshAISetup.model.length > 0 &&
        pendingFreshAISetup.apiKeyLength === 0 &&
        pendingFreshAISetup.saveText === 'Save' &&
        pendingFreshAISetup.removedControlsAbsent &&
        pendingFreshAISetup.saveDisabled &&
        pendingFreshAISetup.activeTab?.id === openedWorkbench.id,
      JSON.stringify(pendingFreshAISetup),
    );
    await evaluate(client, `(() => {
      const input = document.querySelector('#onboardingApiKeyInput');
      input.value = 'setup-e2e-key';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(client, `!document.querySelector('#onboardingOpenWorkbenchButton')?.disabled`);
    await evaluate(client, `document.querySelector('#onboardingOpenWorkbenchButton').click()`);
    const completedSetupSurfaceState = await waitFor(client, `(async () => {
      const [stored, session] = await Promise.all([
        chrome.storage.local.get('spaceTabsState'),
        chrome.storage.session.get('spaceTabsSecrets'),
      ]);
      if (document.querySelector('#onboardingDialog')?.open ||
          stored.spaceTabsState?.onboarding?.completed !== true ||
          stored.spaceTabsState?.onboarding?.stage !== 'done' ||
          session.spaceTabsSecrets?.ai?.apiKey !== 'setup-e2e-key') return null;
      return {
        workbench: new URLSearchParams(location.search).get('layout') === 'workbench',
        misleadingStayAction: Boolean(document.querySelector('#onboardingStayButton')),
        activeTabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id || null,
        completed: stored.spaceTabsState.onboarding.completed,
        stage: stored.spaceTabsState.onboarding.stage,
        localApiKeyLength: String(stored.spaceTabsState?.ai?.apiKey || '').length,
        sessionKeyLength: String(session.spaceTabsSecrets?.ai?.apiKey || '').length,
      };
    })()`);
    record(
      'Saving onboarding AI completes setup, keeps the key session-only, and stays in Workbench',
      completedSetupSurfaceState.workbench &&
        !completedSetupSurfaceState.misleadingStayAction &&
        completedSetupSurfaceState.activeTabId === openedWorkbench.id &&
        completedSetupSurfaceState.completed &&
        completedSetupSurfaceState.stage === 'done' &&
        completedSetupSurfaceState.localApiKeyLength === 0 &&
        completedSetupSurfaceState.sessionKeyLength === 'setup-e2e-key'.length,
      JSON.stringify(completedSetupSurfaceState),
    );

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
    progress('real backup download started');
    const downloadedBackup = await waitForJsonDownload(downloadDir);
    const exportedBackupState = {
      filename: downloadedBackup.name,
      format: downloadedBackup.parsed?.format || '',
      spaces: (downloadedBackup.parsed?.spaces || []).map((space) => space.name),
      hasAIState: Object.hasOwn(downloadedBackup.parsed || {}, 'ai'),
      hasApiKeyText: downloadedBackup.text.includes('apiKey'),
    };
    record(
      'Workbench export downloads a parseable portable backup without AI state',
      exportedBackupState.filename.startsWith('space-backup-') &&
        exportedBackupState.format === 'space-context-workspaces' &&
        exportedBackupState.spaces.includes('Setup E2E') &&
        !exportedBackupState.hasAIState &&
        !exportedBackupState.hasApiKeyText,
      JSON.stringify(exportedBackupState),
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
        hasMaxTokens: Object.hasOwn(saved.ai || {}, 'maxTokens'),
        addSpaceShortcut: saved.shortcuts?.addSpace,
        restoreDisabled: document.querySelector('#restoreSpaceDataButton')?.disabled,
      };
    })()`, 12000);
    record(
      'Workbench restore replaces Space data but preserves local AI and shortcuts',
      !restoredBackupState.hasMaxTokens &&
        restoredBackupState.addSpaceShortcut === 'Control+Alt+K' &&
        restoredBackupState.restoreDisabled,
      JSON.stringify(restoredBackupState),
    );

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
    await evaluate(client, `(() => {
      const file = new File(
        [${JSON.stringify(downloadedBackup.text)}],
        ${JSON.stringify(downloadedBackup.name)},
        { type: 'application/json' },
      );
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector('#spaceBackupInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(client, `!document.querySelector('#restoreSpaceDataButton')?.disabled &&
      document.querySelector('#spaceBackupStatus')?.textContent.startsWith('Ready to restore ')`);
    await evaluate(client, `document.querySelector('#restoreSpaceDataButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Restore Space Data'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const exportRoundTripState = await waitFor(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const names = (saved.spaces || []).map((space) => space.name);
      if (!names.includes('Setup E2E') || names.includes('Backup Restored')) return null;
      return {
        activeSpaceId: saved.activeSpaceId,
        names,
        hasMaxTokens: Object.hasOwn(saved.ai || {}, 'maxTokens'),
        addSpaceShortcut: saved.shortcuts?.addSpace,
      };
    })()`, 12000);
    record(
      'A real downloaded export restores end-to-end after the workspace was replaced',
      !exportRoundTripState.hasMaxTokens &&
        exportRoundTripState.addSpaceShortcut === 'Control+Alt+K',
      JSON.stringify(exportRoundTripState),
    );
    progress('real export-to-restore round trip passed');

    await evaluate(client, `document.querySelector('#settingsButton').click()`);
    await waitFor(client, `document.querySelector('#settingsDialog')?.open`);
    const beforeOversizedRestore = await evaluate(client, `(async () => {
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const withoutVolatileTimestamps = (value) => {
        if (Array.isArray(value)) return value.map(withoutVolatileTimestamps);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value)
          .filter(([key]) => key !== 'updatedAt')
          .map(([key, entry]) => [key, withoutVolatileTimestamps(entry)]));
      };
      const relevant = {
        activeSpaceId: saved.activeSpaceId,
        spaces: saved.spaces,
        spaceContexts: saved.spaceContexts,
        spaceSnapshots: saved.spaceSnapshots,
        askSessions: saved.askSessions,
      };
      return {
        relevant: JSON.stringify(withoutVolatileTimestamps(relevant)),
        bytes: await chrome.storage.local.getBytesInUse(),
      };
    })()`);
    await evaluate(client, `(() => {
      const backup = {
        format: 'space-context-workspaces',
        version: 1,
        exportedAt: new Date().toISOString(),
        activeSpaceId: 'oversized-e2e',
        spaces: [{ id: 'oversized-e2e', name: 'Oversized E2E', icon: 'O', color: 'red' }],
        spaceContexts: { 'oversized-e2e': 'x'.repeat(8 * 1024 * 1024) },
        spaceSnapshots: {},
        askSessions: {},
        collapsedSpaceGroups: {},
      };
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(backup)], 'oversized-e2e.json', { type: 'application/json' }));
      const input = document.querySelector('#spaceBackupInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(client, `!document.querySelector('#restoreSpaceDataButton')?.disabled &&
      document.querySelector('#spaceBackupStatus')?.textContent.startsWith('Ready to restore ')`, 12000);
    await evaluate(client, `document.querySelector('#restoreSpaceDataButton').click()`);
    await waitFor(client, `document.querySelector('#actionDialog')?.open &&
      document.querySelector('#actionDialogTitle')?.textContent === 'Restore Space Data'`);
    await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
    const oversizedRestoreState = await waitFor(client, `(async () => {
      const status = document.querySelector('#spaceBackupStatus')?.textContent || '';
      if (!status.includes('above the safe 8 MB budget')) return null;
      const stored = await chrome.storage.local.get('spaceTabsState');
      const saved = stored.spaceTabsState || {};
      const withoutVolatileTimestamps = (value) => {
        if (Array.isArray(value)) return value.map(withoutVolatileTimestamps);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value)
          .filter(([key]) => key !== 'updatedAt')
          .map(([key, entry]) => [key, withoutVolatileTimestamps(entry)]));
      };
      const relevant = JSON.stringify(withoutVolatileTimestamps({
        activeSpaceId: saved.activeSpaceId,
        spaces: saved.spaces,
        spaceContexts: saved.spaceContexts,
        spaceSnapshots: saved.spaceSnapshots,
        askSessions: saved.askSessions,
      }));
      return {
        status,
        relevant,
        bytes: await chrome.storage.local.getBytesInUse(),
        oversizedPersisted: (saved.spaces || []).some((space) => space.id === 'oversized-e2e') ||
          Object.hasOwn(saved.spaceContexts || {}, 'oversized-e2e') ||
          Object.hasOwn(saved.spaceSnapshots || {}, 'oversized-e2e'),
        restoreStillEnabled: !document.querySelector('#restoreSpaceDataButton')?.disabled,
      };
    })()`, 12000);
    record(
      'Oversized restore is rejected before persistence and leaves the workspace unchanged',
      oversizedRestoreState.relevant === beforeOversizedRestore.relevant &&
        !oversizedRestoreState.oversizedPersisted &&
        oversizedRestoreState.restoreStillEnabled,
      JSON.stringify({
        status: oversizedRestoreState.status,
        workspaceUnchanged: oversizedRestoreState.relevant === beforeOversizedRestore.relevant,
        bytesBefore: beforeOversizedRestore.bytes,
        bytesAfter: oversizedRestoreState.bytes,
        oversizedPersisted: oversizedRestoreState.oversizedPersisted,
        restoreStillEnabled: oversizedRestoreState.restoreStillEnabled,
      }),
    );
    progress('oversized restore rollback passed');
    await evaluate(client, `document.querySelector('#settingsDialog').close()`);

    progress('checking Workbench de-duplication');
    const openUniqueSetup = await evaluate(client, `(async () => {
      const matchUrl = chrome.runtime.getURL('sidepanel.html?layout=workbench');
      const current = await chrome.tabs.getCurrent();
      await chrome.tabs.update(current.id, { active: true });
      const url = current.url || location.href;
      const duplicate = await chrome.tabs.create({ url: matchUrl, active: false });
      return { url, matchUrl, currentTabId: current.id, duplicateId: duplicate.id };
    })()`);
    progress('Workbench duplicate created');
    const firstOpenUnique = await evaluate(client, `(async () => chrome.runtime.sendMessage({
      type: 'tabs:openUnique',
      url: ${JSON.stringify(openUniqueSetup.url)},
      matchUrl: ${JSON.stringify(openUniqueSetup.matchUrl)},
      preferredTabId: ${JSON.stringify(openUniqueSetup.currentTabId)},
    }))()`);
    progress('first Workbench de-duplication request passed');
    const secondOpenUnique = await evaluate(client, `(async () => chrome.runtime.sendMessage({
      type: 'tabs:openUnique',
      url: ${JSON.stringify(openUniqueSetup.url)},
      matchUrl: ${JSON.stringify(openUniqueSetup.matchUrl)},
      preferredTabId: ${JSON.stringify(openUniqueSetup.currentTabId)},
    }))()`);
    const openUniqueResults = { first: firstOpenUnique, second: secondOpenUnique };
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
    await askFixtureServer.close();
    await extensionFixture.close();
    await rm(downloadDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
