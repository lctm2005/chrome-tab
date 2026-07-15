import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1280;
const HEIGHT = 800;
const repoRoot = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const outputDir = normalize(join(repoRoot, 'docs/store-assets/screenshots'));

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

const shots = [
  {
    id: 'overview',
    file: '01-spaces-overview.png',
    title: 'Your Arc workspace, now in Chrome.',
    kicker: 'One thing. One Space.',
    description: 'Keep projects, folders, tab groups, and saved tabs together without switching browsers.',
    activeSpaceId: 'launch',
    notes: ['Spaces', 'Folders + saved tabs', 'Chrome-native groups'],
  },
  {
    id: 'arc-import',
    file: '02-nested-folders-dormant-tabs.png',
    title: 'Import Arc Spaces in minutes.',
    kicker: 'Move from Arc',
    description: 'Preview Spaces, folders, saved tabs, and conflicts before anything changes.',
    activeSpaceId: 'launch',
    notes: ['3-step setup with AI', 'Choose Spaces', 'Undo import'],
  },
  {
    id: 'ask',
    file: '05-ask-page-byok-ai.png',
    title: 'Ask the current page with your own AI key.',
    kicker: 'Ask Page',
    description: 'Review the provider, exact page, and content size before anything is sent.',
    activeSpaceId: 'launch',
    notes: ['Current page only', 'Clickable citation', 'Stream + Stop'],
  },
  {
    id: 'auto-group',
    file: '03-tab-context-menu.png',
    title: 'AI organizes tabs. You approve every change.',
    kicker: 'Auto Group',
    description: 'Live and saved tabs enter one proposal. Cancel, apply, or Undo with a visible record.',
    activeSpaceId: 'launch',
    notes: ['Live + saved tabs', 'Preview first', 'Undo'],
  },
  {
    id: 'settings',
    file: '04-settings-arc-import-shortcuts.png',
    title: 'Local by default. Export anytime.',
    kicker: 'Your workspace, your data',
    description: 'No Space Tabs account or server. Export a portable backup whenever you want.',
    activeSpaceId: 'launch',
    notes: ['Local workspace data', 'Portable backup', 'BYOK'],
  },
];

async function main() {
  await mkdir(outputDir, { recursive: true });
  const previewServer = await startPreviewServer();
  const previewPort = previewServer.address().port;
  const cdpPort = Number(process.env.CDP_PORT || await freePort());
  const base = `http://127.0.0.1:${cdpPort}`;
  let chrome = null;
  let client = null;

  try {
    chrome = await startChromeForCdp(cdpPort);
    const version = await json(`${base}/json/version`);
    client = createClient(version.webSocketDebuggerUrl);
    await client.ready;
    await client.send('Target.setDiscoverTargets', { discover: true });

    for (const shot of shots) {
      const url = `http://127.0.0.1:${previewPort}/store-shot.html?shot=${encodeURIComponent(shot.id)}`;
      const target = await json(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      const page = createClient(target.webSocketDebuggerUrl);
      await page.ready;
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: WIDTH,
        screenHeight: HEIGHT,
      });
      await page.send('Page.navigate', { url });
      await waitFor(page, 'document.body?.dataset.ready === "true"', 15000);
      await waitFor(page, 'document.fonts ? document.fonts.status === "loaded" : true', 3000).catch(() => null);
      await page.send('Page.bringToFront');
      const image = await page.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const outputPath = join(outputDir, shot.file);
      await writeFile(outputPath, Buffer.from(image.data, 'base64'));
      const dimensions = await pngDimensions(outputPath);
      if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) {
        throw new Error(`${shot.file} is ${dimensions.width}x${dimensions.height}; expected ${WIDTH}x${HEIGHT}.`);
      }
      await page.send('Page.close').catch(() => null);
      page.close();
      console.log(`Wrote ${relative(repoRoot, outputPath)} (${WIDTH}x${HEIGHT})`);
    }
  } finally {
    client?.close();
    await chrome?.close();
    await new Promise((resolve) => previewServer.close(resolve));
  }
}

