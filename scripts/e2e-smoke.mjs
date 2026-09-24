import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArcImportPlan } from '../src/shared/arc-import.js';
import {
  compressLineNumbers,
  summarizeLocalIstanbulCoverage,
  summarizeLocalPreciseCoverage,
} from './cdp-coverage.mjs';

const port = Number(process.env.CDP_PORT || 9223);
const extensionId = process.env.EXT_ID || 'fignfifoniblkonapihmkfakmlgkbkcf';
const preview = process.env.PREVIEW !== '0';
const previewPort = Number(process.env.PREVIEW_PORT || 8765);
const arcImportFile = process.env.ARC_IMPORT_FILE || '';
const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const base = `http://127.0.0.1:${port}`;
const autoChrome = process.env.E2E_AUTO_CHROME !== '0';
const coverageEnabled = ['1', 'true'].includes(String(process.env.E2E_COVERAGE || '').toLowerCase());
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
  let target = coverageEnabled ? null : targets.find((item) => item.url === sidepanelUrl);
  if (!target) {
    const initialUrl = coverageEnabled ? 'about:blank' : sidepanelUrl;
    target = await json(`${base}/json/new?${encodeURIComponent(initialUrl)}`, { method: 'PUT' });
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

async function startPreviewCoverage(client) {
  await client.send('Profiler.enable');
  await client.send('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true,
  });
}

async function checkpointPreviewCoverage(client, snapshots) {
  if (!coverageEnabled) return null;
  const snapshot = await client.send('Profiler.takePreciseCoverage');
  snapshots.push(...(snapshot.result || []));
  return snapshot;
}

function previewRelativeScriptPath(scriptUrl) {
  try {
    const script = new URL(String(scriptUrl || ''));
    const previewRoot = new URL(sidepanelUrl);
    if (script.origin !== previewRoot.origin) return '';
    const path = decodeURIComponent(script.pathname).replace(/^\/+/, '');
    if (!path.endsWith('.js')) return '';
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
    return path;
  } catch {
    return '';
  }
}

async function collectPreviewCoverage(client, snapshots, complete) {
  const finalSnapshot = await client.send('Profiler.takePreciseCoverage');
  const scripts = [...snapshots, ...(finalSnapshot.result || [])];
  const sourceCache = new Map();
  const records = [];
  for (const script of scripts) {
    const path = previewRelativeScriptPath(script?.url);
    if (!path) continue;
    const sourcePath = join(repoRoot, path);
    if (!await pathExists(sourcePath)) continue;
    if (!sourceCache.has(path)) sourceCache.set(path, await readFile(sourcePath, 'utf8'));
    records.push({
      path,
      source: sourceCache.get(path),
      functions: script.functions || [],
    });
  }
  const summary = summarizeLocalPreciseCoverage(records);
  const astSummary = await summarizeLocalIstanbulCoverage(records);
  const astFiles = new Map(astSummary.files.map((file) => [file.path, file]));
  const sourceHashes = Object.fromEntries([...sourceCache]
    .map(([path, source]) => [
      path,
      createHash('sha256').update(source).digest('hex'),
    ])
    .sort(([left], [right]) => left.localeCompare(right)));
  const files = summary.files.map((file) => ({
    path: file.path,
    lines: {
      covered: file.lines.covered,
      total: file.lines.total,
      percent: file.lines.percent,
      ...(file.path === 'sidepanel.js'
        ? { uncoveredRanges: compressLineNumbers(file.lines.uncovered) }
        : {}),
    },
    functions: {
      covered: file.functions.covered,
      total: file.functions.total,
      percent: file.functions.percent,
      ...(file.path === 'sidepanel.js'
        ? {
            uncovered: file.functions.uncovered,
            details: file.functions.details,
          }
        : {}),
    },
    ...(astFiles.has(file.path)
      ? {
          coverage: {
            statements: astFiles.get(file.path).statements,
            branches: astFiles.get(file.path).branches,
            functions: astFiles.get(file.path).functions,
            lines: astFiles.get(file.path).lines,
          },
          ...(file.path === 'sidepanel.js'
            ? { uncovered: astFiles.get(file.path).uncovered }
            : {}),
        }
      : {}),
  }));
  return {
    schemaVersion: 2,
    engine: 'cdp-precise',
    generatedAt: new Date().toISOString(),
    complete: Boolean(complete),
    startedBeforeExecution: true,
    sourceHashAlgorithm: 'sha256',
    sourceHashes,
    totals: summary.totals,
    coverage: astSummary.totals,
    files,
  };
}

