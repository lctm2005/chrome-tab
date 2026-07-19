import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirmPanelWindowBindingAfterInitialization,
  createEligibleTabActivationController,
  createPanelCommandMessage,
  createPanelWindowBindingController,
  mergeTabActivationCache,
  normalizePanelWindowId,
  resolvePanelHostBinding,
  runPanelWindowRefreshTransaction,
  selectEligibleTabSource,
  shouldRouteToPanel,
} from '../src/shared/panel-routing.js';
import { activeSpaceForWindow } from '../src/shared/state.js';

test('normalizes only real non-negative Chrome window ids', () => {
  assert.equal(normalizePanelWindowId(0), 0);
  assert.equal(normalizePanelWindowId(17), 17);
  assert.equal(normalizePanelWindowId('0017'), 17);
  assert.equal(normalizePanelWindowId(-1), null);
  assert.equal(normalizePanelWindowId(2.5), null);
  assert.equal(normalizePanelWindowId(null), null);
  assert.equal(normalizePanelWindowId(''), null);
  assert.equal(normalizePanelWindowId('2.5'), null);
  assert.equal(normalizePanelWindowId('9007199254740992'), null);
});

test('routes close and shortcut messages only to the visible panel in the target window', () => {
  assert.equal(shouldRouteToPanel({ visible: true, windowId: 7 }, 7), true);
  assert.equal(shouldRouteToPanel({ visible: true, windowId: '7' }, 7), true);
  assert.equal(shouldRouteToPanel({ visible: true, windowId: 8 }, 7), false);
  assert.equal(shouldRouteToPanel({ visible: true }, 7), false);
  assert.equal(shouldRouteToPanel({ visible: false, windowId: 7 }, 7), false);
  assert.equal(shouldRouteToPanel(null, 7), false);
  assert.equal(shouldRouteToPanel({ visible: true, windowId: 8 }, null), true);
});

test('resolves Workbench and side-panel host windows from their actual Chrome contexts', () => {
  assert.deepEqual(resolvePanelHostBinding(
    { id: 41, windowId: 7 },
    { id: 3 },
  ), {
    hostTabId: 41,
    windowId: 7,
  }, 'a Workbench tab is authoritative even when another window is focused');
  assert.deepEqual(resolvePanelHostBinding(undefined, { id: '8' }), {
    hostTabId: null,
    windowId: 8,
  }, 'a side panel has no host tab and uses the containing window');
  assert.deepEqual(resolvePanelHostBinding({ id: '9' }, { id: 10 }), {
    hostTabId: 9,
    windowId: 10,
  }, 'a temporarily incomplete host tab can fall back to the containing window');
  assert.deepEqual(resolvePanelHostBinding({ id: -1, windowId: -1 }, {}), {
    hostTabId: null,
    windowId: null,
  });
});

test('rebinds only the Workbench host after cross-window attach or move signals', () => {
  const transitions = [];
  const controller = createPanelWindowBindingController({
    hostTabId: '41',
    windowId: 7,
    onRebind: (transition) => transitions.push(transition),
  });

  assert.deepEqual(controller.current(), { hostTabId: 41, windowId: 7, epoch: 0 });
  assert.equal(controller.handleAttached(99, { newWindowId: 8 }), null,
    'moving an ordinary content tab cannot redirect the Workbench');
  assert.equal(controller.handleAttached(41, { newWindowId: 'bad' }), null);
  assert.equal(controller.handleAttached(41, { newWindowId: 7 }), null,
    'an event already reflected in state is a no-op');
  assert.deepEqual(controller.handleAttached(41, { newWindowId: '8' }), {
    source: 'attached',
    hostTabId: 41,
    previousWindowId: 7,
    windowId: 8,
    previousEpoch: 0,
    epoch: 1,
  });
  assert.deepEqual(controller.current(), { hostTabId: 41, windowId: 8, epoch: 1 });
  assert.deepEqual(controller.handleMoved(41, { windowId: 9 }), {
    source: 'moved',
    hostTabId: 41,
    previousWindowId: 8,
    windowId: 9,
    previousEpoch: 1,
    epoch: 2,
  });
  assert.equal(controller.isCurrent(transitions[0]), false,
    'a queued refresh for B becomes stale after the host moves again to C');
  assert.equal(controller.isCurrent(transitions[1]), true);
  assert.deepEqual(transitions, [
    {
      source: 'attached',
      hostTabId: 41,
      previousWindowId: 7,
      windowId: 8,
      previousEpoch: 0,
      epoch: 1,
    },
    {
      source: 'moved',
      hostTabId: 41,
      previousWindowId: 8,
      windowId: 9,
      previousEpoch: 1,
      epoch: 2,
    },
  ]);
});