async function startPreviewServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/store-shot.html' : url.pathname);

      if (pathname === '/store-shot.html') {
        const shot = shots.find((item) => item.id === url.searchParams.get('shot')) || shots[0];
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(storeShotHtml(shot));
        return;
      }

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
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function storeShotHtml(shot) {
  const scenario = scenarioFor(shot);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(shot.title)} - Space Store Screenshot</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #101116;
        color: #f7f8fb;
      }
      * { box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        margin: 0;
        overflow: hidden;
        background:
          radial-gradient(circle at 18% 20%, rgba(118, 82, 255, 0.24), transparent 34%),
          linear-gradient(180deg, #191724 0%, #0c0b12 100%);
      }
      .canvas {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 432px;
        gap: 34px;
        width: 100%;
        height: 100%;
        padding: 48px 58px 42px;
      }
      .story {
        display: grid;
        grid-template-rows: auto auto auto 1fr auto;
        min-width: 0;
        padding: 18px 0 10px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        color: rgba(247, 248, 251, 0.78);
        font-size: 15px;
        font-weight: 750;
      }
      .brand img {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
      }
      .kicker {
        margin: 70px 0 12px;
        color: #b7a5ff;
        font-size: 18px;
        font-weight: 760;
      }
      h1 {
        max-width: 640px;
        margin: 0;
        color: #ffffff;
        font-size: 62px;
        line-height: 0.98;
        font-weight: 860;
        letter-spacing: 0;
      }
      .description {
        max-width: 620px;
        margin: 26px 0 0;
        color: rgba(247, 248, 251, 0.74);
        font-size: 23px;
        line-height: 1.34;
        font-weight: 520;
      }
      .browser {
        align-self: end;
        width: 680px;
        max-width: 100%;
        min-height: 188px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.055);
        box-shadow: 0 28px 80px rgba(0, 0, 0, 0.24);
        overflow: hidden;
      }
      .browser-bar {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: center;
        height: 42px;
        padding: 0 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.055);
      }
      .dots { display: flex; gap: 7px; }
      .dots span {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.28);
      }
      .address {
        height: 22px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.1);
      }
      .browser-body {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 16px;
        padding: 18px;
      }
      .mock-card {
        min-height: 110px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .mock-list {
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .mock-line {
        height: 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.13);
      }
      .mock-line:nth-child(2) { width: 84%; }
      .mock-line:nth-child(3) { width: 62%; }
      .notes {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 28px;
      }
      .notes span {
        border: 1px solid rgba(183, 165, 255, 0.3);
        border-radius: 999px;
        padding: 8px 12px;
        color: rgba(247, 248, 251, 0.82);
        background: rgba(118, 82, 255, 0.1);
        font-size: 13px;
        font-weight: 720;
      }
      .panel-wrap {
        align-self: center;
        display: grid;
        grid-template-rows: 36px minmax(0, 1fr);
        width: 432px;
        height: 708px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 8px;
        background: #090812;
        box-shadow: 0 34px 90px rgba(0, 0, 0, 0.44);
      }
      .workbench-shot .canvas {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: 82px minmax(0, 1fr);
        gap: 18px;
        padding: 28px 34px 32px;
      }
      .workbench-shot .story {
        display: grid;
        grid-template-columns: 190px minmax(0, 1fr) auto;
        grid-template-rows: minmax(0, 1fr);
        align-items: center;
        gap: 24px;
        padding: 0;
      }
      .workbench-shot .kicker,
      .workbench-shot .description,
      .workbench-shot .browser {
        display: none;
      }
      .workbench-shot h1 {
        position: relative;
        margin: 0;
        font-size: 38px;
        line-height: 1;
      }
      .auto-group-shot .brand {
        visibility: hidden;
      }
      .auto-group-shot::before {
        position: fixed;
        z-index: 10;
        top: 52px;
        left: 38px;
        min-height: 38px;
        padding-left: 50px;
        background: url('/icons/icon128.png') left center / 38px 38px no-repeat;
        color: rgba(247, 248, 251, 0.86);
        content: 'Space Tabs';
        font-size: 15px;
        font-weight: 750;
        line-height: 38px;
      }
      .workbench-shot .story > div:last-child {
        min-width: 0;
      }
      .workbench-shot .notes {
        max-width: 480px;
        justify-content: flex-end;
        margin: 0;
      }
      .workbench-shot .panel-wrap {
        align-self: stretch;
        width: 100%;
        height: 100%;
      }
      .panel-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(247, 248, 251, 0.76);
        font-size: 12px;
        font-weight: 750;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
        background: #090812;
      }
    </style>
  </head>
  <body class="${shot.id === 'overview' ? '' : 'workbench-shot'} ${shot.id}-shot">
    <main class="canvas">
      <section class="story">
        <div class="brand">
          <img src="/icons/icon128.png" alt="">
          <span>Space Tabs</span>
        </div>
        <div class="kicker">${escapeHtml(shot.kicker)}</div>
        <h1>${escapeHtml(shot.title)}</h1>
        <p class="description">${escapeHtml(shot.description)}</p>
        <div>
          <div class="browser" aria-hidden="true">
            <div class="browser-bar">
              <div class="dots"><span></span><span></span><span></span></div>
              <div class="address"></div>
            </div>
            <div class="browser-body">
              <div class="mock-card"></div>
              <div class="mock-list">
                <div class="mock-line"></div>
                <div class="mock-line"></div>
                <div class="mock-line"></div>
                <div class="mock-line"></div>
              </div>
            </div>
          </div>
          <div class="notes">${shot.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>
        </div>
      </section>
      <section class="panel-wrap" aria-label="Space side panel preview">
        <div class="panel-titlebar">
          <span>Side panel</span>
          <span>Chrome</span>
        </div>
        <iframe id="panel" title="Space"></iframe>
      </section>
    </main>
    <script>
      const scenario = ${JSON.stringify(scenario)};
      const STORAGE_KEY = 'spaceTabsState';
      const RUNTIME_KEY = 'spaceTabsPreviewRuntime';
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ [STORAGE_KEY]: scenario.state }));
      sessionStorage.setItem(RUNTIME_KEY, JSON.stringify(scenario.runtime));

      const panel = document.querySelector('#panel');
      panel.addEventListener('load', async () => {
        try {
          await afterPanelLoad(panel, scenario);
          document.body.dataset.ready = 'true';
        } catch (error) {
          document.body.dataset.ready = 'error';
          document.body.dataset.error = error?.stack || error?.message || String(error);
        }
      }, { once: true });
      panel.src = scenario.action === 'settings'
        ? '/sidepanel.html?layout=workbench&view=settings'
        : scenario.action === 'arc-import'
        ? '/sidepanel.html?layout=workbench&onboarding=1'
        : scenario.action === 'auto-group' || scenario.action === 'ask'
        ? '/sidepanel.html?layout=workbench'
        : '/sidepanel.html';

      async function afterPanelLoad(frame, scenario) {
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        await waitFor(() => doc.querySelector('#activeSpaceName')?.textContent?.trim().length);
        await waitFor(() => doc.querySelector('#spacesList button'));
        if (scenario.action === 'arc-import') openArcImport(doc);
        if (scenario.action === 'auto-group') await openAutoGroup(doc);
        if (scenario.action === 'settings') openSettings(doc);
        if (scenario.action === 'ask') await openAskPage(doc);
        await wait(240);
        win.dispatchEvent(new Event('resize'));
      }

      function openArcImport(doc) {
        const input = doc.querySelector('#onboardingArcInput');
        if (input) input.click = () => {};
        doc.querySelector('[data-onboarding-path="arc"]')?.click();
        const status = doc.querySelector('#onboardingArcStatus');
        const list = doc.querySelector('#onboardingArcSpaces');
        const choose = doc.querySelector('#onboardingArcChooseButton');
        if (choose) choose.textContent = 'Choose another Arc file';
        if (status) {
          status.textContent = 'Preview: 3 Spaces, 6 folders, 18 saved tabs. 1 name conflict will import as Research (2).';
        }
        if (list) {
          list.innerHTML = [
            ['Launch', '3 folders · 8 tabs', 'Ready'],
            ['Research', '2 folders · 6 tabs', 'Will import as Research (2)'],
            ['Personal', '1 folder · 4 tabs', 'Ready'],
          ].map(([name, counts, detail], index) => \`
            <label class="onboarding-space-option">
              <input type="checkbox" data-arc-space-id="arc-\${index}" checked>
              <span class="onboarding-space-icon">\${name.slice(0, 1)}</span>
              <strong>\${name}</strong>
              <small class="\${index === 1 ? 'conflict' : ''}">\${counts} · \${detail}</small>
            </label>
          \`).join('');
        }
        const next = doc.querySelector('#onboardingNextButton');
        if (next) next.disabled = false;
      }

      async function openAutoGroup(doc) {
        doc.querySelector('#autoGroupButton')?.click();
        await waitFor(() => doc.querySelector('#actionDialog')?.open &&
          /Auto Group Preview/i.test(doc.querySelector('#actionDialogTitle')?.textContent), 5000);
        const dialog = doc.querySelector('#actionDialog');
        const preview = doc.querySelector('#actionDialogPreview');
        const form = dialog?.querySelector('.action-form');
        if (!dialog || !preview || !form || dialog.scrollHeight > dialog.clientHeight + 1 ||
            doc.defaultView.getComputedStyle(preview).overflowY !== 'auto' ||
            doc.defaultView.getComputedStyle(form).overflow !== 'hidden') {
          throw new Error('Auto Group preview must use one internal scroll region.');
        }
      }

      function openSettings(doc) {
        const dialog = doc.querySelector('#settingsDialog');
        const form = doc.querySelector('.settings');
        const settingsStatus = doc.querySelector('#settingsStatus');
        const backupStatus = doc.querySelector('#spaceBackupStatus');
        const backupInput = doc.querySelector('#spaceBackupInput');
        const backupPicker = backupInput?.closest('.file-picker');
        const arcInput = doc.querySelector('#arcImportInput');
        const restoreBackup = doc.querySelector('#restoreSpaceDataButton');
        const style = doc.createElement('style');
        style.textContent = '.store-file-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; min-height: 36px; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); background: var(--surface-strong); padding: 0 10px; color: var(--text-soft); font-size: 12px; font-weight: 650; } .store-file-button { border-radius: 6px; padding: 5px 8px; background: var(--surface-hover); color: var(--text); }';
        doc.head.append(style);
        if (backupPicker && backupInput && !backupPicker.querySelector('.store-file-row')) {
          backupInput.hidden = true;
          const fakeBackupPicker = doc.createElement('div');
          fakeBackupPicker.className = 'store-file-row';
          fakeBackupPicker.innerHTML = '<span class="store-file-button">Choose File</span><span>space-backup-2026-07-12.json</span>';
          backupPicker.append(fakeBackupPicker);
        }
        if (arcInput) arcInput.hidden = true;
        if (backupStatus) backupStatus.textContent = 'Ready to restore: 4 Spaces and 8 saved tabs.';
        if (restoreBackup) restoreBackup.disabled = false;
        if (settingsStatus) settingsStatus.textContent = 'AI is optional. Your key stays in Chrome session storage.';
        if (dialog?.open && form) {
          const spaceData = doc.querySelector('.space-data-settings');
          form.scrollTop = Math.max(0, (spaceData?.offsetTop || 0) - 92);
        }
      }

      async function openAskPage(doc) {
        doc.querySelector('.ask-page')?.click();
        await waitFor(() => !doc.querySelector('#askPageView')?.hidden, 8000, 'Ask Page view');
        const input = doc.querySelector('#askPagePrompt');
        input.value = 'What launch work is still missing from this brief?';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        doc.querySelector('#askAIButton')?.click();
        await waitFor(() => doc.querySelector('#actionDialog')?.open &&
          /Review Ask Page/i.test(doc.querySelector('#actionDialogTitle')?.textContent), 5000, 'Ask Page send review');
        doc.querySelector('#actionDialogConfirm')?.click();
        await waitFor(() => [...doc.querySelectorAll('.ask-message.assistant')]
          .some((node) => /Preview AI response/i.test(node.textContent)), 5000, 'Ask Page preview response');
        const assistant = [...doc.querySelectorAll('.ask-message.assistant')].at(-1);
        if (assistant) {
          assistant.innerHTML = '<p><strong>Three launch gaps remain</strong></p><p>Finish privacy review, package verification, and the final store checklist <a href="https://docs.example.com/launch-brief">[1]</a>.</p><p><strong>Source</strong><br><a href="https://docs.example.com/launch-brief">[1] Launch brief</a></p>';
          const messages = doc.querySelector('#askMessages');
          messages?.replaceChildren(assistant);
          if (messages) messages.scrollTop = 0;
        }
      }

      async function waitFor(check, timeoutMs = 8000, label = 'screenshot state') {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const value = check();
          if (value) return value;
          await wait(50);
        }
        throw new Error(\`Timed out while preparing screenshot: \${label}.\`);
      }

      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
    </script>
  </body>
</html>`;
}

function scenarioFor(shot) {
  const state = baseState(shot.activeSpaceId);
  const runtime = baseRuntime();
  if (shot.id === 'arc-import') state.onboarding = { version: 2, completed: false, stage: 'choose' };
  if (shot.id === 'ask') state.ai.apiKey = 'store-preview-fixture-key';
  if (shot.id === 'auto-group') {
    state.spaceSnapshots.launch = {
      version: 1,
      updatedAt: 1770000000000,
      preserveGroups: true,
      groups: [{
        id: 'arc-history',
        title: 'Arc History',
        color: 'orange',
        collapsed: false,
        tabs: [
          { title: 'Arc launch plan', url: 'https://example.com/arc/launch-plan' },
          { title: 'Historical store copy', url: 'https://example.com/arc/store-copy' },
        ],
      }],
    };
    state.groupOrder.launch.push('snapshot:0:Arc History');
  }
  return {
    state,
    runtime,
    action: shot.id,
  };
}

function baseState(activeSpaceId) {
  const spaces = [
    { id: 'launch', name: 'Launch', icon: 'L', color: 'blue' },
    { id: 'research', name: 'Research', icon: 'R', color: 'green' },
    { id: 'ops', name: 'Ops', icon: 'O', color: 'purple' },
    { id: 'personal', name: 'Personal', icon: 'P', color: 'orange' },
  ];

  return {
    version: 8,
    theme: 'ocean',
    activeSpaceId,
    spaces,
    groupSpaces: { 1: 'launch', 2: 'launch', 3: 'launch' },
    tabSpaces: {},
    virtualGroups: {},
    tabGroups: {},
    ephemeralTabIds: [],
    renamedTabs: {
      1: 'Launch brief',
      2: 'Store copy',
      3: 'Reviewer notes',
      4: 'Design QA',
      5: 'Release build',
      6: 'Bug triage',
      7: 'Customer inbox',
    },
    groupOrder: {
      launch: ['group:1', 'group:2', 'group:3', 'ungrouped'],
      research: [
        'snapshot:0:Projects / Launch / Specs',
        'snapshot:1:Projects / Launch / Research',
        'snapshot:2:Projects / Customers / Notes',
        'snapshot:3:Reading Queue',
      ],
    },
    tabOrder: {},
    collapsedGroups: {
      'group:3': true,
      'snapshot:0:Projects / Launch / Specs': false,
      'snapshot:1:Projects / Launch / Research': false,
      'snapshot:2:Projects / Customers / Notes': false,
      'snapshot:3:Reading Queue': false,
    },
    collapsedSpaceGroups: {},
    askSessions: {},
    activeAskSessionKey: '',
    spaceContexts: {},
    spaceSnapshots: {
      research: {
        version: 1,
        updatedAt: 1770000000000,
        groups: [
          {
            title: 'Projects / Launch / Specs',
            color: 'blue',
            collapsed: false,
            tabs: [
              { title: 'Requirements matrix', url: 'https://example.com/specs/requirements' },
              { title: 'Release checklist', url: 'https://example.com/specs/release-checklist' },
            ],
          },
          {
            title: 'Projects / Launch / Research',
            color: 'green',
            collapsed: false,
            tabs: [
              { title: 'Competitor notes', url: 'https://example.com/research/competitors' },
              { title: 'Pricing benchmark', url: 'https://example.com/research/pricing' },
            ],
          },
          {
            title: 'Projects / Customers / Notes',
            color: 'purple',
            collapsed: false,
            tabs: [
              { title: 'Interview themes', url: 'https://example.com/customers/interviews' },
              { title: 'Support signals', url: 'https://example.com/customers/support' },
            ],
          },
          {
            title: 'Reading Queue',
            color: 'cyan',
            collapsed: false,
            tabs: [
              { title: 'Chrome side panel docs', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel' },
              { title: 'Tab Groups API', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabGroups' },
            ],
          },
        ],
      },
    },
    onboarding: { version: 2, completed: true, stage: 'done' },
    shortcuts: {
      togglePanel: 'Alt+S',
      askSubmit: 'Meta+Enter',
      askAbort: 'Control+C',
      openAsk: 'Alt+A',
      tidyNames: 'Control+Alt+T',
      autoGroup: 'Control+Alt+G',
      addSpace: 'Control+Alt+N',
      previousSpace: 'Control+Alt+ArrowLeft',
      nextSpace: 'Control+Alt+ArrowRight',
    },
    ai: {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      apiKey: '',
      thinking: 'disabled',
      language: 'en',
      temperature: 0.6,
    },
  };
}

function baseRuntime() {
  return {
    tabs: [
      tab(1, 'Launch brief - Google Docs', 'https://docs.example.com/launch-brief', 1, true),
      tab(2, 'Chrome Web Store listing copy', 'https://example.com/store-listing', 1),
      tab(3, 'Reviewer notes checklist', 'https://example.com/reviewer-notes', 1),
      tab(4, 'Design QA board', 'https://figma.example.com/file/design-qa', 2),
      tab(5, 'Release build workflow', 'https://github.com/example/space-tabs/actions', 2),
      tab(6, 'Bug triage queue', 'https://github.com/example/space-tabs/issues', 2),
      tab(7, 'Customer inbox', 'https://mail.example.com/inbox', 3),
      tab(8, 'Calendar: launch week', 'https://calendar.example.com/launch', 3),
    ],
    groups: [
      { id: 1, title: 'Planning', color: 'blue', collapsed: false },
      { id: 2, title: 'Build', color: 'green', collapsed: false },
      { id: 3, title: 'Inbox', color: 'purple', collapsed: true },
    ],
    nextId: 9,
    nextGroupId: 4,
  };
}

function tab(id, title, url, groupId, active = false) {
  return {
    id,
    title,
    url,
    favIconUrl: '',
    pinned: false,
    muted: false,
    active,
    groupId,
    index: id - 1,
    windowId: 1,
    audible: false,
  };
}

async function startChromeForCdp(port) {
  const executable = await findChromeExecutable();
  const userDataDir = await mkdtemp(join(tmpdir(), 'space-tabs-store-shots-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--force-color-profile=srgb',
    '--headless=new',
    '--hide-scrollbars',
    '--remote-allow-origins=*',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ];
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let exitInfo = null;
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });
  let exited = false;
  child.once('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });
  child.unref();

  try {
    await waitForCdp(port, () => exitInfo, () => stderr);
  } catch (error) {
    child.kill('SIGTERM');
    await rm(userDataDir, { recursive: true, force: true });
    throw new Error(`${error.message}${stderr ? `\nChrome stderr:\n${stderr}` : ''}`);
  }

  return {
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

async function waitForCdp(port, getExitInfo = () => null, getStderr = () => '', timeoutMs = 20000) {
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exitInfo = getExitInfo();
    if (exitInfo) {
      const details = [
        `Chrome exited before CDP was ready at ${base}.`,
        `Exit: code=${exitInfo.code ?? 'null'} signal=${exitInfo.signal ?? 'null'}.`,
        getStderr() ? `Chrome stderr:\n${getStderr()}` : '',
      ].filter(Boolean).join('\n');
      throw new Error(details);
    }
    try {
      await json(`${base}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  throw new Error('Could not find Chrome. Set CHROME_PATH to the Chrome executable and rerun npm run screenshots:store.');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function createClient(wsUrl) {
  const ws = createWebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onMessage((data) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const record = pending.get(message.id);
    if (!record) return;
    pending.delete(message.id);
    if (message.error) record.reject(new Error(message.error.message));
    else record.resolve(message.result);
  });
  return {
    ready: ws.ready,
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

function createWebSocket(wsUrl) {
  const url = new URL(wsUrl);
  const socket = connect({
    host: url.hostname,
    port: Number(url.port || 80),
  });
  const key = randomBytes(16).toString('base64');
  const path = `${url.pathname}${url.search}`;
  const messageHandlers = [];
  let buffer = Buffer.alloc(0);
  let handshakeComplete = false;
  let fragmentBuffers = [];

  const ready = new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.slice(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          reject(new Error(`WebSocket handshake failed:\n${header}`));
          socket.destroy();
          return;
        }
        handshakeComplete = true;
        socket.removeAllListeners('error');
        socket.on('error', () => null);
        buffer = buffer.slice(headerEnd + 4);
        resolve();
      }
      readFrames();
    });
  });

  function readFrames() {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;

      let payload = buffer.slice(offset, offset + length);
      if (masked) {
        const mask = buffer.slice(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      buffer = buffer.slice(offset + length);

      if (opcode === 8) {
        socket.end();
        return;
      }
      if (opcode === 9) {
        socket.write(webSocketFrame(payload, 0x0a));
        continue;
      }
      if (opcode === 10) continue;

      if (opcode === 1 || opcode === 0) {
        fragmentBuffers.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(fragmentBuffers).toString('utf8');
        fragmentBuffers = [];
        for (const handler of messageHandlers) handler(text);
      }
    }
  }

  return {
    ready,
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    send(text) {
      socket.write(webSocketFrame(Buffer.from(text), 0x01));
    },
    close() {
      if (!socket.destroyed) socket.end(webSocketFrame(Buffer.alloc(0), 0x08));
    },
  };
}

function webSocketFrame(payload, opcode) {
  const length = payload.length;
  const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const headerLength = 2 + lengthBytes + 4;
  const frame = Buffer.alloc(headerLength + length);
  frame[0] = 0x80 | opcode;
  if (length < 126) {
    frame[1] = 0x80 | length;
  } else if (length <= 0xffff) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }
  const maskOffset = 2 + lengthBytes;
  const mask = randomBytes(4);
  mask.copy(frame, maskOffset);
  for (let index = 0; index < length; index += 1) {
    frame[headerLength + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
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
    const readyState = await evaluate(client, 'document.body?.dataset.ready || ""').catch(() => '');
    if (readyState === 'error') {
      const error = await evaluate(client, 'document.body?.dataset.error || "Screenshot setup failed."').catch(() => '');
      throw new Error(error || 'Screenshot setup failed.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function pngDimensions(path) {
  const bytes = await readFile(path);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${path} is not a PNG.`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