async function writePreviewCoverage(report) {
  const configuredPath = String(process.env.E2E_COVERAGE_OUTPUT || '').trim();
  if (!configuredPath) return '';
  const outputPath = resolve(repoRoot, configuredPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

async function main() {
  const previewServer = await startPreviewServer();
  const chrome = await startChromeForCdp();
  let client = null;
  const coverageSnapshots = [];
  let coverageCollected = false;
  try {
    const target = await sidepanelTarget();
    client = createClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    if (coverageEnabled) await startPreviewCoverage(client);
    await client.send('Page.navigate', { url: sidepanelUrl });
    await waitFor(client, `location.href === ${JSON.stringify(sidepanelUrl)}`);

    const results = [];
    const bugs = [];
    const record = (name, ok, detail = '') => results.push({ name, ok, detail });

    await evaluate(client, `new Promise((resolve) => {
    if (document.readyState === 'complete') resolve(true);
    else addEventListener('load', () => resolve(true), { once: true });
  })`);

    if (preview) {
      await evaluate(client, `(() => {
        localStorage.clear();
        sessionStorage.clear();
        return true;
      })()`);
      const onboardingUrl = new URL(sidepanelUrl);
      onboardingUrl.searchParams.set('layout', 'workbench');
      onboardingUrl.searchParams.set('onboarding', '1');
      await checkpointPreviewCoverage(client, coverageSnapshots);
      await client.send('Page.navigate', { url: onboardingUrl.toString() });
      await waitFor(client, `document.querySelector('#onboardingDialog')?.open && document.querySelector('#onboardingStepLabel')?.textContent === 'Step 1 of 2'`);
      const freshPathSelectionState = await evaluate(client, `(() => {
        document.querySelector('[data-onboarding-path="fresh"]').click();
        return {
          chooseVisible: !document.querySelector('#onboardingChooseStep')?.hidden,
          freshHidden: Boolean(document.querySelector('#onboardingFreshStep')?.hidden),
          selected: document.querySelector('[data-onboarding-path="fresh"]')?.classList.contains('selected'),
          step: document.querySelector('#onboardingStepLabel')?.textContent || '',
          nextText: document.querySelector('#onboardingNextButton')?.textContent || '',
          nextDisabled: Boolean(document.querySelector('#onboardingNextButton')?.disabled),
        };
      })()`);
      record(
        'selecting Create new space stays on the first Space screen until Continue',
        freshPathSelectionState.chooseVisible &&
          freshPathSelectionState.freshHidden &&
          freshPathSelectionState.selected &&
          freshPathSelectionState.step === 'Step 1 of 2' &&
          freshPathSelectionState.nextText === 'Continue' &&
          !freshPathSelectionState.nextDisabled,
        JSON.stringify(freshPathSelectionState),
      );
      await evaluate(client, `(() => {
        const originalSetItem = Storage.prototype.setItem;
        window.__ONBOARDING_STORAGE_FAULT__ = {
          failuresRemaining: 0,
          successfulWritesBeforeFailure: 0,
          message: '',
          restore() {
            Storage.prototype.setItem = originalSetItem;
          },
        };
        Storage.prototype.setItem = function(key, value) {
          const fault = window.__ONBOARDING_STORAGE_FAULT__;
          if (this !== localStorage || key !== 'spaceTabsState') {
            return originalSetItem.call(this, key, value);
          }
          originalSetItem.call(this, key, value);
          if (fault.failuresRemaining > 0) {
            if (fault.successfulWritesBeforeFailure > 0) {
              fault.successfulWritesBeforeFailure -= 1;
              return;
            }
            fault.failuresRemaining -= 1;
            throw new Error(fault.message || 'Simulated onboarding storage failure.');
          }
        };
        document.querySelector('#onboardingNextButton').click();
        const input = document.querySelector('#onboardingSpaceNameInput');
        input.value = 'Atomic Space';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.__ONBOARDING_STORAGE_FAULT__.failuresRemaining = 1;
        window.__ONBOARDING_STORAGE_FAULT__.message = 'Simulated skip storage failure.';
        document.querySelector('#skipOnboardingButton').click();
        return true;
      })()`);
      const failedSkip = await waitFor(client, `(() => {
        const toast = document.querySelector('#workbenchToast');
        if (toast?.hidden || toast?.dataset.tone !== 'error' || !toast.textContent.includes('Simulated skip storage failure.')) return null;
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        return {
          dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
          step: document.querySelector('#onboardingStepLabel')?.textContent || '',
          input: document.querySelector('#onboardingSpaceNameInput')?.value || '',
          storedNames: (stored.spaces || []).map((space) => space.name),
          onboarding: stored.onboarding || null,
          toast: { text: toast.textContent, tone: toast.dataset.tone },
        };
      })()`);
      record(
        'skipping onboarding rolls an apply-then-reject write back without a ghost completion',
        failedSkip.dialogOpen &&
          failedSkip.step === 'Step 1 of 2' &&
          failedSkip.input === 'Atomic Space' &&
          failedSkip.storedNames.filter((name) => name === 'Atomic Space').length === 0 &&
          failedSkip.onboarding?.completed === false &&
          failedSkip.onboarding?.stage === 'choose' &&
          failedSkip.toast.tone === 'error' &&
          !/ready|completed|saved/i.test(failedSkip.toast.text),
        JSON.stringify(failedSkip),
      );

      await evaluate(client, `(() => {
        window.__ONBOARDING_STORAGE_FAULT__.failuresRemaining = 1;
        window.__ONBOARDING_STORAGE_FAULT__.message = 'Simulated create storage failure.';
        document.querySelector('#onboardingNextButton').click();
        return true;
      })()`);
      const failedCreate = await waitFor(client, `(() => {
        const toast = document.querySelector('#workbenchToast');
        if (toast?.hidden || toast?.dataset.tone !== 'error' || !toast.textContent.includes('Simulated create storage failure.')) return null;
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        const railNames = [...document.querySelectorAll('.space .space-label')].map((node) => node.textContent);
        return {
          dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
          step: document.querySelector('#onboardingStepLabel')?.textContent || '',
          nextAction: document.querySelector('#onboardingNextButton')?.textContent || '',
          activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
          railNames,
          storedNames: (stored.spaces || []).map((space) => space.name),
          activeSpaceId: stored.activeSpaceId || '',
          onboarding: stored.onboarding || null,
          finishVisible: !document.querySelector('#onboardingFinishStep')?.hidden,
          finishMessage: document.querySelector('#onboardingFinishMessage')?.textContent || '',
          toast: { text: toast.textContent, tone: toast.dataset.tone },
        };
      })()`);
      record(
        'onboarding Space creation storage failure stays on the naming step without a ghost or false success',
        failedCreate.dialogOpen &&
          failedCreate.step === 'Step 1 of 2' &&
          failedCreate.nextAction === 'Create Space' &&
          failedCreate.activeSpaceName === 'Default' &&
          failedCreate.railNames.filter((name) => name === 'Atomic Space').length === 0 &&
          failedCreate.storedNames.filter((name) => name === 'Atomic Space').length === 0 &&
          failedCreate.activeSpaceId === 'default' &&
          failedCreate.onboarding?.completed !== true &&
          failedCreate.onboarding?.stage !== 'ai' &&
          failedCreate.finishVisible === false &&
          failedCreate.finishMessage !== 'Atomic Space is ready.' &&
          failedCreate.toast.tone === 'error' &&
          !/ready|created|saved/i.test(failedCreate.toast.text),
        JSON.stringify(failedCreate),
      );

      await evaluate(client, `(() => {
        window.__ONBOARDING_STORAGE_FAULT__.successfulWritesBeforeFailure = 1;
        window.__ONBOARDING_STORAGE_FAULT__.failuresRemaining = 1;
        window.__ONBOARDING_STORAGE_FAULT__.message = 'Simulated post-commit refresh storage failure.';
        document.querySelector('#onboardingNextButton').click();
        return true;
      })()`);
      const retriedCreate = await waitFor(client, `(() => {
        if (document.querySelector('#onboardingStepLabel')?.textContent !== 'Step 2 of 2') return null;
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        const railNames = [...document.querySelectorAll('.space .space-label')].map((node) => node.textContent);
        return {
          dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
          step: document.querySelector('#onboardingStepLabel')?.textContent || '',
          finishMessage: document.querySelector('#onboardingFinishMessage')?.textContent || '',
          activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
          railMatches: railNames.filter((name) => name === 'Atomic Space').length,
          storedMatches: (stored.spaces || []).filter((space) => space.name === 'Atomic Space').length,
          spaceIds: (stored.spaces || []).map((space) => space.id),
          onboarding: stored.onboarding || null,
        };
      })()`);
      record(
        'retrying onboarding Space creation commits one visible and durable Space',
        retriedCreate.dialogOpen &&
          retriedCreate.step === 'Step 2 of 2' &&
          retriedCreate.finishMessage === 'Atomic Space was created and saved, but its tabs could not refresh. You can finish setup now; reopen Space Tabs if the tab list looks stale.' &&
          retriedCreate.activeSpaceName === 'Atomic Space' &&
          retriedCreate.railMatches === 1 &&
          retriedCreate.storedMatches === 1 &&
          retriedCreate.spaceIds.length === 1 &&
          retriedCreate.spaceIds[0] === 'default' &&
          retriedCreate.onboarding?.completed === false &&
          retriedCreate.onboarding?.stage === 'ai',
        JSON.stringify(retriedCreate),
      );

      await evaluate(client, `(() => {
        window.__ONBOARDING_STORAGE_FAULT__.successfulWritesBeforeFailure = 0;
        window.__ONBOARDING_STORAGE_FAULT__.failuresRemaining = 1;
        window.__ONBOARDING_STORAGE_FAULT__.message = 'Simulated completion storage failure.';
        document.querySelector('#onboardingOpenWorkbenchButton').click();
        return true;
      })()`);
      const failedCompletion = await waitFor(client, `(() => {
        const toast = document.querySelector('#workbenchToast');
        if (toast?.hidden || toast?.dataset.tone !== 'error' || !toast.textContent.includes('Simulated completion storage failure.')) return null;
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        return {
          dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
          step: document.querySelector('#onboardingStepLabel')?.textContent || '',
          finishMessage: document.querySelector('#onboardingFinishMessage')?.textContent || '',
          storedMatches: (stored.spaces || []).filter((space) => space.name === 'Atomic Space').length,
          onboarding: stored.onboarding || null,
          toast: { text: toast.textContent, tone: toast.dataset.tone },
        };
      })()`);
      record(
        'onboarding completion storage failure keeps the final step open and rolls back the completion marker',
        failedCompletion.dialogOpen &&
          failedCompletion.step === 'Step 2 of 2' &&
          failedCompletion.finishMessage === 'Atomic Space was created and saved, but its tabs could not refresh. You can finish setup now; reopen Space Tabs if the tab list looks stale.' &&
          failedCompletion.storedMatches === 1 &&
          failedCompletion.onboarding?.completed === false &&
          failedCompletion.onboarding?.stage === 'ai' &&
          failedCompletion.toast.tone === 'error' &&
          !/setup saved|onboarding completed/i.test(failedCompletion.toast.text),
        JSON.stringify(failedCompletion),
      );

      await evaluate(client, `document.querySelector('#onboardingOpenWorkbenchButton').click()`);
      const retriedCompletion = await waitFor(client, `(() => {
        const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
        if (document.querySelector('#onboardingDialog')?.open || stored.onboarding?.completed !== true) return null;
        window.__ONBOARDING_STORAGE_FAULT__?.restore();
        return {
          dialogOpen: Boolean(document.querySelector('#onboardingDialog')?.open),
          storedMatches: (stored.spaces || []).filter((space) => space.name === 'Atomic Space').length,
          onboarding: stored.onboarding || null,
        };
      })()`);
      record(
        'retrying onboarding completion closes setup with one Space and one durable completion state',
        retriedCompletion.dialogOpen === false &&
          retriedCompletion.storedMatches === 1 &&
          retriedCompletion.onboarding?.completed === true &&
          retriedCompletion.onboarding?.stage === 'done',
        JSON.stringify(retriedCompletion),
      );

      await checkpointPreviewCoverage(client, coverageSnapshots);
      await client.send('Page.navigate', { url: sidepanelUrl });
      await waitFor(client, `location.href === ${JSON.stringify(sidepanelUrl)}`);
    }

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
        provider: 'z-ai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
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
    if (${JSON.stringify(preview)}) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: state }));
      sessionStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify({
        [SECRET_STORAGE_KEY]: {
          ai: {
            provider: 'z-ai',
            baseUrl: 'https://api.z.ai/api/paas/v4',
            apiKey: 'preview-e2e-key',
          },
        },
      }));
    } else {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    }
    return true;
  })()`);
    await checkpointPreviewCoverage(client, coverageSnapshots);
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default' && document.querySelector('.add-space')`);
    record('cold boot renders default Space', true);

    await waitFor(client, `document.querySelector('.ask-page')`);
    await evaluate(client, `document.querySelector('.ask-page').click()`);
    await waitFor(client, `!document.querySelector('#askPageView')?.hidden`);
    const askPageState = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const activeRow = document.querySelector('.tab-row.active');
      const activeTab = {
        id: Number(activeRow?.dataset.tabId),
        title: activeRow?.querySelector('.tab-title')?.textContent || '',
        url: 'https://example.com/spaces-guide',
      };
      if (activeTab.id !== 2 || activeTab.title !== 'Browser Spaces Guide') return null;
      const expectedKey = 'tab:2:https://example.com/spaces-guide';
      if (stored.activeAskSessionKey !== expectedKey) return null;
      const session = stored.askSessions?.[expectedKey];
      return {
        key: stored.activeAskSessionKey,
        expectedKey,
        scope: document.querySelector('#askScope')?.textContent || '',
        sourceSummary: document.querySelector('#askSourceSummary')?.textContent || '',
        sourceCount: document.querySelectorAll('#askSourceList .ask-source-chip').length,
        tabId: session?.tabId ?? null,
        url: session?.url || '',
        activeTab,
      };
    })()`);
    record(
      'Ask Page uses a tab-and-normalized-URL session for the active fixture page',
      askPageState.key === askPageState.expectedKey &&
        askPageState.key.startsWith(`tab:${askPageState.activeTab.id}:`) &&
        askPageState.tabId === askPageState.activeTab.id &&
        askPageState.url === askPageState.expectedKey.slice(`tab:${askPageState.activeTab.id}:`.length) &&
        /^https?:\/\//.test(askPageState.activeTab.url) &&
        askPageState.sourceSummary === 'Current page' &&
        askPageState.sourceCount === 1 &&
        !askPageState.scope.includes('Context'),
      JSON.stringify(askPageState),
    );
    await evaluate(client, `(() => {
      [...document.querySelectorAll('.space')].find((button) => button.title === 'Default')?.click();
      return true;
    })()`);
    await waitFor(client, `!document.querySelector('#groupsList')?.hidden`);

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
        return true;
      })()`);
      await checkpointPreviewCoverage(client, coverageSnapshots);
      await client.send('Page.reload', { ignoreCache: true });
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
  const addSpaceAtomicityBaseline = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    return {
      local: localStorage.getItem('spaceTabsState'),
      window: sessionStorage.getItem('spaceTabsWindowState'),
      activeSpaceId: stored.activeSpaceId || '',
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      targetRailMatches: [...document.querySelectorAll('.space')]
        .filter((button) => button.title === 'E2E Space').length,
    };
  })()`);
  await evaluate(client, `(() => {
    const originalSetItem = Storage.prototype.setItem;
    window.__ADD_SPACE_ATOMICITY_FAULT__ = {
      originalSetItem,
      modes: ['pre-write', 'apply-then-reject'],
      candidateWrites: 0,
      restore() {
        Storage.prototype.setItem = originalSetItem;
        delete window.__ADD_SPACE_ATOMICITY_FAULT__;
      },
    };
    Storage.prototype.setItem = function addSpaceAtomicitySetItem(key, value) {
      const fault = window.__ADD_SPACE_ATOMICITY_FAULT__;
      let candidate = false;
      if (fault && this === localStorage && key === 'spaceTabsState') {
        try {
          const stored = JSON.parse(value || '{}').spaceTabsState || {};
          candidate = (stored.spaces || []).some((space) => space.name === 'E2E Space');
        } catch {
          candidate = false;
        }
      }
      if (!candidate) return originalSetItem.call(this, key, value);
      fault.candidateWrites += 1;
      const mode = fault.modes.shift() || '';
      if (mode === 'pre-write') throw new Error('Add Space pre-write failure E2E');
      if (mode === 'apply-then-reject') {
        originalSetItem.call(this, key, value);
        throw new Error('Add Space apply-then-reject failure E2E');
      }
      return originalSetItem.call(this, key, value);
    };
    const input = document.querySelector('#actionDialogInput');
    input.value = 'E2E Space';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#actionDialogConfirm').click();
    return true;
  })()`);

  const addSpacePreWriteFailure = await waitFor(client, `(() => {
    const fault = window.__ADD_SPACE_ATOMICITY_FAULT__;
    const input = document.querySelector('#actionDialogInput');
    const toast = document.querySelector('#workbenchToast');
    const status = document.querySelector('#syncStatus')?.textContent || '';
    if (fault?.candidateWrites !== 1 || !document.querySelector('#actionDialog')?.open ||
        input?.value !== 'E2E Space' || document.activeElement !== input ||
        !status.includes('Add Space pre-write failure E2E')) return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const mutationCommands = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
    return {
      local: localStorage.getItem('spaceTabsState'),
      window: sessionStorage.getItem('spaceTabsWindowState'),
      activeSpaceId: stored.activeSpaceId || '',
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      storedMatches: (stored.spaces || []).filter((space) => space.name === 'E2E Space').length,
      railMatches: [...document.querySelectorAll('.space')]
        .filter((button) => button.title === 'E2E Space').length,
      draft: input.value,
      focused: document.activeElement === input,
      dialogOpen: Boolean(document.querySelector('#actionDialog')?.open),
      toast: toast.textContent || '',
      tone: toast.dataset.tone || '',
      status,
      candidateWrites: fault.candidateWrites,
      chromeMutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => mutationCommands.has(command.type)),
    };
  })()`);
  const addSpaceAttemptRolledBackSafely = (mutations, attempts) => {
    if (mutations.length !== attempts * 5) return false;
    return Array.from({ length: attempts }, (_, index) => mutations.slice(index * 5, index * 5 + 5))
      .every((chunk) => (
        chunk.map((command) => command.type).join(',') ===
          'tabs:create,tabs:focus,tabs:focus,tabs:close,tabs:focus' &&
        chunk[0]?.payload?.active === false &&
        Number.isSafeInteger(Number(chunk[1]?.payload?.tabId)) &&
        Number.isSafeInteger(Number(chunk[3]?.payload?.requiredActiveSurvivorTabId))
      ));
  };
  record(
    'Add Space pre-write failure is a focused, retryable no-op',
    addSpacePreWriteFailure.local === addSpaceAtomicityBaseline.local &&
      addSpacePreWriteFailure.window === addSpaceAtomicityBaseline.window &&
      addSpacePreWriteFailure.activeSpaceId === addSpaceAtomicityBaseline.activeSpaceId &&
      addSpacePreWriteFailure.activeSpaceName === addSpaceAtomicityBaseline.activeSpaceName &&
      addSpacePreWriteFailure.storedMatches === 0 &&
      addSpacePreWriteFailure.railMatches === addSpaceAtomicityBaseline.targetRailMatches &&
      addSpacePreWriteFailure.draft === 'E2E Space' &&
      addSpacePreWriteFailure.focused && addSpacePreWriteFailure.dialogOpen &&
      addSpacePreWriteFailure.status.includes('Add Space pre-write failure E2E') &&
      !/created|ready|saved/i.test(addSpacePreWriteFailure.status) &&
      addSpacePreWriteFailure.candidateWrites === 1 &&
      addSpaceAttemptRolledBackSafely(addSpacePreWriteFailure.chromeMutations, 1),
    JSON.stringify({
      ...addSpacePreWriteFailure,
      local: undefined,
      window: undefined,
      localRestored: addSpacePreWriteFailure.local === addSpaceAtomicityBaseline.local,
      windowRestored: addSpacePreWriteFailure.window === addSpaceAtomicityBaseline.window,
    }),
  );

  await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
  const addSpaceApplyThenRejectFailure = await waitFor(client, `(() => {
    const fault = window.__ADD_SPACE_ATOMICITY_FAULT__;
    const input = document.querySelector('#actionDialogInput');
    const toast = document.querySelector('#workbenchToast');
    const status = document.querySelector('#syncStatus')?.textContent || '';
    if (fault?.candidateWrites !== 2 || !document.querySelector('#actionDialog')?.open ||
        input?.value !== 'E2E Space' || document.activeElement !== input ||
        !status.includes('Add Space apply-then-reject failure E2E')) return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const mutationCommands = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
    return {
      local: localStorage.getItem('spaceTabsState'),
      window: sessionStorage.getItem('spaceTabsWindowState'),
      activeSpaceId: stored.activeSpaceId || '',
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      storedMatches: (stored.spaces || []).filter((space) => space.name === 'E2E Space').length,
      railMatches: [...document.querySelectorAll('.space')]
        .filter((button) => button.title === 'E2E Space').length,
      draft: input.value,
      focused: document.activeElement === input,
      dialogOpen: Boolean(document.querySelector('#actionDialog')?.open),
      toast: toast.textContent || '',
      tone: toast.dataset.tone || '',
      status,
      candidateWrites: fault.candidateWrites,
      chromeMutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => mutationCommands.has(command.type)),
    };
  })()`);
  record(
    'Add Space apply-then-reject is compensated before the same draft retries',
    addSpaceApplyThenRejectFailure.local === addSpaceAtomicityBaseline.local &&
      addSpaceApplyThenRejectFailure.window === addSpaceAtomicityBaseline.window &&
      addSpaceApplyThenRejectFailure.activeSpaceId === addSpaceAtomicityBaseline.activeSpaceId &&
      addSpaceApplyThenRejectFailure.activeSpaceName === addSpaceAtomicityBaseline.activeSpaceName &&
      addSpaceApplyThenRejectFailure.storedMatches === 0 &&
      addSpaceApplyThenRejectFailure.railMatches === addSpaceAtomicityBaseline.targetRailMatches &&
      addSpaceApplyThenRejectFailure.draft === 'E2E Space' &&
      addSpaceApplyThenRejectFailure.focused && addSpaceApplyThenRejectFailure.dialogOpen &&
      addSpaceApplyThenRejectFailure.status.includes('Add Space apply-then-reject failure E2E') &&
      !/created|ready|saved/i.test(addSpaceApplyThenRejectFailure.status) &&
      addSpaceApplyThenRejectFailure.candidateWrites === 2 &&
      addSpaceAttemptRolledBackSafely(addSpaceApplyThenRejectFailure.chromeMutations, 2),
    JSON.stringify({
      ...addSpaceApplyThenRejectFailure,
      local: undefined,
      window: undefined,
      localRestored: addSpaceApplyThenRejectFailure.local === addSpaceAtomicityBaseline.local,
      windowRestored: addSpaceApplyThenRejectFailure.window === addSpaceAtomicityBaseline.window,
    }),
  );

  await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'E2E Space'`);
  const newEmptySpaceState = await waitFor(client, `(() => {
    if (document.querySelector('#activeSpaceName')?.textContent !== 'E2E Space') return null;
    const mutationCommands = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const fault = window.__ADD_SPACE_ATOMICITY_FAULT__;
    return {
      activeSpaceId: stored.activeSpaceId,
      rows: document.querySelectorAll('.tab-row').length,
      snapshot: stored.spaceSnapshots?.['e2e-space'] || null,
      storedMatches: (stored.spaces || []).filter((space) =>
        space.id === 'e2e-space' && space.name === 'E2E Space').length,
      railMatches: [...document.querySelectorAll('.space')]
        .filter((button) => button.dataset.spaceId === 'e2e-space' && button.title === 'E2E Space').length,
      candidateWrites: fault?.candidateWrites || 0,
      chromeMutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => mutationCommands.has(command.type)),
    };
  })()`);
  await evaluate(client, `window.__ADD_SPACE_ATOMICITY_FAULT__?.restore()`);
  record(
    'retrying Add Space commits one durable active Space with a safe active target tab',
    newEmptySpaceState.activeSpaceId === 'e2e-space' &&
      newEmptySpaceState.rows === 1 &&
      !newEmptySpaceState.snapshot &&
      newEmptySpaceState.storedMatches === 1 &&
      newEmptySpaceState.railMatches === 1 &&
      newEmptySpaceState.candidateWrites === 4 &&
      newEmptySpaceState.chromeMutations.some((command) => command.type === 'tabs:create') &&
      newEmptySpaceState.chromeMutations.some((command) => (
        command.type === 'tabs:close' &&
        Number.isSafeInteger(Number(command.payload?.requiredActiveSurvivorTabId)) &&
        (command.payload?.requiredTargetTabGuards || []).length === 1
      )),
    JSON.stringify(newEmptySpaceState)
  );

  const unsafeAddSpaceBaseline = await evaluate(client, `(() => ({
    local: localStorage.getItem('spaceTabsState'),
    window: sessionStorage.getItem('spaceTabsWindowState'),
    activeSpaceId: JSON.parse(localStorage.getItem('spaceTabsState') || '{}')
      .spaceTabsState?.activeSpaceId || '',
    activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
  }))()`);
  await evaluate(client, `document.querySelector('.add-space').click()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open`);
  await evaluate(client, `(() => {
    const originalSetItem = Storage.prototype.setItem;
    window.__UNSAFE_ADD_SPACE_FAULT__ = {
      originalSetItem,
      baselineLocal: localStorage.getItem('spaceTabsState'),
      candidateWrites: 0,
      rollbackWrites: 0,
    };
    Storage.prototype.setItem = function unsafeAddSpaceSetItem(key, value) {
      const fault = window.__UNSAFE_ADD_SPACE_FAULT__;
      if (fault && this === localStorage && key === 'spaceTabsState') {
        let candidate = false;
        try {
          const stored = JSON.parse(value || '{}').spaceTabsState || {};
          candidate = (stored.spaces || []).some((space) =>
            space.id === 'unsafe-space' && space.name === 'Unsafe Space');
        } catch {
          candidate = false;
        }
        if (candidate) {
          fault.candidateWrites += 1;
          originalSetItem.call(this, key, value);
          throw new Error('Add Space uncertain candidate failure E2E');
        }
        if (fault.candidateWrites > 0 && value === fault.baselineLocal) {
          fault.rollbackWrites += 1;
          throw new Error('Add Space compensation failure E2E');
        }
      }
      return originalSetItem.call(this, key, value);
    };
    const input = document.querySelector('#actionDialogInput');
    input.value = 'Unsafe Space';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#actionDialogConfirm').click();
  })()`);
  const unsafeAddSpaceFailure = await waitFor(client, `(() => {
    const fault = window.__UNSAFE_ADD_SPACE_FAULT__;
    const status = document.querySelector('#syncStatus')?.textContent || '';
    if (fault?.candidateWrites !== 2 || fault.rollbackWrites !== 2 ||
        !status.includes('Reload Space Tabs before trying Add Space again')) return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    return {
      activeSpaceId: stored.activeSpaceId || '',
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      storedMatches: (stored.spaces || []).filter((space) =>
        space.id === 'unsafe-space' || space.name === 'Unsafe Space').length,
      railMatches: [...document.querySelectorAll('.space')]
        .filter((button) => button.dataset.spaceId === 'unsafe-space' ||
          button.title === 'Unsafe Space').length,
      dialogOpen: Boolean(document.querySelector('#actionDialog')?.open),
      status,
      candidateWrites: fault.candidateWrites,
      rollbackWrites: fault.rollbackWrites,
    };
  })()`);
  const unsafeAddSpaceRepair = await evaluate(client, `(() => {
    const fault = window.__UNSAFE_ADD_SPACE_FAULT__;
    Storage.prototype.setItem = fault.originalSetItem;
    fault.originalSetItem.call(localStorage, 'spaceTabsState', fault.baselineLocal);
    delete window.__UNSAFE_ADD_SPACE_FAULT__;
    return {
      localRestored: localStorage.getItem('spaceTabsState') === ${JSON.stringify(unsafeAddSpaceBaseline.local)},
      windowRestored: sessionStorage.getItem('spaceTabsWindowState') ===
        ${JSON.stringify(unsafeAddSpaceBaseline.window)},
    };
  })()`);
  record(
    'Add Space fails closed when storage compensation cannot verify a safe retry',
    unsafeAddSpaceFailure.candidateWrites === 2 &&
      unsafeAddSpaceFailure.rollbackWrites === 2 &&
      unsafeAddSpaceFailure.storedMatches === 1 &&
      unsafeAddSpaceFailure.railMatches === 0 &&
      !unsafeAddSpaceFailure.dialogOpen &&
      unsafeAddSpaceFailure.activeSpaceName === unsafeAddSpaceBaseline.activeSpaceName &&
      unsafeAddSpaceFailure.status.includes('Reload Space Tabs before trying Add Space again') &&
      unsafeAddSpaceRepair.localRestored && unsafeAddSpaceRepair.windowRestored,
    JSON.stringify({ ...unsafeAddSpaceFailure, ...unsafeAddSpaceRepair }),
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
    'switching away from a brand-new empty Space restores the target without a placeholder tab',
    emptySpaceSwitchState.rows.length === 5 &&
      emptySpaceSwitchState.ephemeralTabIds.length === 0 &&
      ['Research', 'Build', 'Inbox'].every((title) => emptySpaceSwitchState.defaultSnapshotGroups.includes(title)) &&
      !emptySpaceSwitchState.e2eSnapshot &&
      emptySpaceSwitchState.carrierMutations.filter((command) => command.type === 'tabs:create').length === 5 &&
      emptySpaceSwitchState.carrierMutations.filter((command) => command.type === 'tabs:close').length === 1 &&
      emptySpaceSwitchState.carrierMutations.find((command) => command.type === 'tabs:close')
        ?.payload?.requiredTargetTabGuards?.length === 5 &&
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
  await checkpointPreviewCoverage(client, coverageSnapshots);
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
    settingsState.api === (preview
      ? 'API key is configured for this Chrome session.'
      : 'No API key configured.')
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

  const settingsAtomicityBaseline = await evaluate(client, `(() => ({
    local: localStorage.getItem('spaceTabsState'),
    session: sessionStorage.getItem('spaceTabsSecrets'),
  }))()`);
  await evaluate(client, `(() => {
    const originalSetItem = Storage.prototype.setItem;
    let rejectSecretWriteAfterApply = true;
    Storage.prototype.setItem = function setItemWithOneShotSessionFailure(key, value) {
      originalSetItem.call(this, key, value);
      if (this === sessionStorage && key === 'spaceTabsSecrets' && rejectSecretWriteAfterApply) {
        rejectSecretWriteAfterApply = false;
        throw new Error('session write failed after apply');
      }
    };
    window.__restoreSettingsAtomicityStorage__ = () => {
      Storage.prototype.setItem = originalSetItem;
      delete window.__restoreSettingsAtomicityStorage__;
    };

    document.querySelector('.theme-option[data-theme="ocean"]').click();
    document.querySelector('#languageInput').value = 'en';
    document.querySelector('#apiKeyInput').value = 'preview-e2e-key-after-retry';
    const shortcut = document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]');
    shortcut.dataset.shortcut = 'Control+Alt+J';
    shortcut.value = 'Ctrl + Alt + J';
    document.querySelector('#saveSettingsButton').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#workbenchToast')?.dataset.tone === 'error' && document.querySelector('#workbenchToast')?.textContent.includes('session write failed after apply')`);
  const settingsAtomicityFailure = await evaluate(client, `(() => ({
    local: localStorage.getItem('spaceTabsState'),
    session: sessionStorage.getItem('spaceTabsSecrets'),
    toast: document.querySelector('#workbenchToast')?.textContent || '',
    tone: document.querySelector('#workbenchToast')?.dataset.tone || '',
    status: document.querySelector('#settingsStatus')?.textContent || '',
    apiKeyDraft: document.querySelector('#apiKeyInput')?.value || '',
    languageDraft: document.querySelector('#languageInput')?.value || '',
    shortcutDraft: document.querySelector('.shortcut-input[data-shortcut-action="addSpace"]')?.dataset.shortcut || '',
    themeDraft: document.querySelector('.theme-option.active')?.dataset.theme || '',
    appliedTheme: document.documentElement.dataset.theme || 'purple',
  }))()`);
  record(
    'Settings rolls local and session storage back without false success while retaining the full draft',
    settingsAtomicityFailure.local === settingsAtomicityBaseline.local &&
      settingsAtomicityFailure.session === settingsAtomicityBaseline.session &&
      settingsAtomicityFailure.tone === 'error' &&
      settingsAtomicityFailure.toast.includes('session write failed after apply') &&
      settingsAtomicityFailure.status.includes('session write failed after apply') &&
      settingsAtomicityFailure.toast !== 'Settings saved.' &&
      settingsAtomicityFailure.apiKeyDraft === 'preview-e2e-key-after-retry' &&
      settingsAtomicityFailure.languageDraft === 'en' &&
      settingsAtomicityFailure.shortcutDraft === 'Control+Alt+J' &&
      settingsAtomicityFailure.themeDraft === 'ocean' &&
      settingsAtomicityFailure.appliedTheme === 'ocean',
    JSON.stringify({
      ...settingsAtomicityFailure,
      localRolledBack: settingsAtomicityFailure.local === settingsAtomicityBaseline.local,
      sessionRolledBack: settingsAtomicityFailure.session === settingsAtomicityBaseline.session,
    }),
  );

  await evaluate(client, `document.querySelector('#saveSettingsButton').click()`);
  await waitFor(client, `document.querySelector('#workbenchToast')?.textContent === 'Settings saved.' && document.querySelector('#workbenchToast')?.dataset.tone === 'success'`);
  const settingsAtomicityRetry = await evaluate(client, `(() => {
    window.__restoreSettingsAtomicityStorage__?.();
    const local = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const session = JSON.parse(sessionStorage.getItem('spaceTabsSecrets') || '{}').spaceTabsSecrets || {};
    return {
      theme: local.theme,
      language: local.ai?.language,
      durableApiKey: local.ai?.apiKey,
      sessionApiKey: session.ai?.apiKey,
      sessionProvider: session.ai?.provider,
      sessionBaseUrl: session.ai?.baseUrl,
      shortcut: local.shortcuts?.addSpace,
      apiKeyDraft: document.querySelector('#apiKeyInput')?.value || '',
      appliedTheme: document.documentElement.dataset.theme || 'purple',
      toast: document.querySelector('#workbenchToast')?.textContent || '',
      tone: document.querySelector('#workbenchToast')?.dataset.tone || '',
    };
  })()`);
  record(
    'retrying the retained Settings draft commits one consistent local/session configuration',
    settingsAtomicityRetry.theme === 'ocean' &&
      settingsAtomicityRetry.language === 'en' &&
      settingsAtomicityRetry.durableApiKey === '' &&
      settingsAtomicityRetry.sessionApiKey === 'preview-e2e-key-after-retry' &&
      settingsAtomicityRetry.sessionProvider === 'z-ai' &&
      settingsAtomicityRetry.sessionBaseUrl === 'https://api.z.ai/api/paas/v4' &&
      settingsAtomicityRetry.shortcut === 'Control+Alt+J' &&
      settingsAtomicityRetry.apiKeyDraft === 'preview-e2e-key-after-retry' &&
      settingsAtomicityRetry.appliedTheme === 'ocean' &&
      settingsAtomicityRetry.toast === 'Settings saved.' &&
      settingsAtomicityRetry.tone === 'success',
    JSON.stringify(settingsAtomicityRetry),
  );

  const restoreAtomicityBaseline = await evaluate(client, `(() => ({
    local: localStorage.getItem('spaceTabsState'),
    windowState: sessionStorage.getItem('spaceTabsWindowState'),
    previewRuntime: sessionStorage.getItem('spaceTabsPreviewRuntime'),
    activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
    visibleSpaceNames: [...document.querySelectorAll('.space')].map((button) => button.title),
  }))()`);
  const restoreAtomicityFixture = {
    id: 'preview-restore-atomic',
    name: 'Preview Restore Atomic',
    filename: 'preview-restore-atomic.json',
    context: 'PREVIEW_RESTORE_CONTEXT_ATOMIC',
    savedUrl: 'https://example.net/preview-restore-saved',
  };
  await evaluate(client, `(() => {
    const fixture = ${JSON.stringify(restoreAtomicityFixture)};
    const backup = {
      format: 'space-context-workspaces',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeSpaceId: fixture.id,
      spaces: [{ id: fixture.id, name: fixture.name, icon: 'P', color: 'cyan' }],
      spaceContexts: { [fixture.id]: fixture.context },
      spaceSnapshots: {
        [fixture.id]: {
          version: 1,
          preserveGroups: true,
          updatedAt: Date.now(),
          groups: [{
            title: 'Saved before opening',
            color: 'cyan',
            collapsed: false,
            tabs: [{ title: 'Saved restore target', url: fixture.savedUrl }],
          }],
        },
      },
      askSessions: {},
      collapsedSpaceGroups: {},
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(backup)], fixture.filename, {
      type: 'application/json',
    }));
    const input = document.querySelector('#spaceBackupInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, `!document.querySelector('#restoreSpaceDataButton')?.disabled &&
    document.querySelector('#spaceBackupStatus')?.textContent.startsWith('Ready to restore ') &&
    document.querySelector('#spaceBackupInput')?.files?.[0]?.name ===
      ${JSON.stringify(restoreAtomicityFixture.filename)}`);
  await evaluate(client, `document.querySelector('#restoreSpaceDataButton').click()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open &&
    document.querySelector('#actionDialogTitle')?.textContent === 'Restore Space Data'`);
  const restoreFailureInjectionInstalled = await evaluate(client, `(() => {
    const fixture = ${JSON.stringify(restoreAtomicityFixture)};
    const originalSetItem = Storage.prototype.setItem;
    window.__restoreBackupAtomicityFailureCount = 0;
    Storage.prototype.setItem = function setItemWithOneShotRestoreFailure(key, value) {
      const parsed = this === localStorage && key === 'spaceTabsState'
        ? JSON.parse(String(value || '{}')).spaceTabsState
        : null;
      const isRestoreWrite = parsed?.spaces?.length === 1 &&
        parsed.spaces[0]?.id === fixture.id;
      originalSetItem.call(this, key, value);
      if (isRestoreWrite && window.__restoreBackupAtomicityFailureCount === 0) {
        window.__restoreBackupAtomicityFailureCount += 1;
        throw new Error('preview restore write failed after apply');
      }
    };
    window.__restoreBackupAtomicityStorage__ = () => {
      Storage.prototype.setItem = originalSetItem;
      delete window.__restoreBackupAtomicityStorage__;
    };
    document.querySelector('#actionDialogConfirm').click();
    return Storage.prototype.setItem !== originalSetItem;
  })()`);
  if (!restoreFailureInjectionInstalled) {
    throw new Error('Could not install the Preview Restore storage failure.');
  }
  const restoreAtomicityFailure = await waitFor(client, `(() => {
    const fixture = ${JSON.stringify(restoreAtomicityFixture)};
    const toast = document.querySelector('#workbenchToast');
    const backupStatus = document.querySelector('#spaceBackupStatus')?.textContent || '';
    if (toast?.hidden || toast?.dataset.tone !== 'error' ||
        !toast.textContent.includes('preview restore write failed after apply') ||
        !backupStatus.includes('Restore failed')) return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    return {
      local: localStorage.getItem('spaceTabsState'),
      windowState: sessionStorage.getItem('spaceTabsWindowState'),
      previewRuntime: sessionStorage.getItem('spaceTabsPreviewRuntime'),
      failureCount: window.__restoreBackupAtomicityFailureCount,
      settingsOpen: Boolean(document.querySelector('#settingsDialog')?.open),
      selectedFilename: document.querySelector('#spaceBackupInput')?.files?.[0]?.name || '',
      selectedFiles: document.querySelector('#spaceBackupInput')?.files?.length || 0,
      restoreEnabled: !document.querySelector('#restoreSpaceDataButton')?.disabled,
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      visibleSpaceNames: [...document.querySelectorAll('.space')].map((button) => button.title),
      restoredSpacePresent: (stored.spaces || []).some((space) => space.id === fixture.id),
      backupStatus,
      toast: toast.textContent || '',
      tone: toast.dataset.tone || '',
    };
  })()`);
  record(
    'Restore compensates an apply-then-reject commit and keeps the reviewed file immediately retryable',
    restoreAtomicityFailure.local === restoreAtomicityBaseline.local &&
      restoreAtomicityFailure.windowState === restoreAtomicityBaseline.windowState &&
      restoreAtomicityFailure.previewRuntime === restoreAtomicityBaseline.previewRuntime &&
      restoreAtomicityFailure.failureCount === 1 &&
      restoreAtomicityFailure.settingsOpen &&
      restoreAtomicityFailure.selectedFilename === restoreAtomicityFixture.filename &&
      restoreAtomicityFailure.selectedFiles === 1 &&
      restoreAtomicityFailure.restoreEnabled &&
      restoreAtomicityFailure.activeSpaceName === restoreAtomicityBaseline.activeSpaceName &&
      JSON.stringify(restoreAtomicityFailure.visibleSpaceNames) ===
        JSON.stringify(restoreAtomicityBaseline.visibleSpaceNames) &&
      !restoreAtomicityFailure.restoredSpacePresent &&
      restoreAtomicityFailure.tone === 'error' &&
      !/Restored \d/.test(restoreAtomicityFailure.toast),
    JSON.stringify({
      ...restoreAtomicityFailure,
      localCompensated: restoreAtomicityFailure.local === restoreAtomicityBaseline.local,
      windowStateCompensated:
        restoreAtomicityFailure.windowState === restoreAtomicityBaseline.windowState,
      physicalTabsUnchanged:
        restoreAtomicityFailure.previewRuntime === restoreAtomicityBaseline.previewRuntime,
    }),
  );

  await evaluate(client, `(() => {
    window.__restoreBackupAtomicityStorage__?.();
    document.querySelector('#restoreSpaceDataButton').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open &&
    document.querySelector('#actionDialogTitle')?.textContent === 'Restore Space Data'`);
  await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
  const restoreAtomicityRetry = await waitFor(client, `(() => {
    const fixture = ${JSON.stringify(restoreAtomicityFixture)};
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const savedRows = (stored.spaceSnapshots?.[fixture.id]?.groups || [])
      .flatMap((group) => group.tabs || [])
      .filter((tab) => tab.url === fixture.savedUrl);
    const operations = (stored.operationHistory || [])
      .filter((operation) => operation?.type === 'restore-backup' && operation.status !== 'undone');
    if (stored.activeSpaceId !== fixture.id || document.querySelector('#settingsDialog')?.open ||
        document.querySelector('#activeSpaceName')?.textContent !== fixture.name) return null;
    return {
      activeSpaceId: stored.activeSpaceId,
      spaces: (stored.spaces || []).map((space) => space.id),
      context: stored.spaceContexts?.[fixture.id] || '',
      savedRows: savedRows.length,
      liveTabOwners: (runtime.tabs || []).map((tab) => ({
        tabId: tab.id,
        spaceId: stored.tabSpaces?.[String(tab.id)] ||
          stored.groupSpaces?.[String(tab.groupId)] || '',
        lifecycleSpaceId: stored.tabLifecycle?.[String(tab.id)]?.spaceId || '',
      })),
      liveGroupOwners: (runtime.groups || []).map((group) => stored.groupSpaces?.[String(group.id)] || ''),
      windowSpaceId: JSON.parse(
        sessionStorage.getItem('spaceTabsWindowState') || '{}'
      ).spaceTabsWindowState?.activeSpaceIds?.['1'] || '',
      operations: operations.length,
      settingsOpen: Boolean(document.querySelector('#settingsDialog')?.open),
      selectedFiles: document.querySelector('#spaceBackupInput')?.files?.length || 0,
      restoreDisabled: Boolean(document.querySelector('#restoreSpaceDataButton')?.disabled),
      activeSpaceName: document.querySelector('#activeSpaceName')?.textContent || '',
      previewRuntime: sessionStorage.getItem('spaceTabsPreviewRuntime'),
      status: document.querySelector('#syncStatus')?.textContent || '',
    };
  })()`);
  record(
    'retrying the retained Restore file commits one workspace and adopts every live Preview tab exactly once',
    restoreAtomicityRetry.activeSpaceId === restoreAtomicityFixture.id &&
      JSON.stringify(restoreAtomicityRetry.spaces) === JSON.stringify([restoreAtomicityFixture.id]) &&
      restoreAtomicityRetry.context === restoreAtomicityFixture.context &&
      restoreAtomicityRetry.savedRows === 1 &&
      restoreAtomicityRetry.liveTabOwners.length > 0 &&
      restoreAtomicityRetry.liveTabOwners.every((owner) =>
        owner.spaceId === restoreAtomicityFixture.id &&
        (!owner.lifecycleSpaceId || owner.lifecycleSpaceId === restoreAtomicityFixture.id)) &&
      restoreAtomicityRetry.liveGroupOwners.length > 0 &&
      restoreAtomicityRetry.liveGroupOwners.every((spaceId) => spaceId === restoreAtomicityFixture.id) &&
      restoreAtomicityRetry.windowSpaceId === restoreAtomicityFixture.id &&
      restoreAtomicityRetry.operations === 1 &&
      !restoreAtomicityRetry.settingsOpen &&
      restoreAtomicityRetry.selectedFiles === 0 &&
      restoreAtomicityRetry.restoreDisabled &&
      restoreAtomicityRetry.activeSpaceName === restoreAtomicityFixture.name &&
      restoreAtomicityRetry.previewRuntime === restoreAtomicityBaseline.previewRuntime &&
      restoreAtomicityRetry.status.startsWith('Restored '),
    JSON.stringify(restoreAtomicityRetry),
  );
  await evaluate(client, `(() => {
    const baseline = ${JSON.stringify(restoreAtomicityBaseline)};
    localStorage.setItem('spaceTabsState', baseline.local);
    if (baseline.windowState === null) sessionStorage.removeItem('spaceTabsWindowState');
    else sessionStorage.setItem('spaceTabsWindowState', baseline.windowState);
    if (baseline.previewRuntime === null) sessionStorage.removeItem('spaceTabsPreviewRuntime');
    else sessionStorage.setItem('spaceTabsPreviewRuntime', baseline.previewRuntime);
    delete window.__restoreBackupAtomicityFailureCount;
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.navigate', { url: sidepanelUrl });
  await waitFor(client, `location.href === ${JSON.stringify(sidepanelUrl)} && document.querySelector('#activeSpaceName')?.textContent === 'Default' && !document.querySelector('#groupsList')?.hidden`);

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

  const groupPreviewKeyboardState = await evaluate(client, `(() => {
    const trigger = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    if (!trigger) return null;
    const sendKey = (target, key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const focusIndex = (items) => items.indexOf(document.activeElement);

    const disclosureExpandedBefore = trigger.getAttribute('aria-expanded');
    trigger.focus();
    const arrowDownPrevented = sendKey(trigger, 'ArrowDown');
    const popover = document.querySelector('#groupPreviewPopover');
    const search = popover?.querySelector('.group-preview-search-input');
    const list = popover?.querySelector('.group-preview-list');
    const firstOpenItems = [...(list?.querySelectorAll('.group-preview-item') || [])];
    const openedWithArrowDown = {
      hidden: popover?.hidden,
      focusInSearch: document.activeElement === search,
      previewOpen: trigger.dataset.previewOpen,
      disclosureExpanded: trigger.getAttribute('aria-expanded'),
    };
    const searchEscapePrevented = search ? sendKey(search, 'Escape') : false;
    const closedFromSearch = {
      hidden: popover?.hidden,
      focusReturned: document.activeElement === trigger,
      previewOpen: trigger.dataset.previewOpen,
      disclosureExpanded: trigger.getAttribute('aria-expanded'),
    };

    const arrowRightPrevented = sendKey(trigger, 'ArrowRight');
    const reopenedSearch = popover?.querySelector('.group-preview-search-input');
    const reopenedList = popover?.querySelector('.group-preview-list');
    const items = [...(reopenedList?.querySelectorAll('.group-preview-item') || [])];
    const reopenedWithArrowRight = {
      hidden: popover?.hidden,
      focusedSearch: document.activeElement === reopenedSearch,
      previewOpen: trigger.dataset.previewOpen,
      disclosureExpanded: trigger.getAttribute('aria-expanded'),
    };
    const searchDownPrevented = reopenedSearch ? sendKey(reopenedSearch, 'ArrowDown') : false;
    const afterSearchDown = focusIndex(items);
    const firstDownPrevented = document.activeElement ? sendKey(document.activeElement, 'ArrowDown') : false;
    const afterFirstDown = focusIndex(items);
    const wrapDownPrevented = document.activeElement ? sendKey(document.activeElement, 'ArrowDown') : false;
    const afterWrapDown = focusIndex(items);
    const wrapUpPrevented = document.activeElement ? sendKey(document.activeElement, 'ArrowUp') : false;
    const afterWrapUp = focusIndex(items);
    const homePrevented = document.activeElement ? sendKey(document.activeElement, 'Home') : false;
    const afterHome = focusIndex(items);
    const endPrevented = document.activeElement ? sendKey(document.activeElement, 'End') : false;
    const afterEnd = focusIndex(items);
    const itemEscapePrevented = document.activeElement ? sendKey(document.activeElement, 'Escape') : false;
    const closedFromItem = {
      hidden: popover?.hidden,
      focusReturned: document.activeElement === trigger,
      previewOpen: trigger.dataset.previewOpen,
      disclosureExpanded: trigger.getAttribute('aria-expanded'),
    };

    return {
      trigger: {
        hasPopup: trigger.getAttribute('aria-haspopup'),
        controls: trigger.getAttribute('aria-controls'),
        keyShortcuts: trigger.getAttribute('aria-keyshortcuts'),
        disclosureExpandedBefore,
      },
      dialog: {
        id: popover?.id,
        role: popover?.getAttribute('role'),
        label: popover?.getAttribute('aria-label'),
      },
      search: {
        label: search?.getAttribute('aria-label'),
      },
      list: {
        role: list?.getAttribute('role'),
        label: list?.getAttribute('aria-label'),
        itemCount: firstOpenItems.length,
        itemRoles: firstOpenItems.map((item) => item.getAttribute('role')),
        itemSelections: firstOpenItems.map((item) => item.getAttribute('aria-selected')),
      },
      openedWithArrowDown,
      closedFromSearch,
      reopenedWithArrowRight,
      navigation: {
        itemCount: items.length,
        afterSearchDown,
        afterFirstDown,
        afterWrapDown,
        afterWrapUp,
        afterHome,
        afterEnd,
      },
      prevented: {
        arrowDownPrevented,
        searchEscapePrevented,
        arrowRightPrevented,
        searchDownPrevented,
        firstDownPrevented,
        wrapDownPrevented,
        wrapUpPrevented,
        homePrevented,
        endPrevented,
        itemEscapePrevented,
      },
      closedFromItem,
    };
  })()`);
  record(
    'collapsed group preview is fully keyboard operable and exposes truthful accessibility semantics',
    groupPreviewKeyboardState?.trigger.hasPopup === 'dialog' &&
      groupPreviewKeyboardState.trigger.controls === groupPreviewKeyboardState.dialog.id &&
      groupPreviewKeyboardState.trigger.keyShortcuts === 'ArrowDown ArrowRight' &&
      groupPreviewKeyboardState.trigger.disclosureExpandedBefore === 'false' &&
      groupPreviewKeyboardState.dialog.role === 'dialog' &&
      Boolean(groupPreviewKeyboardState.dialog.label) &&
      Boolean(groupPreviewKeyboardState.search.label) &&
      groupPreviewKeyboardState.list.role === 'listbox' &&
      Boolean(groupPreviewKeyboardState.list.label) &&
      groupPreviewKeyboardState.list.itemCount === 2 &&
      groupPreviewKeyboardState.list.itemRoles.every((role) => role === 'option') &&
      groupPreviewKeyboardState.list.itemSelections.every((selected) => ['true', 'false'].includes(selected)) &&
      groupPreviewKeyboardState.openedWithArrowDown.hidden === false &&
      groupPreviewKeyboardState.openedWithArrowDown.focusInSearch &&
      groupPreviewKeyboardState.openedWithArrowDown.previewOpen === 'true' &&
      groupPreviewKeyboardState.openedWithArrowDown.disclosureExpanded === 'false' &&
      groupPreviewKeyboardState.closedFromSearch.hidden === true &&
      groupPreviewKeyboardState.closedFromSearch.focusReturned &&
      groupPreviewKeyboardState.closedFromSearch.previewOpen === 'false' &&
      groupPreviewKeyboardState.closedFromSearch.disclosureExpanded === 'false' &&
      groupPreviewKeyboardState.reopenedWithArrowRight.hidden === false &&
      groupPreviewKeyboardState.reopenedWithArrowRight.focusedSearch &&
      groupPreviewKeyboardState.reopenedWithArrowRight.previewOpen === 'true' &&
      groupPreviewKeyboardState.reopenedWithArrowRight.disclosureExpanded === 'false' &&
      groupPreviewKeyboardState.navigation.itemCount === 2 &&
      groupPreviewKeyboardState.navigation.afterSearchDown === 0 &&
      groupPreviewKeyboardState.navigation.afterFirstDown === 1 &&
      groupPreviewKeyboardState.navigation.afterWrapDown === 0 &&
      groupPreviewKeyboardState.navigation.afterWrapUp === 1 &&
      groupPreviewKeyboardState.navigation.afterHome === 0 &&
      groupPreviewKeyboardState.navigation.afterEnd === 1 &&
      Object.values(groupPreviewKeyboardState.prevented).every(Boolean) &&
      groupPreviewKeyboardState.closedFromItem.hidden === true &&
      groupPreviewKeyboardState.closedFromItem.focusReturned &&
      groupPreviewKeyboardState.closedFromItem.previewOpen === 'false' &&
      groupPreviewKeyboardState.closedFromItem.disclosureExpanded === 'false',
    JSON.stringify(groupPreviewKeyboardState),
  );

  // Exercise the preview as a real launcher, not just as a keyboard-focus
  // surface. Keep this fixture isolated because the next scenarios expect the
  // original all-dormant Folder Demo snapshot.
  const groupPreviewFixtureBackup = await evaluate(client, `({
    local: [...Array(localStorage.length)].map((_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    }),
    session: [...Array(sessionStorage.length)].map((_, index) => {
      const key = sessionStorage.key(index);
      return [key, sessionStorage.getItem(key)];
    }),
  })`);
  const dormantPreviewLaunch = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const target = (stored.spaceSnapshots?.['folder-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .find((tab) => tab.url === 'https://example.com/nested-plan');
    const trigger = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    if (!target?.snapshotTabId || !trigger) return null;
    const sendKey = (targetNode, key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      targetNode.dispatchEvent(event);
      return event.defaultPrevented;
    };
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    trigger.focus();
    const openPrevented = sendKey(trigger, 'ArrowDown');
    const popover = document.querySelector('#groupPreviewPopover');
    const input = popover?.querySelector('.group-preview-search-input');
    if (!input) return null;
    input.value = 'nested-plan';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const items = [...popover.querySelectorAll('.group-preview-item')];
    const before = items.map((item) => ({
      title: item.querySelector('.group-preview-title')?.textContent || '',
      dormant: item.classList.contains('dormant'),
      state: item.querySelector('.group-preview-state')?.textContent || '',
    }));
    const enterPrevented = sendKey(input, 'Enter');
    return {
      snapshotTabId: target.snapshotTabId,
      query: input.value,
      openPrevented,
      enterPrevented,
      before,
    };
  })()`);
  const dormantPreviewLaunchState = await waitFor(client, `(() => {
    const snapshotTabId = ${JSON.stringify(dormantPreviewLaunch?.snapshotTabId || '')};
    if (!snapshotTabId) return null;
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const commands = window.__SPACE_TABS_PREVIEW_COMMANDS__ || [];
    const targetTabs = (runtime.tabs || [])
      .filter((tab) => tab.url === 'https://example.com/nested-plan');
    const targetBindings = Object.entries(stored.tabLifecycle || {})
      .filter(([, binding]) => binding?.snapshotTabId === snapshotTabId);
    if (targetTabs.length !== 1 || targetBindings.length !== 1) return null;
    const [bindingTabId, binding] = targetBindings[0];
    const createCommands = commands.filter((command) => command.type === 'tabs:create');
    return {
      popoverHidden: document.querySelector('#groupPreviewPopover')?.hidden,
      previewOpen: [...document.querySelectorAll('.folder-header')]
        .find((node) => node.querySelector('strong')?.textContent === 'Work')
        ?.dataset.previewOpen,
      targetTabs,
      bindingTabId: Number(bindingTabId),
      binding,
      createCommands,
      focusCommands: commands.filter((command) => command.type === 'tabs:focus'),
    };
  })()`, 7000);
  record(
    'collapsed group preview search + Enter focuses the exact materialized saved identity once',
    dormantPreviewLaunch?.query === 'nested-plan' &&
      dormantPreviewLaunch.openPrevented &&
      dormantPreviewLaunch.enterPrevented &&
      dormantPreviewLaunch.before.length === 1 &&
      dormantPreviewLaunch.before[0].title === 'example.com' &&
      !dormantPreviewLaunch.before[0].dormant &&
      dormantPreviewLaunchState.popoverHidden === true &&
      dormantPreviewLaunchState.previewOpen === 'false' &&
      dormantPreviewLaunchState.createCommands.length === 0 &&
      dormantPreviewLaunchState.focusCommands.length === 1 &&
      Number(dormantPreviewLaunchState.focusCommands[0]?.payload?.tabId) ===
        Number(dormantPreviewLaunchState.bindingTabId) &&
      dormantPreviewLaunchState.targetTabs[0]?.active === true &&
      dormantPreviewLaunchState.targetTabs[0]?.id === dormantPreviewLaunchState.bindingTabId &&
      dormantPreviewLaunchState.binding.snapshotTabId === dormantPreviewLaunch.snapshotTabId &&
      dormantPreviewLaunchState.binding.trackingMode === 'saved-target',
    JSON.stringify({ dormantPreviewLaunch, dormantPreviewLaunchState }),
  );

  await evaluate(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    if (workSection && !workSection.classList.contains('collapsed')) {
      workSection.querySelector(':scope > .folder-header')?.click();
    }
    return Boolean(workSection);
  })()`);
  await waitFor(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    return workSection?.classList.contains('collapsed') || null;
  })()`);
  const livePreviewLaunch = await evaluate(client, `(() => {
    const trigger = [...document.querySelectorAll('.folder-header')]
      .find((node) => node.querySelector('strong')?.textContent === 'Work');
    if (!trigger) return null;
    const sendKey = (targetNode, key) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      targetNode.dispatchEvent(event);
      return event.defaultPrevented;
    };
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    trigger.focus();
    const openPrevented = sendKey(trigger, 'ArrowRight');
    const popover = document.querySelector('#groupPreviewPopover');
    const input = popover?.querySelector('.group-preview-search-input');
    if (!input) return null;
    input.value = 'nested-plan';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const items = [...popover.querySelectorAll('.group-preview-item')];
    const before = items.map((item) => ({
      title: item.querySelector('.group-preview-title')?.textContent || '',
      dormant: item.classList.contains('dormant'),
      active: item.classList.contains('active'),
      state: item.querySelector('.group-preview-state')?.textContent || '',
    }));
    const enterPrevented = sendKey(input, 'Enter');
    return { openPrevented, enterPrevented, before };
  })()`);
  const livePreviewLaunchState = await waitFor(client, `(() => {
    const targetTabId = ${JSON.stringify(dormantPreviewLaunchState?.bindingTabId || null)};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const commands = window.__SPACE_TABS_PREVIEW_COMMANDS__ || [];
    const focusCommands = commands.filter((command) => command.type === 'tabs:focus');
    if (focusCommands.length < 1) return null;
    return {
      popoverHidden: document.querySelector('#groupPreviewPopover')?.hidden,
      previewOpen: [...document.querySelectorAll('.folder-header')]
        .find((node) => node.querySelector('strong')?.textContent === 'Work')
        ?.dataset.previewOpen,
      createCommands: commands.filter((command) => command.type === 'tabs:create'),
      focusCommands,
      targetTabs: (runtime.tabs || [])
        .filter((tab) => tab.url === 'https://example.com/nested-plan'),
      targetTabId,
    };
  })()`, 7000);

  await evaluate(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    if (workSection?.classList.contains('collapsed')) {
      workSection.querySelector(':scope > .folder-header')?.click();
    }
    return Boolean(workSection);
  })()`);
  await waitFor(client, `(() => {
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    return workSection && !workSection.classList.contains('collapsed') || null;
  })()`);
  await evaluate(client, `(() => {
    const docsCard = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Docs');
    if (docsCard?.classList.contains('collapsed')) docsCard.querySelector('.group-toggle')?.click();
    return Boolean(docsCard);
  })()`);
  const livePreviewIdentityState = await waitFor(client, `(() => {
    const snapshotTabId = ${JSON.stringify(dormantPreviewLaunch?.snapshotTabId || '')};
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const rows = [...document.querySelectorAll('.tab-row')]
      .filter((row) => row.dataset.snapshotTabId === snapshotTabId)
      .map((row) => ({
        tabId: Number(row.dataset.tabId),
        dormant: row.classList.contains('dormant'),
        title: row.querySelector('.tab-title')?.textContent || '',
      }));
    if (rows.length !== 1) return null;
    const snapshotRows = (stored.spaceSnapshots?.['folder-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .filter((tab) => tab.snapshotTabId === snapshotTabId);
    const lifecycleRows = Object.entries(stored.tabLifecycle || {})
      .filter(([, binding]) => binding?.snapshotTabId === snapshotTabId);
    return {
      rows,
      snapshotRows,
      lifecycleRows,
      runtimeTargets: (runtime.tabs || [])
        .filter((tab) => tab.url === 'https://example.com/nested-plan'),
    };
  })()`, 7000);
  record(
    'collapsed group preview search + Enter reuses the exact live identity without duplicate rows',
    livePreviewLaunch?.openPrevented &&
      livePreviewLaunch.enterPrevented &&
      livePreviewLaunch.before.length === 1 &&
      livePreviewLaunch.before[0].dormant === false &&
      livePreviewLaunch.before[0].active === true &&
      livePreviewLaunch.before[0].state === 'Active' &&
      livePreviewLaunchState.popoverHidden === true &&
      livePreviewLaunchState.previewOpen === 'false' &&
      livePreviewLaunchState.createCommands.length === 0 &&
      livePreviewLaunchState.focusCommands.length === 1 &&
      livePreviewLaunchState.focusCommands[0]?.payload?.tabId === livePreviewLaunchState.targetTabId &&
      livePreviewLaunchState.targetTabs.length === 1 &&
      livePreviewLaunchState.targetTabs[0]?.id === livePreviewLaunchState.targetTabId &&
      livePreviewLaunchState.targetTabs[0]?.active === true &&
      livePreviewIdentityState.rows.length === 1 &&
      livePreviewIdentityState.rows[0]?.tabId === livePreviewLaunchState.targetTabId &&
      livePreviewIdentityState.rows[0]?.dormant === false &&
      livePreviewIdentityState.snapshotRows.length === 1 &&
      livePreviewIdentityState.lifecycleRows.length === 1 &&
      livePreviewIdentityState.runtimeTargets.length === 1,
    JSON.stringify({ livePreviewLaunch, livePreviewLaunchState, livePreviewIdentityState }),
  );

  await checkpointPreviewCoverage(client, coverageSnapshots);
  await evaluate(client, `(() => {
    const backup = ${JSON.stringify(groupPreviewFixtureBackup)};
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of backup.local) localStorage.setItem(key, value);
    for (const [key, value] of backup.session) sessionStorage.setItem(key, value);
    return true;
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `(() => {
    if (document.querySelector('#activeSpaceName')?.textContent !== 'Folder Demo') return null;
    const workSection = [...document.querySelectorAll('.folder-section')]
      .find((node) => node.querySelector(':scope > .folder-header strong')?.textContent === 'Work');
    return workSection?.classList.contains('collapsed') || null;
  })()`);

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

  const savedOnlyDeletionFixtureBackup = await evaluate(client, `({
    local: [...Array(localStorage.length)].map((_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    }),
    session: [...Array(sessionStorage.length)].map((_, index) => {
      const key = sessionStorage.key(index);
      return [key, sessionStorage.getItem(key)];
    }),
  })`);
  await evaluate(client, `(() => {
    document.body.click();
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const state = raw.spaceTabsState || {};
    const spaceId = 'saved-delete-demo';
    state.spaces = (state.spaces || []).filter((space) => space.id !== spaceId);
    state.spaces.push({ id: spaceId, name: 'Saved Delete Demo', icon: 'S', color: 'cyan' });
    state.activeSpaceId = spaceId;
    state.spaceContexts = state.spaceContexts || {};
    state.spaceContexts[spaceId] = '# Saved-only Context must survive failed deletion';
    state.askSessions = state.askSessions || {};
    state.askSessions['space:' + spaceId] = {
      key: 'space:' + spaceId,
      title: 'Saved-only conversation',
      messages: [{
        id: 'saved-delete-question',
        role: 'user',
        text: 'Keep this saved-only conversation',
        createdAt: 1,
        updatedAt: 1,
      }],
      createdAt: 1,
      updatedAt: 1,
    };
    state.spaceSnapshots = state.spaceSnapshots || {};
    state.spaceSnapshots[spaceId] = {
      version: 1,
      identityVersion: 1,
      updatedAt: 1,
      groups: [
        {
          snapshotGroupId: 'saved-delete-group-single',
          title: 'Saved Single',
          color: 'blue',
          collapsed: false,
          tabs: [
            {
              snapshotTabId: 'saved-delete-tab-remove',
              title: 'Remove after retry',
              url: 'https://saved-delete.test/remove',
            },
            {
              snapshotTabId: 'saved-delete-tab-keep',
              title: 'Keep exact identity',
              url: 'https://saved-delete.test/keep',
            },
          ],
        },
        {
          snapshotGroupId: 'saved-delete-group-whole',
          title: 'Saved Whole',
          color: 'green',
          collapsed: false,
          tabs: [{
            snapshotTabId: 'saved-delete-tab-whole',
            title: 'Delete with group after retry',
            url: 'https://saved-delete.test/whole',
          }],
        },
      ],
    };
    state.collapsedGroups = state.collapsedGroups || {};
    state.collapsedGroups['snapshot:0:saved-delete-demo:saved-delete-group-single'] = false;
    state.collapsedGroups['snapshot:1:saved-delete-demo:saved-delete-group-whole'] = false;
    state.collapsedSpaceGroups = state.collapsedSpaceGroups || {};
    state.collapsedSpaceGroups[spaceId] = false;
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: state }));
    sessionStorage.removeItem('spaceTabsWindowState');
    sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify({
      tabs: [],
      groups: [],
      nextId: 9100,
      nextGroupId: 9200,
    }));
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `(() => {
    if (document.querySelector('#activeSpaceName')?.textContent !== 'Saved Delete Demo') return null;
    const rows = [...document.querySelectorAll('.tab-row.dormant')];
    return rows.length === 3 &&
      rows.some((row) => row.dataset.snapshotTabId === 'saved-delete-tab-remove') &&
      rows.some((row) => row.dataset.snapshotTabId === 'saved-delete-tab-keep') &&
      rows.some((row) => row.dataset.snapshotTabId === 'saved-delete-tab-whole') || null;
  })()`);
  const savedOnlyDeletionStateExpression = `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const snapshot = stored.spaceSnapshots?.['saved-delete-demo'];
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const chromeMutations = new Set(${JSON.stringify(dormantSwitchMutationCommands)});
    return {
      groups: (snapshot?.groups || []).map((group) => ({
        id: group.snapshotGroupId || '',
        title: group.title || '',
        tabs: (group.tabs || []).map((tab) => tab.snapshotTabId || ''),
      })),
      context: stored.spaceContexts?.['saved-delete-demo'] || '',
      askMessages: (stored.askSessions?.['space:saved-delete-demo']?.messages || [])
        .map((message) => ({ id: message.id, text: message.text })),
      domRows: [...document.querySelectorAll('.tab-row')].map((row) => ({
        snapshotGroupId: row.dataset.snapshotGroupId || '',
        snapshotTabId: row.dataset.snapshotTabId || '',
        dormant: row.classList.contains('dormant'),
      })),
      status: document.querySelector('#syncStatus')?.textContent || '',
      runtimeTabs: (runtime.tabs || []).length,
      commands: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .map((command) => command.type)
        .filter((type) => chromeMutations.has(type)),
    };
  })()`;
  const savedOnlyDeletionBaseline = await evaluate(client, savedOnlyDeletionStateExpression);

  await evaluate(client, `(() => {
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    const originalSetItem = Storage.prototype.setItem;
    let rejectAfterApply = true;
    Storage.prototype.setItem = function savedTabCheckpointFailure(key, value) {
      originalSetItem.call(this, key, value);
      if (this === localStorage && key === 'spaceTabsState' && rejectAfterApply) {
        rejectAfterApply = false;
        throw new Error('saved-only tab checkpoint failed after apply');
      }
    };
    window.__restoreSavedDeletionStorage__ = () => {
      Storage.prototype.setItem = originalSetItem;
      delete window.__restoreSavedDeletionStorage__;
    };
    const row = [...document.querySelectorAll('.tab-row')]
      .find((node) => node.dataset.snapshotTabId === 'saved-delete-tab-remove');
    row?.querySelector('button[aria-label="Remove saved tab"]')?.click();
    return Boolean(row);
  })()`);
  await waitFor(client, `document.querySelector('#syncStatus')?.textContent.includes('saved-only tab checkpoint failed after apply')`);
  const savedOnlyTabFailureState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'saved-only tab deletion compensates an applied checkpoint failure without losing DOM, Context, or identity',
    JSON.stringify(savedOnlyTabFailureState.groups) === JSON.stringify(savedOnlyDeletionBaseline.groups) &&
      JSON.stringify(savedOnlyTabFailureState.domRows) === JSON.stringify(savedOnlyDeletionBaseline.domRows) &&
      savedOnlyTabFailureState.context === savedOnlyDeletionBaseline.context &&
      JSON.stringify(savedOnlyTabFailureState.askMessages) === JSON.stringify(savedOnlyDeletionBaseline.askMessages) &&
      savedOnlyTabFailureState.status.includes('saved-only tab checkpoint failed after apply') &&
      !savedOnlyTabFailureState.status.includes('Removed saved tab') &&
      savedOnlyTabFailureState.runtimeTabs === 0 &&
      savedOnlyTabFailureState.commands.length === 0,
    JSON.stringify({ savedOnlyDeletionBaseline, savedOnlyTabFailureState }),
  );

  await evaluate(client, `window.__restoreSavedDeletionStorage__?.()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('.tab-row[data-snapshot-tab-id="saved-delete-tab-remove"]') || null`);
  const savedOnlyTabFailureReloadState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'saved-only tab remains durable after the failed deletion is reloaded',
    JSON.stringify(savedOnlyTabFailureReloadState.groups) === JSON.stringify(savedOnlyDeletionBaseline.groups) &&
      JSON.stringify(savedOnlyTabFailureReloadState.domRows) === JSON.stringify(savedOnlyDeletionBaseline.domRows) &&
      savedOnlyTabFailureReloadState.context === savedOnlyDeletionBaseline.context &&
      JSON.stringify(savedOnlyTabFailureReloadState.askMessages) === JSON.stringify(savedOnlyDeletionBaseline.askMessages),
    JSON.stringify(savedOnlyTabFailureReloadState),
  );

  await evaluate(client, `(() => {
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    const row = [...document.querySelectorAll('.tab-row')]
      .find((node) => node.dataset.snapshotTabId === 'saved-delete-tab-remove');
    row?.querySelector('button[aria-label="Remove saved tab"]')?.click();
    return Boolean(row);
  })()`);
  await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const ids = (stored.spaceSnapshots?.['saved-delete-demo']?.groups || [])
      .flatMap((group) => (group.tabs || []).map((tab) => tab.snapshotTabId));
    return !ids.includes('saved-delete-tab-remove') &&
      !document.querySelector('.tab-row[data-snapshot-tab-id="saved-delete-tab-remove"]') || null;
  })()`);
  const savedOnlyTabRetryState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'retrying saved-only tab deletion removes exactly one row and preserves the remaining identities and Context',
    JSON.stringify(savedOnlyTabRetryState.groups) === JSON.stringify([
      {
        id: 'saved-delete-group-single',
        title: 'Saved Single',
        tabs: ['saved-delete-tab-keep'],
      },
      {
        id: 'saved-delete-group-whole',
        title: 'Saved Whole',
        tabs: ['saved-delete-tab-whole'],
      },
    ]) &&
      savedOnlyTabRetryState.domRows.length === 2 &&
      savedOnlyTabRetryState.domRows.every((row) => row.dormant) &&
      savedOnlyTabRetryState.context === savedOnlyDeletionBaseline.context &&
      JSON.stringify(savedOnlyTabRetryState.askMessages) === JSON.stringify(savedOnlyDeletionBaseline.askMessages) &&
      savedOnlyTabRetryState.status === 'Removed saved tab.' &&
      savedOnlyTabRetryState.runtimeTabs === 0 &&
      savedOnlyTabRetryState.commands.length === 0,
    JSON.stringify(savedOnlyTabRetryState),
  );

  const savedOnlyGroupBaseline = savedOnlyTabRetryState;
  await evaluate(client, `(() => {
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    const originalSetItem = Storage.prototype.setItem;
    let rejectAfterApply = true;
    Storage.prototype.setItem = function savedGroupCheckpointFailure(key, value) {
      originalSetItem.call(this, key, value);
      if (this === localStorage && key === 'spaceTabsState' && rejectAfterApply) {
        rejectAfterApply = false;
        throw new Error('saved-only group checkpoint failed after apply');
      }
    };
    window.__restoreSavedDeletionStorage__ = () => {
      Storage.prototype.setItem = originalSetItem;
      delete window.__restoreSavedDeletionStorage__;
    };
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Saved Whole');
    card?.querySelector('.group-toggle')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, clientX: 24, clientY: 24,
    }));
    [...document.querySelectorAll('#contextMenu [role="menuitem"]')]
      .find((item) => item.textContent === 'Delete Group')?.click();
    return Boolean(card);
  })()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'Delete Group'`);
  await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
  await waitFor(client, `document.querySelector('#syncStatus')?.textContent.includes('saved-only group checkpoint failed after apply')`);
  const savedOnlyGroupFailureState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'saved-only group deletion compensates an applied checkpoint failure without losing the group or its Context',
    JSON.stringify(savedOnlyGroupFailureState.groups) === JSON.stringify(savedOnlyGroupBaseline.groups) &&
      JSON.stringify(savedOnlyGroupFailureState.domRows) === JSON.stringify(savedOnlyGroupBaseline.domRows) &&
      savedOnlyGroupFailureState.context === savedOnlyGroupBaseline.context &&
      JSON.stringify(savedOnlyGroupFailureState.askMessages) === JSON.stringify(savedOnlyGroupBaseline.askMessages) &&
      savedOnlyGroupFailureState.status.includes('saved-only group checkpoint failed after apply') &&
      !savedOnlyGroupFailureState.status.includes('Deleted saved group') &&
      savedOnlyGroupFailureState.runtimeTabs === 0 &&
      savedOnlyGroupFailureState.commands.length === 0,
    JSON.stringify({ savedOnlyGroupBaseline, savedOnlyGroupFailureState }),
  );

  await evaluate(client, `window.__restoreSavedDeletionStorage__?.()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('.tab-row[data-snapshot-tab-id="saved-delete-tab-whole"]') || null`);
  const savedOnlyGroupFailureReloadState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'saved-only group remains durable after the failed deletion is reloaded',
    JSON.stringify(savedOnlyGroupFailureReloadState.groups) === JSON.stringify(savedOnlyGroupBaseline.groups) &&
      JSON.stringify(savedOnlyGroupFailureReloadState.domRows) === JSON.stringify(savedOnlyGroupBaseline.domRows) &&
      savedOnlyGroupFailureReloadState.context === savedOnlyGroupBaseline.context &&
      JSON.stringify(savedOnlyGroupFailureReloadState.askMessages) === JSON.stringify(savedOnlyGroupBaseline.askMessages),
    JSON.stringify(savedOnlyGroupFailureReloadState),
  );

  await evaluate(client, `(() => {
    window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Saved Whole');
    card?.querySelector('.group-toggle')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, clientX: 24, clientY: 24,
    }));
    [...document.querySelectorAll('#contextMenu [role="menuitem"]')]
      .find((item) => item.textContent === 'Delete Group')?.click();
    return Boolean(card);
  })()`);
  await waitFor(client, `document.querySelector('#actionDialog')?.open && document.querySelector('#actionDialogTitle')?.textContent === 'Delete Group'`);
  await evaluate(client, `document.querySelector('#actionDialogConfirm').click()`);
  await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const groups = stored.spaceSnapshots?.['saved-delete-demo']?.groups || [];
    return !groups.some((group) => group.snapshotGroupId === 'saved-delete-group-whole') &&
      !document.querySelector('.tab-row[data-snapshot-tab-id="saved-delete-tab-whole"]') || null;
  })()`);
  const savedOnlyGroupRetryState = await evaluate(client, savedOnlyDeletionStateExpression);
  record(
    'retrying saved-only group deletion removes exactly that group once and preserves Context',
    JSON.stringify(savedOnlyGroupRetryState.groups) === JSON.stringify([{
      id: 'saved-delete-group-single',
      title: 'Saved Single',
      tabs: ['saved-delete-tab-keep'],
    }]) &&
      JSON.stringify(savedOnlyGroupRetryState.domRows) === JSON.stringify([{
        snapshotGroupId: 'saved-delete-group-single',
        snapshotTabId: 'saved-delete-tab-keep',
        dormant: true,
      }]) &&
      savedOnlyGroupRetryState.context === savedOnlyDeletionBaseline.context &&
      JSON.stringify(savedOnlyGroupRetryState.askMessages) === JSON.stringify(savedOnlyDeletionBaseline.askMessages) &&
      savedOnlyGroupRetryState.status === 'Deleted saved group "Saved Whole".' &&
      savedOnlyGroupRetryState.runtimeTabs === 0 &&
      savedOnlyGroupRetryState.commands.length === 0,
    JSON.stringify(savedOnlyGroupRetryState),
  );

  await checkpointPreviewCoverage(client, coverageSnapshots);
  await evaluate(client, `(() => {
    const backup = ${JSON.stringify(savedOnlyDeletionFixtureBackup)};
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of backup.local) localStorage.setItem(key, value);
    for (const [key, value] of backup.session) sessionStorage.setItem(key, value);
    return true;
  })()`);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Folder Demo'`);

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
    const domOrder = [...(document.querySelector('#groupsList')?.children || [])]
      .map((node) => {
        const title = node.matches('.group-card')
          ? node.querySelector(':scope > .group-header h2')?.textContent
          : node.querySelector(':scope > .folder-header strong')?.textContent;
        return title ? (node.matches('.folder-section') ? 'folder:' : 'group:') + title : '';
      })
      .filter(Boolean);
    return titles[0] === 'Beta' ? { titles, domOrder } : null;
  })()`);
  record(
    'dormant imported groups can be drag-sorted',
    dormantSortState.titles.join(' > ') === 'Beta > Alpha > Gamma' &&
      dormantSortState.domOrder.join(' > ') === 'group:Beta > group:Alpha > group:Gamma',
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
    const groupsList = document.querySelector('#groupsList');
    const betaFolder = [...(groupsList?.children || [])].find((node) => (
      node.matches('.folder-section') &&
      node.querySelector(':scope > .folder-header strong')?.textContent === 'Beta'
    ));
    const rootOrder = [...(groupsList?.children || [])]
      .map((node) => {
        const title = node.matches('.group-card')
          ? node.querySelector(':scope > .group-header h2')?.textContent
          : node.querySelector(':scope > .folder-header strong')?.textContent;
        return title ? (node.matches('.folder-section') ? 'folder:' : 'group:') + title : '';
      })
      .filter(Boolean);
    const betaChildren = [...(betaFolder?.querySelector(':scope > .folder-children')?.children || [])]
      .map((node) => 'group:' + (node.querySelector(':scope > .group-header h2')?.textContent || ''));
    const gammaHeader = [...(betaFolder?.querySelectorAll('.group-header h2') || [])]
      .find((node) => node.textContent === 'Gamma');
    const gammaDepth = gammaHeader
      ? [...gammaHeader.closest('.group-card, .folder-direct-group').parentElement.closest('#groupsList')
        .querySelectorAll('.folder-section')]
        .filter((section) => section.contains(gammaHeader)).length
      : 0;
    return titles.includes('Beta / Gamma')
      ? { titles, rootOrder, betaChildren, gammaDepth }
      : null;
  })()`);
  record(
    'dormant imported groups can be dragged into another group',
    dormantNestState.titles.join(' > ') === 'Beta > Beta / Gamma > Alpha' &&
      dormantNestState.rootOrder.join(' > ') === 'folder:Beta > group:Alpha' &&
      dormantNestState.betaChildren.join(' > ') === 'group:Beta > group:Gamma' &&
      dormantNestState.gammaDepth === 1,
    JSON.stringify(dormantNestState)
  );
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drag Demo'`);
  const dormantNestReloadState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const titles = (stored.spaceSnapshots?.['drag-demo']?.groups || []).map((group) => group.title);
    const groupsList = document.querySelector('#groupsList');
    const betaFolder = [...(groupsList?.children || [])].find((node) => (
      node.matches('.folder-section') &&
      node.querySelector(':scope > .folder-header strong')?.textContent === 'Beta'
    ));
    const rootOrder = [...(groupsList?.children || [])]
      .map((node) => {
        const title = node.matches('.group-card')
          ? node.querySelector(':scope > .group-header h2')?.textContent
          : node.querySelector(':scope > .folder-header strong')?.textContent;
        return title ? (node.matches('.folder-section') ? 'folder:' : 'group:') + title : '';
      })
      .filter(Boolean);
    const betaChildren = [...(betaFolder?.querySelector(':scope > .folder-children')?.children || [])]
      .map((node) => 'group:' + (node.querySelector(':scope > .group-header h2')?.textContent || ''));
    const gammaHeader = [...(betaFolder?.querySelectorAll('.group-header h2') || [])]
      .find((node) => node.textContent === 'Gamma');
    return titles.includes('Beta / Gamma') && gammaHeader
      ? {
          titles,
          rootOrder,
          betaChildren,
          gammaFolderTitle: gammaHeader.closest('.folder-section')
            ?.querySelector(':scope > .folder-header strong')?.textContent || '',
        }
      : null;
  })()`);
  record(
    'dormant imported group nesting keeps storage and DOM hierarchy after reload',
    dormantNestReloadState.titles.join(' > ') === 'Beta > Beta / Gamma > Alpha' &&
      dormantNestReloadState.rootOrder.join(' > ') === 'folder:Beta > group:Alpha' &&
      dormantNestReloadState.betaChildren.join(' > ') === 'group:Beta > group:Gamma' &&
      dormantNestReloadState.gammaFolderTitle === 'Beta',
    JSON.stringify(dormantNestReloadState)
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
    state.groupSpaces[1201] = 'drop-demo';
    state.tabSpaces[1202] = 'drop-demo';
    delete state.tabGroups[1202];
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
    const storedWindowState = JSON.parse(
      sessionStorage.getItem('spaceTabsWindowState') || '{}'
    ).spaceTabsWindowState || { activeSpaceIds: {} };
    storedWindowState.activeSpaceIds = {
      ...(storedWindowState.activeSpaceIds || {}),
      1: 'drop-demo',
    };
    sessionStorage.setItem('spaceTabsWindowState', JSON.stringify({
      spaceTabsWindowState: storedWindowState,
    }));
    sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify({
      tabs: [{
        id: 1202,
        title: 'Browser Spaces Guide',
        url: 'https://example.com/spaces-guide',
        favIconUrl: '',
        pinned: false,
        muted: false,
        active: true,
        groupId: 1201,
        index: 0,
        windowId: 1,
        audible: false,
      }],
      groups: [{ id: 1201, title: 'Research', color: 'blue', collapsed: false }],
      nextId: 1203,
      nextGroupId: 1202,
    }));
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  await evaluate(client, `(() => {
    for (const header of document.querySelectorAll('.group-card.collapsed .group-header')) {
      header.querySelector('.group-toggle')?.click();
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
  const dormantTabDropReadyState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    const rows = [...(card?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    const ready = rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      rows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      !rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      snapshotUrls.filter((url) => url === 'https://example.com/spaces-guide').length === 1;
    return ready ? { rows, snapshotUrls } : null;
  })()`);
  record(
    'an imported legacy row binds to one matching live tab without a duplicate dormant row',
    dormantTabDropReadyState.snapshotUrls.includes('https://example.com/drop-saved'),
    JSON.stringify(dormantTabDropReadyState)
  );
  await evaluate(client, `(() => {
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const state = raw.spaceTabsState || {};
    state.groupSpaces = state.groupSpaces || {};
    state.tabSpaces = state.tabSpaces || {};
    state.tabGroups = state.tabGroups || {};
    state.groupOrder = state.groupOrder || {};
    state.tabOrder = state.tabOrder || {};
    state.collapsedGroups = state.collapsedGroups || {};
    state.tabLifecycle = state.tabLifecycle || {};
    delete state.groupSpaces[1201];
    delete state.tabSpaces[1202];
    delete state.tabGroups[1202];
    delete state.tabLifecycle[1202];
    state.groupSpaces[1301] = 'drop-demo';
    state.groupSpaces[1302] = 'drop-demo';
    delete state.tabSpaces[1303];
    delete state.tabSpaces[1304];
    delete state.tabGroups[1303];
    delete state.tabGroups[1304];
    delete state.tabLifecycle[1303];
    delete state.tabLifecycle[1304];
    state.groupOrder['drop-demo'] = ['group:1301', 'group:1302'];
    state.tabOrder['drop-demo'] = { 'group:1301': [1304], 'group:1302': [1303] };
    state.collapsedGroups['group:1301'] = false;
    state.collapsedGroups['group:1302'] = false;
    state.spaceSnapshots['drop-demo'] = {
      version: 1,
      updatedAt: Date.now(),
      groups: [
        {
          snapshotGroupId: 'drop-research',
          title: 'Research',
          color: 'blue',
          collapsed: false,
          tabs: [
            {
              snapshotTabId: 'drop-anchor',
              title: 'Research Anchor',
              url: 'https://example.com/research-anchor',
            },
            {
              snapshotTabId: 'drop-saved',
              title: 'Saved Doc',
              url: 'https://example.com/drop-saved',
            },
          ],
        },
        {
          snapshotGroupId: 'drop-source',
          title: 'Source',
          color: 'green',
          collapsed: false,
          tabs: [{
            snapshotTabId: 'drop-live',
            title: 'Browser Spaces Guide',
            url: 'https://example.com/spaces-guide',
          }],
        },
      ],
    };
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: state }));
    sessionStorage.setItem('spaceTabsPreviewRuntime', JSON.stringify({
      tabs: [
        {
          id: 1303,
          title: 'Browser Spaces Guide',
          url: 'https://example.com/spaces-guide',
          favIconUrl: '',
          pinned: false,
          muted: false,
          active: true,
          groupId: 1302,
          index: 0,
          windowId: 1,
          audible: false,
        },
        {
          id: 1304,
          title: 'Research Anchor',
          url: 'https://example.com/research-anchor',
          favIconUrl: '',
          pinned: false,
          muted: false,
          active: false,
          groupId: 1301,
          index: 1,
          windowId: 1,
          audible: false,
        },
      ],
      groups: [
        { id: 1301, title: 'Research', color: 'blue', collapsed: false },
        { id: 1302, title: 'Source', color: 'green', collapsed: false },
      ],
      nextId: 1305,
      nextGroupId: 1303,
    }));
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  const distinctDropFixtureState = await waitFor(client, `(() => {
    for (const card of document.querySelectorAll('.group-card.collapsed')) {
      card.querySelector('.group-toggle')?.click();
    }
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const cardFor = (title) => [...document.querySelectorAll('.group-card')]
      .find((card) => card.querySelector('.group-header h2')?.textContent === title);
    const rowsFor = (title) => [...(cardFor(title)?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const targetRows = rowsFor('Research');
    const sourceRows = rowsFor('Source');
    const runtimeTab = (runtime.tabs || []).find((tab) => Number(tab.id) === 1303);
    const snapshotGroups = stored.spaceSnapshots?.['drop-demo']?.groups || [];
    const researchUrls = snapshotGroups.find((group) => group.title === 'Research')?.tabs
      ?.map((tab) => tab.url) || [];
    const sourceUrls = snapshotGroups.find((group) => group.title === 'Source')?.tabs
      ?.map((tab) => tab.url) || [];
    const ready = Number(runtimeTab?.groupId) === 1302 &&
      stored.groupSpaces?.[1301] === 'drop-demo' &&
      stored.groupSpaces?.[1302] === 'drop-demo' &&
      targetRows.some((row) => !row.dormant && row.text.includes('Research Anchor')) &&
      targetRows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      !targetRows.some((row) => row.text.includes('Browser Spaces Guide')) &&
      sourceRows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      !sourceRows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      !researchUrls.includes('https://example.com/spaces-guide') &&
      researchUrls.includes('https://example.com/research-anchor') &&
      sourceUrls.filter((url) => url === 'https://example.com/spaces-guide').length === 1;
    return ready ? {
      runtimeGroupId: runtimeTab.groupId,
      targetRows,
      sourceRows,
      researchUrls,
      sourceUrls,
    } : null;
  })()`);
  record(
    'live-tab drop fixture starts in distinct physical Source and Research groups',
    distinctDropFixtureState.runtimeGroupId === 1302 &&
      distinctDropFixtureState.targetRows.some((row) => (
        !row.dormant && row.text.includes('Research Anchor')
      )) &&
      !distinctDropFixtureState.targetRows.some((row) => row.text.includes('Browser Spaces Guide')) &&
      distinctDropFixtureState.sourceRows.some((row) => (
        !row.dormant && row.text.includes('Browser Spaces Guide')
      )),
    JSON.stringify(distinctDropFixtureState)
  );
  await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
  const dormantTabDropDispatchState = await evaluate(client, `(() => {
    const sourceCard = [...document.querySelectorAll('.group-card')]
      .find((card) => card.querySelector('.group-header h2')?.textContent === 'Source');
    const source = [...(sourceCard?.querySelectorAll('.tab-row:not(.dormant)') || [])]
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
    window.__dormantTabDropStartedAt = Date.now();
    return {
      ok: true,
      overPrevented: over.defaultPrevented || overResult === false,
      dropPrevented: drop.defaultPrevented || dropResult === false,
    };
  })()`);
  const dormantTabDropState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const targetCard = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (targetCard?.classList.contains('collapsed')) {
      targetCard.querySelector('.group-toggle')?.click();
      return null;
    }
    const sourceCard = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Source');
    const groupKey = targetCard?.dataset.groupKey || '';
    const groupId = groupKey.match(/^group:(\\d+)$/)?.[1] || '';
    const targetRows = [...(targetCard?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const sourceRows = [...(sourceCard?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const matchingRows = [...document.querySelectorAll('.tab-row')]
      .filter((row) => row.textContent.includes('Browser Spaces Guide'))
      .map((row) => ({
        text: row.textContent,
        dormant: row.classList.contains('dormant'),
        groupTitle: row.closest('.group-card')?.querySelector('.group-header h2')?.textContent || '',
      }));
    const snapshotGroups = (stored.spaceSnapshots?.['drop-demo']?.groups || []).map((group) => ({
      snapshotGroupId: group.snapshotGroupId || '',
      title: group.title,
      color: group.color,
      collapsed: Boolean(group.collapsed),
      tabs: (group.tabs || []).map((tab) => ({
        snapshotTabId: tab.snapshotTabId || '',
        title: tab.title,
        url: tab.url,
      })),
    }));
    const snapshotUrls = snapshotGroups.flatMap((group) => group.tabs).map((tab) => tab.url);
    const sourceSnapshotUrls = snapshotGroups.find((group) => group.title === 'Source')?.tabs
      ?.map((tab) => tab.url) || [];
    const syntheticStateKeys = [
      ...Object.keys(stored.tabSpaces || {}),
      ...Object.keys(stored.tabGroups || {}),
    ].filter((key) => key.startsWith('snapshot:'));
    const commands = window.__SPACE_TABS_PREVIEW_COMMANDS__ || [];
    const groupExistingCommands = commands.filter((command) => command.type === 'tabs:groupExisting');
    const moveRelativeCommands = commands.filter((command) => command.type === 'tabs:moveRelative');
    const runtimeTab = (runtime.tabs || []).find((tab) => Number(tab.id) === 1303);
    const runtimeOrder = [...(runtime.tabs || [])]
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map((item) => ({ id: Number(item.id), index: Number(item.index), groupId: Number(item.groupId) }));
    const runtimeGroupIds = (runtime.groups || []).map((group) => Number(group.id)).sort((a, b) => a - b);
    const status = document.querySelector('#syncStatus')?.textContent || '';
    const expectedGroupCommand = groupExistingCommands.length === 1 &&
      Number(groupExistingCommands[0]?.payload?.groupId) === 1301 &&
      JSON.stringify(groupExistingCommands[0]?.payload?.tabIds || []) === '[1303]';
    const expectedMoveCommand = moveRelativeCommands.length === 1 &&
      JSON.stringify(moveRelativeCommands[0]?.payload || {}) === JSON.stringify({
        tabId: 1303,
        anchorTabId: 1304,
        edge: 'after',
        expectedGroupId: 1301,
      });
    const storageProjection = {
      groupSpaces: {
        research: stored.groupSpaces?.[1301] || '',
        source: stored.groupSpaces?.[1302] || '',
      },
      tabSpaces: stored.tabSpaces?.[1303] || '',
      tabGroups: stored.tabGroups?.[1303] || '',
      groupOrder: stored.groupOrder?.['drop-demo'] || [],
      tabOrder: stored.tabOrder?.['drop-demo'] || {},
      snapshotGroups,
    };
    const complete = groupId === '1301' && stored.groupSpaces?.[1301] === 'drop-demo' &&
      Number(runtimeTab?.groupId) === 1301 && expectedGroupCommand && expectedMoveCommand &&
      JSON.stringify(runtimeOrder) === JSON.stringify([
        { id: 1304, index: 0, groupId: 1301 },
        { id: 1303, index: 1, groupId: 1301 },
      ]) &&
      JSON.stringify(runtimeGroupIds) === JSON.stringify([1301]) &&
      targetRows.some((row) => !row.dormant && row.text.includes('Research Anchor')) &&
      targetRows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      targetRows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      !targetRows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      matchingRows.length === 1 && !matchingRows[0].dormant && matchingRows[0].groupTitle === 'Research' &&
      sourceRows.length === 0 && !sourceCard &&
      !sourceSnapshotUrls.includes('https://example.com/spaces-guide') &&
      snapshotUrls.filter((url) => url === 'https://example.com/spaces-guide').length === 1 &&
      snapshotUrls.includes('https://example.com/research-anchor') &&
      snapshotUrls.includes('https://example.com/drop-saved') &&
      syntheticStateKeys.length === 0 && !/could not|changed|failed|error/i.test(status);
    const diagnosticReady = Date.now() - Number(window.__dormantTabDropStartedAt || 0) >= 2500;
    return complete || diagnosticReady ? {
      complete,
      groupKey,
      runtimeGroupId: runtimeTab?.groupId,
      targetRows,
      sourceRows,
      sourceCardPresent: Boolean(sourceCard),
      matchingRows,
      snapshotUrls,
      sourceSnapshotUrls,
      snapshotGroups,
      syntheticStateKeys,
      groupExistingCommands,
      moveRelativeCommands,
      runtimeOrder,
      runtimeGroupIds,
      storageProjection,
      status,
    } : null;
  })()`);
  record(
    'live tabs physically move from Source onto imported Research without residue',
    dormantTabDropDispatchState.ok &&
      dormantTabDropDispatchState.overPrevented &&
      dormantTabDropDispatchState.dropPrevented &&
      dormantTabDropState.complete &&
      dormantTabDropState.runtimeGroupId === 1301 &&
      dormantTabDropState.groupExistingCommands.length === 1 &&
      dormantTabDropState.groupExistingCommands[0].payload.groupId === 1301 &&
      JSON.stringify(dormantTabDropState.groupExistingCommands[0].payload.tabIds) === '[1303]' &&
      dormantTabDropState.moveRelativeCommands.length === 1 &&
      JSON.stringify(dormantTabDropState.moveRelativeCommands[0].payload) === JSON.stringify({
        tabId: 1303,
        anchorTabId: 1304,
        edge: 'after',
        expectedGroupId: 1301,
      }) &&
      JSON.stringify(dormantTabDropState.runtimeOrder) === JSON.stringify([
        { id: 1304, index: 0, groupId: 1301 },
        { id: 1303, index: 1, groupId: 1301 },
      ]) &&
      JSON.stringify(dormantTabDropState.runtimeGroupIds) === JSON.stringify([1301]) &&
      dormantTabDropState.targetRows.some((row) => (
        !row.dormant && row.text.includes('Browser Spaces Guide')
      )) &&
      dormantTabDropState.targetRows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      dormantTabDropState.matchingRows.length === 1 &&
      dormantTabDropState.sourceRows.length === 0 &&
      dormantTabDropState.sourceCardPresent === false &&
      dormantTabDropState.snapshotUrls
        .filter((url) => url === 'https://example.com/spaces-guide').length === 1 &&
      dormantTabDropState.snapshotUrls.includes('https://example.com/research-anchor') &&
      dormantTabDropState.snapshotUrls.includes('https://example.com/drop-saved') &&
      dormantTabDropState.syntheticStateKeys.length === 0,
    JSON.stringify({ dormantTabDropDispatchState, dormantTabDropState })
  );
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  const dormantTabDropReloadState = await waitFor(client, `(() => {
    for (const card of document.querySelectorAll('.group-card.collapsed')) {
      card.querySelector('.group-toggle')?.click();
    }
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const targetCard = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    const sourceCard = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Source');
    const targetRows = [...(targetCard?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const matchingRows = [...document.querySelectorAll('.tab-row')]
      .filter((row) => row.textContent.includes('Browser Spaces Guide'))
      .map((row) => ({
        dormant: row.classList.contains('dormant'),
        groupTitle: row.closest('.group-card')?.querySelector('.group-header h2')?.textContent || '',
      }));
    const snapshotGroups = (stored.spaceSnapshots?.['drop-demo']?.groups || []).map((group) => ({
      snapshotGroupId: group.snapshotGroupId || '',
      title: group.title,
      color: group.color,
      collapsed: Boolean(group.collapsed),
      tabs: (group.tabs || []).map((tab) => ({
        snapshotTabId: tab.snapshotTabId || '',
        title: tab.title,
        url: tab.url,
      })),
    }));
    const runtimeTab = (runtime.tabs || []).find((tab) => Number(tab.id) === 1303);
    const runtimeOrder = [...(runtime.tabs || [])]
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map((item) => ({ id: Number(item.id), index: Number(item.index), groupId: Number(item.groupId) }));
    const runtimeGroupIds = (runtime.groups || []).map((group) => Number(group.id)).sort((a, b) => a - b);
    const storageProjection = {
      groupSpaces: {
        research: stored.groupSpaces?.[1301] || '',
        source: stored.groupSpaces?.[1302] || '',
      },
      tabSpaces: stored.tabSpaces?.[1303] || '',
      tabGroups: stored.tabGroups?.[1303] || '',
      groupOrder: stored.groupOrder?.['drop-demo'] || [],
      tabOrder: stored.tabOrder?.['drop-demo'] || {},
      snapshotGroups,
    };
    const ready = Number(runtimeTab?.groupId) === 1301 &&
      targetRows.some((row) => !row.dormant && row.text.includes('Research Anchor')) &&
      targetRows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      targetRows.some((row) => row.dormant && row.text.includes('Saved Doc')) &&
      matchingRows.length === 1 && !matchingRows[0].dormant &&
      matchingRows[0].groupTitle === 'Research' && !sourceCard;
    const diagnosticReady = performance.now() >= 2500;
    return ready || diagnosticReady ? {
      ready,
      runtimeGroupId: runtimeTab.groupId,
      runtimeOrder,
      runtimeGroupIds,
      targetRows,
      matchingRows,
      sourceCardPresent: Boolean(sourceCard),
      sourceRows: [...(sourceCard?.querySelectorAll('.tab-row') || [])].map((row) => ({
        text: row.textContent,
        dormant: row.classList.contains('dormant'),
      })),
      storageProjection,
    } : null;
  })()`);
  record(
    'live-tab imported-group drop keeps runtime, DOM, and storage stable after reload',
    dormantTabDropReloadState.ready &&
      dormantTabDropReloadState.runtimeGroupId === 1301 &&
      JSON.stringify(dormantTabDropReloadState.runtimeOrder) === JSON.stringify([
        { id: 1304, index: 0, groupId: 1301 },
        { id: 1303, index: 1, groupId: 1301 },
      ]) &&
      JSON.stringify(dormantTabDropReloadState.runtimeGroupIds) === JSON.stringify([1301]) &&
      dormantTabDropReloadState.matchingRows.length === 1 &&
      dormantTabDropReloadState.sourceCardPresent === false &&
      JSON.stringify(dormantTabDropReloadState.storageProjection) ===
        JSON.stringify(dormantTabDropState.storageProjection),
    JSON.stringify({ dormantTabDropState, dormantTabDropReloadState })
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
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Drop Demo'`);
  const activatedTagResidueState = await waitFor(client, `(() => {
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (card?.classList.contains('collapsed')) {
      card.querySelector('.group-toggle')?.click();
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
    window.__closeGroupTagStartedAt = Date.now();
    return {
      clicked: Boolean(closeButton),
      rowText: row?.textContent || '',
    };
  })()`);
  const closeGroupTagCheckpointState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const runtimeUrls = (runtime.tabs || []).map((tab) => tab.url);
    const complete = !runtimeUrls.includes('https://example.com/spaces-guide') &&
      snapshotUrls.includes('https://example.com/drop-saved') &&
      snapshotUrls.includes('https://example.com/spaces-guide#stale-dormant-row') &&
      !snapshotUrls.includes('https://example.com/spaces-guide');
    const diagnosticReady = Date.now() - Number(window.__closeGroupTagStartedAt || 0) >= 2500;
    return complete || diagnosticReady ? { complete, runtimeUrls, snapshotUrls } : null;
  })()`);
  await evaluate(client, `(() => {
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    if (card?.classList.contains('collapsed')) card.querySelector('.group-toggle')?.click();
    return true;
  })()`);
  const closeGroupTagResidueState = await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    const rows = [...(card?.querySelectorAll('.tab-row') || [])].map((row) => ({
      text: row.textContent,
      dormant: row.classList.contains('dormant'),
    }));
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    if (!rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide'))) return null;
    return { rows, snapshotUrls };
  })()`);
  record(
    'closing a live group tag keeps its distinct URL-variant history',
    closeGroupTagDispatchState.clicked &&
      closeGroupTagCheckpointState.complete &&
      !closeGroupTagResidueState.rows.some((row) => !row.dormant && row.text.includes('Browser Spaces Guide')) &&
      closeGroupTagResidueState.rows.some((row) => row.dormant && row.text.includes('Browser Spaces Guide')) &&
      closeGroupTagResidueState.snapshotUrls.includes('https://example.com/drop-saved') &&
      closeGroupTagResidueState.snapshotUrls.includes('https://example.com/spaces-guide#stale-dormant-row') &&
      !closeGroupTagResidueState.snapshotUrls.includes('https://example.com/spaces-guide'),
    JSON.stringify({
      closeGroupTagDispatchState,
      closeGroupTagCheckpointState,
      closeGroupTagResidueState,
    })
  );
  const dropFixtureAnchorCleanup = await evaluate(client, `(() => {
    const card = [...document.querySelectorAll('.group-card')]
      .find((node) => node.querySelector('.group-header h2')?.textContent === 'Research');
    const row = [...(card?.querySelectorAll('.tab-row') || [])]
      .find((node) => !node.classList.contains('dormant') && node.textContent.includes('Research Anchor'));
    const closeButton = row?.querySelector('button[aria-label="Close"]');
    closeButton?.click();
    return { clicked: Boolean(closeButton), rowText: row?.textContent || '' };
  })()`);
  await waitFor(client, `(() => {
    const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
    const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
    const snapshotUrls = (stored.spaceSnapshots?.['drop-demo']?.groups || [])
      .flatMap((group) => group.tabs || [])
      .map((tab) => tab.url);
    return ${JSON.stringify(dropFixtureAnchorCleanup.clicked)} &&
      !(runtime.tabs || []).some((tab) => tab.url === 'https://example.com/research-anchor') &&
      !snapshotUrls.includes('https://example.com/research-anchor') &&
      snapshotUrls.includes('https://example.com/drop-saved') &&
      snapshotUrls.includes('https://example.com/spaces-guide#stale-dormant-row');
  })()`);
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

  // Seed the active window directly so this separate scenario can exercise
  // the user opening one genuinely dormant saved row without a preceding
  // switch changing the browser fixture.
  await evaluate(client, `(() => {
    const raw = JSON.parse(localStorage.getItem('spaceTabsState') || '{}');
    const stored = raw.spaceTabsState || {};
    stored.activeSpaceId = 'dormant-demo';
    localStorage.setItem('spaceTabsState', JSON.stringify({ spaceTabsState: stored }));
    const windowState = JSON.parse(
      sessionStorage.getItem('spaceTabsWindowState') || '{}'
    ).spaceTabsWindowState || { activeSpaceIds: {} };
    windowState.activeSpaceIds = {
      ...(windowState.activeSpaceIds || {}),
      1: 'dormant-demo',
    };
    sessionStorage.setItem('spaceTabsWindowState', JSON.stringify({
      spaceTabsWindowState: windowState,
    }));
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Dormant Demo'`);
  await waitFor(client, `[...document.querySelectorAll('.group-header h2')].some((node) => node.textContent === 'Search')`);
  await evaluate(client, `(() => {
    const header = [...document.querySelectorAll('.group-header')]
      .find((node) => node.querySelector('h2')?.textContent === 'Search');
    if (header?.closest('.collapsed')) header.querySelector('.group-toggle')?.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelectorAll('.tab-row.dormant').length === 2`);
  await evaluate(client, `document.querySelector('.tab-row.dormant .tab-main-button').click()`);
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

  await evaluate(client, `document.querySelector('.tab-row.dormant .tab-main-button').click()`);
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
    return true;
  })()`);
  await checkpointPreviewCoverage(client, coverageSnapshots);
  await client.send('Page.reload', { ignoreCache: true });
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
    if (header?.closest('.collapsed')) header.querySelector('.group-toggle')?.click();
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
      return true;
    })()`);
    await checkpointPreviewCoverage(client, coverageSnapshots);
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Default' && document.querySelectorAll('.tab-row').length === 2`);
    await evaluate(client, `(() => {
      const row = document.querySelectorAll('.tab-row')[0];
      row.querySelector('.tab-main-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return true;
    })()`);
    await waitFor(client, `document.querySelectorAll('.tab-row.selected').length === 1`);
    await evaluate(client, `(() => {
      const row = document.querySelectorAll('.tab-row')[1];
      row.querySelector('.tab-main-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, shiftKey: true }));
      return true;
    })()`);
    const moveShiftSelectionState = await waitFor(client, `(() => {
      const rows = [...document.querySelectorAll('.tab-row')].map((row) => ({
        title: row.querySelector('.tab-title')?.textContent || '',
        selected: row.classList.contains('selected'),
        ariaPressed: row.querySelector('.tab-main-button')?.getAttribute('aria-pressed'),
      }));
      return rows.filter((row) => row.selected).length === 2 ? rows : null;
    })()`);
    record(
      'Shift multi-select updates visible tab rows',
      moveShiftSelectionState.length === 2 &&
        moveShiftSelectionState.every((row) => row.selected && row.ariaPressed === 'true'),
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
      if (header?.closest('.collapsed')) header.querySelector('.group-toggle')?.click();
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
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      return {
        activeSpaceId: stored.activeSpaceId,
        rows,
        headers: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
        groupSpaces: stored.groupSpaces || {},
        tabSpaces: stored.tabSpaces || {},
        tabGroups: stored.tabGroups || {},
        virtualGroups: stored.virtualGroups || {},
        runtimeGroupIds: (runtime.tabs || [])
          .filter((tab) => tab.id === 201 || tab.id === 202)
          .map((tab) => tab.groupId),
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
      moveToState.runtimeGroupIds.length === 2 &&
      moveToState.runtimeGroupIds[0] >= 0 &&
      moveToState.runtimeGroupIds.every((groupId) => groupId === moveToState.runtimeGroupIds[0]) &&
      moveToState.groupSpaces[moveToState.runtimeGroupIds[0]] === 'move-target' &&
      [201, 202].every((tabId) => !moveToState.tabSpaces[tabId] && !moveToState.tabGroups[tabId]) &&
      moveToState.closedMovedTabIds.length === 0;
    record(
      'Move to materializes selected tabs in one durable destination Tag before source cleanup',
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
      return true;
    })()`);
    await checkpointPreviewCoverage(client, coverageSnapshots);
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client, `document.querySelector('#activeSpaceName')?.textContent === 'Move Target' && document.querySelectorAll('.tab-row').length >= 2`);
    const moveMaterializedState = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      const movedTabs = (runtime.tabs || []).filter((tab) => tab.id === 201 || tab.id === 202);
      const groupIds = movedTabs.map((tab) => Number(tab.groupId));
      if (groupIds.length !== 2 || groupIds[0] < 0 || groupIds.some((groupId) => groupId !== groupIds[0])) {
        return null;
      }
      const group = (runtime.groups || []).find((candidate) => Number(candidate.id) === groupIds[0]);
      return {
        groupId: groupIds[0],
        group,
        groupSpaceId: stored.groupSpaces?.[groupIds[0]] || '',
        tabSpaces: [stored.tabSpaces?.[201] || '', stored.tabSpaces?.[202] || ''],
        tabGroups: [stored.tabGroups?.[201] || '', stored.tabGroups?.[202] || ''],
        virtualGroupKeys: Object.keys(stored.virtualGroups || {}),
        headers: [...document.querySelectorAll('.group-header h2')].map((node) => node.textContent),
      };
    })()`, 7000);
    const moveMaterialized = moveMaterializedState.group?.title === 'Move Source' &&
      moveMaterializedState.group?.color === 'blue' &&
      moveMaterializedState.groupSpaceId === 'move-target' &&
      moveMaterializedState.tabSpaces.every((spaceId) => !spaceId) &&
      moveMaterializedState.tabGroups.every((groupKey) => !groupKey) &&
      moveMaterializedState.virtualGroupKeys.length === 0 &&
      moveMaterializedState.headers.includes('Move Source');
    record(
      'Move to materializes the durable destination group in Chrome on refresh',
      moveMaterialized,
      JSON.stringify(moveMaterializedState)
    );
    if (!moveMaterialized) {
      bugs.push('Move to did not materialize its durable destination group in Chrome.');
    }
    await evaluate(client, `window.__SPACE_TABS_PREVIEW_COMMANDS__ = []`);
    await evaluate(client, `document.querySelector('#tidyNamesButton').click()`);
    const tidyDirectApply = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const operation = (stored.operationHistory || []).at(-1);
      if (operation?.type !== 'tidy-names' || operation.status !== 'applied' ||
          document.querySelector('#tidyNamesButton')?.disabled) return null;
      return {
        operationId: operation.id,
        previewOpen: Boolean(document.querySelector('#actionDialog')?.open),
        undoText: document.querySelector('#undoOrganizationButton')?.textContent || '',
        renamedCount: Object.keys(stored.renamedTabs || {}).length,
        providerRequests: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => command.type === 'ai:chat').length,
      };
    })()`);
    await evaluate(client, `document.querySelector('#undoOrganizationButton').click()`);
    const tidyDirectUndo = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const operation = (stored.operationHistory || [])
        .find((item) => item.id === ${JSON.stringify(tidyDirectApply.operationId)});
      if (operation?.status !== 'undone') return null;
      return {
        renamedTabs: stored.renamedTabs || {},
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => ['tabs:close', 'tabs:group', 'tabs:groupExisting'].includes(command.type)),
      };
    })()`);
    record(
      'Tidy Names applies without Preview and Undo restores its changes',
      !tidyDirectApply.previewOpen &&
        tidyDirectApply.undoText === 'Undo' &&
        tidyDirectApply.renamedCount > 0 &&
        tidyDirectApply.providerRequests === 1 &&
        tidyDirectUndo.mutations.length === 0 &&
        Object.keys(tidyDirectUndo.renamedTabs).length === 0,
      JSON.stringify({ tidyDirectApply, tidyDirectUndo })
    );

    await evaluate(client, `(() => {
      const STORAGE_KEY = 'spaceTabsState';
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const state = stored[STORAGE_KEY] || {};
      const snapshot = state.spaceSnapshots?.['move-target'];
      if (snapshot) {
        snapshot.preserveGroups = true;
        snapshot.groups = (snapshot.groups || []).filter((group) => group.title !== 'Planning');
        snapshot.groups.push(
          {
            snapshotGroupId: 'preview-planning-canonical',
            title: 'Planning',
            color: 'cyan',
            collapsed: false,
            tabs: [],
          },
          {
            snapshotGroupId: 'preview-planning-duplicate',
            title: 'Planning',
            color: 'cyan',
            collapsed: false,
            tabs: [],
          },
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: state }));
      }
      window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
      window.__autoGroupPreviewTitles = [];
      window.__autoGroupPreviewObserver?.disconnect();
      const title = document.querySelector('#actionDialogTitle');
      window.__autoGroupPreviewObserver = new MutationObserver(() => {
        const value = title?.textContent || '';
        if (value) window.__autoGroupPreviewTitles.push(value);
      });
      window.__autoGroupPreviewObserver.observe(title, { childList: true, subtree: true, characterData: true });
    })()`);
    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    const autoGroupPreview = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open) return null;
      if (document.querySelector('#actionDialogTitle')?.textContent !== 'Auto Group Preview') return null;
      const dialog = document.querySelector('#actionDialog');
      const form = dialog?.querySelector('.action-form');
      const preview = document.querySelector('#actionDialogPreview');
      return {
        message: document.querySelector('#actionDialogMessage')?.textContent || '',
        titles: [...new Set(window.__autoGroupPreviewTitles || [])],
        sectionTitles: [...document.querySelectorAll('#actionDialogPreview .action-preview-section h3 span')]
          .map((heading) => heading.textContent || ''),
        items: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
        sourceLabels: document.querySelectorAll('#actionDialogPreview .group-plan-source').length,
        groupCards: document.querySelectorAll('#actionDialogPreview .group-plan-section').length,
        confirmText: document.querySelector('#actionDialogConfirm')?.textContent || '',
        disclosure: document.querySelector('#autoGroupButton')?.getAttribute('aria-label') || '',
        scroll: {
          dialogOverflowY: dialog ? getComputedStyle(dialog).overflowY : '',
          formOverflowY: form ? getComputedStyle(form).overflowY : '',
          previewOverflowY: preview ? getComputedStyle(preview).overflowY : '',
        },
        providerRequests: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => command.type === 'ai:chat').length,
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => [
            'tabs:group', 'tabs:groupExisting', 'tabs:ungroup', 'groups:update',
          ].includes(command.type)),
      };
    })()`);
    record(
      'Auto Group directly opens one concise final preview with one scroll region',
      autoGroupPreview.message.includes('2 tabs → 1 group') &&
        autoGroupPreview.message.length <= 72 &&
        /(?:\d+ ms|\d+(?:\.\d+)? s)$/.test(autoGroupPreview.message) &&
        !autoGroupPreview.message.includes('AI proposal') &&
        !autoGroupPreview.message.includes('sent ') &&
        !autoGroupPreview.message.includes('generated in') &&
        !autoGroupPreview.titles.includes('Generate Auto Group preview?') &&
        !autoGroupPreview.sectionTitles.includes('Remain untouched') &&
        autoGroupPreview.items > 0 &&
        autoGroupPreview.sourceLabels > 0 &&
        autoGroupPreview.groupCards > 0 &&
        autoGroupPreview.confirmText === 'Apply groups' &&
        autoGroupPreview.disclosure.includes('titles, simplified URLs, domains, current Tags, and live/saved status') &&
        autoGroupPreview.scroll.dialogOverflowY === 'hidden' &&
        autoGroupPreview.scroll.formOverflowY === 'hidden' &&
        autoGroupPreview.scroll.previewOverflowY === 'auto' &&
        autoGroupPreview.providerRequests === 1 &&
        autoGroupPreview.mutations.length === 0,
      JSON.stringify(autoGroupPreview)
    );
    await evaluate(client, `document.querySelector('#actionDialogCancel').click()`);
    await waitFor(client, `!document.querySelector('#actionDialog')?.open && !document.querySelector('#autoGroupButton')?.disabled`);
    const autoGroupFinalCancel = await evaluate(client, `({
      providerRequests: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => command.type === 'ai:chat').length,
      mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
        .filter((command) => [
          'tabs:group', 'tabs:groupExisting', 'tabs:ungroup', 'groups:update',
        ].includes(command.type)).length,
    })`);
    record(
      'Auto Group final-preview Cancel leaves organization unchanged',
      autoGroupFinalCancel.providerRequests === 1 && autoGroupFinalCancel.mutations === 0,
      JSON.stringify(autoGroupFinalCancel)
    );

    await evaluate(client, `document.querySelector('#autoGroupButton').click()`);
    const groupPreview = await waitFor(client, `(() => {
      if (!document.querySelector('#actionDialog')?.open) return null;
      if (document.querySelector('#actionDialogTitle')?.textContent !== 'Auto Group Preview') return null;
      return {
        items: document.querySelectorAll('#actionDialogPreview .action-preview-item').length,
        sourceLabels: document.querySelectorAll('#actionDialogPreview .group-plan-source').length,
        groupCards: document.querySelectorAll('#actionDialogPreview .group-plan-section').length,
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => [
            'tabs:group', 'tabs:groupExisting', 'tabs:ungroup', 'groups:update',
          ].includes(command.type)),
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
        .filter((command) => ['tabs:group', 'tabs:groupExisting', 'groups:update'].includes(command.type));
      const matchingCards = [...document.querySelectorAll('#groupsList .group-card')]
        .filter((card) => card.querySelector('.group-header h2')?.textContent === 'Planning')
        .map((card) => ({
          key: card.dataset.groupKey || '',
          rows: card.querySelectorAll('.tab-row').length,
        }));
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const planningSnapshotGroups = (stored.spaceSnapshots?.['move-target']?.groups || [])
        .filter((group) => group.title === 'Planning')
        .map((group) => ({ tabs: (group.tabs || []).length }));
      return mutations.length > 0 && matchingCards.length > 0
        ? {
          mutations,
          matchingCards,
          planningSnapshotGroups,
        }
        : null;
    })()`);
    record(
      'Auto Group applies only after confirmation without rendering an empty same-name shadow',
      groupApplyState.mutations.length > 0 &&
        groupApplyState.planningSnapshotGroups.length === 1 &&
        groupApplyState.planningSnapshotGroups[0].tabs === 2 &&
        groupApplyState.matchingCards.length === 1 &&
      groupApplyState.matchingCards[0].rows === 2,
      JSON.stringify(groupApplyState)
    );

    const undoAvailability = await waitFor(client, `(() => {
      const record = document.querySelector('#operationRecord');
      const button = document.querySelector('#undoOrganizationButton');
      const operationId = button?.dataset.operationId || '';
      return record && !record.hidden && button && !button.disabled && operationId
        ? {
          operationId,
          summary: document.querySelector('#operationRecordText')?.textContent || '',
          text: button.textContent || '',
        }
        : null;
    })()`);
    await evaluate(client, `(() => {
      window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
      document.querySelector('#undoOrganizationButton').click();
      return true;
    })()`);
    const groupUndoState = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      const operation = (stored.operationHistory || [])
        .find((candidate) => candidate?.id === ${JSON.stringify(undoAvailability.operationId)});
      const movedTabs = (runtime.tabs || []).filter((tab) => tab.id === 201 || tab.id === 202);
      const groupIds = [...new Set(movedTabs.map((tab) => Number(tab.groupId)))];
      const liveGroup = groupIds.length === 1
        ? (runtime.groups || []).find((group) => Number(group.id) === groupIds[0])
        : null;
      const planningSnapshotGroups = (stored.spaceSnapshots?.['move-target']?.groups || [])
        .filter((group) => group.title === 'Planning')
        .map((group) => ({
          snapshotGroupId: group.snapshotGroupId || '',
          tabs: (group.tabs || []).length,
        }));
      const headers = [...document.querySelectorAll('#groupsList .group-header h2')]
        .map((node) => node.textContent || '');
      const planningCards = [...document.querySelectorAll('#groupsList .group-card')]
        .filter((card) => card.querySelector('.group-header h2')?.textContent === 'Planning')
        .map((card) => card.querySelectorAll('.tab-row').length);
      const status = document.querySelector('#syncStatus')?.textContent || '';
      if (operation?.status !== 'undone' || liveGroup?.title !== 'Move Source' ||
          movedTabs.length !== 2 || !headers.includes('Move Source') ||
          !status.startsWith('Undid:')) return null;
      return {
        operationStatus: operation.status,
        liveGroup: {
          title: liveGroup.title,
          color: liveGroup.color,
          tabs: movedTabs.length,
        },
        planningSnapshotGroups,
        headers,
        planningCards,
        status,
        mutations: (window.__SPACE_TABS_PREVIEW_COMMANDS__ || [])
          .filter((command) => [
            'tabs:group', 'tabs:groupExisting', 'tabs:ungroup', 'groups:update',
          ].includes(command.type)),
      };
    })()`, 7000);
    record(
      'Auto Group Undo restores the original live Tag and both deduplicated saved Tags',
      undoAvailability.text === 'Undo' &&
        undoAvailability.summary.length > 0 &&
        groupUndoState.operationStatus === 'undone' &&
        groupUndoState.liveGroup.title === 'Move Source' &&
        groupUndoState.liveGroup.color === 'blue' &&
        groupUndoState.liveGroup.tabs === 2 &&
        groupUndoState.planningSnapshotGroups.length === 2 &&
        groupUndoState.planningSnapshotGroups.every((group) => group.tabs === 0) &&
        new Set(groupUndoState.planningSnapshotGroups.map((group) => group.snapshotGroupId)).size === 2 &&
        groupUndoState.headers.includes('Move Source') &&
        groupUndoState.headers.filter((title) => title === 'Planning').length === 2 &&
        groupUndoState.planningCards.length === 2 &&
        groupUndoState.planningCards.every((rows) => rows === 0) &&
        groupUndoState.mutations.length > 0,
      JSON.stringify({ undoAvailability, groupUndoState })
    );

    await evaluate(client, `(() => {
      window.__SPACE_TABS_PREVIEW_COMMANDS__ = [];
      document.querySelector('#tidyNamesButton').click();
      return true;
    })()`);
    const tidyApplyState = await waitFor(client, `(() => {
      if (document.querySelector('#actionDialog')?.open) return null;
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const button = document.querySelector('#undoOrganizationButton');
      const operationId = button?.dataset.operationId || '';
      const operation = (stored.operationHistory || [])
        .find((candidate) => candidate?.id === operationId);
      const planningSnapshotGroups = (stored.spaceSnapshots?.['move-target']?.groups || [])
        .filter((group) => group.title === 'Planning');
      const renamedTabs = stored.renamedTabs || {};
      if (operation?.type !== 'tidy-names' || operation.status !== 'applied' ||
          planningSnapshotGroups.length !== 1 || Object.keys(renamedTabs).length === 0) return null;
      return {
        operationId,
        operationSummary: operation.summary || '',
        renamedTabs,
        planningSnapshotGroups: planningSnapshotGroups.length,
        planningCards: [...document.querySelectorAll('#groupsList .group-card')]
          .filter((card) => card.querySelector('.group-header h2')?.textContent === 'Planning').length,
        status: document.querySelector('#syncStatus')?.textContent || '',
      };
    })()`, 7000);
    await evaluate(client, `document.querySelector('#undoOrganizationButton').click()`);
    const tidyUndoState = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const operation = (stored.operationHistory || [])
        .find((candidate) => candidate?.id === ${JSON.stringify(tidyApplyState.operationId)});
      const planningSnapshotGroups = (stored.spaceSnapshots?.['move-target']?.groups || [])
        .filter((group) => group.title === 'Planning');
      const planningCards = [...document.querySelectorAll('#groupsList .group-card')]
        .filter((card) => card.querySelector('.group-header h2')?.textContent === 'Planning');
      const status = document.querySelector('#syncStatus')?.textContent || '';
      if (operation?.status !== 'undone' || planningSnapshotGroups.length !== 2 ||
          planningCards.length !== 2 || Object.keys(stored.renamedTabs || {}).length !== 0 ||
          !status.startsWith('Undid:')) return null;
      return {
        operationStatus: operation.status,
        renamedTabs: stored.renamedTabs || {},
        snapshotGroupIds: planningSnapshotGroups.map((group) => group.snapshotGroupId || ''),
        planningRows: planningCards.map((card) => card.querySelectorAll('.tab-row').length),
        visibleTitles: [...document.querySelectorAll('#groupsList .tab-title')]
          .map((node) => node.textContent || ''),
        status,
      };
    })()`, 7000);
    record(
      'Tidy applies naming and Tag deduplication together, then Undo restores both exactly',
      tidyApplyState.operationSummary.includes('renamed 1 tab') &&
        tidyApplyState.operationSummary.includes('merged 1 duplicate Tag') &&
        tidyApplyState.planningSnapshotGroups === 1 &&
        tidyApplyState.planningCards === 1 &&
        Object.keys(tidyApplyState.renamedTabs).length === 1 &&
        tidyUndoState.operationStatus === 'undone' &&
        Object.keys(tidyUndoState.renamedTabs).length === 0 &&
        tidyUndoState.snapshotGroupIds.length === 2 &&
        new Set(tidyUndoState.snapshotGroupIds).size === 2 &&
        tidyUndoState.planningRows.every((rows) => rows === 0) &&
        tidyUndoState.visibleTitles.some((title) => title.includes('deliberately long browser title')),
      JSON.stringify({ tidyApplyState, tidyUndoState })
    );
  }

    await evaluate(client, `document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true, cancelable: true,
    }))`);
    const paletteOpenState = await waitFor(client, `(() => {
      const dialog = document.querySelector('#commandPaletteDialog');
      const input = document.querySelector('#commandPaletteInput');
      return dialog?.open && document.activeElement === input
        ? {
            options: dialog.querySelectorAll('[data-command-index]').length,
            selected: dialog.querySelector('[aria-selected="true"]')?.textContent || '',
          }
        : null;
    })()`);
    record(
      'Command Palette opens from the reserved keyboard shortcut with a selected result',
      paletteOpenState.options > 0 && Boolean(paletteOpenState.selected),
      JSON.stringify(paletteOpenState),
    );

    await evaluate(client, `(() => {
      const input = document.querySelector('#commandPaletteInput');
      input.value = 'no-result-e2e-query';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const paletteEmptyState = await waitFor(client, `(() => {
      const results = document.querySelector('#commandPaletteResults');
      return results?.querySelectorAll('[data-command-index]').length === 0
        ? {
            text: results.textContent.trim(),
            options: results.querySelectorAll('[data-command-index]').length,
          }
        : null;
    })()`);
    record(
      'Command Palette gives an explicit empty result instead of leaving stale commands',
      paletteEmptyState.options === 0 && paletteEmptyState.text === 'No matching Spaces, tabs, or commands.',
      JSON.stringify(paletteEmptyState),
    );

    const paletteWrapState = await evaluate(client, `(() => {
      const input = document.querySelector('#commandPaletteInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const before = [...document.querySelectorAll('#commandPaletteResults [data-command-index]')]
        .map((button) => button.textContent.trim());
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowUp', bubbles: true, cancelable: true,
      }));
      const selected = document.querySelector('#commandPaletteResults [aria-selected="true"]');
      return {
        count: before.length,
        expected: before.at(-1) || '',
        selected: selected?.textContent.trim() || '',
      };
    })()`);
    record(
      'Command Palette Arrow Up wraps from the first result to the last result',
      paletteWrapState.count > 1 && paletteWrapState.selected === paletteWrapState.expected,
      JSON.stringify(paletteWrapState),
    );
    await evaluate(client, `document.querySelector('#commandPaletteDialog').close()`);

    const shortcutCaptureState = await evaluate(client, `(() => {
      const input = document.querySelector('.shortcut-input');
      if (!input) return null;
      const keyEvent = (key, options = {}) => new KeyboardEvent('keydown', {
        key,
        code: options.code || '',
        ctrlKey: Boolean(options.ctrlKey),
        altKey: Boolean(options.altKey),
        metaKey: Boolean(options.metaKey),
        shiftKey: Boolean(options.shiftKey),
        bubbles: true,
        cancelable: true,
      });
      const captured = keyEvent('j', { code: 'KeyJ', ctrlKey: true, altKey: true });
      input.dispatchEvent(captured);
      const afterCapture = {
        prevented: captured.defaultPrevented,
        value: input.value,
        shortcut: input.dataset.shortcut || '',
      };
      const tab = keyEvent('Tab', { code: 'Tab' });
      input.dispatchEvent(tab);
      const afterTab = {
        prevented: tab.defaultPrevented,
        shortcut: input.dataset.shortcut || '',
      };
      const cleared = keyEvent('Backspace', { code: 'Backspace' });
      input.dispatchEvent(cleared);
      return {
        afterCapture,
        afterTab,
        afterClear: {
          prevented: cleared.defaultPrevented,
          value: input.value,
          shortcut: input.dataset.shortcut || '',
        },
      };
    })()`);
    record(
      'Shortcut capture records a real modifier chord, preserves Tab navigation, and clears with Backspace',
      shortcutCaptureState?.afterCapture.prevented === true &&
        shortcutCaptureState.afterCapture.shortcut === 'Control+Alt+J' &&
        shortcutCaptureState.afterCapture.value === 'Ctrl+Alt+J' &&
        shortcutCaptureState.afterTab.prevented === false &&
        shortcutCaptureState.afterTab.shortcut === 'Control+Alt+J' &&
        shortcutCaptureState.afterClear.prevented === true &&
        shortcutCaptureState.afterClear.value === '' &&
        shortcutCaptureState.afterClear.shortcut === '',
      JSON.stringify(shortcutCaptureState),
    );

    await evaluate(client, `(() => {
      document.querySelector('#settingsDialog button[aria-label="Close settings"]')?.click();
      const card = [...document.querySelectorAll('#groupsList .group-card')]
        .find((item) => item.querySelector('.group-header h2')?.textContent === 'Move Source');
      card?.querySelector('button[aria-label="Close group"]')?.click();
      return Boolean(card);
    })()`);
    const closedTag = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      const card = [...document.querySelectorAll('#groupsList .group-card')]
        .find((item) => item.querySelector('.group-header h2')?.textContent === 'Move Source');
      const saved = (stored.spaceSnapshots?.['move-target']?.groups || [])
        .find((group) => group.title === 'Move Source');
      const status = document.querySelector('#syncStatus')?.textContent || '';
      if (/could not|failed|changed|moved/i.test(status)) return {
        error: status,
        savedRows: saved?.tabs?.length ?? -1,
        dormantRows: card?.querySelectorAll('.tab-row.dormant').length ?? -1,
        runtimeIds: (runtime.tabs || []).map((tab) => tab.id),
      };
      if (!saved || saved.tabs?.length !== 2 ||
          !card?.querySelector('button[aria-label="Open group"]') ||
          (runtime.tabs || []).some((tab) => [201, 202].includes(Number(tab.id)))) return null;
      return {
        savedRows: saved.tabs.length,
        openButton: Boolean(card.querySelector('button[aria-label="Open group"]')),
        status,
      };
    })()`, 7000);
    record(
      'Close group preserves the Tag and both pages as dormant rows',
      closedTag.savedRows === 2 &&
        closedTag.openButton && closedTag.status.includes('Tag remains saved'),
      JSON.stringify(closedTag),
    );

    await evaluate(client, `(() => {
      const card = [...document.querySelectorAll('#groupsList .group-card')]
        .find((item) => item.querySelector('.group-header h2')?.textContent === 'Move Source');
      card?.querySelector('button[aria-label="Open group"]')?.click();
    })()`);
    const reopenedTag = await waitFor(client, `(() => {
      const stored = JSON.parse(localStorage.getItem('spaceTabsState') || '{}').spaceTabsState || {};
      const runtime = JSON.parse(sessionStorage.getItem('spaceTabsPreviewRuntime') || '{}');
      const card = [...document.querySelectorAll('#groupsList .group-card')]
        .find((item) => item.querySelector('.group-header h2')?.textContent === 'Move Source');
      const groupTabs = (runtime.tabs || []).filter((tab) => (
        ['https://example.com/move-alpha', 'https://example.com/move-beta'].includes(tab.url)
      ));
      if (groupTabs.length !== 2 || !card?.querySelector('button[aria-label="Close group"]')) return null;
      return {
        liveRows: groupTabs.length,
        grouped: groupTabs.every((tab) => Number(tab.groupId) >= 0),
        savedGroup: Boolean((stored.spaceSnapshots?.['move-target']?.groups || [])
          .find((group) => group.title === 'Move Source')),
      };
    })()`, 7000);
    record(
      'Open group restores its pages in one live Tag',
      reopenedTag.liveRows === 2 && reopenedTag.grouped && reopenedTag.savedGroup,
      JSON.stringify(reopenedTag),
    );

    const failures = results.filter((result) => !result.ok);
    let coverage;
    let coverageOutputPath = '';
    if (coverageEnabled) {
      coverage = await collectPreviewCoverage(
        client,
        coverageSnapshots,
        failures.length === 0 && bugs.length === 0,
      );
      coverageCollected = true;
      coverageOutputPath = await writePreviewCoverage(coverage);
      if (coverageOutputPath) process.stderr.write(`[e2e] preview coverage written to ${coverageOutputPath}\n`);
      const sidepanel = coverage.files.find((file) => file.path === 'sidepanel.js');
      process.stderr.write(
        `[e2e] preview coverage sidepanel.js lines=${sidepanel?.coverage?.lines.percent ?? 0}% ` +
        `branches=${sidepanel?.coverage?.branches.percent ?? 0}% ` +
        `functions=${sidepanel?.coverage?.functions.percent ?? 0}%\n`,
      );
      await client.send('Profiler.stopPreciseCoverage').catch(() => null);
      await client.send('Profiler.disable').catch(() => null);
    }
    const sidepanelCoverage = coverage?.files.find((file) => file.path === 'sidepanel.js');
    console.log(JSON.stringify({
      results,
      bugs,
      ...(coverage ? {
        coverage: {
          complete: coverage.complete,
          generatedAt: coverage.generatedAt,
          outputPath: coverageOutputPath,
          totals: coverage.coverage,
          sidepanel: sidepanelCoverage?.coverage,
        },
      } : {}),
    }, null, 2));
    if (failures.length || bugs.length) {
      throw new Error(`E2E smoke failed: ${failures.map((failure) => failure.name).join(', ') || bugs.join('; ')}`);
    }
  } finally {
    if (coverageEnabled && !coverageCollected && client) {
      try {
        const coverage = await collectPreviewCoverage(client, coverageSnapshots, false);
        coverageCollected = true;
        const outputPath = await writePreviewCoverage(coverage);
        if (outputPath) process.stderr.write(`[e2e] incomplete preview coverage written to ${outputPath}\n`);
      } catch (coverageError) {
        process.stderr.write(
          `[e2e] could not collect incomplete preview coverage: ${coverageError?.message || String(coverageError)}\n`,
        );
      }
      await client.send('Profiler.stopPreciseCoverage').catch(() => null);
      await client.send('Profiler.disable').catch(() => null);
    }
    client?.close();
    await chrome?.close();
    await new Promise((resolve) => previewServer?.close(resolve) ?? resolve());
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