test('side panels ignore all tab attachment events because they have no host tab', () => {
  const controller = createPanelWindowBindingController({ windowId: '12' });
  assert.deepEqual(controller.current(), { hostTabId: null, windowId: 12, epoch: 0 });
  assert.equal(controller.handleAttached(5), null);
  assert.equal(controller.handleMoved(5), null);
  assert.equal(controller.isCurrent({ hostTabId: null, windowId: 12, epoch: 0 }), true);
  assert.deepEqual(controller.current(), { hostTabId: null, windowId: 12, epoch: 0 });

  const callbackFreeWorkbench = createPanelWindowBindingController({ hostTabId: 6, windowId: 12 });
  assert.equal(callbackFreeWorkbench.handleMoved(6, { windowId: 13 }).windowId, 13,
    'the optional callback is not required to keep binding state current');
});

test('binding epochs reject an old refresh even after the host returns to the same window', () => {
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const originalA = controller.current();
  controller.handleAttached(41, { newWindowId: 8 });
  controller.handleAttached(41, { newWindowId: 7 });

  assert.deepEqual(controller.current(), { hostTabId: 41, windowId: 7, epoch: 2 });
  assert.equal(controller.isCurrent(originalA), false,
    'window equality alone must not resurrect work captured before A → B → A');
});

test('initialization confirmation catches a missed move without reverting a newer event', () => {
  const transitions = [];
  const controller = createPanelWindowBindingController({
    hostTabId: 41,
    windowId: 7,
    onRebind: (transition) => transitions.push(transition),
  });

  const beforeConfirmationRead = controller.current();
  controller.handleAttached(41, { newWindowId: 8 });
  assert.equal(controller.confirm(
    { hostTabId: 41, windowId: 9 },
    beforeConfirmationRead.epoch,
  ), null, 'a late getCurrent result cannot overwrite the attach event for B');
  assert.equal(controller.current().windowId, 8);

  const afterEvent = controller.current();
  assert.deepEqual(controller.confirm(
    { hostTabId: 41, windowId: 9 },
    afterEvent.epoch,
  ), {
    source: 'confirmed',
    hostTabId: 41,
    previousWindowId: 8,
    windowId: 9,
    previousEpoch: 1,
    epoch: 2,
  }, 'a stable final read repairs an attach event missed during initialization');
  assert.equal(controller.confirm({ hostTabId: 99, windowId: 10 }, 2), null);
  assert.deepEqual(transitions.map(({ source, windowId, epoch }) => ({ source, windowId, epoch })), [
    { source: 'attached', windowId: 8, epoch: 1 },
    { source: 'confirmed', windowId: 9, epoch: 2 },
  ]);
});

test('initialization waits for the newest rebind when B is superseded by C', async () => {
  const firstHostRead = deferred();
  const bRebind = deferred();
  const cRebind = deferred();
  const bTaskCaptured = deferred();
  let pendingRebind = Promise.resolve();
  let hostReads = 0;
  let rebindTaskReads = 0;
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const confirmation = confirmPanelWindowBindingAfterInitialization(
    controller,
    async () => {
      hostReads += 1;
      if (hostReads === 1) return firstHostRead.promise;
      return { hostTabId: 41, windowId: 9 };
    },
    () => {
      rebindTaskReads += 1;
      if (rebindTaskReads === 1) bTaskCaptured.resolve();
      return pendingRebind;
    },
  );

  controller.handleAttached(41, { newWindowId: 8 });
  pendingRebind = bRebind.promise;
  firstHostRead.resolve({ hostTabId: 41, windowId: 8 });
  await bTaskCaptured.promise;
  controller.handleMoved(41, { windowId: 9 });
  pendingRebind = cRebind.promise;
  bRebind.resolve();
  await Promise.resolve();
  cRebind.resolve();

  assert.deepEqual(await confirmation, { hostTabId: 41, windowId: 9, epoch: 2 });
  assert.equal(hostReads, 2, 'the final host is read again after the awaited B task becomes stale');
});

test('A and B refreshes cannot commit after successive host moves to B and C', async () => {
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const aSynchronized = deferred();
  const bSynchronized = deferred();
  const commits = [];

  const bindingA = controller.current();
  const refreshA = runPanelWindowRefreshTransaction(
    controller,
    bindingA,
    async () => {
      await aSynchronized.promise;
      return true;
    },
    async (binding) => {
      commits.push(binding.windowId);
      return true;
    },
  );
  controller.handleAttached(41, { newWindowId: 8 });
  aSynchronized.resolve();
  assert.equal(await refreshA, false);
  assert.deepEqual(commits, [], 'the old A Space is never persisted into B');

  const bindingB = controller.current();
  const refreshB = runPanelWindowRefreshTransaction(
    controller,
    bindingB,
    async () => {
      await bSynchronized.promise;
      return true;
    },
    async (binding) => {
      commits.push(binding.windowId);
      return true;
    },
  );
  controller.handleMoved(41, { windowId: 9 });
  bSynchronized.resolve();
  assert.equal(await refreshB, false);
  assert.deepEqual(commits, [], 'a queued B refresh is also stale after the host reaches C');

  const bindingC = controller.current();
  assert.equal(await runPanelWindowRefreshTransaction(
    controller,
    bindingC,
    async () => true,
    async (binding) => {
      commits.push(binding.windowId);
      return true;
    },
  ), true);
  assert.deepEqual(commits, [9]);
});

test('window refresh transactions stop when either state stage declines the captured binding', async () => {
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const binding = controller.current();
  let refreshCalls = 0;
  assert.equal(await runPanelWindowRefreshTransaction(
    controller,
    binding,
    async () => false,
    async () => {
      refreshCalls += 1;
      return true;
    },
  ), false);
  assert.equal(refreshCalls, 0);

  assert.equal(await runPanelWindowRefreshTransaction(
    controller,
    binding,
    async () => true,
    async () => false,
  ), false);
  controller.handleAttached(41, { newWindowId: 8 });
  assert.equal(await runPanelWindowRefreshTransaction(
    controller,
    binding,
    async () => true,
    async () => true,
  ), false, 'an already stale transaction never starts synchronization');
});

test('all user-facing window commands route to the Workbench destination immediately after attach', () => {
  const controller = createPanelWindowBindingController({ hostTabId: 41, windowId: 7 });
  const routedWindowIds = () => [
    createPanelCommandMessage('tabs:list', {}, controller.current().windowId),
    createPanelCommandMessage('tabs:create', { url: 'chrome://newtab' }, controller.current().windowId),
    createPanelCommandMessage('tabs:openUnique', { url: 'https://example.test/' }, controller.current().windowId),
  ].map((message) => message.windowId);

  assert.deepEqual(routedWindowIds(), [7, 7, 7]);
  controller.handleAttached(99, { newWindowId: 8 });
  assert.deepEqual(routedWindowIds(), [7, 7, 7], 'an ordinary tab move leaves routing in A');
  controller.handleAttached(41, { newWindowId: 8 });
  assert.deepEqual(routedWindowIds(), [8, 8, 8], 'the host attach redirects every later command to B');
  assert.equal(activeSpaceForWindow({
    activeSpaceIds: { 7: 'space-a', 8: 'space-b' },
  }, controller.current().windowId, [
    { id: 'space-a' },
    { id: 'space-b' },
  ], 'space-a'), 'space-b', 'the refreshed Workbench selects B\'s saved Space mapping');

  assert.deepEqual(createPanelCommandMessage('tabs:list', { windowId: 12 }, 8), {
    type: 'tabs:list',
    windowId: 12,
  }, 'an intentional per-operation destination remains authoritative');
  assert.deepEqual(createPanelCommandMessage('tabs:listAll', {}, 8), { type: 'tabs:listAll' });
  assert.deepEqual(createPanelCommandMessage('tabs:create', {}, 'invalid'), { type: 'tabs:create' });
});

test('selects only eligible Ask sources while preserving a fresh remembered activation', () => {
  const isEligible = (tab) => Boolean(tab?.url && !tab.url.startsWith('chrome-extension://'));
  const remembered = { id: 7, title: 'Remembered', url: 'https://example.com/remembered', active: true };
  assert.deepEqual(selectEligibleTabSource([], remembered, isEligible), remembered);
  assert.deepEqual(
    selectEligibleTabSource([
      { id: 7, title: 'Refreshed', url: 'https://example.com/refreshed', active: true },
    ], remembered, isEligible),
    { id: 7, title: 'Refreshed', url: 'https://example.com/refreshed', active: true },
  );

  assert.deepEqual(selectEligibleTabSource([
    { ...remembered, active: false },
    { id: 8, title: 'Actually active', url: 'https://example.com/active-now', active: true },
  ], remembered, isEligible), {
    id: 8,
    title: 'Actually active',
    url: 'https://example.com/active-now',
    active: true,
  });

  const fallback = selectEligibleTabSource([
    { id: 8, title: 'Workbench', url: 'chrome-extension://id/sidepanel.html', active: true },
    { id: 9, title: 'Older', url: 'https://example.com/older', lastAccessed: 100 },
    { id: 10, title: 'Newest', url: 'https://example.com/newest', lastAccessed: 300 },
    { id: 11, title: 'No timestamp', url: 'https://example.com/no-time', lastAccessed: 0 },
  ], { id: 8, url: 'https://stale.example/' }, isEligible);
  assert.equal(fallback.id, 10);

  const activePage = { id: 12, url: 'https://example.com/active', active: true };
  assert.equal(selectEligibleTabSource([activePage], null, isEligible), activePage);
  assert.equal(selectEligibleTabSource(null, null, isEligible), null);
  assert.equal(selectEligibleTabSource([null], null), null);
});

test('activation cache keeps stale observations inactive without clearing the authoritative page', () => {
  const initial = [
    { id: 1, title: 'Current page', url: 'https://current.example/', active: true },
    { id: 2, title: 'Older page', url: 'https://older.example/', active: false },
  ];
  const staleObservation = mergeTabActivationCache(initial, {
    id: 2,
    title: 'Older lookup',
    url: 'https://older.example/',
    active: true,
  });

  assert.deepEqual(staleObservation.tabs, [
    { id: 1, title: 'Current page', url: 'https://current.example/', active: true },
    { id: 2, title: 'Older lookup', url: 'https://older.example/', active: false },
  ]);
  assert.equal(staleObservation.tab.active, false);

  assert.deepEqual(mergeTabActivationCache(null, { id: 3 }), {
    tabs: [{ id: 3, active: false }],
    tab: { id: 3, active: false },
  });
});

test('an active authoritative winner becomes the cache\'s only active page', () => {
  const authoritative = mergeTabActivationCache([
    { id: 1, title: 'Current page', url: 'https://current.example/', active: true },
    { id: 2, title: 'Older page', url: 'https://older.example/', active: false },
  ], {
    id: 2,
    title: 'New current page',
    url: 'https://new.example/',
    active: true,
  }, { authoritative: true });
  assert.deepEqual(authoritative.tabs, [
    { id: 1, title: 'Current page', url: 'https://current.example/', active: false },
    { id: 2, title: 'New current page', url: 'https://new.example/', active: true },
  ]);
  assert.equal(authoritative.tab.active, true);
  assert.deepEqual(authoritative.tabs.filter((tab) => tab.active).map((tab) => tab.id), [2]);
});

test('an inactive authoritative winner is returned for remembering without inventing an active page', () => {
  const inactiveWinner = mergeTabActivationCache([
    { id: 1, title: 'Current page', url: 'https://current.example/', active: true },
  ], {
    id: 2,
    title: 'Remembered after focusing Workbench',
    url: 'https://remembered.example/',
    active: false,
  }, { authoritative: true });
  assert.deepEqual(inactiveWinner.tabs, [
    { id: 1, title: 'Current page', url: 'https://current.example/', active: false },
    {
      id: 2,
      title: 'Remembered after focusing Workbench',
      url: 'https://remembered.example/',
      active: false,
    },
  ]);
  assert.equal(inactiveWinner.tab.id, 2);
  assert.equal(inactiveWinner.tab.active, false);
  assert.equal(inactiveWinner.tabs.some((tab) => tab.active), false);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('newer eligible tab activations win while older fresh pages remain observable', async () => {
  const pending = new Map([[1, deferred()], [2, deferred()]]);
  const observed = [];
  const activated = [];
  const controller = createEligibleTabActivationController({
    getTab: ({ tabId }) => pending.get(tabId).promise,
    isEligible: (tab) => Boolean(tab?.url && !tab.url.startsWith('chrome-extension://')),
    now: () => 1_000,
    onObserve: (tab, activeInfo, activation) => observed.push({
      id: tab.id,
      activeTabId: activeInfo.tabId,
      sequence: activation.sequence,
      activatedAt: activation.activatedAt,
      activation,
    }),
    onActivate: (tab, activeInfo, activation) => activated.push({
      id: tab.id,
      activeTabId: activeInfo.tabId,
      activation,
    }),
  });

  const first = controller.handle({ tabId: 1 });
  const second = controller.handle({ tabId: 2 });
  pending.get(2).resolve({ id: 2, url: 'https://example.com/newer' });
  assert.equal(await second, true);
  pending.get(1).resolve({ id: 1, url: 'https://example.com/older' });
  assert.equal(await first, false);
  assert.deepEqual(activated.map(({ id, activeTabId }) => ({ id, activeTabId })), [
    { id: 2, activeTabId: 2 },
  ]);
  assert.deepEqual(observed.map(({ id, activeTabId, sequence }) => ({ id, activeTabId, sequence })), [
    { id: 2, activeTabId: 2, sequence: 2 },
    { id: 1, activeTabId: 1, sequence: 1 },
  ]);
  assert.strictEqual(activated[0].activation, observed[0].activation);
  assert.deepEqual(observed.map(({ activatedAt }) => activatedAt), [1_001, 1_000]);
});

test('an ineligible Workbench activation does not suppress the preceding real page', async () => {
  const page = deferred();
  const workbench = deferred();
  const activated = [];
  const controller = createEligibleTabActivationController({
    getCachedTab: () => {
      throw new Error('stale cached pages must never be committed');
    },
    getTab: ({ tabId }) => tabId === 1 ? page.promise : workbench.promise,
    isEligible: (tab) => Boolean(tab?.url && !tab.url.startsWith('chrome-extension://')),
    onActivate: (tab) => activated.push(tab.id),
  });

  const pageActivation = controller.handle({ tabId: 1 });
  const workbenchActivation = controller.handle({ tabId: 2 });
  workbench.resolve({ id: 2, url: 'chrome-extension://id/sidepanel.html' });
  assert.equal(await workbenchActivation, false);
  page.resolve({ id: 1, url: 'https://example.com/source' });
  assert.equal(await pageActivation, true);
  assert.deepEqual(activated, [1]);
});

test('activation commits only fresh tab data and reports lookup failures', async () => {
  const failures = [];
  const activated = [];
  const controller = createEligibleTabActivationController({
    getTab: async ({ tabId }) => {
      if (tabId === 4) throw new Error('closed');
      return { id: tabId, url: 'https://example.com/fresh', title: 'Fresh' };
    },
    isEligible: (tab) => Boolean(tab?.url),
    onActivate: (tab) => activated.push([tab.id, tab.title || '']),
    onError: (error, activeInfo) => failures.push([error.message, activeInfo.tabId]),
  });

  assert.equal(await controller.handle({ tabId: 3 }), true);
  assert.deepEqual(activated, [[3, 'Fresh']]);
  assert.equal(await controller.handle({ tabId: 4 }), false);
  assert.deepEqual(failures, [['closed', 4]]);
});

test('a fresh active update advances the watermark ahead of an older pending lookup', async () => {
  const older = deferred();
  const observed = [];
  const activated = [];
  const controller = createEligibleTabActivationController({
    getTab: () => older.promise,
    isEligible: (tab) => Boolean(tab?.url),
    now: () => 2_000,
    onObserve: (tab, activeInfo, activation) => observed.push({
      id: tab.id,
      activeTabId: activeInfo.tabId,
      sequence: activation.sequence,
      activatedAt: activation.activatedAt,
    }),
    onActivate: (tab) => activated.push(tab.id),
  });

  const pending = controller.handle({ tabId: 1 });
  assert.equal(controller.commitFresh(
    { id: 2, url: 'https://example.com/new-active' },
    { tabId: 2 },
  ), true);
  older.resolve({ id: 1, url: 'https://example.com/late-old-page' });

  assert.equal(await pending, false);
  assert.deepEqual(activated, [2]);
  assert.deepEqual(observed, [
    { id: 2, activeTabId: 2, sequence: 2, activatedAt: 2_001 },
    { id: 1, activeTabId: 1, sequence: 1, activatedAt: 2_000 },
  ]);
  assert.equal(controller.commitFresh(null), false);
});

test('invalidating a pending tab prevents late activation from resurrecting it', async () => {
  const first = deferred();
  const activated = [];
  const controller = createEligibleTabActivationController({
    getTab: ({ tabId }) => tabId === 5
      ? first.promise
      : Promise.resolve({ id: tabId, url: 'https://example.com/reopened' }),
    isEligible: (tab) => Boolean(tab?.url),
    onActivate: (tab) => activated.push(tab.id),
  });

  const pending = controller.handle({ tabId: 5 });
  const duplicatePending = controller.handle({ tabId: 5 });
  assert.equal(controller.invalidate('invalid'), false);
  assert.equal(controller.invalidate(5), true);
  assert.equal(controller.invalidate(5), true);
  first.resolve({ id: 5, url: 'https://example.com/closed' });
  assert.equal(await pending, false);
  assert.equal(await duplicatePending, false);
  assert.deepEqual(activated, []);
  assert.equal(await controller.handle({ tabId: 6 }), true);
  assert.equal(controller.invalidate(6), true);
  assert.deepEqual(activated, [6]);
});

test('activation controller defaults safely when no host callbacks are provided', async () => {
  const controller = createEligibleTabActivationController();
  assert.equal(await controller.handle(), false);

  const controllerWithDefaultActivate = createEligibleTabActivationController({
    getTab: async () => ({ id: 5, url: 'https://example.com/fresh' }),
    isEligible: () => true,
  });
  assert.equal(await controllerWithDefaultActivate.handle({ tabId: 5 }), true);

  const controllerWithDefaultError = createEligibleTabActivationController({
    getTab: async () => { throw new Error('closed after cache hit'); },
    isEligible: () => true,
  });
  assert.equal(await controllerWithDefaultError.handle({ tabId: 5 }), false);
});
