import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_SESSION_STORAGE_KEY,
  createDefaultState,
  SHARED_STATE_LOCK_NAME,
  STORAGE_KEY,
  WINDOW_STATE_KEY,
} from '../src/shared/state.js';
import { createAskSession } from '../src/shared/ask-session.js';
import { askSessionRevision, markAskStreamPending } from '../src/shared/ask-stream.js';
import { chromeGroupTitle } from '../src/shared/group-title.js';

const LIFECYCLE_EVENT_PREFIX = 'spaceTabsLifecycleEvent:';
const LIFECYCLE_SUPPRESSION_PREFIX = 'spaceTabsLifecycleSuppression:';

let registeredBackgroundListeners = null;

function eventTarget() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createControllableWebLock({ blocked = false } = {}) {
  let isBlocked = blocked;
  const pending = [];
  const calls = [];
  return {
    calls,
    request(name, options, task) {
      calls.push([name, options]);
      if (!isBlocked) return task();
      return new Promise((resolve, reject) => {
        pending.push(() => Promise.resolve().then(task).then(resolve, reject));
      });
    },
    hold() {
      isBlocked = true;
    },
    releaseAll() {
      isBlocked = false;
      for (const resume of pending.splice(0)) resume();
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

function makeTab(id, overrides = {}) {
  return {
    id,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
    favIconUrl: '',
    pinned: false,
    mutedInfo: { muted: false },
    active: false,
    groupId: -1,
    index: id,
    windowId: 1,
    audible: false,
    lastAccessed: 100 + id,
    ...overrides,
  };
}

function makeGroup(id, overrides = {}) {
  return {
    id,
    title: `Group ${id}`,
    color: 'blue',
    collapsed: false,
    windowId: 1,
    ...overrides,
  };
}

function missingTab(id) {
  return new Error(`No tab with id: ${id}`);
}

function missingGroup(id) {
  return new Error(`No group with id: ${id}`);
}

function missingWindow(id) {
  return new Error(`No window with id: ${id}`);
}

function createChromeMock(options = {}) {
  const calls = [];
  const tabs = new Map((options.tabs || []).map((tab) => [Number(tab.id), { ...tab }]));
  const groups = new Map((options.groups || []).map((group) => [Number(group.id), { ...group }]));
  const storageConfig = options.storage && typeof options.storage === 'object' ? options.storage : {};
  const storageLocal = cloneValue(storageConfig.local || {});
  const storageSession = cloneValue(storageConfig.session || {});
  const alarms = new Map();
  let nextTabId = options.nextTabId || 1000;
  let nextGroupId = options.nextGroupId || 500;
  const behavior = options.behavior || {};

  const invoke = async (name, fallback, ...args) => {
    calls.push([name, ...args]);
    if (Object.hasOwn(behavior, name)) return behavior[name](...args);
    return fallback(...args);
  };

  const createStorageArea = (areaName, data) => ({
    get(keys) {
      return invoke(`storage.${areaName}.get`, () => {
        if (keys === null || keys === undefined) return cloneValue(data);
        const requested = typeof keys === 'string' ? [keys]
          : Array.isArray(keys) ? keys
          : Object.keys(keys || {});
        const result = {};
        for (const key of requested) {
          if (Object.hasOwn(data, key)) result[key] = cloneValue(data[key]);
          else if (keys && !Array.isArray(keys) && typeof keys === 'object') result[key] = cloneValue(keys[key]);
        }
        return result;
      }, keys);
    },
    set(values) {
      return invoke(`storage.${areaName}.set`, () => {
        for (const [key, value] of Object.entries(values || {})) data[key] = cloneValue(value);
      }, values);
    },
    remove(keys) {
      return invoke(`storage.${areaName}.remove`, () => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      }, keys);
    },
    clear() {
      return invoke(`storage.${areaName}.clear`, () => {
        for (const key of Object.keys(data)) delete data[key];
      });
    },
  });

  const runtime = {
    onInstalled: eventTarget(),
    onStartup: eventTarget(),
    onMessage: eventTarget(),
    onConnect: eventTarget(),
    getURL(path = '') {
      return `chrome-extension://space-tabs/${path}`;
    },
    sendMessage(message) {
      calls.push(['runtime.sendMessage', message]);
      if (behavior['runtime.sendMessage']) return behavior['runtime.sendMessage'](message);
      return Promise.resolve();
    },
  };

  const chrome = {
    runtime,
    alarms: {
      onAlarm: eventTarget(),
      create(name, alarmInfo) {
        calls.push(['alarms.create', name, alarmInfo]);
        alarms.set(name, cloneValue(alarmInfo));
        return behavior['alarms.create']?.(name, alarmInfo);
      },
      clear(name) {
        return invoke('alarms.clear', () => alarms.delete(name), name);
      },
    },
    tabs: {
      onCreated: eventTarget(),
      onRemoved: eventTarget(),
      onUpdated: eventTarget(),
      onMoved: eventTarget(),
      onDetached: eventTarget(),
      onAttached: eventTarget(),
      onReplaced: eventTarget(),
      query(query) {
        return invoke('tabs.query', () => {
          let result = [...tabs.values()];
          if (Number.isFinite(query?.windowId)) result = result.filter((tab) => tab.windowId === query.windowId);
          if (query?.currentWindow) result = result.filter((tab) => tab.windowId === (options.currentWindowId || 1));
          if (query?.active) result = result.filter((tab) => tab.active);
          return result.map((tab) => ({ ...tab }));
        }, query);
      },
      create(properties) {
        return invoke('tabs.create', () => {
          const tab = makeTab(nextTabId++, {
            url: properties.url,
            active: properties.active,
            windowId: properties.windowId ?? options.currentWindowId ?? 1,
            index: tabs.size,
          });
          tabs.set(tab.id, tab);
          return { ...tab };
        }, properties);
      },
      update(tabId, update) {
        return invoke('tabs.update', () => {
          const tab = tabs.get(Number(tabId));
          if (!tab) throw missingTab(tabId);
          Object.assign(tab, update);
          return { ...tab };
        }, tabId, update);
      },
      get(tabId) {
        return invoke('tabs.get', () => {
          const tab = tabs.get(Number(tabId));
          if (!tab) throw missingTab(tabId);
          return { ...tab };
        }, tabId);
      },
      duplicate(tabId) {
        return invoke('tabs.duplicate', () => {
          const source = tabs.get(Number(tabId));
          if (!source) throw missingTab(tabId);
          const tab = { ...source, id: nextTabId++, index: source.index + 1, active: true };
          tabs.set(tab.id, tab);
          return { ...tab };
        }, tabId);
      },
      discard(tabId) {
        return invoke('tabs.discard', () => {
          const tab = tabs.get(Number(tabId));
          if (!tab) throw missingTab(tabId);
          tab.discarded = true;
          return { ...tab };
        }, tabId);
      },
      remove(tabIds) {
        return invoke('tabs.remove', () => {
          const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
          for (const id of ids) {
            if (!tabs.has(Number(id))) throw missingTab(id);
            tabs.delete(Number(id));
          }
        }, tabIds);
      },
      group(properties) {
        return invoke('tabs.group', () => {
          const groupId = Number.isFinite(properties.groupId) ? properties.groupId : nextGroupId++;
          const existingGroup = groups.get(groupId);
          const targetWindowId = Number.isFinite(properties.createProperties?.windowId)
            ? properties.createProperties.windowId
            : existingGroup?.windowId;
          for (const id of properties.tabIds) {
            const tab = tabs.get(Number(id));
            if (!tab) throw missingTab(id);
            tab.groupId = groupId;
            if (Number.isFinite(targetWindowId)) tab.windowId = targetWindowId;
          }
          if (!groups.has(groupId)) {
            groups.set(groupId, makeGroup(groupId, {
              windowId: Number.isFinite(targetWindowId) ? targetWindowId : 1,
            }));
          }
          return groupId;
        }, properties);
      },
      ungroup(tabIds) {
        return invoke('tabs.ungroup', () => {
          for (const id of tabIds) {
            const tab = tabs.get(Number(id));
            if (!tab) throw missingTab(id);
            tab.groupId = -1;
          }
        }, tabIds);
      },
      move(tabId, properties) {
        return invoke('tabs.move', () => {
          const tab = tabs.get(Number(tabId));
          if (!tab) throw missingTab(tabId);
          const oldWindowId = tab.windowId;
          const targetWindowId = Number.isFinite(properties.windowId) ? properties.windowId : oldWindowId;
          const oldWindowTabs = [...tabs.values()]
            .filter((candidate) => candidate.windowId === oldWindowId && candidate.id !== tab.id)
            .sort((left, right) => left.index - right.index);
          oldWindowTabs.forEach((candidate, index) => { candidate.index = index; });
          tab.windowId = targetWindowId;
          const targetTabs = [...tabs.values()]
            .filter((candidate) => candidate.windowId === targetWindowId && candidate.id !== tab.id)
            .sort((left, right) => left.index - right.index);
          const targetIndex = properties.index === -1
            ? targetTabs.length
            : Math.max(0, Math.min(Number(properties.index), targetTabs.length));
          targetTabs.splice(targetIndex, 0, tab);
          targetTabs.forEach((candidate, index) => { candidate.index = index; });
          return { ...tab };
        }, tabId, properties);
      },
    },
    tabGroups: {
      onCreated: eventTarget(),
      onUpdated: eventTarget(),
      onMoved: eventTarget(),
      onRemoved: eventTarget(),
      get(groupId) {
        return invoke('tabGroups.get', () => {
          const group = groups.get(Number(groupId));
          if (!group) throw missingGroup(groupId);
          return { ...group };
        }, groupId);
      },
      query(query) {
        return invoke('tabGroups.query', () => [...groups.values()].map((group) => ({ ...group })), query);
      },
      update(groupId, update) {
        return invoke('tabGroups.update', () => {
          const group = groups.get(Number(groupId));
          if (!group) throw missingGroup(groupId);
          Object.assign(group, update);
          return { ...group };
        }, groupId, update);
      },
      move(groupId, properties) {
        return invoke('tabGroups.move', () => {
          const group = groups.get(Number(groupId));
          if (!group) throw missingGroup(groupId);
          group.index = properties.index;
          return { ...group };
        }, groupId, properties);
      },
    },
    windows: {
      onRemoved: eventTarget(),
      get(windowId) {
        return invoke('windows.get', () => {
          const exists = [...tabs.values()].some((tab) => Number(tab.windowId) === Number(windowId));
          if (!exists) throw missingWindow(windowId);
          return { id: Number(windowId) };
        }, windowId);
      },
      update(windowId, update) {
        return invoke('windows.update', () => ({ id: windowId, ...update }), windowId, update);
      },
      getLastFocused(properties) {
        calls.push(['windows.getLastFocused', properties]);
        if (behavior['windows.getLastFocused']) return behavior['windows.getLastFocused'](properties);
        return Promise.resolve(options.lastFocusedWindow || { id: options.currentWindowId || 1 });
      },
    },
    scripting: {
      executeScript(details) {
        return invoke('scripting.executeScript', () => [{
          result: {
            title: `Extracted ${details.target.tabId}`,
            url: tabs.get(details.target.tabId)?.url || '',
            text: 'page text',
            charCount: 9,
            originalCharCount: 9,
            truncated: false,
          },
        }], details);
      },
    },
  };

  if (options.storage !== undefined && options.storage !== false) {
    chrome.storage = {
      local: createStorageArea('local', storageLocal),
      session: createStorageArea('session', storageSession),
    };
  }

  if (options.sidePanel !== false) {
    chrome.sidePanel = {
      setPanelBehavior(properties) {
        return invoke('sidePanel.setPanelBehavior', () => undefined, properties);
      },
      open(properties) {
        return invoke('sidePanel.open', () => undefined, properties);
      },
    };
  }

  return { chrome, calls, tabs, groups, alarms, behavior, storageLocal, storageSession };
}

function installMockGlobals(mock, options = {}) {
  globalThis.chrome = mock.chrome;
  globalThis.fetch = options.fetch || (async () => {
    throw new Error('Unexpected fetch call');
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: options.webLock
      ? { locks: { request: (...args) => options.webLock.request(...args) } }
      : {},
  });
}

function listenersFromChrome(chrome) {
  return {
    installed: chrome.runtime.onInstalled.listeners[0],
    startup: chrome.runtime.onStartup.listeners[0],
    message: chrome.runtime.onMessage.listeners[0],
    connect: chrome.runtime.onConnect.listeners[0],
    alarm: chrome.alarms.onAlarm.listeners[0],
    created: chrome.tabs.onCreated.listeners[0],
    removed: chrome.tabs.onRemoved.listeners[0],
    updated: chrome.tabs.onUpdated.listeners[0],
    moved: chrome.tabs.onMoved.listeners[0],
    detached: chrome.tabs.onDetached.listeners[0],
    attached: chrome.tabs.onAttached.listeners[0],
    replaced: chrome.tabs.onReplaced.listeners[0],
    groupCreated: chrome.tabGroups.onCreated.listeners[0],
    groupUpdated: chrome.tabGroups.onUpdated.listeners[0],
    groupMoved: chrome.tabGroups.onMoved.listeners[0],
    groupRemoved: chrome.tabGroups.onRemoved.listeners[0],
    windowRemoved: chrome.windows.onRemoved.listeners[0],
  };
}

function createBackgroundHarness(mock, listeners, options = {}) {
  const messageListener = listeners.message;
  assert.equal(typeof messageListener, 'function');

  return {
    ...mock,
    webLock: options.webLock,
    async send(message, sender = {}) {
      return new Promise((resolve, reject) => {
        let returned;
        try {
          returned = messageListener(message, sender, resolve);
        } catch (error) {
          reject(error);
          return;
        }
        assert.equal(returned, true, 'background keeps the runtime response channel open');
      });
    },
    connect(port) {
      listeners.connect(port);
    },
    async install() {
      await listeners.installed();
    },
    async startup() {
      return listeners.startup?.();
    },
    emitCreated(tab = {}) {
      return listeners.created?.(tab);
    },
    emitRemoved(tabId, removeInfo = {}) {
      return listeners.removed?.(tabId, removeInfo);
    },
    emitUpdated(tabId, changeInfo = {}, tab = {}) {
      return listeners.updated?.(tabId, changeInfo, tab);
    },
    emitMoved(tabId, moveInfo = {}) {
      return listeners.moved?.(tabId, moveInfo);
    },
    emitDetached(tabId, detachInfo = {}) {
      return listeners.detached?.(tabId, detachInfo);
    },
    emitAttached(tabId, attachInfo = {}) {
      return listeners.attached?.(tabId, attachInfo);
    },
    emitReplaced(addedTabId, removedTabId) {
      return listeners.replaced?.(addedTabId, removedTabId);
    },
    emitGroupCreated(group = {}) {
      return listeners.groupCreated?.(group);
    },
    emitGroupUpdated(group = {}) {
      return listeners.groupUpdated?.(group);
    },
    emitGroupMoved(group = {}) {
      return listeners.groupMoved?.(group);
    },
    emitGroupRemoved(group = {}) {
      return listeners.groupRemoved?.(group);
    },
    emitWindowRemoved(windowId) {
      return listeners.windowRemoved?.(windowId);
    },
    async emitAlarm(name) {
      return listeners.alarm?.({ name });
    },
  };
}

async function loadBackground(options = {}) {
  const mock = createChromeMock(options);
  installMockGlobals(mock, options);
  if (!registeredBackgroundListeners) {
    await import(new URL('../background.js', import.meta.url).href);
    registeredBackgroundListeners = listenersFromChrome(mock.chrome);
  }
  return createBackgroundHarness(mock, registeredBackgroundListeners, options);
}

function createPort({ name = 'sidepanel', windowId = 1, throwOnPost = false } = {}) {
  const onMessage = eventTarget();
  const onDisconnect = eventTarget();
  const posted = [];
  return {
    name,
    sender: Number.isFinite(windowId) ? { tab: { windowId } } : {},
    onMessage,
    onDisconnect,
    posted,
    postMessage(message) {
      if (throwOnPost) throw new Error('Port is gone');
      posted.push(message);
    },
    emit(message) {
      for (const listener of onMessage.listeners) listener(message);
    },
    disconnect() {
      for (const listener of onDisconnect.listeners) listener();
    },
  };
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? '',
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? (options.contentType || 'application/json') : null },
    async json() { return payload; },
    async text() { return options.rawBody ?? JSON.stringify(payload); },
    body: options.body,
  };
}

function sseResponse(chunks, options = {}) {
  let index = 0;
  let cancelCount = 0;
  const encoder = new TextEncoder();
  const reader = {
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[index++]) };
    },
    async cancel() {
      cancelCount += 1;
      if (options.cancelError) throw new Error('cancel failed');
    },
  };
  return {
    response: jsonResponse(null, {
      contentType: 'text/event-stream; charset=utf-8',
      body: { getReader: () => reader },
    }),
    get cancelCount() { return cancelCount; },
  };
}

const LIFECYCLE_SESSION_ID = 'session-current';

function lifecycleSnapshot() {
  return {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    spaceId: 'work',
    groups: [{
      snapshotGroupId: 'group-docs',
      title: 'Docs',
      color: 'blue',
      collapsed: false,
      tabs: [
        { snapshotTabId: 'row-first', title: 'First', panelTitle: 'First panel', url: 'https://same.test/page' },
        { snapshotTabId: 'row-second', title: 'Second', panelTitle: 'Second panel', url: 'https://same.test/page' },
        { snapshotTabId: 'row-other', title: 'Other', url: 'https://other.test/page' },
      ],
    }],
  };
}

function lifecycleWorkspace({ savedTargetTabIds = [], includeFocusSpace = false } = {}) {
  const state = createDefaultState({ browserSessionId: LIFECYCLE_SESSION_ID });
  state.activeSpaceId = 'work';
  state.spaces = [
    { id: 'work', name: 'Work', icon: 'W', color: 'blue' },
    ...(includeFocusSpace ? [{ id: 'focus', name: 'Focus', icon: 'F', color: 'red' }] : []),
  ];
  state.groupSpaces = { 100: 'work' };
  state.tabSpaces = { 10: 'work', 11: 'work' };
  state.renamedTabs = { 10: 'First panel', 11: 'Second panel' };
  state.tabGroups = { 10: 'local-docs', 11: 'local-docs' };
  state.ephemeralTabIds = [9, 11];
  state.tabOrder = { work: { 'group:100': [10, 11, 12] } };
  state.spaceSnapshots = { work: lifecycleSnapshot() };
  if (includeFocusSpace) {
    state.spaceSnapshots.focus = {
      version: 1,
      identityVersion: 1,
      updatedAt: 1,
      spaceId: 'focus',
      groups: [{
        snapshotGroupId: 'group-focus',
        title: 'Focus',
        color: 'red',
        collapsed: false,
        tabs: [{ snapshotTabId: 'row-focus', title: 'Focus existing', url: 'https://focus.test/' }],
      }],
    };
  }
  state.tabLifecycle = Object.fromEntries([
    [10, {
      tabId: 10,
      snapshotTabId: 'row-first',
      snapshotGroupId: 'group-docs',
      spaceId: 'work',
      url: 'https://same.test/page',
      title: 'First',
      panelTitle: 'First panel',
      windowId: 1,
      groupId: 100,
      trackingMode: savedTargetTabIds.includes(10) ? 'saved-target' : 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    }],
    [11, {
      tabId: 11,
      snapshotTabId: 'row-second',
      snapshotGroupId: 'group-docs',
      spaceId: 'work',
      url: 'https://same.test/page',
      title: 'Second',
      panelTitle: 'Second panel',
      windowId: 1,
      groupId: 100,
      trackingMode: savedTargetTabIds.includes(11) ? 'saved-target' : 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    }],
  ]);
  return state;
}

function lifecycleStorage(state = lifecycleWorkspace(), session = {}) {
  return {
    local: { [STORAGE_KEY]: cloneValue(state) },
    session: {
      [BROWSER_SESSION_STORAGE_KEY]: LIFECYCLE_SESSION_ID,
      ...cloneValue(session),
    },
  };
}

function askStreamStorage({ requestId = 'ask-request', text = 'Thinking...', status = 'pending' } = {}) {
  const state = createDefaultState();
  const session = createAskSession({
    id: 7,
    title: 'Ask source',
    url: 'https://source.example/page',
  }, 1);
  session.messages = [
    { id: 'question', role: 'user', text: 'What matters?', createdAt: 1 },
    { id: 'answer', role: 'assistant', text, createdAt: 2 },
  ];
  markAskStreamPending(session.messages[1], requestId, Date.now());
  if (status === 'streaming') {
    session.messages[1].askStream.status = 'streaming';
    session.messages[1].askStream.ownerId = 'previous-worker';
  }
  state.askSessions[session.key] = session;
  return {
    state,
    sessionKey: session.key,
    binding: { sessionKey: session.key, messageId: 'answer', requestId },
    storage: { local: { [STORAGE_KEY]: state }, session: {} },
  };
}

function askTurnStorage({ apiKey = 'secret-must-not-leak' } = {}) {
  const state = createDefaultState();
  state.ai = { ...state.ai, apiKey, maxTokens: 9999 };
  const sourceTab = {
    id: 7,
    title: 'Ask source',
    url: 'https://source.example/page',
  };
  const projectedSession = createAskSession(sourceTab, 1);
  projectedSession.messages = [
    { id: 'earlier', role: 'assistant', text: 'Earlier answer', createdAt: 2 },
  ];
  state.askSessions[projectedSession.key] = cloneValue(projectedSession);
  return {
    state,
    sourceTab,
    projectedSession,
    preparedSessionRevision: askSessionRevision(projectedSession),
    storage: { local: { [STORAGE_KEY]: state }, session: {} },
  };
}

function lifecycleJournalKeys(background) {
  return Object.keys(background.storageSession)
    .filter((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX));
}

function lifecycleJournalWriteCount(background) {
  return background.calls.filter(([name, values]) => (
    name === 'storage.session.set' &&
    Object.keys(values || {}).some((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX))
  )).length;
}

async function settleAsyncWork(iterations = 2) {
  for (let index = 0; index < iterations; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(predicate, message = 'Timed out waiting for background work', timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

async function waitForLifecycleAfter(background, previousJournalWrites) {
  await waitFor(
    () => lifecycleJournalWriteCount(background) > previousJournalWrites,
    'lifecycle event was not journaled',
  );
  await waitFor(
    () => lifecycleJournalKeys(background).length === 0,
    'lifecycle journal was not acknowledged',
  );
  await settleAsyncWork();
}

async function emitAndDrain(background, emit) {
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  emit();
  await waitForLifecycleAfter(background, previousJournalWrites);
}

async function captureConsoleErrors(action) {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await action(errors);
  } finally {
    console.error = original;
  }
  return errors;
}

const aiSettings = {
  provider: 'openai-compatible',
  baseUrl: 'https://ai.example/v1',
  model: 'test-model',
  apiKey: 'secret',
  thinking: 'disabled',
  temperature: 0.25,
};

test('service worker top-level boot drains a journal entry left by an earlier worker', async () => {
  const bootKey = `${LIFECYCLE_EVENT_PREFIX}boot-event`;
  const webLock = createControllableWebLock();
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [bootKey]: {
        type: 'updated',
        tabId: 10,
        changeInfo: { title: 'Recovered during boot' },
        eventId: 'boot-event',
        capturedAt: 100,
        sequence: 1,
      },
    }),
    webLock,
  });

  await waitFor(() => !Object.hasOwn(background.storageSession, bootKey));
  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first').title,
    'Recovered during boot',
  );
  assert.equal(webLock.calls.length, 2);
  assert.ok(webLock.calls.every(([name, options]) => (
    name === SHARED_STATE_LOCK_NAME && options.mode === 'exclusive'
  )), 'lifecycle replay and Ask recovery both use the shared exclusive state lock');
});

test('registers extension lifecycle behavior and reports unknown messages through the public protocol', async () => {
  const background = await loadBackground();
  await background.install();
  assert.deepEqual(background.calls[0], ['sidePanel.setPanelBehavior', { openPanelOnActionClick: true }]);

  assert.deepEqual(await background.send({ type: 'not-real' }), {
    ok: false,
    error: 'Unknown message type: not-real',
  });
  assert.deepEqual(await background.send(null), {
    ok: false,
    error: 'Unknown message type: undefined',
  });

  const withoutPanel = await loadBackground({ sidePanel: false });
  await withoutPanel.install();
  assert.equal(withoutPanel.calls.length, 0);
});

test('an install-time side panel failure is contained without blocking durable lifecycle recovery', async () => {
  const eventKey = `${LIFECYCLE_EVENT_PREFIX}install-recovery`;
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [eventKey]: {
        type: 'updated',
        tabId: 10,
        changeInfo: { title: 'Recovered after panel failure' },
        eventId: 'install-recovery',
        capturedAt: 100,
        sequence: 1,
      },
    }),
    behavior: {
      'sidePanel.setPanelBehavior': async () => {
        throw new Error('side panel preferences unavailable');
      },
    },
  });

  const errors = await captureConsoleErrors(async () => {
    await background.install();
    await waitFor(() => !Object.hasOwn(background.storageSession, eventKey));
    await settleAsyncWork();
  });

  assert.equal(
    background.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups[0].tabs
      .find((tab) => tab.snapshotTabId === 'row-first').title,
    'Recovered after panel failure',
  );
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /side panel setup failed/i);
  assert.match(String(errors[0][1]), /side panel preferences unavailable/i);
});

test('routes panel visibility, close, focus, and shortcuts to the intended browser window', async () => {
  const tabs = [makeTab(1, { active: true, windowId: 9 })];
  const background = await loadBackground({ tabs, currentWindowId: 9 });
  const ignored = createPort({ name: 'devtools', windowId: 9 });
  const first = createPort({ windowId: 9 });
  const second = createPort({ windowId: 10 });
  background.connect(ignored);
  background.connect(first);
  background.connect(second);
  assert.equal(ignored.onMessage.listeners.length, 0);

  const openCallsBeforeVisibleFocus = background.calls.filter((call) => call[0] === 'sidePanel.open').length;
  assert.deepEqual(await background.send({ type: 'panel:focus', windowId: 9 }), {
    ok: true,
    focused: false,
    alreadyOpen: true,
  });
  assert.equal(
    background.calls.filter((call) => call[0] === 'sidePanel.open').length,
    openCallsBeforeVisibleFocus,
    'an already-visible panel focuses itself locally instead of reopening through Chrome',
  );

  assert.deepEqual(await background.send({ type: 'panel:toggle', windowId: 9 }), { ok: true, closed: true });
  assert.deepEqual(first.posted, [{ type: 'panel:close' }]);
  assert.deepEqual(second.posted, []);

  first.emit({ type: 'panel:visibility', visible: false, windowId: 9 });
  assert.deepEqual(await background.send({ type: 'panel:toggle', windowId: '9' }), { ok: true, opened: true });
  assert.deepEqual(background.calls.at(-1), ['sidePanel.open', { windowId: 9 }]);

  first.emit({ type: 'ignored', visible: true, windowId: 10 });
  first.emit({ type: 'panel:visibility', visible: true, windowId: 'invalid' });
  assert.deepEqual(await background.send({ type: 'shortcut:action', action: 'askPage', windowId: 9 }), {
    ok: true,
    forwarded: true,
  });
  assert.deepEqual(first.posted.at(-1), { type: 'shortcut:action', action: 'askPage' });

  first.emit({ type: 'panel:visibility', windowId: '10' });
  assert.deepEqual(await background.send({ type: 'shortcut:action', action: 'newTab', windowId: 9 }), {
    ok: true,
    opened: true,
    forwarded: false,
  });
  assert.deepEqual(await background.send({ type: 'shortcut:action', action: '' }, { tab: { windowId: 9 } }), {
    ok: false,
    error: 'Missing shortcut action.',
  });

  assert.deepEqual(await background.send({ type: 'panel:focus' }, { tab: { windowId: 9 } }), {
    ok: true,
    focused: true,
  });
  first.disconnect();
  second.disconnect();
});

test('closed windows clear their Space routing and stale side-panel ports under the shared lock', async () => {
  const webLock = createControllableWebLock();
  const background = await loadBackground({
    storage: {
      local: {},
      session: {
        [WINDOW_STATE_KEY]: {
          activeSpaceIds: { 9: 'work', 10: 'personal' },
          retained: true,
        },
      },
    },
    webLock,
  });
  const closedWindowPort = createPort({ windowId: 9 });
  background.connect(closedWindowPort);

  background.emitWindowRemoved(9);
  await waitFor(() => !Object.hasOwn(
    background.storageSession[WINDOW_STATE_KEY].activeSpaceIds,
    '9',
  ));
  assert.deepEqual(background.storageSession[WINDOW_STATE_KEY], {
    activeSpaceIds: { 10: 'personal' },
    retained: true,
  });
  assert.deepEqual(webLock.calls, [[SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }]]);
  assert.deepEqual(await background.send({
    type: 'shortcut:action', action: 'tidy', windowId: 9,
  }), { ok: true, opened: true, forwarded: false });
  assert.deepEqual(closedWindowPort.posted, []);

  const sessionWrites = background.calls.filter(([name]) => name === 'storage.session.set').length;
  background.emitWindowRemoved(9);
  await settleAsyncWork();
  assert.equal(
    background.calls.filter(([name]) => name === 'storage.session.set').length,
    sessionWrites,
    'repeated close notifications do not rewrite unchanged session state',
  );
});

test('window cleanup failures are contained and reported instead of becoming unhandled rejections', async () => {
  const background = await loadBackground({
    storage: { local: {}, session: {} },
    behavior: {
      'storage.session.get': async () => { throw new Error('session unavailable'); },
    },
  });
  const errors = await captureConsoleErrors(async (captured) => {
    background.emitWindowRemoved(7);
    await waitFor(() => captured.length > 0);
  });
  assert.match(String(errors[0][0]), /window cleanup failed/i);
  assert.match(String(errors[0][1]), /session unavailable/i);
});

test('panel routing survives dead ports and returns user-facing failure when Chrome cannot identify a window', async () => {
  const background = await loadBackground({
    tabs: [],
    sidePanel: false,
    behavior: {
      'windows.getLastFocused': async () => { throw new Error('No normal window'); },
    },
  });
  const dead = createPort({ windowId: 4, throwOnPost: true });
  background.connect(dead);
  assert.deepEqual(await background.send({ type: 'panel:toggle', windowId: 4 }), { ok: true, closed: true });
  assert.deepEqual(await background.send({ type: 'panel:toggle' }), {
    ok: false,
    error: 'Cannot open the side panel from this page.',
  });
  assert.deepEqual(await background.send({ type: 'panel:focus' }), { ok: true, focused: false });
  assert.deepEqual(await background.send({ type: 'shortcut:action', action: 'tidy' }), {
    ok: true,
    forwarded: false,
  });

  const deadShortcutPort = createPort({ windowId: 4, throwOnPost: true });
  background.connect(deadShortcutPort);
  assert.deepEqual(await background.send({ type: 'shortcut:action', action: 'tidy', windowId: 4 }), {
    ok: true,
    forwarded: true,
  });
});

test('panel window discovery falls back from the active tab to the last focused normal window', async () => {
  const background = await loadBackground({
    tabs: [],
    lastFocusedWindow: { id: 42 },
  });
  assert.deepEqual(await background.send({ type: 'panel:focus' }), { ok: true, focused: true });
  assert.deepEqual(background.calls.at(-1), ['sidePanel.open', { windowId: 42 }]);

  assert.deepEqual(await background.send({ type: 'panel:focus', windowId: '7' }), {
    ok: true,
    focused: true,
  });
  assert.deepEqual(background.calls.at(-1), ['sidePanel.open', { windowId: 7 }]);

  const callsBeforeInvalidWindow = background.calls.length;
  assert.deepEqual(await background.send({ type: 'panel:focus', windowId: 'not-a-window' }), {
    ok: true,
    focused: false,
  });
  assert.equal(background.calls.length, callsBeforeInvalidWindow);
});

test('panel window discovery prefers the active tab before querying window focus state', async () => {
  const background = await loadBackground({ tabs: [makeTab(5, { active: true, windowId: 77 })] });
  assert.deepEqual(await background.send({ type: 'panel:focus' }), { ok: true, focused: true });
  assert.deepEqual(background.calls.at(-1), ['sidePanel.open', { windowId: 77 }]);
  assert.equal(background.calls.some((call) => call[0] === 'windows.getLastFocused'), false);
});

test('lists managed tabs in stable user order while exposing every Chrome tab for window safety', async () => {
  const tabs = [
    makeTab(8, { windowId: 2, index: 3, groupId: 20 }),
    makeTab(7, { windowId: 2, index: 1, groupId: 20, pendingUrl: 'https://pending.test/' }),
    makeTab(6, { windowId: 1, index: 5, groupId: 10 }),
    makeTab(5, { windowId: 1, index: 2, groupId: -1 }),
    makeTab(4, { windowId: 2, index: 0, url: 'chrome-extension://space-tabs/sidepanel.html' }),
    makeTab(3, { windowId: 2, index: 2, pendingUrl: 'chrome-extension://space-tabs/workbench.html' }),
  ];
  const groups = [makeGroup(10, { windowId: 1 }), makeGroup(20, { windowId: 2 }), makeGroup(30, { windowId: 3 })];
  const background = await loadBackground({ tabs, groups, currentWindowId: 2 });

  const listed = await background.send({ type: 'tabs:list', windowId: '2' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [7, 8]);
  assert.deepEqual(listed.groups.map((group) => group.id), [20]);
  assert.deepEqual(listed.allTabs.map((tab) => tab.id), [5, 6, 7, 8]);
  assert.deepEqual(listed.allGroups.map((group) => group.id), [10, 20, 30]);
  assert.deepEqual(listed.existingTabIds.sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(listed.existingWindowIds, [1, 2]);
  assert.deepEqual(listed.existingGroupIds, [10, 20, 30]);
  assert.deepEqual(listed.pendingLifecycleTabIds, []);
  assert.deepEqual(listed.suppressedLifecycleTabIds, []);

  const all = await background.send({ type: 'tabs:listAll' });
  assert.deepEqual(all.tabs.map((tab) => tab.id), [5, 6, 7, 8]);
  assert.deepEqual(all.allChromeTabs.map((tab) => tab.id), [5, 6, 4, 7, 3, 8]);
  assert.equal(all.tabs.some((tab) => tab.url.startsWith('chrome-extension://space-tabs/')), false);
  assert.deepEqual(
    all.allChromeTabs.filter((tab) => tab.url.startsWith('chrome-extension://space-tabs/')).map((tab) => tab.id),
    [4, 3],
  );
  assert.deepEqual(all.groups.map((group) => group.id), [10, 20]);

  const current = await background.send({ type: 'tabs:list' });
  assert.deepEqual(current.tabs.map((tab) => tab.id), [7, 8]);
});

test('tab listings separate pending lifecycle events from current valid close suppressions', async () => {
  const now = Date.now();
  const background = await loadBackground({
    tabs: [makeTab(1)],
    storage: {
      local: {},
      session: {
        [`${LIFECYCLE_EVENT_PREFIX}removed`]: {
          type: 'removed', tabId: 41, eventId: 'removed', capturedAt: 1, sequence: 1,
        },
        [`${LIFECYCLE_EVENT_PREFIX}replaced`]: {
          type: 'replaced', removedTabId: 41, addedTabId: '42',
          eventId: 'replaced', capturedAt: 2, sequence: 2,
        },
        [`${LIFECYCLE_EVENT_PREFIX}nested-tab`]: {
          type: 'created', tabId: null, tab: { id: 43 },
          eventId: 'nested-tab', capturedAt: 3, sequence: 3,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}44`]: {
          tabId: 44, disposition: 'panel-managed', createdAt: now,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}41`]: {
          tabId: 41, disposition: 'panel-managed', createdAt: now - 1,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}45`]: {
          tabId: 46, disposition: 'panel-managed', createdAt: now,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}46`]: {
          tabId: 46, disposition: 'panel-managed', createdAt: now - 5 * 60 * 1000,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}47`]: {
          tabId: 47, disposition: 'panel-managed', createdAt: now + 1000,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}48`]: {
          tabId: 48, disposition: 'native', createdAt: now,
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}49`]: {
          tabId: 49, disposition: 'panel-managed', createdAt: 'not-a-time',
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}050`]: {
          tabId: 50, disposition: 'panel-managed', createdAt: now,
        },
        [`${LIFECYCLE_EVENT_PREFIX}malformed`]: {
          tabId: '', removedTabId: false, addedTabId: -1, tab: { id: 1.5 },
        },
        [`${LIFECYCLE_SUPPRESSION_PREFIX}invalid`]: null,
        unrelated: { tabId: 99 },
      },
    },
  });

  const listed = await background.send({ type: 'tabs:list' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.pendingLifecycleTabIds, [41, 42, 43]);
  assert.deepEqual(listed.suppressedLifecycleTabIds, [41, 44]);
});

test('onRemoved reserves its tab before suppression lookup so tabs:list cannot erase an in-flight close', async () => {
  const suppressionKey = `${LIFECYCLE_SUPPRESSION_PREFIX}77`;
  let releaseSuppressionRead;
  const behavior = {
    'storage.session.get': (keys) => {
      if (keys === suppressionKey) {
        return new Promise((resolve) => { releaseSuppressionRead = resolve; });
      }
      return {};
    },
  };
  const webLock = createControllableWebLock({ blocked: true });
  const background = await loadBackground({
    tabs: [makeTab(1)],
    storage: lifecycleStorage(),
    behavior,
    webLock,
  });

  background.emitRemoved(77, { windowId: 1, isWindowClosing: false });
  await waitFor(() => typeof releaseSuppressionRead === 'function');
  assert.equal(lifecycleJournalWriteCount(background), 0);
  const listed = await background.send({ type: 'tabs:list' });
  assert.deepEqual(listed.pendingLifecycleTabIds, [77]);
  assert.deepEqual(listed.suppressedLifecycleTabIds, []);
  assert.equal(webLock.pendingCount, 0, 'listing pending ids does not wait for the shared state lock');

  releaseSuppressionRead({});
  await waitFor(() => lifecycleJournalWriteCount(background) === 1);
  delete behavior['storage.session.get'];
  await waitFor(() => webLock.pendingCount === 1);
  webLock.releaseAll();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  await settleAsyncWork();
});

test('tabs:list retains a replaced event when its session read raced with journal persistence', async () => {
  let releaseStaleSessionRead;
  const behavior = {
    'storage.session.get': (keys) => {
      if (keys === null) {
        return new Promise((resolve) => { releaseStaleSessionRead = resolve; });
      }
      return {};
    },
  };
  const webLock = createControllableWebLock({ blocked: true });
  const background = await loadBackground({
    tabs: [makeTab(82)],
    storage: lifecycleStorage(),
    behavior,
    webLock,
  });

  const listing = background.send({ type: 'tabs:list' });
  await waitFor(() => typeof releaseStaleSessionRead === 'function');
  background.emitReplaced(82, 81);
  await waitFor(() => lifecycleJournalWriteCount(background) === 1);
  releaseStaleSessionRead({});

  const listed = await listing;
  assert.deepEqual(listed.pendingLifecycleTabIds, [81, 82]);
  assert.deepEqual(listed.suppressedLifecycleTabIds, []);
  assert.equal(webLock.pendingCount, 1, 'only the lifecycle drain waits for the shared state lock');

  delete behavior['storage.session.get'];
  webLock.releaseAll();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  await settleAsyncWork();
});

test('empty tab listings do not expose unrelated groups', async () => {
  const background = await loadBackground({
    tabs: [makeTab(1, { url: '', pendingUrl: '', windowId: 1 })],
    groups: [makeGroup(2, { windowId: 7 })],
  });
  const listed = await background.send({ type: 'tabs:list', windowId: 'not-a-window' });
  assert.deepEqual(listed.tabs.map((tab) => tab.id), [1]);
  assert.equal(listed.tabs[0].url, '');
  assert.deepEqual(listed.groups, []);
  assert.deepEqual(listed.allTabs.map((tab) => tab.id), [1]);
  const all = await background.send({ type: 'tabs:listAll' });
  assert.deepEqual(all.tabs.map((tab) => tab.id), [1]);
  assert.deepEqual(all.allChromeTabs.map((tab) => tab.id), [1]);
  assert.deepEqual(all.groups, []);

  background.tabs.clear();
  const noWindowContext = await background.send({ type: 'tabs:list', windowId: 'still-invalid' });
  assert.deepEqual(noWindowContext.tabs, []);
  assert.deepEqual(noWindowContext.groups, []);
});

test('creates tabs with browser defaults and respects a valid target window', async () => {
  const background = await loadBackground();
  const first = await background.send({ type: 'tabs:create' });
  assert.equal(first.tab.url, 'chrome://newtab');
  assert.equal(first.tab.active, true);
  assert.deepEqual(background.calls.at(-1), ['tabs.create', { url: 'chrome://newtab', active: true }]);

  const second = await background.send({ type: 'tabs:create', url: 'https://created.test', active: false, windowId: '12' });
  assert.equal(second.tab.windowId, 12);
  assert.equal(second.tab.active, false);
  assert.deepEqual(background.calls.at(-1), ['tabs.create', {
    url: 'https://created.test',
    active: false,
    windowId: 12,
  }]);
});

test('openUnique creates once, then reuses the preferred tab, ungroups it, closes duplicates, and focuses its window', async () => {
  const tabs = [
    makeTab(1, { windowId: 5, index: 0, url: 'https://app.test/old', groupId: 44 }),
    makeTab(2, { windowId: 5, index: 1, url: 'https://app.test/duplicate', active: true }),
    makeTab(3, { windowId: 6, index: 0, url: 'https://app.test/other-window' }),
  ];
  const background = await loadBackground({ tabs, groups: [makeGroup(44, { windowId: 5 })] });
  const reused = await background.send({
    type: 'tabs:openUnique',
    url: 'https://app.test/current',
    matchUrl: 'https://app.test/',
    preferredTabId: 1,
    windowId: 5,
  });
  assert.equal(reused.ok, true);
  assert.equal(reused.reused, true);
  assert.equal(reused.closedDuplicates, 1);
  assert.equal(reused.tab.id, 1);
  assert.equal(reused.tab.url, 'https://app.test/current');
  assert.equal(reused.tab.groupId, -1);
  assert.equal(background.tabs.has(2), false);
  assert.equal(background.tabs.has(3), true, 'another window is outside the unique-tab scope');
  assert.ok(background.calls.some((call) => call[0] === 'windows.update' && call[1] === 5));

  const created = await background.send({
    type: 'tabs:openUnique',
    url: 'https://new-app.test/',
    windowId: 6,
  });
  assert.equal(created.reused, false);
  assert.equal(created.tab.windowId, 6);
});

test('openUnique chooses an active or first match and tolerates focus failures', async () => {
  const tabs = [
    makeTab(10, { url: 'https://reuse.test/a', active: false, windowId: 2 }),
    makeTab(11, { url: 'https://reuse.test/b', active: true, windowId: 2 }),
  ];
  const background = await loadBackground({
    tabs,
    behavior: {
      'windows.update': async () => { throw new Error('focus denied'); },
    },
  });
  const active = await background.send({
    type: 'tabs:openUnique',
    url: 'https://reuse.test/b',
    matchUrl: 'https://reuse.test/',
    preferredTabId: 'bad',
  }, { tab: { id: 999 } });
  assert.equal(active.tab.id, 11);
  assert.equal(active.closedDuplicates, 1);

  background.tabs.set(12, makeTab(12, { url: 'https://first.test/a', windowId: undefined }));
  const first = await background.send({
    type: 'tabs:openUnique',
    url: 'https://first.test/a',
    matchUrl: 'https://first.test/',
  });
  assert.equal(first.tab.id, 12);
  assert.equal(first.closedDuplicates, 0);

  background.tabs.set(13, makeTab(13, { url: 'https://fallback-match.test/', windowId: 4 }));
  const emptyMatchUrl = await background.send({
    type: 'tabs:openUnique',
    url: 'https://fallback-match.test/',
    matchUrl: '',
    windowId: 4,
  });
  assert.equal(emptyMatchUrl.tab.id, 13);

  background.tabs.set(14, makeTab(14, { url: 'https://empty-target.test/', windowId: 4 }));
  const emptyTargetUrl = await background.send({
    type: 'tabs:openUnique',
    url: '',
    matchUrl: 'https://empty-target.test/',
    windowId: 4,
  });
  assert.equal(emptyTargetUrl.tab.id, 14);
  assert.equal(emptyTargetUrl.tab.url, '');
});

test('tab focus, duplicate, discard, and close return serialized observable state', async () => {
  const background = await loadBackground({
    tabs: [makeTab(1, { windowId: 3 }), makeTab(2, { windowId: undefined })],
    behavior: {
      'windows.update': async () => { throw new Error('OS refused focus'); },
    },
  });

  const focused = await background.send({ type: 'tabs:focus', tabId: '1' });
  assert.deepEqual(focused, { ok: false, error: 'OS refused focus' });
  assert.equal(background.tabs.get(1).active, true);
  const tabActivationIndex = background.calls.findIndex(([name, tabId, update]) => (
    name === 'tabs.update' && Number(tabId) === 1 && update?.active === true
  ));
  const owningWindowFocusIndex = background.calls.findIndex(([name, windowId, update]) => (
    name === 'windows.update' && Number(windowId) === 3 && update?.focused === true
  ));
  assert.ok(
    tabActivationIndex >= 0 && owningWindowFocusIndex > tabActivationIndex,
    'cross-window focus activates the exact tab before focusing its owning window',
  );
  const focusedWithoutWindow = await background.send({ type: 'tabs:focus', tabId: 2 });
  assert.equal(focusedWithoutWindow.tab.id, 2);

  const duplicated = await background.send({ type: 'tabs:duplicate', tabId: 1 });
  assert.equal(duplicated.tab.title, 'Tab 1');
  assert.notEqual(duplicated.tab.id, 1);
  assert.equal(duplicated.tab.active, true);

  const discarded = await background.send({ type: 'tabs:discard', tabId: 1 });
  assert.equal(discarded.tab.id, 1);
  assert.equal(background.tabs.get(1).discarded, true);

  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 1 }), { ok: true });
  assert.equal(background.tabs.has(1), false);
});

test('tab focus confirms the owning window without misreporting partial success', async () => {
  const immediate = await loadBackground({
    tabs: [makeTab(20, { windowId: 4 })],
  });
  const immediateResponse = await immediate.send({ type: 'tabs:focus', tabId: 20 });
  assert.equal(immediateResponse.focusConfirmed, true);
  assert.equal(
    immediate.calls.some(([name]) => name === 'windows.get'),
    false,
    'the Window returned as focused is a reliable fast path',
  );

  let delayedPolls = 0;
  const delayed = await loadBackground({
    tabs: [makeTab(21, { windowId: 5 })],
    behavior: {
      'windows.update': async (windowId) => ({ id: windowId, focused: false }),
      'windows.get': async (windowId) => ({
        id: windowId,
        focused: ++delayedPolls >= 2,
      }),
    },
  });
  const delayedResponse = await delayed.send({ type: 'tabs:focus', tabId: 21 });
  assert.equal(delayedResponse.focusConfirmed, true);
  assert.equal(delayedPolls, 2, 'asynchronous native focus receives a bounded confirmation window');

  const unconfirmed = await loadBackground({
    tabs: [makeTab(22, { windowId: 6 })],
    behavior: {
      'windows.update': async (windowId) => ({ id: windowId, focused: false }),
      'windows.get': async (windowId) => ({ id: windowId, focused: false }),
    },
  });
  const unconfirmedResponse = await unconfirmed.send({ type: 'tabs:focus', tabId: 22 });
  assert.equal(unconfirmedResponse.tab.id, 22);
  assert.equal(unconfirmedResponse.focusConfirmed, false);
  assert.equal(
    unconfirmed.calls.filter(([name]) => name === 'windows.get').length,
    5,
    'focus confirmation is bounded and never repeatedly steals focus',
  );

  const disappeared = await loadBackground({
    tabs: [makeTab(23, { windowId: 7 })],
    behavior: {
      'windows.update': async (windowId) => ({ id: windowId, focused: false }),
      'windows.get': async (windowId) => { throw missingWindow(windowId); },
    },
  });
  const disappearedResponse = await disappeared.send({ type: 'tabs:focus', tabId: 23 });
  assert.deepEqual(disappearedResponse, {
    ok: false,
    error: 'No window with id: 7',
  });

  const inspectionFailure = await loadBackground({
    tabs: [makeTab(24, { windowId: 8 })],
    behavior: {
      'windows.update': async (windowId) => ({ id: windowId, focused: false }),
      'windows.get': async () => { throw new Error('Window inspection denied'); },
    },
  });
  assert.deepEqual(await inspectionFailure.send({ type: 'tabs:focus', tabId: 24 }), {
    ok: false,
    error: 'Window inspection denied',
  });
});

test('guarded Command Palette focus refuses stale physical tabs before window focus', async () => {
  const tab = makeTab(25, {
    windowId: 8,
    groupId: 4,
    url: 'https://selected.test/',
  });
  const guard = {
    tabId: 25,
    windowId: 8,
    groupId: 4,
    url: tab.url,
  };
  const background = await loadBackground({ tabs: [tab] });
  const focus = (focusGuard, skipChanged = true, tabId = 25) => background.send({
    type: 'tabs:focus',
    tabId,
    focusGuard,
    skipChanged,
  });

  assert.equal((await focus(guard)).tab.id, 25);
  assert.deepEqual(await focus({ ...guard, url: 'https://stale.test/' }), {
    ok: true,
    tab: null,
    skipped: true,
    reason: 'navigated',
  });
  assert.deepEqual(await focus({ ...guard, tabId: 99 }, true, 99), {
    ok: true,
    tab: null,
    skipped: true,
    reason: 'missing-or-replaced',
  });
  assert.deepEqual(await focus({ ...guard, windowId: 99 }, false), {
    ok: false,
    error: 'That tab changed before it could be focused. Open the Command Palette and choose it again.',
  });

  background.behavior['tabs.update'] = async () => ({
    ...tab,
    active: true,
    url: 'https://raced.test/',
  });
  assert.deepEqual(await focus(guard), {
    ok: true,
    tab: null,
    skipped: true,
    reason: 'navigated',
  });
  assert.equal(
    background.calls.filter(([name]) => name === 'windows.update').length,
    1,
    'only the fresh focus reaches the owning-window focus call',
  );

  background.behavior['tabs.get'] = async () => { throw new Error('Tabs permission denied'); };
  assert.deepEqual(await focus(guard), { ok: false, error: 'Tabs permission denied' });
});

test('guarded closes reject replacement, pin, move, and navigation races before removal', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(10, { pinned: true }),
      makeTab(11, { windowId: 9 }),
      makeTab(12, { groupId: 4 }),
      makeTab(13, { pendingUrl: 'https://loading.test/' }),
    ],
  });
  const changedError = /tab changed after deletion was confirmed/i;
  const guarded = (tabId, overrides = {}) => background.send({
    type: 'tabs:close',
    tabId,
    closeGuard: {
      tabId,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: `https://example.test/${tabId}`,
      ...overrides,
    },
  });

  for (const tabId of [10, 11, 12, 13, 99]) {
    const response = await guarded(tabId);
    assert.equal(response.ok, false);
    assert.match(response.error, changedError);
  }
  background.behavior['tabs.get'] = async () => { throw new Error('Tabs permission denied'); };
  assert.deepEqual(await guarded(10), { ok: false, error: 'Tabs permission denied' });
  delete background.behavior['tabs.get'];
  assert.deepEqual([...background.tabs.keys()].sort((left, right) => left - right), [10, 11, 12, 13]);
  assert.equal(background.calls.some(([name]) => name === 'tabs.remove'), false);
});

test('guarded batch closes report changed targets as protected skips with exact reasons', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(14, { pinned: true }),
      makeTab(15, { windowId: 2 }),
      makeTab(16, { groupId: 6 }),
      makeTab(17, { url: 'https://changed.test/' }),
      makeTab(18),
    ],
  });
  const close = (tabId) => background.send({
    type: 'tabs:close',
    tabId,
    skipChanged: true,
    closeGuard: {
      tabId,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: `https://example.test/${tabId}`,
    },
  });

  assert.deepEqual(await close(14), { ok: true, skipped: true, reason: 'pinned' });
  assert.deepEqual(await close(15), { ok: true, skipped: true, reason: 'moved-window' });
  assert.deepEqual(await close(16), { ok: true, skipped: true, reason: 'moved-group' });
  assert.deepEqual(await close(17), { ok: true, skipped: true, reason: 'navigated' });
  assert.deepEqual(await close(99), { ok: true, skipped: true, reason: 'missing-or-replaced' });
  assert.deepEqual(await close(18), { ok: true });
  assert.deepEqual([...background.tabs.keys()].sort((left, right) => left - right), [14, 15, 16, 17]);
});

test('required active close survivors protect both snapshot preservation paths before removal', async () => {
  const targetId = 60;
  const cases = [
    {
      name: 'active survivor',
      survivorId: 61,
      tabs: [makeTab(targetId), makeTab(61, { active: true })],
      reason: null,
    },
    {
      name: 'missing survivor',
      survivorId: 62,
      tabs: [makeTab(targetId)],
      reason: 'survivor-missing',
    },
    {
      name: 'inactive survivor',
      survivorId: 63,
      tabs: [makeTab(targetId), makeTab(63)],
      reason: 'survivor-not-active',
    },
    {
      name: 'cross-window survivor',
      survivorId: 64,
      tabs: [makeTab(targetId), makeTab(64, { active: true, windowId: 2 })],
      reason: 'survivor-wrong-window',
    },
    {
      name: 'closing tab as survivor',
      survivorId: targetId,
      tabs: [makeTab(targetId, { active: true })],
      reason: 'survivor-same-tab',
    },
  ];

  for (const preserveSnapshot of [true, false]) {
    for (const entry of cases) {
      const background = await loadBackground({
        tabs: entry.tabs,
        storage: preserveSnapshot ? { local: {}, session: {} } : false,
      });
      const response = await background.send({
        type: 'tabs:close',
        tabId: targetId,
        preserveSnapshot,
        requiredActiveSurvivorTabId: entry.survivorId,
        skipChanged: true,
        closeGuard: {
          tabId: targetId,
          requireUnpinned: true,
          windowId: 1,
          groupId: -1,
          url: `https://example.test/${targetId}`,
        },
      });
      const label = `${entry.name}, preserveSnapshot=${preserveSnapshot}`;
      const removeIndex = background.calls.findIndex(([name]) => name === 'tabs.remove');

      if (entry.reason) {
        assert.deepEqual(response, {
          ok: true,
          skipped: true,
          reason: entry.reason,
        }, label);
        assert.equal(background.tabs.has(targetId), true, label);
        assert.equal(removeIndex, -1, label);
        if (preserveSnapshot) {
          assert.equal(
            background.calls.some(([name]) => name === 'storage.session.remove'),
            true,
            `${label} cleans its suppression marker`,
          );
        }
        continue;
      }

      assert.deepEqual(response, { ok: true }, label);
      assert.equal(background.tabs.has(targetId), false, label);
      assert.equal(background.tabs.has(entry.survivorId), true, label);
      const survivorReadIndex = background.calls.findLastIndex(([name, id]) => (
        name === 'tabs.get' && Number(id) === entry.survivorId
      ));
      assert.ok(survivorReadIndex >= 0 && survivorReadIndex < removeIndex, label);
    }
  }
});

test('active survivor checks follow close guards and fail closed on invalid or unreadable identities', async () => {
  const invalid = await loadBackground({
    tabs: [makeTab(70), makeTab(71, { active: true })],
    storage: false,
  });
  assert.deepEqual(await invalid.send({
    type: 'tabs:close',
    tabId: 70,
    preserveSnapshot: false,
    requiredActiveSurvivorTabId: 'not-a-tab',
    skipChanged: true,
    closeGuard: {
      tabId: 70,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://example.test/70',
    },
  }), { ok: true, skipped: true, reason: 'survivor-missing' });
  assert.equal(invalid.calls.some(([name]) => name === 'tabs.remove'), false);

  const staleGuard = await loadBackground({
    tabs: [makeTab(72), makeTab(73, { active: true })],
    storage: false,
  });
  assert.deepEqual(await staleGuard.send({
    type: 'tabs:close',
    tabId: 72,
    preserveSnapshot: false,
    requiredActiveSurvivorTabId: 73,
    skipChanged: true,
    closeGuard: {
      tabId: 72,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://stale.test/',
    },
  }), { ok: true, skipped: true, reason: 'navigated' });
  assert.deepEqual(
    staleGuard.calls.filter(([name]) => name === 'tabs.get').map(([, id]) => id),
    [72],
  );
  assert.equal(staleGuard.calls.some(([name]) => name === 'tabs.remove'), false);

  let denied;
  denied = await loadBackground({
    tabs: [makeTab(74), makeTab(75, { active: true })],
    storage: false,
    behavior: {
      'tabs.get': async (tabId) => {
        if (Number(tabId) === 75) throw new Error('Survivor lookup denied');
        return { ...denied.tabs.get(Number(tabId)) };
      },
    },
  });
  assert.deepEqual(await denied.send({
    type: 'tabs:close',
    tabId: 74,
    preserveSnapshot: false,
    requiredActiveSurvivorTabId: 75,
    closeGuard: {
      tabId: 74,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://example.test/74',
    },
  }), { ok: false, error: 'Survivor lookup denied' });
  assert.equal(denied.calls.some(([name]) => name === 'tabs.remove'), false);

  let lateInactive;
  lateInactive = await loadBackground({
    tabs: [makeTab(76), makeTab(77, { active: true })],
    storage: { local: {}, session: {} },
    behavior: {
      'storage.session.set': async () => {
        lateInactive.tabs.get(77).active = false;
      },
    },
  });
  assert.deepEqual(await lateInactive.send({
    type: 'tabs:close',
    tabId: 76,
    requiredActiveSurvivorTabId: 77,
    skipChanged: true,
    closeGuard: {
      tabId: 76,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://example.test/76',
    },
  }), { ok: true, skipped: true, reason: 'survivor-not-active' });
  assert.equal(lateInactive.calls.some(([name]) => name === 'tabs.remove'), false);
  assert.equal(lateInactive.calls.some(([name]) => name === 'storage.session.remove'), true);
});

test('required target guards keep every materialized Space sibling in place until physical removal', async () => {
  const targetGuard = { tabId: 82, windowId: 1, groupId: 7 };
  for (const preserveSnapshot of [true, false]) {
    const valid = await loadBackground({
      tabs: [makeTab(80), makeTab(81, { active: true }), makeTab(82, { groupId: 7 })],
      storage: preserveSnapshot ? { local: {}, session: {} } : false,
    });
    assert.deepEqual(await valid.send({
      type: 'tabs:close',
      tabId: 80,
      preserveSnapshot,
      requiredActiveSurvivorTabId: 81,
      requiredTargetTabGuards: [targetGuard],
      skipChanged: true,
    }), { ok: true });
    assert.equal(valid.tabs.has(80), false);

    const changed = await loadBackground({
      tabs: [makeTab(80), makeTab(81, { active: true }), makeTab(82, { groupId: 8 })],
      storage: preserveSnapshot ? { local: {}, session: {} } : false,
    });
    assert.deepEqual(await changed.send({
      type: 'tabs:close',
      tabId: 80,
      preserveSnapshot,
      requiredActiveSurvivorTabId: 81,
      requiredTargetTabGuards: [targetGuard],
      skipChanged: true,
    }), { ok: true, skipped: true, reason: 'target-wrong-group' });
    assert.equal(changed.tabs.has(80), true);
    assert.equal(changed.calls.some(([name]) => name === 'tabs.remove'), false);
    if (preserveSnapshot) {
      assert.equal(changed.calls.some(([name]) => name === 'storage.session.remove'), true);
    }
  }

  const invalidCases = [
    { guards: {}, reason: 'target-missing' },
    { guards: Array.from({ length: 513 }, () => targetGuard), reason: 'target-missing' },
    { guards: [{ ...targetGuard, tabId: 'invalid' }], reason: 'target-missing' },
    { guards: [{ ...targetGuard, tabId: 80 }], reason: 'target-missing' },
    { guards: [targetGuard, targetGuard], reason: 'target-missing' },
    { guards: [{ ...targetGuard, windowId: 'invalid' }], reason: 'target-missing' },
    { guards: [{ ...targetGuard, groupId: 1.5 }], reason: 'target-missing' },
    { guards: [{ ...targetGuard, groupId: -2 }], reason: 'target-missing' },
    { guards: [{ ...targetGuard, tabId: 99 }], reason: 'target-missing' },
    { guards: [{ ...targetGuard, windowId: 2 }], reason: 'target-wrong-window' },
    { guards: [{ ...targetGuard, groupId: -1 }], reason: 'target-wrong-group' },
  ];
  for (const entry of invalidCases) {
    const background = await loadBackground({
      tabs: [makeTab(80), makeTab(82, { groupId: 7 })],
      storage: false,
    });
    assert.deepEqual(await background.send({
      type: 'tabs:close',
      tabId: 80,
      preserveSnapshot: false,
      requiredTargetTabGuards: entry.guards,
      skipChanged: true,
    }), { ok: true, skipped: true, reason: entry.reason });
    assert.equal(background.tabs.has(80), true);
  }

  const empty = await loadBackground({ tabs: [makeTab(80)], storage: false });
  assert.deepEqual(await empty.send({
    type: 'tabs:close',
    tabId: 80,
    preserveSnapshot: false,
    requiredTargetTabGuards: [],
  }), { ok: true });

  let denied;
  denied = await loadBackground({
    tabs: [makeTab(80), makeTab(82, { groupId: 7 })],
    storage: false,
    behavior: {
      'tabs.get': async (tabId) => {
        if (Number(tabId) === 82) throw new Error('Target lookup denied');
        return { ...denied.tabs.get(Number(tabId)) };
      },
    },
  });
  assert.deepEqual(await denied.send({
    type: 'tabs:close',
    tabId: 80,
    preserveSnapshot: false,
    requiredTargetTabGuards: [targetGuard],
  }), { ok: false, error: 'Target lookup denied' });
  assert.equal(denied.tabs.has(80), true);
});

test('guarded close rechecks after suppression persistence and cleans suppression on a late race', async () => {
  let background;
  background = await loadBackground({
    tabs: [makeTab(20)],
    storage: { local: {}, session: {} },
    behavior: {
      'storage.session.set': async () => {
        background.tabs.get(20).pinned = true;
      },
    },
  });

  const response = await background.send({
    type: 'tabs:close',
    tabId: 20,
    closeGuard: {
      tabId: 20,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://example.test/20',
    },
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /tab changed after deletion was confirmed/i);
  assert.equal(background.tabs.has(20), true);
  assert.equal(background.calls.filter(([name]) => name === 'tabs.get').length, 2);
  assert.equal(background.calls.some(([name]) => name === 'storage.session.remove'), true);
  assert.equal(background.calls.some(([name]) => name === 'tabs.remove'), false);

  let skipping;
  skipping = await loadBackground({
    tabs: [makeTab(21)],
    storage: { local: {}, session: {} },
    behavior: {
      'storage.session.set': async () => {
        skipping.tabs.get(21).groupId = 5;
      },
    },
  });
  const skipped = await skipping.send({
    type: 'tabs:close',
    tabId: 21,
    skipChanged: true,
    closeGuard: {
      tabId: 21,
      requireUnpinned: true,
      windowId: 1,
      groupId: -1,
      url: 'https://example.test/21',
    },
  });
  assert.deepEqual(skipped, { ok: true, skipped: true, reason: 'moved-group' });
  assert.equal(skipping.tabs.has(21), true);
  assert.equal(skipping.calls.some(([name]) => name === 'storage.session.remove'), true);
  assert.equal(skipping.calls.some(([name]) => name === 'tabs.remove'), false);
});

test('the final background guard preserves tabs changed after inspection but before removal', async () => {
  const cases = [
    {
      name: 'pin',
      reason: 'pinned',
      mutate: (background, tabId) => { background.tabs.get(tabId).pinned = true; },
    },
    {
      name: 'group move',
      reason: 'moved-group',
      mutate: (background, tabId) => { background.tabs.get(tabId).groupId = 8; },
    },
    {
      name: 'window move',
      reason: 'moved-window',
      mutate: (background, tabId) => { background.tabs.get(tabId).windowId = 2; },
    },
    {
      name: 'navigation',
      reason: 'navigated',
      mutate: (background, tabId) => { background.tabs.get(tabId).url = 'https://late-navigation.test/'; },
    },
    {
      name: 'replacement',
      reason: 'missing-or-replaced',
      mutate: (background, tabId) => {
        const replacement = { ...background.tabs.get(tabId), id: tabId + 100 };
        background.tabs.delete(tabId);
        background.tabs.set(replacement.id, replacement);
      },
    },
  ];

  for (const [index, entry] of cases.entries()) {
    const tabId = 40 + index;
    let background;
    background = await loadBackground({
      tabs: [makeTab(tabId)],
      storage: { local: {}, session: {} },
      behavior: {
        'storage.session.set': async () => entry.mutate(background, tabId),
      },
    });
    const response = await background.send({
      type: 'tabs:close',
      tabId,
      skipChanged: true,
      closeGuard: {
        tabId,
        requireUnpinned: true,
        windowId: 1,
        groupId: -1,
        url: `https://example.test/${tabId}`,
      },
    });
    assert.deepEqual(response, {
      ok: true,
      skipped: true,
      reason: entry.reason,
    }, entry.name);
    assert.equal(background.calls.filter(([name]) => name === 'tabs.get').length, 2, entry.name);
    assert.equal(background.calls.some(([name]) => name === 'storage.session.remove'), true, entry.name);
    assert.equal(background.calls.some(([name]) => name === 'tabs.remove'), false, entry.name);
    if (entry.name === 'replacement') assert.equal(background.tabs.has(tabId + 100), true);
  }
});

test('guarded close succeeds without session storage and treats a remove-time disappearance as changed', async () => {
  const withoutSession = await loadBackground({
    tabs: [makeTab(30)],
    storage: false,
  });
  const closeGuard = {
    tabId: 30,
    requireUnpinned: true,
    windowId: 1,
    groupId: -1,
    url: 'https://example.test/30',
  };
  assert.deepEqual(await withoutSession.send({
    type: 'tabs:close',
    tabId: 30,
    closeGuard,
  }), { ok: true });
  assert.equal(withoutSession.tabs.has(30), false);

  const disappearing = await loadBackground({
    tabs: [makeTab(31)],
    behavior: {
      'tabs.remove': async () => { throw missingTab(31); },
    },
  });
  const response = await disappearing.send({
    type: 'tabs:close',
    tabId: 31,
    closeGuard: { ...closeGuard, tabId: 31, url: 'https://example.test/31' },
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /tab changed after deletion was confirmed/i);

  const skipDisappearing = await loadBackground({
    tabs: [makeTab(32)],
    behavior: {
      'tabs.remove': async () => { throw missingTab(32); },
    },
  });
  assert.deepEqual(await skipDisappearing.send({
    type: 'tabs:close',
    tabId: 32,
    skipChanged: true,
    closeGuard: { ...closeGuard, tabId: 32, url: 'https://example.test/32' },
  }), { ok: true, skipped: true, reason: 'missing-or-replaced' });
});

test('tab entity actions distinguish stale Chrome ids from real browser failures', async () => {
  const background = await loadBackground({ tabs: [] });
  assert.deepEqual(await background.send({ type: 'tabs:focus', tabId: 90 }), {
    ok: true, tab: null, missing: true,
  });
  assert.equal(
    background.calls.some(([name]) => name === 'windows.update'),
    false,
    'a missing target never focuses an unrelated window',
  );
  assert.deepEqual(await background.send({ type: 'tabs:duplicate', tabId: 90 }), {
    ok: true, tab: null, missing: true,
  });
  assert.deepEqual(await background.send({ type: 'tabs:discard', tabId: 90 }), {
    ok: true, tab: null, missing: true,
  });
  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 90 }), {
    ok: true, missing: true,
  });

  background.behavior['tabs.update'] = async () => { throw new Error('Tabs permission denied'); };
  assert.deepEqual(await background.send({ type: 'tabs:focus', tabId: 2 }), {
    ok: false, error: 'Tabs permission denied',
  });
  assert.equal(
    background.calls.some(([name]) => name === 'windows.update'),
    false,
    'a failed tab activation never focuses an unrelated window',
  );
  background.behavior['tabs.duplicate'] = async () => { throw new Error('Duplicate failed'); };
  assert.deepEqual(await background.send({ type: 'tabs:duplicate', tabId: 2 }), {
    ok: false, error: 'Duplicate failed',
  });
  background.behavior['tabs.discard'] = async () => { throw new Error('Discard failed'); };
  assert.deepEqual(await background.send({ type: 'tabs:discard', tabId: 2 }), {
    ok: false, error: 'Discard failed',
  });
  background.behavior['tabs.remove'] = async () => { throw new Error('Close failed'); };
  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 2 }), {
    ok: false, error: 'Close failed',
  });
  background.behavior['tabs.update'] = async () => { throw 'raw Chrome failure'; };
  assert.deepEqual(await background.send({ type: 'tabs:focus', tabId: 2 }), {
    ok: false, error: 'raw Chrome failure',
  });
});

test('creates and extends Chrome groups only with live same-window tabs and preserves safe title semantics', async () => {
  const longTitle = 'Research: this title has a long shared prefix and a unique suffix alpha';
  const background = await loadBackground({
    tabs: [makeTab(1, { windowId: 77 }), makeTab(2, { windowId: 77 })],
  });

  const grouped = await background.send({
    type: 'tabs:group',
    tabIds: [1, '2', 1, 'not-a-tab'],
    title: longTitle,
    color: 'purple',
    collapsed: 1,
  });
  assert.equal(grouped.ok, true);
  assert.equal(typeof grouped.groupId, 'number');
  const groupCall = background.calls.find((call) => call[0] === 'tabs.group');
  assert.deepEqual(groupCall, [
    'tabs.group',
    { tabIds: [1, 2], createProperties: { windowId: 77 } },
  ]);
  assert.equal(background.tabs.get(1).windowId, 77);
  assert.equal(background.tabs.get(2).windowId, 77);
  const updateCall = background.calls.find((call) => call[0] === 'tabGroups.update');
  assert.equal(updateCall[2].title.length, 32);
  assert.match(updateCall[2].title, /~[0-9a-f]{8}$/);
  assert.deepEqual(updateCall[2], { title: updateCall[2].title, color: 'purple', collapsed: true });

  const blankGroup = await background.send({
    type: 'tabs:group', tabIds: [1, 2], title: '', color: 'grey', collapsed: false,
  });
  assert.equal(blankGroup.ok, true);
  assert.deepEqual(background.calls.findLast(([name]) => name === 'tabGroups.update'), [
    'tabGroups.update', blankGroup.groupId, { title: '', color: 'grey', collapsed: false },
  ]);
  const nullTitleGroup = await background.send({
    type: 'tabs:group', tabIds: [1, 2], title: null, color: 'grey', collapsed: false,
  });
  assert.deepEqual(background.calls.findLast(([name]) => name === 'tabGroups.update'), [
    'tabGroups.update', nullTitleGroup.groupId, { title: '', color: 'grey', collapsed: false },
  ]);

  const extended = await background.send({
    type: 'tabs:groupExisting',
    groupId: String(grouped.groupId),
    tabIds: [1],
  });
  assert.deepEqual(extended, { ok: true, groupId: grouped.groupId });

  const callsAfterExtension = background.calls.filter((call) => call[0] === 'tabs.group').length;
  assert.deepEqual(await background.send({
    type: 'tabs:groupExisting',
    groupId: grouped.groupId,
    tabIds: [1],
  }), { ok: true, groupId: grouped.groupId });
  assert.equal(
    background.calls.filter((call) => call[0] === 'tabs.group').length,
    callsAfterExtension,
    'extending a group with tabs already in that group must be a physical no-op',
  );

  const groupCallCount = background.calls.filter((call) => call[0] === 'tabs.group').length;
  assert.deepEqual(await background.send({
    type: 'tabs:group',
    tabIds: [1, 999],
  }), { ok: true, groupId: null, missing: true });
  assert.deepEqual(await background.send({
    type: 'tabs:groupExisting',
    groupId: grouped.groupId,
    tabIds: [1, 999],
  }), { ok: true, groupId: null, missing: true });
  assert.equal(background.calls.filter((call) => call[0] === 'tabs.group').length, groupCallCount);

  assert.deepEqual(await background.send({ type: 'tabs:group', tabIds: [999] }), {
    ok: true, groupId: null, missing: true,
  });
  assert.deepEqual(await background.send({ type: 'tabs:groupExisting', groupId: 'bad', tabIds: [1] }), {
    ok: true, groupId: null, missing: false,
  });
  assert.deepEqual(await background.send({ type: 'tabs:groupExisting', groupId: grouped.groupId, tabIds: [999] }), {
    ok: true, groupId: null, missing: true,
  });

  const crossWindow = await loadBackground({
    tabs: [makeTab(10, { windowId: 77 }), makeTab(11, { windowId: 88 })],
  });
  assert.deepEqual(await crossWindow.send({ type: 'tabs:group', tabIds: [10, 11] }), {
    ok: false,
    error: 'Selected tabs must be in the same Chrome window.',
  });
  assert.equal(crossWindow.calls.some((call) => call[0] === 'tabs.group'), false);
});

test('group mutations normalize indexes and updates and expose stale-group recovery', async () => {
  const background = await loadBackground({
    tabs: [makeTab(1), makeTab(2)],
    groups: [makeGroup(8)],
  });
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: -1 }), { ok: true });
  assert.deepEqual(background.calls.at(-1), ['tabs.move', 1, { index: -1 }]);
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: '7' }), { ok: true });
  assert.deepEqual(background.calls.at(-1), ['tabs.move', 1, { index: 7 }]);
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: 2, windowId: '9' }), { ok: true });
  assert.deepEqual(background.calls.at(-1), ['tabs.move', 1, { index: 2, windowId: 9 }]);
  assert.equal(background.tabs.get(1).windowId, 9);

  for (const index of [-4, 1.5, 'bad', null, undefined]) {
    assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index }), {
      ok: false,
      error: 'A valid tab move index is required.',
    });
  }

  assert.deepEqual(await background.send({ type: 'tabs:ungroup', tabIds: [1, 999] }), {
    ok: true,
    missing: true,
  });
  assert.deepEqual(await background.send({ type: 'tabs:ungroup', tabIds: [999] }), { ok: true, missing: true });

  const updated = await background.send({
    type: 'groups:update',
    groupId: 8,
    update: { title: '   ', color: 'orange', collapsed: 'yes', ignored: true },
  });
  assert.deepEqual(updated.group, { id: 8, title: 'Group', color: 'orange', collapsed: true });
  assert.deepEqual(await background.send({ type: 'groups:update', groupId: 8 }), {
    ok: true,
    group: { id: 8, title: 'Group', color: 'orange', collapsed: true },
  });

  await background.send({ type: 'groups:update', groupId: 8, update: { title: '' } });
  assert.deepEqual(background.calls.findLast(([name]) => name === 'tabGroups.update'), [
    'tabGroups.update', 8, { title: '' },
  ]);
  assert.equal(background.groups.get(8).title, '');
  await background.send({ type: 'groups:update', groupId: 8, update: { title: null } });
  assert.deepEqual(background.calls.findLast(([name]) => name === 'tabGroups.update'), [
    'tabGroups.update', 8, { title: '' },
  ]);

  assert.deepEqual(await background.send({ type: 'groups:move', groupId: 8, index: 'bad' }), { ok: true });
  assert.deepEqual(background.calls.at(-1), ['tabGroups.move', 8, { index: 0 }]);

  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 999, index: 1 }), { ok: true, missing: true });
  assert.deepEqual(await background.send({ type: 'groups:update', groupId: 999, update: { color: 'red' } }), {
    ok: true, group: null, missing: true,
  });
  assert.deepEqual(await background.send({ type: 'groups:move', groupId: 999, index: 1 }), { ok: true, missing: true });
});

test('group operations propagate non-stale browser failures instead of pretending success', async () => {
  const background = await loadBackground({ tabs: [makeTab(1)], groups: [makeGroup(1)] });
  background.behavior['tabs.get'] = async () => { throw new Error('Query failed'); };
  assert.deepEqual(await background.send({ type: 'tabs:group', tabIds: [1] }), { ok: false, error: 'Query failed' });
  delete background.behavior['tabs.get'];

  background.behavior['tabs.group'] = async () => { throw missingTab(1); };
  assert.deepEqual(await background.send({ type: 'tabs:group', tabIds: [1] }), {
    ok: true, groupId: null, missing: true,
  });
  assert.deepEqual(await background.send({ type: 'tabs:groupExisting', groupId: 1, tabIds: [1] }), {
    ok: true, groupId: null, missing: true,
  });
  background.behavior['tabs.group'] = async () => { throw new Error('Grouping disabled'); };
  assert.deepEqual(await background.send({ type: 'tabs:group', tabIds: [1] }), {
    ok: false, error: 'Grouping disabled',
  });
  assert.deepEqual(await background.send({ type: 'tabs:groupExisting', groupId: 1, tabIds: [1] }), {
    ok: false, error: 'Grouping disabled',
  });

  background.behavior['tabs.move'] = async () => { throw new Error('Move blocked'); };
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: 0 }), { ok: false, error: 'Move blocked' });
  background.tabs.get(1).groupId = 1;
  background.behavior['tabs.ungroup'] = async () => { throw missingGroup(1); };
  assert.deepEqual(await background.send({ type: 'tabs:ungroup', tabIds: [1] }), { ok: true, missing: true });
  background.behavior['tabs.ungroup'] = async () => { throw new Error('Ungroup blocked'); };
  assert.deepEqual(await background.send({ type: 'tabs:ungroup', tabIds: [1] }), { ok: false, error: 'Ungroup blocked' });

  background.behavior['tabGroups.update'] = async () => { throw new Error('Update blocked'); };
  assert.deepEqual(await background.send({ type: 'groups:update', groupId: 1, update: {} }), {
    ok: false, error: 'Update blocked',
  });
  background.behavior['tabGroups.move'] = async () => { throw new Error('Move group blocked'); };
  assert.deepEqual(await background.send({ type: 'groups:move', groupId: 1, index: 1 }), {
    ok: false, error: 'Move group blocked',
  });
});

test('tab moves retry Chrome temporary user-dragging failures without hiding persistent errors', async () => {
  const background = await loadBackground({ tabs: [makeTab(1)] });
  let attempts = 0;
  background.behavior['tabs.move'] = async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
    }
    return [makeTab(1, { index: 4 })];
  };
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: 4 }), { ok: true });
  assert.equal(attempts, 3);

  attempts = 0;
  background.behavior['tabs.move'] = async () => {
    attempts += 1;
    throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
  };
  assert.deepEqual(await background.send({ type: 'tabs:move', tabId: 1, index: 4 }), {
    ok: false,
    error: 'Tabs cannot be edited right now (user may be dragging a tab).',
  });
  assert.equal(attempts, 3);
});

test('batch ungroup verifies every surviving tab and retries partial Chrome results', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(1, { groupId: 7 }),
      makeTab(2, { groupId: 7 }),
    ],
    groups: [makeGroup(7)],
  });
  let attempts = 0;
  background.behavior['tabs.ungroup'] = async (tabIds) => {
    attempts += 1;
    const ids = attempts === 1 ? tabIds.slice(0, 1) : tabIds;
    for (const id of ids) background.tabs.get(Number(id)).groupId = -1;
  };

  assert.deepEqual(await background.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(background.tabs.get(1).groupId, -1);
  assert.equal(background.tabs.get(2).groupId, -1);
});

test('batch ungroup refuses success when any requested tab is already missing', async () => {
  const background = await loadBackground({
    tabs: [makeTab(1, { groupId: 7 })],
    groups: [makeGroup(7)],
  });

  assert.deepEqual(await background.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), { ok: true, missing: true });
  assert.equal(background.calls.some((call) => call[0] === 'tabs.ungroup'), false);
  assert.equal(background.tabs.get(1).groupId, 7);
});

test('batch ungroup refuses success when Chrome leaves a tab grouped or it disappears', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(1, { groupId: 7 }),
      makeTab(2, { groupId: 7 }),
    ],
    groups: [makeGroup(7)],
  });
  let attempts = 0;
  background.behavior['tabs.ungroup'] = async () => { attempts += 1; };
  assert.deepEqual(await background.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), {
    ok: false,
    error: 'Chrome did not ungroup every selected tab. No Space change was saved.',
  });
  assert.equal(attempts, 3);

  background.behavior['tabs.ungroup'] = async () => {
    background.tabs.delete(2);
    background.tabs.get(1).groupId = -1;
  };
  assert.deepEqual(await background.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), { ok: true, missing: true });
});

test('relative tab moves recompute fresh indexes, enforce the target group, and verify placement', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(1, { index: 0 }),
      makeTab(2, { index: 1 }),
      makeTab(3, { index: 2 }),
    ],
  });
  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 3,
    edge: 'before',
    expectedGroupId: -1,
  }), { ok: true });
  assert.deepEqual([...background.tabs.values()]
    .sort((left, right) => left.index - right.index)
    .map((tab) => tab.id), [2, 1, 3]);
  assert.deepEqual(background.calls.findLast((call) => call[0] === 'tabs.move'), [
    'tabs.move', 1, { index: 1 },
  ]);

  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 3,
    edge: 'after',
    expectedGroupId: -1,
  }), { ok: true });
  assert.deepEqual([...background.tabs.values()]
    .sort((left, right) => left.index - right.index)
    .map((tab) => tab.id), [2, 3, 1]);

  background.tabs.get(3).groupId = 7;
  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 3,
    edge: 'before',
    expectedGroupId: -1,
  }), { ok: false, error: 'The target tab group changed while moving this tab.' });
  background.tabs.get(3).groupId = -1;
  background.tabs.get(3).windowId = 9;
  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 3,
    edge: 'before',
    expectedGroupId: -1,
  }), { ok: false, error: 'The source tab and target tab must be in the same Chrome window.' });
});

test('extracts readable http pages with deduplication, bounded options, fallback metadata, and per-page failures', async () => {
  const tabs = [
    makeTab(1, { title: 'One', url: 'https://one.test/' }),
    makeTab(2, { title: 'Two', pendingUrl: 'http://two.test/loading', url: '' }),
    makeTab(3, { title: 'Internal', url: 'chrome://settings' }),
    makeTab(4, { title: 'Blocked', url: 'https://blocked.test/' }),
  ];
  const background = await loadBackground({
    tabs,
    behavior: {
      'scripting.executeScript': async (details) => {
        if (details.target.tabId === 1) {
          assert.equal(details.args[0], 20000, 'per-page values are clamped to their maximum');
          return [{ result: {
            title: 'Article', url: 'https://one.test/', text: 'hello', charCount: 5,
            originalCharCount: 100, truncated: true,
          } }];
        }
        if (details.target.tabId === 2) return [{}];
        throw new Error('Cannot access this page');
      },
    },
  });
  const response = await background.send({
    type: 'pages:extract',
    tabIds: [1, '1', 2, 3, 4, 'bad'],
    options: { maxCharsPerPage: 999999, maxTotalChars: 999999 },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.pages.map((page) => page.tabId), [1, 2]);
  assert.equal(response.pages[1].title, 'Two');
  assert.equal(response.pages[1].url, 'http://two.test/loading');
  assert.equal(response.pages[1].text, '');
  assert.equal(response.totalChars, 5);
  assert.equal(response.truncated, true);
  assert.deepEqual(response.failures, [
    { tabId: 3, reason: 'read-failed', error: 'Only an http(s) current page can be read by Ask Page.' },
    { tabId: 4, reason: 'read-failed', error: 'Cannot access this page' },
  ]);
});

test('stops page extraction at the overall content budget and caps requests at 24 unique ids', async () => {
  const tabs = Array.from({ length: 30 }, (_, index) => makeTab(index + 1));
  const background = await loadBackground({
    tabs,
    behavior: {
      'scripting.executeScript': async (details) => [{ result: {
        title: 'Large',
        url: `https://example.test/${details.target.tabId}`,
        text: 'x'.repeat(1000),
        charCount: 1000,
        originalCharCount: 1000,
        truncated: false,
      } }],
    },
  });
  const response = await background.send({
    type: 'pages:extract',
    tabIds: tabs.map((tab) => tab.id),
    options: { maxCharsPerPage: 1, maxTotalChars: 1 },
  });
  assert.equal(response.pages.length, 1);
  assert.equal(response.failures.length, 23);
  assert.ok(response.failures.every((failure) => failure.reason === 'content-limit'));
  assert.equal(response.totalChars, 1000);
  assert.equal(response.truncated, false);
  assert.equal(background.calls.filter((call) => call[0] === 'scripting.executeScript').length, 1);
});

test('page extraction applies fallback limits and reports missing tabs cleanly', async () => {
  const background = await loadBackground({ tabs: [makeTab(1)] });
  const response = await background.send({
    type: 'pages:extract', tabIds: [1, 999], options: { maxCharsPerPage: 'nope', maxTotalChars: 'nope' },
  });
  assert.equal(response.pages.length, 1);
  assert.deepEqual(response.failures, [{ tabId: 999, reason: 'read-failed', error: 'No tab with id: 999' }]);
  const execute = background.calls.find((call) => call[0] === 'scripting.executeScript');
  assert.equal(execute[1].args[0], 12000);

  assert.deepEqual(await background.send({ type: 'pages:extract', tabIds: null }), {
    ok: true, pages: [], failures: [], totalChars: 0, truncated: false,
  });

  background.tabs.set(2, makeTab(2));
  background.behavior['scripting.executeScript'] = async () => { throw 'script injection failed'; };
  const rawFailure = await background.send({ type: 'pages:extract', tabIds: [2] });
  assert.deepEqual(rawFailure.failures, [{
    tabId: 2, reason: 'read-failed', error: 'script injection failed',
  }]);
});

test('AI chat sends a bounded OpenAI-compatible request and returns text, usage, and finish reason', async () => {
  const fetchCalls = [];
  const background = await loadBackground({
    fetch: async (url, init) => {
      fetchCalls.push([url, init]);
      return jsonResponse({
        choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
    },
  });
  const response = await background.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [{ role: 'user', content: 'Question' }],
    requestId: 'normal-request',
    stream: false,
    purpose: 'ask-page',
  });
  assert.deepEqual(response, {
    ok: true,
    text: 'Answer',
    usage: { prompt_tokens: 10, completion_tokens: 2 },
    finishReason: 'stop',
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], 'https://ai.example/v1/chat/completions');
  assert.equal(fetchCalls[0][1].method, 'POST');
  assert.equal(fetchCalls[0][1].headers.Authorization, 'Bearer secret');
  const body = JSON.parse(fetchCalls[0][1].body);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 32768);
  assert.equal(body.temperature, 0.25);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Question' }]);
  assert.equal(fetchCalls[0][1].signal instanceof AbortSignal, true);
});

test('AI chat validates purpose, item counts, and required API keys before network access', async () => {
  let fetchCount = 0;
  const background = await loadBackground({
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [] });
    },
  });
  assert.deepEqual(await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], purpose: '',
  }), { ok: false, error: 'Unsupported AI purpose: missing.' });
  assert.deepEqual(await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], purpose: 'auto-group', itemCount: -1,
  }), { ok: false, error: 'auto-group AI requests require a non-negative integer itemCount.' });
  assert.deepEqual(await background.send({
    type: 'ai:chat', settings: { ...aiSettings, apiKey: '' }, messages: [], purpose: 'test-ai',
  }), { ok: false, error: 'AI API key is missing. Add it in Settings.' });
  assert.equal(fetchCount, 0);
});

test('a local AI provider works without a key and missing response fields use stable defaults', async () => {
  const background = await loadBackground({
    fetch: async () => jsonResponse({ choices: [{ delta: { content: 'Local' } }] }),
  });
  const response = await background.send({
    type: 'ai:chat',
    settings: {
      provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen', apiKey: '',
    },
    messages: [],
    purpose: 'test-ai',
  });
  assert.deepEqual(response, { ok: true, text: 'Local', usage: null, finishReason: null });
});

test('AI HTTP failures preserve provider messages, invalid bodies, and generic status errors', async () => {
  const responses = [
    jsonResponse({ error: { code: 'model_not_found', message: 'Invalid model' } }, { ok: false, status: 400 }),
    jsonResponse({ message: 'Account disabled' }, { ok: false, status: 403 }),
    jsonResponse(null, { ok: false, status: 502, rawBody: '<html>gateway down</html>' }),
    jsonResponse({}, { ok: false, status: 503, rawBody: '{}' }),
    jsonResponse({ error: 'Quota unavailable' }, { ok: false, status: 429 }),
    jsonResponse({ message: 'Null code', code: null }, { ok: false, status: 400 }),
    jsonResponse({ error: { message: 'Blank code', code: '   ' } }, { ok: false, status: 400 }),
    jsonResponse({ message: 'Denied', code: 'request_denied' }, { ok: false, status: 401 }),
    jsonResponse(null, { ok: false, status: 503, rawBody: '', statusText: 'Service unavailable' }),
    jsonResponse(null, { ok: false, status: 520, rawBody: '', statusText: '' }),
  ];
  const background = await loadBackground({ fetch: async () => responses.shift() });
  const request = { type: 'ai:chat', settings: aiSettings, messages: [], purpose: 'test-ai' };
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 400, code model_not_found): Invalid model',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 403): Account disabled',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 502): <html>gateway down</html>',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 503): {}',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 429): Quota unavailable',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 400): Null code',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 400): Blank code',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 401, code request_denied): Denied',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 503): Service unavailable',
  });
  assert.deepEqual(await background.send(request), {
    ok: false,
    error: 'AI provider rejected the request (HTTP 520): Request failed',
  });
});

test('Z.ai account failures never jump silently to the Coding Plan endpoint', async () => {
  const urls = [];
  const background = await loadBackground({
    fetch: async (url) => {
      urls.push(url);
      return jsonResponse({ error: { message: '账户余额不足' } }, { ok: false, status: 429 });
    },
  });
  const response = await background.send({
    type: 'ai:chat',
    settings: {
      provider: 'z-ai',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      model: 'glm-5.2',
      apiKey: 'z-key',
      thinking: 'enabled',
    },
    messages: [],
    purpose: 'test-ai',
  });
  assert.deepEqual(response, {
    ok: false,
    error: 'AI provider rejected the request (HTTP 429): 账户余额不足',
  });
  assert.deepEqual(urls, ['https://api.z.ai/api/paas/v4/chat/completions']);
});

test('DeepSeek Disabled is serialized explicitly instead of enabling server defaults', async () => {
  let requestBody = null;
  const background = await loadBackground({
    fetch: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({ choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }] });
    },
  });
  const response = await background.send({
    type: 'ai:chat',
    settings: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: 'deepseek-key',
      thinking: 'disabled',
    },
    messages: [],
    purpose: 'test-ai',
  });

  assert.equal(response.text, 'Done');
  assert.deepEqual(requestBody.thinking, { type: 'disabled' });
});

test('streaming AI emits cumulative text and returns stream usage and finish reason', async () => {
  const stream = sseResponse([
    ': heartbeat\n',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: invalid-json\n\n',
    'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"length"}],"usage":{"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const background = await loadBackground({ fetch: async () => stream.response });
  const response = await background.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'stream-1',
    stream: true,
    purpose: 'ask-page',
  });
  assert.deepEqual(response, {
    ok: true,
    text: 'Hello',
    usage: { completion_tokens: 2 },
    finishReason: 'length',
  });
  assert.deepEqual(background.calls.filter((call) => call[0] === 'runtime.sendMessage'), [
    ['runtime.sendMessage', { type: 'ai:stream', requestId: 'stream-1', text: 'Hel' }],
    ['runtime.sendMessage', { type: 'ai:stream', requestId: 'stream-1', text: 'Hello' }],
  ]);
  assert.equal(stream.cancelCount, 1);
});

test('Ask begin durably arms pending recovery before provider dispatch and survives a session rekey', async () => {
  const fixture = askTurnStorage();
  let releaseAlarm;
  let fetchCount = 0;
  const background = await loadBackground({
    storage: fixture.storage,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [{ message: { content: 'Unexpected' } }] });
    },
    behavior: {
      'alarms.create': async () => new Promise((resolve) => {
        releaseAlarm = resolve;
      }),
    },
  });
  const beginning = background.send({
    type: 'ask:begin',
    askTurn: {
      sessionKey: fixture.projectedSession.key,
      prompt: 'What matters?',
      sourceTab: fixture.sourceTab,
      projectedSession: fixture.projectedSession,
      preparedSessionRevision: fixture.preparedSessionRevision,
      requestId: 'begin-before-provider',
      pruneOptions: {
        openTabIds: [fixture.sourceTab.id],
        openSessionKeys: [fixture.projectedSession.key],
        spaceIds: ['default'],
        inFlightKeys: [],
      },
    },
  });

  await waitFor(() => typeof releaseAlarm === 'function');
  const pendingWorkspace = background.storageLocal[STORAGE_KEY];
  const pending = pendingWorkspace.askSessions[fixture.projectedSession.key].messages.at(-1);
  assert.equal(pending.text, 'Thinking...');
  assert.deepEqual(pending.askStream, {
    requestId: 'begin-before-provider',
    status: 'pending',
    ownerId: '',
    startedAt: pending.askStream.startedAt,
    updatedAt: pending.askStream.updatedAt,
  });
  assert.equal(pendingWorkspace.ai.apiKey, '');
  assert.equal(Object.hasOwn(pendingWorkspace.ai, 'maxTokens'), false);
  assert.equal(fetchCount, 0);
  const setIndex = background.calls.findIndex(([name]) => name === 'storage.local.set');
  const alarmIndex = background.calls.findIndex(([name, alarmName]) => (
    name === 'alarms.create' && alarmName.endsWith('begin-before-provider')
  ));
  assert.ok(setIndex >= 0 && alarmIndex > setIndex, 'the request alarm is created only after pending is durable');

  releaseAlarm();
  const started = await beginning;
  assert.equal(started.ok, true);
  assert.equal(started.sessionKey, fixture.projectedSession.key);
  assert.equal(started.messageId, pending.id);
  assert.equal(started.requestId, 'begin-before-provider');

  const movedSessionKey = fixture.projectedSession.key.replace('tab:7:', 'tab:8:');
  const movedSession = pendingWorkspace.askSessions[fixture.projectedSession.key];
  delete pendingWorkspace.askSessions[fixture.projectedSession.key];
  movedSession.key = movedSessionKey;
  movedSession.tabId = 8;
  pendingWorkspace.askSessions[movedSessionKey] = movedSession;

  await background.emitAlarm('spaceTabsAskStreamRecovery:begin-before-provider');
  const recovered = background.storageLocal[STORAGE_KEY]
    .askSessions[movedSessionKey].messages.at(-1);
  assert.equal(recovered.askStream, undefined);
  assert.match(recovered.text, /Request interrupted before completion/);
  assert.equal(fetchCount, 0, 'a panel disappearing before ai:chat never contacts the provider');
});

test('Ask begin rejects invalid or stale prepared turns and compensates an alarm creation failure', async () => {
  const fixture = askTurnStorage();
  let fetchCount = 0;
  const background = await loadBackground({
    storage: fixture.storage,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [] });
    },
  });
  assert.match((await background.send({ type: 'ask:begin' })).error, /valid request id/);
  assert.match((await background.send({
    type: 'ask:begin',
    askTurn: { requestId: 'x'.repeat(513) },
  })).error, /valid request id/);
  assert.match((await background.send({
    type: 'ask:begin',
    askTurn: {
      sessionKey: 'tab:99:https://wrong.example/',
      sourceTab: fixture.sourceTab,
      projectedSession: fixture.projectedSession,
      preparedSessionRevision: fixture.preparedSessionRevision,
      requestId: 'wrong-session',
    },
  })).error, /no longer matches the current page/);
  assert.match((await background.send({
    type: 'ask:begin',
    askTurn: {
      sessionKey: fixture.projectedSession.key,
      sourceTab: fixture.sourceTab,
      projectedSession: fixture.projectedSession,
      requestId: 'stale-preparation',
    },
  })).error, /conversation changed before it could be sent/);
  assert.equal(fetchCount, 0);

  const writeFixture = askTurnStorage({ apiKey: '' });
  const writeFailure = await loadBackground({
    storage: writeFixture.storage,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [] });
    },
    behavior: {
      'storage.local.set': async () => { throw new Error('begin write failed'); },
    },
  });
  assert.match((await writeFailure.send({
    type: 'ask:begin',
    askTurn: {
      sessionKey: writeFixture.projectedSession.key,
      prompt: 'Never send this',
      sourceTab: writeFixture.sourceTab,
      projectedSession: writeFixture.projectedSession,
      preparedSessionRevision: writeFixture.preparedSessionRevision,
      requestId: 'begin-write-failure',
    },
  })).error, /begin write failed/);
  assert.equal(
    writeFailure.storageLocal[STORAGE_KEY]
      .askSessions[writeFixture.projectedSession.key].messages.length,
    1,
  );
  assert.equal(writeFailure.alarms.has('spaceTabsAskStreamRecovery:begin-write-failure'), false);
  assert.equal(fetchCount, 0);

  const alarmFixture = askTurnStorage();
  const alarmFailure = await loadBackground({
    storage: alarmFixture.storage,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [] });
    },
    behavior: {
      'alarms.create': async () => { throw new Error('alarm storage unavailable'); },
    },
  });
  assert.match((await alarmFailure.send({
    type: 'ask:begin',
    askTurn: {
      sessionKey: alarmFixture.projectedSession.key,
      prompt: '',
      sourceTab: alarmFixture.sourceTab,
      projectedSession: alarmFixture.projectedSession,
      preparedSessionRevision: alarmFixture.preparedSessionRevision,
      requestId: 'alarm-failure',
    },
  })).error, /alarm storage unavailable/);
  const compensated = alarmFailure.storageLocal[STORAGE_KEY]
    .askSessions[alarmFixture.projectedSession.key].messages.at(-1);
  assert.equal(compensated.askStream, undefined);
  assert.match(compensated.text, /Request interrupted before completion/);
  assert.equal(alarmFailure.alarms.has('spaceTabsAskStreamRecovery:alarm-failure'), false);
  assert.equal(fetchCount, 0);
});

test('background owns Ask stream checkpoints and final persistence after the panel disappears', async () => {
  const fixture = askStreamStorage({ requestId: 'durable-stream' });
  const encoder = new TextEncoder();
  let readCount = 0;
  let releaseCompletion;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount === 1) {
              return {
                done: false,
                value: encoder.encode([
                  'data: {"choices":[{"delta":{"content":"H"}}]}',
                  'data: {"choices":[{"delta":{"content":"e"}}]}',
                  'data: {"choices":[{"delta":{"content":"l"},"finish_reason":"stop"}]}',
                  '',
                ].join('\n')),
              };
            }
            if (readCount === 2) {
              return new Promise((resolve) => {
                releaseCompletion = () => resolve({
                  done: false,
                  value: encoder.encode('data: [DONE]\n\n'),
                });
              });
            }
            return { done: true, value: undefined };
          },
          async cancel() {},
        };
      },
    },
  };
  const background = await loadBackground({
    storage: fixture.storage,
    fetch: async () => response,
    behavior: {
      'runtime.sendMessage': async () => { throw new Error('Panel reloaded'); },
    },
  });
  const completion = background.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [{ role: 'user', content: 'PAGE_BODY_SENTINEL' }],
    stream: true,
    purpose: 'ask-page',
    askStream: fixture.binding,
  });

  await waitFor(() => typeof releaseCompletion === 'function');
  const partial = background.storageLocal[STORAGE_KEY]
    .askSessions[fixture.sessionKey].messages.find((message) => message.id === 'answer');
  assert.equal(partial.text, 'H', 'the first partial is durable without writing every token');
  assert.equal(partial.askStream.status, 'streaming');
  assert.notEqual(partial.askStream.ownerId, 'previous-worker');
  assert.equal(
    background.calls.filter(([name]) => name === 'storage.local.set').length,
    2,
    'claim plus one throttled partial checkpoint are durable before completion',
  );

  releaseCompletion();
  const completed = await completion;
  assert.equal(completed.askPersisted, true);
  assert.equal(completed.askStatus, 'complete');
  assert.equal(completed.text, 'Hel');
  const stored = background.storageLocal[STORAGE_KEY];
  const answer = stored.askSessions[fixture.sessionKey].messages
    .find((message) => message.id === 'answer');
  assert.equal(answer.askStream, undefined);
  assert.match(answer.text, /^Hel/);
  assert.match(answer.text, /### Sources/);
  assert.match(answer.text, /https:\/\/source\.example\/page/);
  const durableJSON = JSON.stringify(stored);
  assert.equal(durableJSON.includes('PAGE_BODY_SENTINEL'), false);
  assert.equal(durableJSON.includes(aiSettings.apiKey), false);
  assert.equal(stored.ai.apiKey, '');
  assert.equal(
    background.calls.filter(([name]) => name === 'storage.local.set').length,
    3,
    'the final write replaces the stream marker exactly once',
  );
  assert.ok(background.calls.some(([name, alarmName]) => (
    name === 'alarms.clear' && alarmName.endsWith('durable-stream')
  )));
});

test('a finalized Ask response stays successful and idempotent when alarm cleanup fails', async () => {
  const fixture = askStreamStorage({ requestId: 'clear-failure' });
  const background = await loadBackground({
    storage: fixture.storage,
    fetch: async () => jsonResponse({ choices: [{ message: { content: 'Durable final' } }] }),
    behavior: {
      'alarms.clear': async () => { throw new Error('alarm cleanup unavailable'); },
    },
  });
  const response = await background.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'clear-failure',
    stream: true,
    purpose: 'ask-page',
    askStream: fixture.binding,
  });
  assert.equal(response.ok, true);
  assert.equal(response.askPersisted, true);
  assert.equal(response.askStatus, 'complete');
  const finalBeforeRetry = cloneValue(background.storageLocal[STORAGE_KEY]);
  const writesBeforeRetry = background.calls.filter(([name]) => name === 'storage.local.set').length;
  assert.equal(finalBeforeRetry.askSessions[fixture.sessionKey].messages.at(-1).askStream, undefined);
  assert.match(finalBeforeRetry.askSessions[fixture.sessionKey].messages.at(-1).text, /^Durable final/);

  await background.emitAlarm('spaceTabsAskStreamRecovery:clear-failure');
  assert.deepEqual(background.storageLocal[STORAGE_KEY], finalBeforeRetry);
  assert.equal(
    background.calls.filter(([name]) => name === 'storage.local.set').length,
    writesBeforeRetry,
    'a stale uncleared alarm cannot rewrite a durably finalized answer',
  );
});

test('background persists explicit failed and stopped Ask outcomes instead of permanent Thinking rows', async () => {
  const failedFixture = askStreamStorage({ requestId: 'failed-stream' });
  const failed = await loadBackground({
    storage: failedFixture.storage,
    fetch: async () => { throw new TypeError('Provider offline'); },
  });
  const failedResponse = await failed.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'failed-stream',
    stream: true,
    purpose: 'ask-page',
    askStream: failedFixture.binding,
  });
  assert.equal(failedResponse.askPersisted, true);
  assert.equal(failedResponse.askStatus, 'failed');
  assert.equal(failedResponse.askError, 'Provider offline');
  const failedAnswer = failed.storageLocal[STORAGE_KEY]
    .askSessions[failedFixture.sessionKey].messages.at(-1);
  assert.equal(failedAnswer.askStream, undefined);
  assert.match(failedAnswer.text, /^Provider offline/);
  assert.match(failedAnswer.text, /### Sources/);

  const stoppedFixture = askStreamStorage({ requestId: 'stopped-stream' });
  const stopped = await loadBackground({
    storage: stoppedFixture.storage,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const stoppedCompletion = stopped.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'stopped-stream',
    stream: true,
    purpose: 'ask-page',
    askStream: stoppedFixture.binding,
  });
  await waitFor(() => stopped.calls.some(([name, alarmName]) => (
    name === 'alarms.create' && alarmName.endsWith('stopped-stream')
  )));
  await stopped.startup();
  assert.equal(
    stopped.storageLocal[STORAGE_KEY]
      .askSessions[stoppedFixture.sessionKey].messages.at(-1).askStream.status,
    'streaming',
    'worker-start recovery must preserve a request owned by this still-running worker',
  );
  await stopped.emitAlarm('unrelated-alarm');
  await stopped.emitAlarm('spaceTabsAskStreamRecovery:');
  await stopped.emitAlarm('spaceTabsAskStreamRecovery:stopped-stream');
  assert.deepEqual(await stopped.send({ type: 'ai:abort', requestId: 'stopped-stream' }), {
    ok: true,
    aborted: true,
  });
  const stoppedResponse = await stoppedCompletion;
  assert.equal(stoppedResponse.askPersisted, true);
  assert.equal(stoppedResponse.askStatus, 'stopped');
  const stoppedAnswer = stopped.storageLocal[STORAGE_KEY]
    .askSessions[stoppedFixture.sessionKey].messages.at(-1);
  assert.equal(stoppedAnswer.askStream, undefined);
  assert.match(stoppedAnswer.text, /^Request stopped before completion/);
  assert.ok(stopped.calls.filter(([name, alarmName]) => (
    name === 'alarms.create' && alarmName.endsWith('stopped-stream')
  )).length >= 2, 'an alarm firing while the request is active is rescheduled');
});

test('Ask Stop during durable stream claim never contacts the provider and persists a stopped answer', async () => {
  if (!registeredBackgroundListeners) {
    await loadBackground({
      storage: { local: { [STORAGE_KEY]: createDefaultState() }, session: {} },
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  const fixture = askStreamStorage({ requestId: 'stop-before-claim' });
  const webLock = createControllableWebLock();
  let fetchCount = 0;
  const background = await loadBackground({
    storage: fixture.storage,
    webLock,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [{ message: { content: 'Too late' } }] });
    },
  });
  webLock.hold();
  const completion = background.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'stop-before-claim',
    stream: true,
    purpose: 'ask-page',
    askStream: fixture.binding,
  });

  await waitFor(() => webLock.pendingCount === 1);
  assert.deepEqual(await background.send({ type: 'ai:abort', requestId: 'stop-before-claim' }), {
    ok: true,
    aborted: true,
  });
  webLock.releaseAll();

  const response = await completion;
  assert.equal(response.askPersisted, true);
  assert.equal(response.askStatus, 'stopped');
  assert.equal(fetchCount, 0);
  const answer = background.storageLocal[STORAGE_KEY]
    .askSessions[fixture.sessionKey].messages.at(-1);
  assert.equal(answer.askStream, undefined);
  assert.match(answer.text, /^Request stopped before completion/);
});

test('Ask recovery alarms convert a worker-owned partial to an interrupted answer', async () => {
  const fixture = askStreamStorage({
    requestId: 'orphaned-stream',
    text: 'Durable partial',
    status: 'streaming',
  });
  const background = await loadBackground({ storage: fixture.storage });
  await background.emitAlarm('spaceTabsAskStreamRecovery:orphaned-stream');
  const answer = background.storageLocal[STORAGE_KEY]
    .askSessions[fixture.sessionKey].messages.at(-1);
  assert.equal(answer.askStream, undefined);
  assert.match(answer.text, /^Durable partial/);
  assert.match(answer.text, /Request interrupted before completion/);
  assert.match(answer.text, /### Sources/);
  assert.equal(background.alarms.has('spaceTabsAskStreamRecovery:orphaned-stream'), false);
});

test('worker-start recovery interrupts an older worker owner and contains storage failures', async () => {
  const fixture = askStreamStorage({
    requestId: 'previous-worker-stream',
    text: 'Checkpoint from old worker',
    status: 'streaming',
  });
  const background = await loadBackground({ storage: fixture.storage });
  await background.startup();
  const answer = background.storageLocal[STORAGE_KEY]
    .askSessions[fixture.sessionKey].messages.at(-1);
  assert.equal(answer.askStream, undefined);
  assert.match(answer.text, /Checkpoint from old worker/);
  assert.match(answer.text, /Request interrupted before completion/);

  const unavailable = await loadBackground({
    storage: fixture.storage,
    behavior: {
      'storage.local.get': async () => { throw new Error('startup storage unavailable'); },
    },
  });
  await captureConsoleErrors(async (errors) => {
    assert.deepEqual(await unavailable.startup(), []);
    assert.match(String(errors.at(-1)?.[1]), /startup storage unavailable/);
  });
});

test('Ask stream persistence rejects forged, mismatched, and missing durable bindings before fetch', async () => {
  const fixture = askStreamStorage({ requestId: 'valid-stream' });
  let fetchCount = 0;
  const background = await loadBackground({
    storage: fixture.storage,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse({ choices: [] });
    },
  });
  const base = {
    type: 'ai:chat', settings: aiSettings, messages: [], stream: true, purpose: 'ask-page',
  };
  assert.match((await background.send({ ...base, askStream: {} })).error, /valid streaming Ask Page message/);
  assert.match((await background.send({
    ...base, stream: false, askStream: fixture.binding,
  })).error, /valid streaming Ask Page message/);
  assert.match((await background.send({
    ...base, purpose: 'test-ai', askStream: fixture.binding,
  })).error, /valid streaming Ask Page message/);
  assert.match((await background.send({
    ...base, requestId: 'different', askStream: fixture.binding,
  })).error, /does not match this AI request/);
  assert.match((await background.send({
    ...base,
    askStream: { ...fixture.binding, messageId: 'missing' },
  })).error, /conversation changed before its provider response could be saved/);
  assert.equal(fetchCount, 0);
});

test('Ask stream persistence retries terminal state after checkpoint or final storage failures', async () => {
  const claimFixture = askStreamStorage({ requestId: 'claim-write-failure' });
  let claimWriteCount = 0;
  let claimBackground;
  claimBackground = await loadBackground({
    storage: claimFixture.storage,
    fetch: async () => {
      throw new Error('the provider must not run before the durable claim');
    },
    behavior: {
      'storage.local.set': async (values) => {
        claimWriteCount += 1;
        if (claimWriteCount === 1) throw new Error('claim write failed');
        Object.assign(claimBackground.storageLocal, cloneValue(values));
      },
    },
  });
  assert.match((await claimBackground.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'claim-write-failure',
    stream: true,
    purpose: 'ask-page',
    askStream: claimFixture.binding,
  })).error, /claim write failed/);
  assert.equal(claimBackground.alarms.has(
    'spaceTabsAskStreamRecovery:claim-write-failure',
  ), true, 'a failed first claim still schedules recovery when the panel is gone');
  await claimBackground.emitAlarm('spaceTabsAskStreamRecovery:claim-write-failure');
  const recoveredClaim = claimBackground.storageLocal[STORAGE_KEY]
    .askSessions[claimFixture.sessionKey].messages.at(-1);
  assert.equal(recoveredClaim.askStream, undefined);
  assert.match(recoveredClaim.text, /Request interrupted before completion/);

  const partialFixture = askStreamStorage({ requestId: 'partial-write-failure' });
  let partialWriteCount = 0;
  let partialBackground;
  partialBackground = await loadBackground({
    storage: partialFixture.storage,
    fetch: async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]).response,
    behavior: {
      'storage.local.set': async (values) => {
        partialWriteCount += 1;
        if (partialWriteCount === 2) throw new Error('checkpoint write failed');
        Object.assign(partialBackground.storageLocal, cloneValue(values));
      },
    },
  });
  const partialResponse = await partialBackground.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'partial-write-failure',
    stream: true,
    purpose: 'ask-page',
    askStream: partialFixture.binding,
  });
  assert.equal(partialResponse.askStatus, 'complete');
  assert.equal(partialWriteCount, 3);
  assert.match(
    partialBackground.storageLocal[STORAGE_KEY]
      .askSessions[partialFixture.sessionKey].messages.at(-1).text,
    /^Recovered/,
  );

  const finalFixture = askStreamStorage({ requestId: 'final-write-failure' });
  let finalWriteCount = 0;
  let finalBackground;
  finalBackground = await loadBackground({
    storage: finalFixture.storage,
    fetch: async () => jsonResponse({ choices: [{ message: { content: 'Complete' } }] }),
    behavior: {
      'storage.local.set': async (values) => {
        finalWriteCount += 1;
        if (finalWriteCount === 2) throw new Error('final write failed');
        Object.assign(finalBackground.storageLocal, cloneValue(values));
      },
    },
  });
  assert.deepEqual(await finalBackground.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'final-write-failure',
    stream: true,
    purpose: 'ask-page',
    askStream: finalFixture.binding,
  }), { ok: false, error: 'final write failed' });
  const stillRecoverable = finalBackground.storageLocal[STORAGE_KEY]
    .askSessions[finalFixture.sessionKey].messages.at(-1);
  assert.equal(stillRecoverable.askStream.status, 'streaming');
  assert.ok(finalBackground.calls.filter(([name, alarmName]) => (
    name === 'alarms.create' && alarmName.endsWith('final-write-failure')
  )).length >= 2);
});

test('Ask failure normalization accepts thrown strings and recovery write errors reschedule alarms', async () => {
  const stringFixture = askStreamStorage({ requestId: 'string-failure' });
  const stringFailure = await loadBackground({
    storage: stringFixture.storage,
    fetch: async () => { throw 'provider string failure'; },
  });
  const stringResponse = await stringFailure.send({
    type: 'ai:chat',
    settings: aiSettings,
    messages: [],
    requestId: 'string-failure',
    stream: true,
    purpose: 'ask-page',
    askStream: stringFixture.binding,
  });
  assert.equal(stringResponse.askError, 'provider string failure');

  const recoveryFixture = askStreamStorage({
    requestId: 'recovery-write-failure',
    text: 'Keep partial',
    status: 'streaming',
  });
  const recovery = await loadBackground({
    storage: recoveryFixture.storage,
    behavior: {
      'storage.local.set': async () => { throw new Error('recovery storage unavailable'); },
    },
  });
  await captureConsoleErrors(async (errors) => {
    await recovery.emitAlarm('spaceTabsAskStreamRecovery:recovery-write-failure');
    assert.match(String(errors.at(-1)?.[1]), /recovery storage unavailable/);
  });
  assert.ok(recovery.alarms.has('spaceTabsAskStreamRecovery:recovery-write-failure'));
  await recovery.emitAlarm('spaceTabsAskStreamRecovery:unknown-stream');
  await recovery.emitAlarm(undefined);
});

test('streaming AI parses a final unterminated event and ignores notification and reader-cancel failures', async () => {
  const stream = sseResponse([
    'data: {"choices":[{"delta":{"content":"Tail"},"finish_reason":"stop"}],"usage":{"total_tokens":4}}',
  ], { cancelError: true });
  const background = await loadBackground({
    fetch: async () => stream.response,
    behavior: {
      'runtime.sendMessage': async () => { throw new Error('No side panel'); },
    },
  });
  const response = await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], stream: true, purpose: 'ask-page',
  });
  assert.equal(response.text, 'Tail');
  assert.deepEqual(response.usage, { total_tokens: 4 });
  assert.equal(response.finishReason, 'stop');
  assert.equal(stream.cancelCount, 0, 'a naturally completed response does not need cancellation');

  const doneStream = sseResponse(['data: [DONE]\n\n'], { cancelError: true });
  globalThis.fetch = async () => doneStream.response;
  const completed = await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], stream: true, purpose: 'ask-page',
  });
  assert.equal(completed.text, '');
  assert.equal(doneStream.cancelCount, 1);
});

test('stream requests gracefully fall back to JSON when the server does not provide an SSE body', async () => {
  const responses = [
    jsonResponse({ choices: [{ message: { content: 'JSON content type' } }] }),
    jsonResponse({ choices: [{ message: { content: 'Missing body' } }] }, { contentType: 'text/event-stream' }),
  ];
  const background = await loadBackground({ fetch: async () => responses.shift() });
  for (const expected of ['JSON content type', 'Missing body']) {
    const response = await background.send({
      type: 'ai:chat', settings: aiSettings, messages: [], stream: true, purpose: 'test-ai',
    });
    assert.equal(response.text, expected);
  }

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    async json() { return { choices: [{ message: { content: 'No content type' } }] }; },
  });
  const noContentType = await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], stream: false, purpose: 'test-ai',
  });
  assert.equal(noContentType.text, 'No content type');
});

test('specific and global AI aborts stop active requests and do not claim unknown requests', async () => {
  const pendingFetch = async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const background = await loadBackground({ fetch: pendingFetch });

  const firstChat = background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], requestId: 'first', purpose: 'ask-page',
  });
  await Promise.resolve();
  assert.deepEqual(await background.send({ type: 'ai:abort', requestId: 'missing' }), {
    ok: true, aborted: false,
  });
  assert.deepEqual(await background.send({ type: 'ai:abort', requestId: 'first' }), {
    ok: true, aborted: true,
  });
  assert.deepEqual(await firstChat, { ok: false, error: 'AI request was stopped.' });

  const secondChat = background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], requestId: 'second', purpose: 'ask-page',
  });
  const thirdChat = background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], requestId: 'third', purpose: 'ask-page',
  });
  await Promise.resolve();
  assert.deepEqual(await background.send({ type: 'ai:abort' }), { ok: true, aborted: true });
  assert.deepEqual(await secondChat, { ok: false, error: 'AI request was stopped.' });
  assert.deepEqual(await thirdChat, { ok: false, error: 'AI request was stopped.' });
  assert.deepEqual(await background.send({ type: 'ai:abort' }), { ok: true, aborted: true });
});

test('non-abort network failures remain actionable AI errors', async () => {
  const background = await loadBackground({
    fetch: async () => { throw new TypeError('Network offline'); },
  });
  assert.deepEqual(await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], purpose: 'test-ai',
  }), { ok: false, error: 'Network offline' });

  globalThis.fetch = async () => { throw 'provider disconnected'; };
  assert.deepEqual(await background.send({
    type: 'ai:chat', settings: aiSettings, messages: [], purpose: 'test-ai',
  }), { ok: false, error: 'provider disconnected' });
});

test('panel-managed close persists suppression before Chrome removes the tab and preserves the saved row', async () => {
  let background;
  let suppressionObservedDuringRemove = false;
  background = await loadBackground({
    tabs: [makeTab(10, { groupId: 100 })],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.remove': async (tabId) => {
        const key = `${LIFECYCLE_SUPPRESSION_PREFIX}${tabId}`;
        const suppression = background.storageSession[key];
        assert.equal(suppression?.tabId, 10);
        assert.equal(suppression?.disposition, 'panel-managed');
        assert.ok(Number.isFinite(suppression?.createdAt));
        suppressionObservedDuringRemove = true;
        background.tabs.delete(Number(tabId));
        background.emitRemoved(Number(tabId), { windowId: 1, isWindowClosing: false });
      },
    },
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);

  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 10 }), { ok: true });
  await waitForLifecycleAfter(background, previousJournalWrites);

  assert.equal(suppressionObservedDuringRemove, true);
  const suppressionSetIndex = background.calls.findIndex(([name, values]) => (
    name === 'storage.session.set' && Object.hasOwn(values || {}, `${LIFECYCLE_SUPPRESSION_PREFIX}10`)
  ));
  const removeIndex = background.calls.findIndex(([name]) => name === 'tabs.remove');
  assert.ok(suppressionSetIndex >= 0 && suppressionSetIndex < removeIndex);
  assert.equal(background.storageSession[`${LIFECYCLE_SUPPRESSION_PREFIX}10`], undefined);

  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-first', 'row-second', 'row-other'],
  );
  assert.equal(stored.tabLifecycle[10], undefined, 'closed live ids are still cleaned up');
  assert.equal(stored.tabSpaces[10], undefined);
});

test('checkpoint cleanup closes a transient created tab without preserving a ghost snapshot row', async () => {
  let background;
  let suppressionObservedDuringRemove = false;
  background = await loadBackground({
    tabs: [makeTab(10, { groupId: 100 })],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.remove': async (tabId) => {
        suppressionObservedDuringRemove = Object.hasOwn(
          background.storageSession,
          `${LIFECYCLE_SUPPRESSION_PREFIX}${tabId}`,
        );
        background.tabs.delete(Number(tabId));
        background.emitRemoved(Number(tabId), { windowId: 1, isWindowClosing: false });
      },
    },
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);

  assert.deepEqual(await background.send({
    type: 'tabs:close',
    tabId: 10,
    preserveSnapshot: false,
  }), { ok: true });
  await waitForLifecycleAfter(background, previousJournalWrites);

  assert.equal(suppressionObservedDuringRemove, false);
  assert.equal(background.storageSession[`${LIFECYCLE_SUPPRESSION_PREFIX}10`], undefined);
  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-second', 'row-other'],
  );
  assert.equal(stored.tabLifecycle[10], undefined);
  assert.equal(stored.tabSpaces[10], undefined);
});

test('a rejected panel close removes its suppression marker and leaves durable state untouched', async () => {
  const original = lifecycleWorkspace();
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 100 })],
    storage: lifecycleStorage(original),
    behavior: {
      'tabs.remove': async () => {
        throw new Error('Chrome rejected close');
      },
    },
  });

  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 10 }), {
    ok: false,
    error: 'Chrome rejected close',
  });
  assert.equal(background.storageSession[`${LIFECYCLE_SUPPRESSION_PREFIX}10`], undefined);
  assert.equal(lifecycleJournalKeys(background).length, 0);
  assert.deepEqual(background.storageLocal[STORAGE_KEY], original);
  assert.equal(background.tabs.has(10), true);
});

test('native tab removal deletes the exact stable duplicate row instead of matching by URL', async () => {
  const background = await loadBackground({ storage: lifecycleStorage() });
  await emitAndDrain(background, () => {
    background.emitRemoved(11, { windowId: 1, isWindowClosing: false });
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-first', 'row-other'],
  );
  assert.equal(stored.spaceSnapshots.work.groups[0].tabs[0].url, 'https://same.test/page');
  assert.equal(stored.tabLifecycle[11], undefined);
  assert.equal(stored.renamedTabs[11], undefined);
  assert.deepEqual(stored.ephemeralTabIds, [9]);
  assert.deepEqual(stored.tabOrder.work['group:100'], [10, 12]);
});

test('whole-window removal preserves restorable snapshot rows while clearing stale live metadata', async () => {
  const background = await loadBackground({ storage: lifecycleStorage() });
  await emitAndDrain(background, () => {
    background.emitRemoved(10, { windowId: 1, isWindowClosing: true });
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(stored.spaceSnapshots.work, lifecycleSnapshot());
  assert.equal(stored.tabLifecycle[10], undefined);
  assert.equal(stored.tabSpaces[10], undefined);
  assert.equal(stored.renamedTabs[10], undefined);
  assert.equal(stored.tabGroups[10], undefined);
});

test('whole-window event batches ignore Chrome synthetic ungrouping and preserve the original saved Tag', async () => {
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 100, windowId: 1 })],
    groups: [makeGroup(100, { title: 'Docs', windowId: 1 })],
    storage: lifecycleStorage(),
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  const ungroupedTab = makeTab(10, { groupId: -1, windowId: 1 });
  background.tabs.set(10, ungroupedTab);
  background.emitUpdated(10, { groupId: -1 }, ungroupedTab);
  background.groups.delete(100);
  background.emitGroupRemoved(makeGroup(100, { title: 'Docs', windowId: 1 }));
  background.tabs.delete(10);
  background.emitRemoved(10, { windowId: 1, isWindowClosing: true });

  await waitFor(
    () => lifecycleJournalWriteCount(background) >= previousJournalWrites + 3,
    'whole-window lifecycle burst was not fully journaled',
  );
  await waitFor(
    () => lifecycleJournalKeys(background).length === 0,
    'whole-window lifecycle burst was not acknowledged',
  );
  await settleAsyncWork();

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10], undefined);
  assert.equal(stored.groupSpaces[100], undefined);
  assert.deepEqual(stored.spaceSnapshots.work, lifecycleSnapshot());
  assert.equal(stored.spaceSnapshots.work.groups.some((group) => group.title === 'Ungrouped'), false);
});

test('a lone synthetic ungroup journal preserves its stable Tag when the whole prior window is absent', async () => {
  const journalKey = `${LIFECYCLE_EVENT_PREFIX}lost-window-removal`;
  const background = await loadBackground({
    tabs: [],
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [journalKey]: {
        type: 'updated',
        tabId: 10,
        windowId: 'invalid-window',
        changeInfo: { groupId: -1 },
        tab: makeTab(10, { groupId: -1, windowId: 1 }),
        eventId: 'lost-window-removal',
        capturedAt: Date.now() - 1000,
        sequence: 1,
      },
    }),
  });

  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, 100);
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.deepEqual(stored.spaceSnapshots.work, lifecycleSnapshot());
  assert.equal(stored.spaceSnapshots.work.groups.some((group) => group.title === 'Ungrouped'), false);
  assert.deepEqual(
    background.calls.filter(([name]) => name === 'tabs.query').map(([, query]) => query),
    [{ windowId: 1 }],
  );
  assert.equal(background.calls.some(([name]) => name === 'windows.get'), false);
});

test('missing-tab ungroup inference requires positive closed-window evidence', async () => {
  const drainSyntheticUngroup = async ({ tabs = [], behavior = {}, eventTab } = {}) => {
    const eventId = crypto.randomUUID();
    const journalKey = `${LIFECYCLE_EVENT_PREFIX}${eventId}`;
    const background = await loadBackground({
      tabs,
      storage: lifecycleStorage(lifecycleWorkspace(), {
        [journalKey]: {
          type: 'updated',
          tabId: 10,
          changeInfo: { groupId: -1 },
          tab: eventTab || makeTab(10, { groupId: -1, windowId: 1 }),
          eventId,
          capturedAt: Date.now() - 1000,
          sequence: 1,
        },
      }),
      behavior,
    });
    await background.startup();
    await waitFor(() => lifecycleJournalKeys(background).length === 0);
    return background;
  };

  const confirmedByWindowLookup = await drainSyntheticUngroup({
    behavior: {
      'tabs.query': async () => { throw new Error('tab inventory unavailable'); },
      'windows.get': async () => { throw missingWindow(1); },
    },
  });
  assert.equal(confirmedByWindowLookup.storageLocal[STORAGE_KEY].tabLifecycle[10].groupId, 100);
  assert.deepEqual(confirmedByWindowLookup.storageLocal[STORAGE_KEY].spaceSnapshots.work, lifecycleSnapshot());

  const liveWindowAfterQueryFailure = await drainSyntheticUngroup({
    behavior: {
      'tabs.query': async () => { throw new Error('tab inventory unavailable'); },
      'windows.get': async () => ({ id: 1 }),
    },
  });
  let stored = liveWindowAfterQueryFailure.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(stored.spaceSnapshots.work.groups.find((group) => (
    group.title === 'Ungrouped'
  )).tabs[0].snapshotTabId, 'row-first');

  const unknownWindowAfterQueryFailure = await drainSyntheticUngroup({
    behavior: {
      'tabs.query': async () => { throw new Error('tab inventory unavailable'); },
      'windows.get': async () => { throw 'window lookup permission denied'; },
    },
  });
  stored = unknownWindowAfterQueryFailure.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, -1);

  const liveWindowTab = await drainSyntheticUngroup({
    tabs: [makeTab(99, { windowId: 1 })],
  });
  stored = liveWindowTab.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(liveWindowTab.calls.some(([name]) => name === 'windows.get'), false);

  const extensionTab = makeTab(98, {
    windowId: 1,
    url: 'chrome-extension://space-tabs/sidepanel.html?layout=workbench',
  });
  let extensionClosingQueryCount = 0;
  const extensionPageClosedWithWindow = await drainSyntheticUngroup({
    tabs: [extensionTab],
    behavior: {
      'tabs.query': async () => {
        extensionClosingQueryCount += 1;
        return extensionClosingQueryCount === 1 ? [{ ...extensionTab }] : [];
      },
    },
  });
  stored = extensionPageClosedWithWindow.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, 100);
  assert.deepEqual(stored.spaceSnapshots.work, lifecycleSnapshot());
  assert.equal(extensionClosingQueryCount, 2);
  assert.equal(extensionPageClosedWithWindow.calls.some(([name]) => name === 'windows.get'), false);

  const extensionPageStillLive = await drainSyntheticUngroup({ tabs: [extensionTab] });
  stored = extensionPageStillLive.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(
    extensionPageStillLive.calls.filter(([name]) => name === 'tabs.query').length,
    3,
    'two close-inference reads are followed by the normal ungroup ordering query',
  );
  assert.equal(extensionPageStillLive.calls.some(([name]) => name === 'windows.get'), false);

  let ambiguousQueryCount = 0;
  const extensionRecheckUnavailable = await drainSyntheticUngroup({
    tabs: [extensionTab],
    behavior: {
      'tabs.query': async () => {
        ambiguousQueryCount += 1;
        if (ambiguousQueryCount === 1) return [{ ...extensionTab }];
        throw new Error('window teardown inventory unavailable');
      },
      'windows.get': async () => { throw missingWindow(1); },
    },
  });
  stored = extensionRecheckUnavailable.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, 100);
  assert.equal(ambiguousQueryCount, 2);

  const conflictingPriorWindows = await drainSyntheticUngroup({
    eventTab: makeTab(10, { groupId: -1, windowId: 2 }),
  });
  stored = conflictingPriorWindows.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(conflictingPriorWindows.calls.some(([name, query]) => (
    name === 'tabs.query' && Number(query?.windowId) === 1
  )), false);
  assert.equal(conflictingPriorWindows.calls.some(([name]) => name === 'windows.get'), false);
});

test('panel-closed tab creation keeps its creation-time window Space through navigation and window close', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  const background = await loadBackground({
    tabs: [makeTab(30, {
      title: 'New Tab', url: 'chrome://newtab/', windowId: 2, groupId: -1, index: 0,
    })],
    storage: lifecycleStorage(state, {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'focus' } },
    }),
  });

  await emitAndDrain(background, () => {
    background.emitCreated(background.tabs.get(30));
    background.storageSession[WINDOW_STATE_KEY].activeSpaceIds[2] = 'work';
  });
  let stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[30].spaceId, 'focus');
  assert.equal(stored.tabLifecycle[30].provisional, true);
  assert.equal(stored.tabSpaces[30], 'focus');
  assert.equal(stored.spaceSnapshots.focus.groups.flatMap((group) => group.tabs)
    .some((tab) => tab.snapshotTabId === stored.tabLifecycle[30].snapshotTabId), false);

  const navigated = makeTab(30, {
    title: 'Created while closed',
    url: 'https://panel-closed.test/page',
    windowId: 2,
    groupId: -1,
    index: 0,
  });
  background.tabs.set(30, navigated);
  await emitAndDrain(background, () => {
    background.emitUpdated(30, {
      url: navigated.url,
      title: navigated.title,
    }, navigated);
  });
  stored = background.storageLocal[STORAGE_KEY];
  const snapshotTabId = stored.tabLifecycle[30].snapshotTabId;
  const createdRows = stored.spaceSnapshots.focus.groups
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.snapshotTabId === snapshotTabId);
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].url, 'https://panel-closed.test/page');
  assert.equal(stored.tabLifecycle[30].provisional, false);

  await emitAndDrain(background, () => {
    background.emitUpdated(30, { title: navigated.title }, navigated);
  });
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.spaceSnapshots.focus.groups
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.snapshotTabId === snapshotTabId).length, 1);

  await emitAndDrain(background, () => {
    background.emitRemoved(30, { windowId: 2, isWindowClosing: true });
  });
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[30], undefined);
  assert.equal(stored.spaceSnapshots.focus.groups
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.snapshotTabId === snapshotTabId).length, 1);
});

test('new unmapped windows use the durable Space while explicit ownership wins over window routing', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.tabSpaces[41] = 'focus';
  const background = await loadBackground({
    tabs: [
      makeTab(40, { title: 'Fresh window', url: 'https://fresh-window.test/', windowId: 9, groupId: -1 }),
      makeTab(41, { title: 'Explicit owner', url: 'https://explicit.test/', windowId: 2, groupId: -1 }),
    ],
    storage: lifecycleStorage(state, {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'work' } },
    }),
  });

  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(40)));
  let stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[40].spaceId, 'work');
  assert.equal(stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
    .some((tab) => tab.url === 'https://fresh-window.test/'), true);

  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(41)));
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[41].spaceId, 'focus');
  assert.equal(stored.spaceSnapshots.focus.groups.flatMap((group) => group.tabs)
    .some((tab) => tab.url === 'https://explicit.test/'), true);
});

test('created events cannot overwrite a sidepanel binding and native groups inherit their known owner', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.groupSpaces[200] = 'focus';
  const originalBinding = structuredClone(state.tabLifecycle[10]);
  const background = await loadBackground({
    tabs: [
      makeTab(10, { title: 'Must not overwrite', url: 'https://wrong.test/', windowId: 1, groupId: 100 }),
      makeTab(42, { title: 'Peer owner', url: 'https://peer-owner.test/', windowId: 1, groupId: 200 }),
    ],
    groups: [makeGroup(200, { title: 'Focus group', color: 'red' })],
    storage: lifecycleStorage(state, {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 1: 'work' } },
    }),
  });

  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(10)));
  let stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(stored.tabLifecycle[10], originalBinding);
  assert.equal(stored.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first').url, 'https://same.test/page');

  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(42)));
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[42].spaceId, 'focus');
  assert.equal(stored.groupSpaces[200], 'focus');
  const target = stored.spaceSnapshots.focus.groups.find((group) => (
    group.snapshotGroupId === stored.tabLifecycle[42].snapshotGroupId
  ));
  assert.deepEqual({ title: target.title, color: target.color }, {
    title: 'Focus group', color: 'red',
  });
});

test('native group updates and moves persist their observable Chrome metadata while removal keeps recovery rows', async () => {
  const state = lifecycleWorkspace();
  state.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-second',
    title: 'Second group',
    color: 'red',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-fourth', title: 'Fourth', url: 'https://fourth.test/' }],
  });
  state.tabLifecycle[12] = {
    tabId: 12,
    snapshotTabId: 'row-fourth',
    snapshotGroupId: 'group-second',
    spaceId: 'work',
    url: 'https://fourth.test/',
    title: 'Fourth',
    windowId: 1,
    groupId: 200,
    trackingMode: 'live',
    sessionId: LIFECYCLE_SESSION_ID,
  };
  state.groupSpaces[200] = 'work';
  const background = await loadBackground({
    tabs: [
      makeTab(12, { groupId: 200, index: 0, url: 'https://fourth.test/' }),
      makeTab(10, { groupId: 100, index: 1 }),
      makeTab(11, { groupId: 100, index: 2 }),
    ],
    groups: [
      makeGroup(100, { title: 'Docs', color: 'blue' }),
      makeGroup(200, { title: 'Second group', color: 'red' }),
    ],
    storage: lifecycleStorage(state),
  });

  const renamed = makeGroup(100, {
    title: 'Renamed natively', color: 'orange', collapsed: true,
  });
  background.groups.set(100, renamed);
  await emitAndDrain(background, () => background.emitGroupUpdated(renamed));
  let stored = background.storageLocal[STORAGE_KEY];
  let docs = stored.spaceSnapshots.work.groups.find((group) => group.snapshotGroupId === 'group-docs');
  assert.deepEqual({ title: docs.title, color: docs.color, collapsed: docs.collapsed }, {
    title: 'Renamed natively', color: 'orange', collapsed: true,
  });
  assert.equal(stored.collapsedGroups['group:100'], true);

  const unnamed = makeGroup(100, { title: '', color: 'orange', collapsed: true });
  background.groups.set(100, unnamed);
  background.behavior['tabGroups.get'] = async () => { throw new Error('group disappeared after event'); };
  await emitAndDrain(background, () => background.emitGroupUpdated(unnamed));
  delete background.behavior['tabGroups.get'];
  stored = background.storageLocal[STORAGE_KEY];
  docs = stored.spaceSnapshots.work.groups.find((group) => group.snapshotGroupId === 'group-docs');
  assert.equal(docs.title, '');

  await emitAndDrain(background, () => background.emitGroupMoved(unnamed));
  stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(stored.spaceSnapshots.work.groups.slice(0, 2).map((group) => group.snapshotGroupId), [
    'group-second', 'group-docs',
  ]);
  assert.deepEqual(stored.groupOrder.work.slice(0, 2), ['group:200', 'group:100']);

  await emitAndDrain(background, () => background.emitGroupRemoved(renamed));
  stored = background.storageLocal[STORAGE_KEY];
  docs = stored.spaceSnapshots.work.groups.find((group) => group.snapshotGroupId === 'group-docs');
  assert.equal(docs.title, '');
  assert.equal(stored.groupSpaces[100], undefined);
  assert.equal(stored.collapsedGroups['group:100'], undefined);
});

test('panel-closed grouped pin auto-ungroups without an explicit groupId event and never restores the old Tag', async () => {
  const tab = makeTab(10, { groupId: 100, pinned: false });
  const background = await loadBackground({
    tabs: [tab],
    groups: [makeGroup(100, { title: 'Docs', color: 'blue' })],
    storage: lifecycleStorage(),
  });

  tab.pinned = true;
  tab.groupId = -1;
  background.tabs.set(10, { ...tab });
  await emitAndDrain(background, () => background.emitUpdated(10, { pinned: true }, { ...tab }));
  let stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.spaceSnapshots.work.groups[0].tabs
    .some((row) => row.snapshotTabId === 'row-first'), false);
  assert.equal(stored.tabLifecycle[10].snapshotTabId, 'row-first');
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.notEqual(stored.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.equal(stored.tabSpaces[10], 'work');
  assert.equal(stored.tabGroups[10], undefined);
  assert.equal(stored.tabLifecycle[10].provisional, true);

  tab.pinned = false;
  background.tabs.set(10, { ...tab });
  await emitAndDrain(background, () => background.emitUpdated(10, { pinned: false }, { ...tab }));
  stored = background.storageLocal[STORAGE_KEY];
  const restoredGroup = stored.spaceSnapshots.work.groups.find((group) => (
    group.snapshotGroupId === stored.tabLifecycle[10].snapshotGroupId
  ));
  assert.equal(restoredGroup.title, 'Ungrouped');
  assert.deepEqual(restoredGroup.tabs.map((row) => row.snapshotTabId), ['row-first']);
  assert.equal(stored.spaceSnapshots.work.groups.find((group) => (
    group.snapshotGroupId === 'group-docs'
  )).tabs.some((row) => row.snapshotTabId === 'row-first'), false);
  assert.equal(stored.tabLifecycle[10].provisional, false);

  tab.pinned = true;
  background.tabs.set(10, { ...tab });
  await emitAndDrain(background, () => background.emitUpdated(10, { pinned: true }, { ...tab }));
  await emitAndDrain(background, () => background.emitRemoved(10, {
    windowId: 1, isWindowClosing: true,
  }));
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10], undefined);
  assert.equal(stored.spaceSnapshots.work.groups[0].tabs
    .some((row) => row.snapshotTabId === 'row-first'), false);
});

test('a suppression lookup failure is treated as a native close instead of losing the event', async () => {
  const behavior = {};
  behavior['storage.session.get'] = () => {
    delete behavior['storage.session.get'];
    throw new Error('transient session read failure');
  };
  const background = await loadBackground({
    storage: lifecycleStorage(),
    behavior,
  });
  await emitAndDrain(background, () => {
    background.emitRemoved(10, { windowId: 1, isWindowClosing: false });
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10], undefined);
  assert.equal(stored.spaceSnapshots.work.groups[0].tabs.some((tab) => (
    tab.snapshotTabId === 'row-first'
  )), false);
});

test('saved-target navigation updates live metadata but not the user saved URL or title', async () => {
  const original = lifecycleWorkspace({ savedTargetTabIds: [10] });
  const background = await loadBackground({ storage: lifecycleStorage(original) });
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  background.emitUpdated(10, { status: 'complete' }, makeTab(10, { title: 'Ignored status' }));
  await settleAsyncWork();
  assert.equal(lifecycleJournalWriteCount(background), previousJournalWrites);
  assert.deepEqual(background.storageLocal[STORAGE_KEY], original);

  await emitAndDrain(background, () => {
    background.emitUpdated(
      10,
      { url: 'https://navigated.test/path', title: 'Navigated page' },
      makeTab(10, {
        url: 'https://navigated.test/path',
        title: 'Navigated page',
        groupId: 100,
      }),
    );
  });

  const stored = background.storageLocal[STORAGE_KEY];
  const row = stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(row.url, 'https://same.test/page');
  assert.equal(row.title, 'First');
  assert.equal(stored.tabLifecycle[10].url, 'https://navigated.test/path');
  assert.equal(stored.tabLifecycle[10].title, 'Navigated page');
  assert.equal(stored.tabLifecycle[10].trackingMode, 'saved-target');
});

test('a delayed saved-target event cannot overwrite a newer explicit saved URL commit', async () => {
  const webLock = createControllableWebLock({ blocked: true });
  const finalUrl = 'https://final.test/committed';
  const background = await loadBackground({
    tabs: [makeTab(10, { url: finalUrl, title: 'Explicit commit', groupId: 100 })],
    storage: lifecycleStorage(lifecycleWorkspace({ savedTargetTabIds: [10] })),
    webLock,
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  background.emitUpdated(
    10,
    { url: 'https://stale.test/intermediate', title: 'Stale intermediate' },
    makeTab(10, { url: 'https://stale.test/intermediate', title: 'Stale intermediate', groupId: 100 }),
  );
  await waitFor(() => webLock.pendingCount === 1);
  assert.equal(lifecycleJournalWriteCount(background), previousJournalWrites);
  assert.equal(lifecycleJournalKeys(background).length, 0);

  const committed = background.storageLocal[STORAGE_KEY];
  const committedRow = committed.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  committedRow.url = finalUrl;
  committedRow.title = 'Explicit commit';
  Object.assign(committed.tabLifecycle[10], {
    url: finalUrl,
    title: 'Explicit commit',
    trackingMode: 'live',
  });

  webLock.releaseAll();
  await waitFor(() => lifecycleJournalWriteCount(background) > previousJournalWrites);
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  const stored = background.storageLocal[STORAGE_KEY];
  const row = stored.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(row.url, finalUrl);
  assert.equal(row.title, 'Explicit commit');
  assert.equal(stored.tabLifecycle[10].url, finalUrl);
  assert.equal(stored.tabLifecycle[10].title, 'Explicit commit');
  assert.equal(stored.tabLifecycle[10].trackingMode, 'live');
});

test('a delayed panel grouping event retains the checkpointed stable Tag identity', async () => {
  const state = lifecycleWorkspace({ savedTargetTabIds: [10] });
  const logicalTitle = `${'Saved research group '.repeat(3)}one`;
  state.spaceSnapshots.work.groups[0].title = logicalTitle;
  state.spaceSnapshots.work.groups[0].color = 'green';
  state.groupSpaces[999] = 'work';
  state.tabLifecycle[10].groupId = 999;
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 999 })],
    groups: [makeGroup(999, { title: chromeGroupTitle(logicalTitle), color: 'green' })],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => {
    background.emitUpdated(10, { groupId: 999 }, makeTab(10, { groupId: 999 }));
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.equal(stored.tabLifecycle[10].groupId, 999);
  assert.equal(stored.spaceSnapshots.work.groups.length, 1);
  assert.equal(stored.spaceSnapshots.work.groups[0].snapshotGroupId, 'group-docs');
  assert.equal(stored.spaceSnapshots.work.groups[0].title, logicalTitle);
  assert.deepEqual(stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first', 'row-second', 'row-other',
  ]);
});

test('a compact Chrome title uniquely resolves its full logical snapshot Tag', async () => {
  const state = lifecycleWorkspace();
  const logicalTitle = `${'Saved research group '.repeat(3)}two`;
  state.spaceSnapshots.work.groups[0].title = logicalTitle;
  state.spaceSnapshots.work.groups[0].color = 'purple';
  state.groupSpaces[999] = 'work';
  state.tabLifecycle[10].groupId = 999;
  state.tabLifecycle[10].snapshotGroupId = '';
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 999 })],
    groups: [makeGroup(999, { title: chromeGroupTitle(logicalTitle), color: 'purple' })],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => {
    background.emitUpdated(10, { groupId: 999 }, makeTab(10, { groupId: 999 }));
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.equal(stored.tabLifecycle[10].groupId, 999);
  assert.equal(stored.spaceSnapshots.work.groups.length, 1);
  assert.equal(stored.spaceSnapshots.work.groups[0].title, logicalTitle);
});

test('native group changes use explicit owners or keep the tab in its already-bound Space', async () => {
  const zeroState = lifecycleWorkspace({ includeFocusSpace: true });
  zeroState.groupSpaces[0] = 'focus';
  const zero = await loadBackground({
    groups: [makeGroup(0, { title: 'Focus', color: 'red' })],
    storage: lifecycleStorage(zeroState),
  });
  await emitAndDrain(zero, () => {
    zero.emitUpdated(10, { groupId: 0 }, makeTab(10, { groupId: 0 }));
  });

  const moved = zero.storageLocal[STORAGE_KEY];
  assert.ok(zero.calls.some((call) => call[0] === 'tabGroups.get' && call[1] === 0));
  assert.equal(moved.tabLifecycle[10].groupId, 0);
  assert.equal(moved.tabLifecycle[10].spaceId, 'focus');
  assert.equal(moved.tabLifecycle[10].snapshotGroupId, 'group-focus');
  assert.deepEqual(
    moved.spaceSnapshots.focus.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-focus', 'row-first'],
  );
  assert.equal(moved.spaceSnapshots.work.groups[0].tabs.some((tab) => tab.snapshotTabId === 'row-first'), false);

  const unknown = await loadBackground({
    groups: [makeGroup(999, { title: 'Mystery', color: 'yellow' })],
    storage: lifecycleStorage(),
  });
  await emitAndDrain(unknown, () => {
    unknown.emitUpdated(10, { groupId: 999 }, makeTab(10, { groupId: 999 }));
  });

  const regrouped = unknown.storageLocal[STORAGE_KEY];
  assert.equal(unknown.calls.some((call) => call[0] === 'tabGroups.get' && call[1] === 999), true);
  assert.equal(regrouped.tabLifecycle[10].spaceId, 'work');
  assert.notEqual(regrouped.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.equal(regrouped.tabLifecycle[10].groupId, 999);
  assert.equal(regrouped.groupSpaces[999], 'work');
  assert.equal(regrouped.tabSpaces[10], undefined);
  const mystery = regrouped.spaceSnapshots.work.groups.find((group) => (
    group.snapshotGroupId === regrouped.tabLifecycle[10].snapshotGroupId
  ));
  assert.deepEqual({ title: mystery.title, color: mystery.color }, {
    title: 'Mystery', color: 'yellow',
  });
  assert.deepEqual(mystery.tabs.map((tab) => tab.snapshotTabId), ['row-first']);
});

test('a delayed ungrouped event preserves a checkpointed virtual Tag', async () => {
  const state = lifecycleWorkspace();
  state.tabLifecycle[10].groupId = -1;
  state.tabSpaces[10] = 'work';
  state.tabGroups[10] = 'vgroup:moved-docs';
  state.virtualGroups['vgroup:moved-docs'] = {
    id: 'vgroup:moved-docs',
    spaceId: 'work',
    snapshotGroupId: 'group-docs',
    title: 'Docs',
    color: 'blue',
  };
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => {
    background.emitUpdated(10, { groupId: -1 }, makeTab(10, { groupId: -1 }));
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-docs');
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(stored.tabSpaces[10], 'work');
  assert.equal(stored.tabGroups[10], 'vgroup:moved-docs');
  assert.equal(stored.spaceSnapshots.work.groups.some((group) => (
    group.snapshotGroupId === 'group-docs' &&
    group.tabs.some((tab) => tab.snapshotTabId === 'row-first')
  )), true);
  assert.equal(stored.spaceSnapshots.work.groups.some((group) => (
    group.title === 'Ungrouped' &&
    group.tabs.some((tab) => tab.snapshotTabId === 'row-first')
  )), false);
});

test('ungrouping a live tab moves its stable row into the same Space ungrouped snapshot group', async () => {
  const state = lifecycleWorkspace();
  state.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-ungrouped',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-unrelated', title: 'Loose tab', url: 'https://loose.test/' }],
  });
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(state),
  });
  await emitAndDrain(background, () => {
    background.emitUpdated(10, { groupId: -1 }, makeTab(10, { groupId: -1 }));
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].spaceId, 'work');
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-ungrouped');
  assert.equal(stored.tabLifecycle[10].groupId, -1);
  assert.equal(stored.groupSpaces[-1], undefined);
  assert.equal(stored.tabSpaces[10], 'work');
  assert.equal(stored.tabGroups[10], undefined);
  assert.deepEqual(
    stored.spaceSnapshots.work.groups.find((group) => group.snapshotGroupId === 'group-ungrouped')
      .tabs.map((tab) => tab.snapshotTabId),
    ['row-unrelated', 'row-first'],
  );
  assert.equal(
    stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .filter((tab) => tab.snapshotTabId === 'row-first').length,
    1,
  );
});

test('move, detach, attach, and replacement events keep ordering and stable identity coherent', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(10, { groupId: 100, index: 1, windowId: 1 }),
      makeTab(11, { groupId: 100, index: 0, windowId: 1 }),
      makeTab(12, { groupId: 100, index: 2, windowId: 1 }),
    ],
    groups: [makeGroup(100, { title: 'Docs', color: 'blue' })],
    storage: lifecycleStorage(),
  });

  await emitAndDrain(background, () => {
    background.emitMoved(11, { windowId: 1, fromIndex: 1, toIndex: 0 });
  });
  let stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(stored.tabOrder.work['group:100'], [11, 10, 12]);
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-second', 'row-first', 'row-other'],
  );
  assert.equal(stored.tabLifecycle[11].index, 0);
  assert.ok(background.calls.some(([name, query]) => name === 'tabs.query' && query?.windowId === 1));

  await emitAndDrain(background, () => {
    background.emitDetached(10, { oldWindowId: 1, oldPosition: 1 });
  });
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].windowId, null);
  assert.equal(stored.tabLifecycle[10].detachedFromWindowId, 1);

  await emitAndDrain(background, () => {
    background.emitAttached(10, { newWindowId: 7, newPosition: 3 });
  });
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].windowId, 7);
  assert.equal(stored.tabLifecycle[10].index, 3);
  assert.equal(stored.tabLifecycle[10].detachedFromWindowId, undefined);

  background.tabs.set(20, makeTab(20, {
    title: 'Second replacement',
    url: 'https://replacement.test/page',
    windowId: 7,
    groupId: 100,
    index: 0,
  }));
  await emitAndDrain(background, () => {
    background.emitReplaced(20, 11);
  });
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[11], undefined);
  assert.equal(stored.tabLifecycle[20].snapshotTabId, 'row-second');
  assert.equal(stored.tabLifecycle[20].tabId, 20);
  assert.equal(stored.tabLifecycle[20].url, 'https://replacement.test/page');
  assert.equal(stored.tabLifecycle[20].windowId, 7);
  assert.equal(stored.tabSpaces[11], undefined);
  assert.equal(stored.tabSpaces[20], 'work');
  assert.equal(stored.renamedTabs[20], 'Second panel');
  assert.equal(stored.tabGroups[20], 'local-docs');
  assert.deepEqual(stored.ephemeralTabIds, [9, 20]);
  assert.deepEqual(stored.tabOrder.work['group:100'], [20, 10, 12]);
  const replacedRow = stored.spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-second');
  assert.equal(replacedRow.url, 'https://replacement.test/page');
  assert.equal(replacedRow.title, 'Second replacement');
});

test('moving an ownerless binding records its live index without inventing a Space', async () => {
  const state = lifecycleWorkspace();
  state.tabLifecycle[10].spaceId = '';
  state.tabLifecycle[10].groupId = -1;
  state.tabSpaces = {};
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: -1, index: 4 })],
    storage: lifecycleStorage(state),
  });
  await emitAndDrain(background, () => {
    background.emitMoved(10, { windowId: 1, fromIndex: 1, toIndex: 4 });
  });

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].index, 4);
  assert.equal(stored.tabLifecycle[10].spaceId, '');
  assert.deepEqual(stored.tabSpaces, {});
});

test('concurrent lifecycle callbacks capture and drain independent journals under the shared lock', async () => {
  const webLock = createControllableWebLock({ blocked: true });
  const background = await loadBackground({
    storage: lifecycleStorage(),
    webLock,
  });
  background.emitUpdated(10, { title: 'First concurrent' }, makeTab(10, { groupId: 100 }));
  background.emitUpdated(11, { title: 'Second concurrent' }, makeTab(11, { groupId: 100 }));

  await waitFor(() => webLock.pendingCount === 2);
  assert.equal(lifecycleJournalKeys(background).length, 0);
  assert.equal(lifecycleJournalWriteCount(background), 0);
  assert.deepEqual(webLock.calls, [
    [SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }],
    [SHARED_STATE_LOCK_NAME, { mode: 'exclusive' }],
  ]);
  assert.equal(
    background.calls.some(([name]) => name === 'storage.local.set'),
    false,
    'capture and durable mutation both wait until the lock is acquired',
  );

  webLock.releaseAll();
  await waitFor(() => lifecycleJournalWriteCount(background) === 2);
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  await settleAsyncWork();
  const journalSets = background.calls.filter(([name, values]) => (
    name === 'storage.session.set' &&
    Object.keys(values || {}).some((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX))
  ));
  assert.equal(journalSets.length, 2);
  assert.ok(journalSets.every(([, values]) => (
    Object.keys(values).filter((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX)).length === 1
  )));
  assert.notEqual(Object.keys(journalSets[0][1])[0], Object.keys(journalSets[1][1])[0]);
  assert.ok(webLock.calls.length >= 3);
  assert.ok(webLock.calls.every(([name, options]) => (
    name === SHARED_STATE_LOCK_NAME && options?.mode === 'exclusive'
  )));
  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first').title,
    'First concurrent',
  );
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-second').title,
    'Second concurrent',
  );
});

test('a delayed created reservation prevents its later removal from being consumed out of order', async () => {
  const original = lifecycleWorkspace();
  let background;
  let releaseCreatedRead;
  let delayedCreatedRead = true;
  const behavior = {
    'storage.local.get': (keys) => {
      if (keys === STORAGE_KEY && delayedCreatedRead) {
        delayedCreatedRead = false;
        return new Promise((resolve) => {
          releaseCreatedRead = () => resolve({
            [STORAGE_KEY]: cloneValue(background.storageLocal[STORAGE_KEY]),
          });
        });
      }
      return { [STORAGE_KEY]: cloneValue(background.storageLocal[STORAGE_KEY]) };
    },
  };
  background = await loadBackground({
    storage: lifecycleStorage(original),
    behavior,
  });
  const transient = makeTab(50, {
    title: 'Transient duplicate',
    url: 'https://same.test/page',
    groupId: -1,
    index: 4,
  });
  background.tabs.set(transient.id, transient);

  background.emitCreated(transient);
  await waitFor(() => typeof releaseCreatedRead === 'function');
  background.tabs.delete(transient.id);
  background.emitRemoved(transient.id, { windowId: 1, isWindowClosing: false });

  await waitFor(() => lifecycleJournalWriteCount(background) === 1);
  await settleAsyncWork();
  assert.equal(lifecycleJournalKeys(background).length, 1);
  assert.deepEqual(
    background.storageLocal[STORAGE_KEY],
    original,
    'the later removal waits instead of being acknowledged before the reserved creation',
  );

  releaseCreatedRead();
  await waitFor(() => lifecycleJournalWriteCount(background) === 2);
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  await settleAsyncWork();

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[transient.id], undefined);
  assert.equal(stored.tabSpaces[transient.id], undefined);
  assert.deepEqual(
    stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .map((tab) => tab.snapshotTabId),
    ['row-first', 'row-second', 'row-other'],
  );
});

test('a late created event cannot resurrect a missing tab but survives a transient lookup failure', async () => {
  const original = lifecycleWorkspace();
  const missing = await loadBackground({
    storage: lifecycleStorage(original),
  });
  const capturedMissingTab = makeTab(55, {
    title: 'Already compensated duplicate',
    url: 'https://same.test/page',
    groupId: -1,
    index: 4,
  });
  await emitAndDrain(missing, () => missing.emitCreated(capturedMissingTab));
  assert.deepEqual(missing.storageLocal[STORAGE_KEY], original);
  assert.equal(
    missing.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups
      .some((group) => group.title === 'Ungrouped'),
    false,
  );

  const capturedLiveTab = makeTab(56, {
    title: 'Captured through lookup failure',
    url: 'https://captured-live.test/page',
    groupId: -1,
    index: 5,
  });
  const queryFailure = await loadBackground({
    tabs: [capturedLiveTab],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.get': async () => { throw new Error('Tabs permission temporarily unavailable'); },
    },
  });
  await emitAndDrain(queryFailure, () => queryFailure.emitCreated(capturedLiveTab));
  const stored = queryFailure.storageLocal[STORAGE_KEY];
  const binding = stored.tabLifecycle[capturedLiveTab.id];
  assert.equal(binding.spaceId, 'work');
  assert.equal(binding.url, capturedLiveTab.url);
  assert.equal(stored.tabSpaces[capturedLiveTab.id], 'work');
  assert.equal(
    stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .filter((tab) => tab.snapshotTabId === binding.snapshotTabId).length,
    1,
  );

  for (const [eventId, rawEvent, expectedGroupId] of [
    ['captured-explicit-group', { groupId: -1 }, -1],
    ['captured-default-group', {}, -1],
  ]) {
    const tabId = eventId === 'captured-explicit-group' ? 57 : 58;
    queryFailure.storageSession[`${LIFECYCLE_EVENT_PREFIX}${eventId}`] = {
      type: 'created',
      tabId,
      tab: {
        id: tabId,
        title: `Recovered ${eventId}`,
        url: `https://${eventId}.test/`,
        windowId: 1,
      },
      windowSpaceId: 'work',
      eventId,
      capturedAt: tabId,
      sequence: tabId,
      ...rawEvent,
    };
    await queryFailure.startup();
    await waitFor(() => !Object.hasOwn(
      queryFailure.storageSession,
      `${LIFECYCLE_EVENT_PREFIX}${eventId}`,
    ));
    assert.equal(queryFailure.storageLocal[STORAGE_KEY].tabLifecycle[tabId].groupId, expectedGroupId);
  }
});

test('a failed lifecycle capture releases its reservation and cannot stall later events', async () => {
  let background;
  let rejectNextLocalRead = true;
  const behavior = {
    'storage.local.get': (keys) => {
      if (keys === STORAGE_KEY && rejectNextLocalRead) {
        rejectNextLocalRead = false;
        throw new Error('capture read unavailable');
      }
      return { [STORAGE_KEY]: cloneValue(background.storageLocal[STORAGE_KEY]) };
    },
  };
  background = await loadBackground({
    storage: lifecycleStorage(),
    behavior,
  });
  const transient = makeTab(60, { title: 'Failed capture', groupId: -1 });
  background.tabs.set(transient.id, transient);

  const errors = await captureConsoleErrors(async (captured) => {
    background.emitCreated(transient);
    await waitFor(() => captured.length > 0);
  });
  assert.match(String(errors[0][0]), /lifecycle event capture failed/i);
  assert.match(String(errors[0][1]), /capture read unavailable/i);
  assert.deepEqual(
    (await background.send({ type: 'tabs:list' })).pendingLifecycleTabIds,
    [],
  );

  const previousJournalWrites = lifecycleJournalWriteCount(background);
  background.tabs.delete(transient.id);
  background.emitRemoved(transient.id, { windowId: 1, isWindowClosing: false });
  await waitForLifecycleAfter(background, previousJournalWrites);
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[transient.id], undefined);
});

test('a failed local write keeps the journal durable and startup retries without losing the user change', async () => {
  const original = lifecycleWorkspace();
  const background = await loadBackground({
    storage: lifecycleStorage(original),
    behavior: {
      'storage.local.set': async () => {
        throw new Error('disk quota temporarily unavailable');
      },
    },
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  const errors = await captureConsoleErrors(async (captured) => {
    background.emitRemoved(11, { windowId: 1, isWindowClosing: false });
    await waitFor(() => lifecycleJournalWriteCount(background) > previousJournalWrites);
    await waitFor(() => captured.length > 0);
    await settleAsyncWork();
  });

  assert.match(String(errors[0][0]), /lifecycle journal failed/i);
  assert.match(String(errors[0][1]), /disk quota temporarily unavailable/i);
  assert.equal(lifecycleJournalKeys(background).length, 1);
  assert.deepEqual(background.storageLocal[STORAGE_KEY], original);

  delete background.behavior['storage.local.set'];
  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-first', 'row-other'],
  );
  assert.equal(stored.tabLifecycle[11], undefined);
});

test('an acknowledgement failure replays an already-written event idempotently on startup', async () => {
  const background = await loadBackground({
    storage: lifecycleStorage(),
    behavior: {
      'storage.session.remove': async () => {
        throw new Error('session acknowledgement failed');
      },
    },
  });
  const previousJournalWrites = lifecycleJournalWriteCount(background);
  const errors = await captureConsoleErrors(async (captured) => {
    background.emitUpdated(10, { title: 'Written before ack' }, makeTab(10, { groupId: 100 }));
    await waitFor(() => lifecycleJournalWriteCount(background) > previousJournalWrites);
    await waitFor(() => captured.length > 0);
    await settleAsyncWork();
  });

  assert.match(String(errors[0][1]), /session acknowledgement failed/i);
  assert.equal(lifecycleJournalKeys(background).length, 1);
  let stored = background.storageLocal[STORAGE_KEY];
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first').title,
    'Written before ack',
  );
  const writesBeforeReplay = background.calls.filter(([name]) => name === 'storage.local.set').length;

  delete background.behavior['storage.session.remove'];
  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  stored = background.storageLocal[STORAGE_KEY];
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.find((tab) => tab.snapshotTabId === 'row-first').title,
    'Written before ack',
  );
  assert.equal(
    stored.spaceSnapshots.work.groups[0].tabs.filter((tab) => tab.snapshotTabId === 'row-first').length,
    1,
  );
  assert.equal(
    background.calls.filter(([name]) => name === 'storage.local.set').length,
    writesBeforeReplay + 1,
  );
});

test('runtime startup drains a journal entry left by an earlier worker', async () => {
  const startupKey = `${LIFECYCLE_EVENT_PREFIX}startup-event`;
  const webLock = createControllableWebLock();
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [startupKey]: {
        type: 'removed',
        tabId: 11,
        windowId: 1,
        isWindowClosing: false,
        eventId: 'startup-event',
        capturedAt: 200,
        sequence: 2,
      },
    }),
    webLock,
  });

  assert.ok(Object.hasOwn(background.storageSession, startupKey));
  await background.startup();
  await waitFor(() => background.storageSession[startupKey] === undefined);
  const stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual(
    stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-first', 'row-other'],
  );
  assert.equal(stored.tabLifecycle[11], undefined);
  assert.equal(webLock.calls.length, 2);
  assert.ok(webLock.calls.every(([name, options]) => (
    name === SHARED_STATE_LOCK_NAME && options.mode === 'exclusive'
  )));
});

test('journal ordering is deterministic when timestamps and worker-local sequences tie', async () => {
  const firstKey = `${LIFECYCLE_EVENT_PREFIX}same-time-a`;
  const secondKey = `${LIFECYCLE_EVENT_PREFIX}same-time-b`;
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [secondKey]: {
        type: 'updated', tabId: 10, changeInfo: { title: 'Second by key' },
        eventId: 'same-time-b', capturedAt: 500, sequence: 1,
      },
      [firstKey]: {
        type: 'updated', tabId: 10, changeInfo: { title: 'First by key' },
        eventId: 'same-time-a', capturedAt: 500, sequence: 1,
      },
    }),
  });
  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);

  const row = background.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(row.title, 'Second by key');
});

test('a missing browser session id creates a new session and drops recycled live ids', async () => {
  const journalKey = `${LIFECYCLE_EVENT_PREFIX}new-browser-session`;
  const storage = lifecycleStorage(lifecycleWorkspace(), {
    [journalKey]: {
      type: 'updated', tabId: 10, changeInfo: { title: 'Must not touch a recycled id' },
      eventId: 'new-browser-session', capturedAt: 600, sequence: 1,
    },
  });
  delete storage.session[BROWSER_SESSION_STORAGE_KEY];
  const background = await loadBackground({ storage });
  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);

  const sessionId = background.storageSession[BROWSER_SESSION_STORAGE_KEY];
  assert.match(sessionId, /^[A-Za-z0-9._:-]{1,200}$/);
  assert.notEqual(sessionId, LIFECYCLE_SESSION_ID);
  assert.deepEqual(background.storageLocal[STORAGE_KEY].tabLifecycle, {});
  assert.deepEqual(background.storageLocal[STORAGE_KEY].spaceSnapshots.work, lifecycleSnapshot());
});

test('relative tab moves validate their public contract and reject invalid Chrome positions', async () => {
  const background = await loadBackground({
    tabs: [
      makeTab(1, { index: 0 }),
      makeTab(2, { index: 1 }),
      makeTab(3, { index: Number.NaN }),
    ],
  });

  for (const [message, error] of [
    [{ tabId: 'not-a-tab', anchorTabId: 2, edge: 'before', expectedGroupId: -1 },
      'A live source tab and anchor tab are required for this move.'],
    [{ tabId: 1, anchorTabId: -2, edge: 'before', expectedGroupId: -1 },
      'A live source tab and anchor tab are required for this move.'],
    [{ tabId: 1, anchorTabId: 2, edge: 'sideways', expectedGroupId: -1 },
      'A tab move must be before or after its anchor.'],
    [{ tabId: 1, anchorTabId: 2, edge: 'before', expectedGroupId: -2 },
      'A valid target tab group is required for this move.'],
  ]) {
    assert.deepEqual(await background.send({ type: 'tabs:moveRelative', ...message }), {
      ok: false,
      error,
    });
  }

  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 1,
    edge: 'before',
    expectedGroupId: -1,
  }), { ok: true });
  assert.deepEqual(await background.send({
    type: 'tabs:moveRelative',
    tabId: 3,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: -1,
  }), { ok: false, error: 'Chrome returned an invalid tab position.' });
});

test('relative tab moves report stale tabs at the exact read or verification stage', async () => {
  const missingAtRead = await loadBackground({ tabs: [makeTab(2, { index: 1 })] });
  const readResponse = await missingAtRead.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: -1,
  });
  assert.equal(readResponse.ok, true);
  assert.equal(readResponse.missing, true);
  assert.equal(readResponse.missingStage, 'reading source and anchor tabs');
  assert.match(readResponse.missingMessage, /No tab with id: 1/);

  let getCalls = 0;
  const missingDuringVerification = await loadBackground({
    tabs: [makeTab(1, { index: 0 }), makeTab(2, { index: 1 })],
    behavior: {
      'tabs.get': async (tabId) => {
        getCalls += 1;
        if (getCalls > 2 && Number(tabId) === 1) throw missingTab(tabId);
        return makeTab(Number(tabId), { index: Number(tabId) - 1 });
      },
    },
  });
  const verifyResponse = await missingDuringVerification.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: -1,
  });
  assert.equal(verifyResponse.ok, true);
  assert.equal(verifyResponse.missing, true);
  assert.equal(verifyResponse.missingStage, 'verifying the moved tab');
  assert.match(verifyResponse.missingMessage, /No tab with id: 1/);
});

test('relative tab moves verify Chrome placement and retry temporary drag conflicts', async () => {
  const noOpMove = await loadBackground({
    tabs: [makeTab(1, { index: 0 }), makeTab(2, { index: 1 })],
    behavior: {
      'tabs.move': async () => undefined,
    },
  });
  assert.deepEqual(await noOpMove.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'after',
    expectedGroupId: -1,
  }), { ok: false, error: 'Chrome did not place the tab at the requested position.' });

  let groupChangingMove;
  groupChangingMove = await loadBackground({
    tabs: [makeTab(1, { index: 0 }), makeTab(2, { index: 1 })],
    behavior: {
      'tabs.move': async () => {
        groupChangingMove.tabs.get(2).index = 0;
        groupChangingMove.tabs.get(1).index = 1;
        groupChangingMove.tabs.get(1).groupId = 7;
      },
    },
  });
  assert.deepEqual(await groupChangingMove.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'after',
    expectedGroupId: -1,
  }), { ok: false, error: 'Chrome did not place the tab at the requested position.' });

  let attempts = 0;
  let retryingMove;
  retryingMove = await loadBackground({
    tabs: [makeTab(1, { index: 0 }), makeTab(2, { index: 1 })],
    behavior: {
      'tabs.move': async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
        }
        retryingMove.tabs.get(2).index = 0;
        retryingMove.tabs.get(1).index = 1;
      },
    },
  });
  assert.deepEqual(await retryingMove.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'after',
    expectedGroupId: -1,
  }), { ok: true });
  assert.equal(attempts, 2);

  attempts = 0;
  const persistentlyBlocked = await loadBackground({
    tabs: [makeTab(1, { index: 0 }), makeTab(2, { index: 1 })],
    behavior: {
      'tabs.move': async () => {
        attempts += 1;
        throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
      },
    },
  });
  assert.deepEqual(await persistentlyBlocked.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'after',
    expectedGroupId: -1,
  }), {
    ok: false,
    error: 'Tabs cannot be edited right now (user may be dragging a tab).',
  });
  assert.equal(attempts, 3);
});

test('batch ungroup retries temporary drag conflicts and rechecks every requested tab', async () => {
  assert.deepEqual(await (await loadBackground()).send({
    type: 'tabs:ungroup',
    tabIds: null,
  }), { ok: true, missing: true });

  const alreadyUngrouped = await loadBackground({ tabs: [makeTab(1, { groupId: -1 })] });
  assert.deepEqual(await alreadyUngrouped.send({
    type: 'tabs:ungroup',
    tabIds: [1],
  }), { ok: true });
  assert.equal(alreadyUngrouped.calls.some(([name]) => name === 'tabs.ungroup'), false);

  let attempts = 0;
  let retryingUngroup;
  retryingUngroup = await loadBackground({
    tabs: [makeTab(1, { groupId: 7 }), makeTab(2, { groupId: 7 })],
    groups: [makeGroup(7)],
    behavior: {
      'tabs.ungroup': async (tabIds) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
        }
        for (const tabId of tabIds) retryingUngroup.tabs.get(Number(tabId)).groupId = -1;
      },
    },
  });
  assert.deepEqual(await retryingUngroup.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), { ok: true });
  assert.equal(attempts, 2);

  attempts = 0;
  let disappearsDuringRetry;
  disappearsDuringRetry = await loadBackground({
    tabs: [makeTab(1, { groupId: 7 }), makeTab(2, { groupId: 7 })],
    groups: [makeGroup(7)],
    behavior: {
      'tabs.ungroup': async () => {
        attempts += 1;
        disappearsDuringRetry.tabs.delete(2);
        throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
      },
    },
  });
  assert.deepEqual(await disappearsDuringRetry.send({
    type: 'tabs:ungroup',
    tabIds: [1, 2],
  }), { ok: true, missing: true });
  assert.equal(attempts, 1);

  attempts = 0;
  const persistentlyBlocked = await loadBackground({
    tabs: [makeTab(1, { groupId: 7 })],
    groups: [makeGroup(7)],
    behavior: {
      'tabs.ungroup': async () => {
        attempts += 1;
        throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
      },
    },
  });
  assert.deepEqual(await persistentlyBlocked.send({
    type: 'tabs:ungroup',
    tabIds: [1],
  }), {
    ok: false,
    error: 'Tabs cannot be edited right now (user may be dragging a tab).',
  });
  assert.equal(attempts, 3);
});

test('native group creation and peer bindings assign new grouped tabs to the durable Space', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.tabLifecycle[42] = {
    tabId: 42,
    snapshotTabId: 'row-focus',
    snapshotGroupId: 'group-focus',
    spaceId: 'focus',
    url: 'https://focus.test/',
    title: 'Focus existing',
    windowId: 1,
    groupId: 200,
    trackingMode: 'live',
    sessionId: LIFECYCLE_SESSION_ID,
  };
  delete state.groupSpaces[200];
  const group = makeGroup(200, { title: 'Focus', color: 'red' });
  const background = await loadBackground({
    tabs: [
      makeTab(42, { groupId: 200, url: 'https://focus.test/' }),
      makeTab(43, { groupId: 200, url: 'https://focus-new.test/' }),
    ],
    groups: [group],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(43)));
  let stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[43].spaceId, 'focus');
  assert.equal(stored.tabLifecycle[43].snapshotGroupId, 'group-focus');
  assert.equal(stored.groupSpaces[200], 'focus');
  assert.equal(stored.spaceSnapshots.focus.groups[0].tabs
    .some((tab) => tab.url === 'https://focus-new.test/'), true);

  const createdGroup = makeGroup(200, {
    title: 'Created natively',
    color: 'orange',
    collapsed: true,
  });
  background.groups.set(200, createdGroup);
  await emitAndDrain(background, () => background.emitGroupCreated(createdGroup));
  stored = background.storageLocal[STORAGE_KEY];
  assert.deepEqual({
    title: stored.spaceSnapshots.focus.groups[0].title,
    color: stored.spaceSnapshots.focus.groups[0].color,
    collapsed: stored.spaceSnapshots.focus.groups[0].collapsed,
  }, { title: 'Created natively', color: 'orange', collapsed: true });
});

test('native grouping of existing cross-Space tabs deterministically uses the target window Space', async () => {
  const runGroupingOrder = async (orderedTabIds, { targetWindowSpace = 'focus' } = {}) => {
    const state = lifecycleWorkspace({ includeFocusSpace: true });
    if (!targetWindowSpace) {
      state.spaces.unshift({ id: '', name: 'No active Space', icon: '', color: 'grey' });
      state.activeSpaceId = '';
    }
    state.groupSpaces[200] = 'focus';
    state.groupSpaces[400] = 'focus';
    state.spaceSnapshots.focus.groups.push({
      snapshotGroupId: 'group-focus-anchor',
      title: 'Focus anchor',
      color: 'purple',
      collapsed: false,
      tabs: [{
        snapshotTabId: 'row-focus-anchor',
        title: 'Focus anchor',
        url: 'https://focus-anchor.test/',
      }],
    });
    state.tabLifecycle[42] = {
      tabId: 42,
      snapshotTabId: 'row-focus',
      snapshotGroupId: 'group-focus',
      spaceId: 'focus',
      url: 'https://focus.test/',
      title: 'Focus existing',
      windowId: 2,
      groupId: 200,
      trackingMode: 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    };
    state.tabLifecycle[10].windowId = 2;
    state.tabLifecycle[43] = {
      tabId: 43,
      snapshotTabId: 'row-focus-anchor',
      snapshotGroupId: 'group-focus-anchor',
      spaceId: 'focus',
      url: 'https://focus-anchor.test/',
      title: 'Focus anchor',
      windowId: 2,
      groupId: 400,
      trackingMode: 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    };
    const groupedTabs = new Map([
      [43, makeTab(43, {
        groupId: 400,
        windowId: 2,
        index: 0,
        title: 'Focus anchor',
        url: 'https://focus-anchor.test/',
      })],
      [10, makeTab(10, { groupId: 300, windowId: 2, index: 1 })],
      [42, makeTab(42, {
        groupId: 300,
        windowId: 2,
        index: 2,
        title: 'Focus existing',
        url: 'https://focus.test/',
      })],
    ]);
    const background = await loadBackground({
      tabs: [...groupedTabs.values()],
      groups: [makeGroup(300, {
        title: 'Native merge', color: 'green', windowId: 2,
      }), makeGroup(400, {
        title: 'Focus anchor', color: 'purple', windowId: 2,
      })],
      storage: lifecycleStorage(state, {
        [WINDOW_STATE_KEY]: {
          activeSpaceIds: { 2: targetWindowSpace || 'not-a-space' },
        },
      }),
    });

    for (const tabId of orderedTabIds) {
      await emitAndDrain(background, () => background.emitUpdated(
        tabId,
        { groupId: 300 },
        groupedTabs.get(tabId),
      ));
    }

    const stored = background.storageLocal[STORAGE_KEY];
    const first = stored.tabLifecycle[10];
    const second = stored.tabLifecycle[42];
    if (!targetWindowSpace) {
      assert.deepEqual([first.spaceId, second.spaceId], ['work', 'focus']);
      assert.equal(stored.groupSpaces[300], undefined);
      assert.equal(stored.tabSpaces[10], 'work');
      assert.equal(stored.tabSpaces[42], 'focus');
      return { first, second, stored };
    }
    assert.deepEqual([first.spaceId, second.spaceId], ['focus', 'focus']);
    assert.equal(first.snapshotGroupId, second.snapshotGroupId);
    assert.equal(stored.groupSpaces[300], 'focus');
    assert.equal(stored.tabSpaces[10], undefined);
    assert.equal(stored.tabSpaces[42], undefined);
    assert.deepEqual(stored.groupOrder.focus.slice(0, 2), ['group:400', 'group:300']);
    assert.equal(stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .some((tab) => ['row-first', 'row-focus'].includes(tab.snapshotTabId)), false);
    assert.deepEqual(stored.spaceSnapshots.focus.groups.flatMap((group) => group.tabs)
      .filter((tab) => ['row-first', 'row-focus'].includes(tab.snapshotTabId))
      .map((tab) => tab.snapshotTabId).sort(), ['row-first', 'row-focus']);
    return { first, second, stored };
  };

  await runGroupingOrder([10, 42]);
  await runGroupingOrder([42, 10]);
  await runGroupingOrder([10, 42], { targetWindowSpace: '' });
});

test('a failed physical membership query never lets event order claim an unowned cross-Space group', async () => {
  const runUpdateOrder = async (updateOrder) => {
    const state = lifecycleWorkspace({ includeFocusSpace: true });
    state.groupSpaces[200] = 'focus';
    state.tabLifecycle[10].windowId = 2;
    state.tabLifecycle[42] = {
      tabId: 42,
      snapshotTabId: 'row-focus',
      snapshotGroupId: 'group-focus',
      spaceId: 'focus',
      url: 'https://focus.test/',
      title: 'Focus existing',
      windowId: 2,
      groupId: 200,
      trackingMode: 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    };
    const background = await loadBackground({
      tabs: [
        makeTab(42, { groupId: 300, windowId: 2, index: 0, url: 'https://focus.test/' }),
        makeTab(10, { groupId: 300, windowId: 2, index: 1 }),
      ],
      groups: [makeGroup(300, { windowId: 2 })],
      storage: lifecycleStorage(state, {
        [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'focus' } },
      }),
      behavior: {
        'tabs.query': async () => { throw new Error('physical membership unavailable'); },
      },
    });

    for (const tabId of updateOrder) {
      await emitAndDrain(background, () => background.emitUpdated(
        tabId,
        { groupId: 300 },
        background.tabs.get(tabId),
      ));
    }

    const stored = background.storageLocal[STORAGE_KEY];
    assert.deepEqual([stored.tabLifecycle[10].spaceId, stored.tabLifecycle[42].spaceId], [
      'work', 'focus',
    ]);
    assert.equal(stored.groupSpaces[300], undefined);
    assert.deepEqual([stored.tabLifecycle[10].groupId, stored.tabLifecycle[42].groupId], [100, 200]);
    assert.equal(stored.tabSpaces[10], 'work');
    assert.equal(stored.tabSpaces[42], undefined);
    assert.equal(stored.spaceSnapshots.work.groups[0].tabs
      .some((tab) => tab.snapshotTabId === 'row-first'), true);
    assert.equal(stored.spaceSnapshots.focus.groups[0].tabs
      .some((tab) => tab.snapshotTabId === 'row-focus'), true);
  };

  await runUpdateOrder([10, 42]);
  await runUpdateOrder([42, 10]);
});

test('physical membership recovery reconciles every tab without retaining the first event owner', async () => {
  const runUpdateOrder = async (updateOrder) => {
    const state = lifecycleWorkspace({ includeFocusSpace: true });
    state.groupSpaces[200] = 'focus';
    state.tabLifecycle[10].windowId = 2;
    state.tabLifecycle[42] = {
      tabId: 42, snapshotTabId: 'row-focus', snapshotGroupId: 'group-focus',
      spaceId: 'focus', url: 'https://focus.test/', title: 'Focus existing',
      windowId: 2, groupId: 200, trackingMode: 'live', sessionId: LIFECYCLE_SESSION_ID,
    };
    let queryAttempts = 0;
    const background = await loadBackground({
      tabs: [
        makeTab(42, { groupId: 300, windowId: 2, index: 0, url: 'https://focus.test/' }),
        makeTab(10, { groupId: 300, windowId: 2, index: 1 }),
      ],
      groups: [makeGroup(300, { title: 'Recovered', color: 'green', windowId: 2 })],
      storage: lifecycleStorage(state, {
        [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'focus' } },
      }),
      behavior: {
        'tabs.query': async (query) => {
          queryAttempts += 1;
          if (queryAttempts === 1) throw new Error('first physical query failed');
          return [...background.tabs.values()]
            .filter((tab) => tab.windowId === query.windowId)
            .map((tab) => ({ ...tab }));
        },
      },
    });

    for (const tabId of updateOrder) {
      await emitAndDrain(background, () => background.emitUpdated(
        tabId,
        { groupId: 300 },
        background.tabs.get(tabId),
      ));
    }

    const stored = background.storageLocal[STORAGE_KEY];
    assert.deepEqual([stored.tabLifecycle[42].spaceId, stored.tabLifecycle[10].spaceId], [
      'focus', 'focus',
    ]);
    assert.equal(stored.tabLifecycle[42].snapshotGroupId, stored.tabLifecycle[10].snapshotGroupId);
    assert.equal(stored.groupSpaces[300], 'focus');
    assert.equal(stored.tabSpaces[42], undefined);
    assert.equal(stored.tabSpaces[10], undefined);
    assert.deepEqual(stored.tabOrder.focus['group:300'], [42, 10]);
    const recoveredGroup = stored.spaceSnapshots.focus.groups.find((group) => (
      group.snapshotGroupId === stored.tabLifecycle[10].snapshotGroupId
    ));
    assert.deepEqual({ title: recoveredGroup.title, color: recoveredGroup.color }, {
      title: 'Recovered', color: 'green',
    });
    assert.equal(stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .some((tab) => tab.snapshotTabId === 'row-first'), false);
  };

  await runUpdateOrder([10, 42]);
  await runUpdateOrder([42, 10]);
});

test('early group metadata failure is repaired by the first membership event from physical Chrome state', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.groupSpaces[200] = 'focus';
  state.tabLifecycle[10].windowId = 2;
  state.tabLifecycle[42] = {
    tabId: 42, snapshotTabId: 'row-focus', snapshotGroupId: 'group-focus',
    spaceId: 'focus', url: 'https://focus.test/', title: 'Focus existing',
    windowId: 2, groupId: 200, trackingMode: 'live', sessionId: LIFECYCLE_SESSION_ID,
  };
  const physicalGroup = makeGroup(300, {
    title: 'Physical exact', color: 'orange', collapsed: true, windowId: 2,
  });
  let groupReads = 0;
  const background = await loadBackground({
    tabs: [
      makeTab(42, { groupId: 300, windowId: 2, index: 0, url: 'https://focus.test/' }),
      makeTab(10, { groupId: 300, windowId: 2, index: 1 }),
    ],
    groups: [physicalGroup],
    storage: lifecycleStorage(state, {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'focus' } },
    }),
    behavior: {
      'tabGroups.get': async () => {
        groupReads += 1;
        if (groupReads === 1) throw new Error('first group read failed');
        return { ...physicalGroup };
      },
    },
  });

  await emitAndDrain(background, () => background.emitGroupUpdated(makeGroup(300, {
    title: 'Stale event', color: 'blue', collapsed: false, windowId: 2,
  })));
  assert.equal(background.storageLocal[STORAGE_KEY].groupSpaces[300], undefined);

  await emitAndDrain(background, () => background.emitUpdated(
    10,
    { groupId: 300 },
    background.tabs.get(10),
  ));

  const stored = background.storageLocal[STORAGE_KEY];
  const targetGroup = stored.spaceSnapshots.focus.groups.find((group) => (
    group.snapshotGroupId === stored.tabLifecycle[10].snapshotGroupId
  ));
  assert.deepEqual({
    title: targetGroup.title,
    color: targetGroup.color,
    collapsed: targetGroup.collapsed,
  }, { title: 'Physical exact', color: 'orange', collapsed: true });
  assert.equal(stored.tabLifecycle[42].snapshotGroupId, targetGroup.snapshotGroupId);
  assert.equal(stored.groupSpaces[300], 'focus');
});

test('updated-tab capture waits for the final paired window/workspace transaction state', async () => {
  const runDelayedUpdate = async ({
    initialWindowSpace,
    activeSpaceId = 'work',
    mutate,
    expectedSpace,
    expectedGroupSpace = expectedSpace,
    expectedTabSpace,
  }) => {
    const state = lifecycleWorkspace({ includeFocusSpace: true });
    state.activeSpaceId = activeSpaceId;
    state.groupSpaces[200] = 'focus';
    state.tabLifecycle[10].windowId = 2;
    state.tabLifecycle[42] = {
      tabId: 42,
      snapshotTabId: 'row-focus',
      snapshotGroupId: 'group-focus',
      spaceId: 'focus',
      url: 'https://focus.test/',
      title: 'Focus existing',
      windowId: 2,
      groupId: 200,
      trackingMode: 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    };
    const webLock = createControllableWebLock({ blocked: true });
    const background = await loadBackground({
      tabs: [
        makeTab(42, { groupId: 300, windowId: 2, index: 0, url: 'https://focus.test/' }),
        makeTab(10, { groupId: 300, windowId: 2, index: 1 }),
      ],
      groups: [makeGroup(300, { windowId: 2 })],
      storage: lifecycleStorage(state, {
        [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: initialWindowSpace } },
      }),
      webLock,
    });
    const previousJournalWrites = lifecycleJournalWriteCount(background);
    background.emitUpdated(10, { groupId: 300 }, background.tabs.get(10));
    await waitFor(() => webLock.pendingCount === 1);
    assert.equal(lifecycleJournalWriteCount(background), previousJournalWrites);
    assert.equal(lifecycleJournalKeys(background).length, 0);

    mutate(background.storageSession[WINDOW_STATE_KEY].activeSpaceIds);
    webLock.releaseAll();
    await waitFor(() => lifecycleJournalWriteCount(background) > previousJournalWrites);
    await waitFor(() => lifecycleJournalKeys(background).length === 0);

    const stored = background.storageLocal[STORAGE_KEY];
    assert.equal(stored.tabLifecycle[10].spaceId, expectedSpace);
    assert.equal(stored.groupSpaces[300], expectedGroupSpace === null ? undefined : expectedGroupSpace);
    assert.equal(stored.tabSpaces[10], expectedTabSpace);
  };

  await runDelayedUpdate({
    initialWindowSpace: 'focus',
    mutate: (activeSpaceIds) => { activeSpaceIds[2] = 'work'; },
    expectedSpace: 'work',
  });
  await runDelayedUpdate({
    initialWindowSpace: 'focus',
    mutate: (activeSpaceIds) => { delete activeSpaceIds[2]; },
    expectedSpace: 'work',
  });
  await runDelayedUpdate({
    initialWindowSpace: 'not-a-space',
    activeSpaceId: '',
    mutate: (activeSpaceIds) => { activeSpaceIds[2] = 'focus'; },
    expectedSpace: 'focus',
  });
  await runDelayedUpdate({
    initialWindowSpace: 'not-a-space',
    activeSpaceId: '',
    mutate: () => {},
    expectedSpace: 'work',
    expectedGroupSpace: null,
    expectedTabSpace: 'work',
  });
});

test('membership updates repair moved-before-updated ordering in either update order', async () => {
  const runUpdateOrder = async (updateOrder) => {
    const state = lifecycleWorkspace({ includeFocusSpace: true });
    state.groupSpaces[200] = 'focus';
    state.tabLifecycle[10].windowId = 2;
    state.tabLifecycle[42] = {
      tabId: 42,
      snapshotTabId: 'row-focus',
      snapshotGroupId: 'group-focus',
      spaceId: 'focus',
      url: 'https://focus.test/',
      title: 'Focus existing',
      windowId: 2,
      groupId: 200,
      trackingMode: 'live',
      sessionId: LIFECYCLE_SESSION_ID,
    };
    const background = await loadBackground({
      tabs: [
        makeTab(42, { groupId: 300, windowId: 2, index: 0, url: 'https://focus.test/' }),
        makeTab(10, { groupId: 300, windowId: 2, index: 1 }),
      ],
      groups: [makeGroup(300, { title: 'Native', color: 'green', windowId: 2 })],
      storage: lifecycleStorage(state, {
        [WINDOW_STATE_KEY]: { activeSpaceIds: { 2: 'focus' } },
      }),
    });

    await emitAndDrain(background, () => background.emitMoved(10, {
      windowId: 2, fromIndex: 0, toIndex: 1,
    }));
    assert.deepEqual(
      background.storageLocal[STORAGE_KEY].tabOrder.work['group:300'],
      [42, 10],
    );

    for (const tabId of updateOrder) {
      await emitAndDrain(background, () => background.emitUpdated(
        tabId,
        { groupId: 300 },
        background.tabs.get(tabId),
      ));
    }

    const stored = background.storageLocal[STORAGE_KEY];
    assert.equal(stored.tabOrder.work['group:300'], undefined);
    assert.deepEqual(stored.tabOrder.focus['group:300'], [42, 10]);
    const targetGroup = stored.spaceSnapshots.focus.groups.find((group) => (
      group.snapshotGroupId === stored.tabLifecycle[10].snapshotGroupId
    ));
    assert.deepEqual(targetGroup.tabs.map((tab) => tab.snapshotTabId), ['row-focus', 'row-first']);
    assert.equal(stored.spaceSnapshots.work.groups.flatMap((group) => group.tabs)
      .some((tab) => tab.snapshotTabId === 'row-first'), false);
    assert.equal(stored.groupSpaces[300], 'focus');
  };

  await runUpdateOrder([42, 10]);
  await runUpdateOrder([10, 42]);
});

test('an explicitly empty Chrome group title resolves the existing empty snapshot Tag', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.spaceSnapshots.focus.groups[0].title = '';
  state.groupSpaces[999] = 'focus';
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 999 })],
    groups: [makeGroup(999, { title: '', color: 'red' })],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => background.emitUpdated(
    10,
    { groupId: 999 },
    background.tabs.get(10),
  ));

  const stored = background.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].spaceId, 'focus');
  assert.equal(stored.tabLifecycle[10].snapshotGroupId, 'group-focus');
  assert.equal(stored.spaceSnapshots.focus.groups[0].title, '');

  const nullPhysicalTitleState = lifecycleWorkspace({ includeFocusSpace: true });
  nullPhysicalTitleState.spaceSnapshots.focus.groups[0].title = '';
  nullPhysicalTitleState.groupSpaces[998] = 'focus';
  const nullPhysicalTitle = await loadBackground({
    tabs: [makeTab(10, { groupId: 998 })],
    groups: [makeGroup(998, { title: null, color: 'red' })],
    storage: lifecycleStorage(nullPhysicalTitleState),
  });
  await emitAndDrain(nullPhysicalTitle, () => nullPhysicalTitle.emitUpdated(
    10,
    { groupId: 998 },
    nullPhysicalTitle.tabs.get(10),
  ));
  assert.equal(
    nullPhysicalTitle.storageLocal[STORAGE_KEY].tabLifecycle[10].snapshotGroupId,
    'group-focus',
  );
});

test('lifecycle enrichment remains lossless when Chrome entities disappear or queries fail', async () => {
  const replacement = await loadBackground({ storage: lifecycleStorage() });
  await emitAndDrain(replacement, () => replacement.emitReplaced(20, 11));
  let stored = replacement.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[11], undefined);
  assert.equal(stored.tabLifecycle[20].snapshotTabId, 'row-second');
  assert.equal(stored.tabLifecycle[20].url, 'https://same.test/page');
  assert.deepEqual(stored.tabOrder.work['group:100'], [10, 20, 12]);

  const groupFallback = await loadBackground({ storage: lifecycleStorage() });
  const renamed = makeGroup(100, { title: 'Event metadata', color: 'green', collapsed: true });
  await emitAndDrain(groupFallback, () => groupFallback.emitGroupUpdated(renamed));
  stored = groupFallback.storageLocal[STORAGE_KEY];
  assert.deepEqual({
    title: stored.spaceSnapshots.work.groups[0].title,
    color: stored.spaceSnapshots.work.groups[0].color,
    collapsed: stored.spaceSnapshots.work.groups[0].collapsed,
  }, { title: 'Event metadata', color: 'green', collapsed: true });

  const missingWindow = await loadBackground({
    tabs: [makeTab(10, { groupId: 999, windowId: undefined })],
    groups: [makeGroup(999, { title: 'No window metadata', windowId: undefined })],
    storage: lifecycleStorage(),
  });
  await emitAndDrain(missingWindow, () => missingWindow.emitUpdated(
    10,
    { groupId: 999 },
    missingWindow.tabs.get(10),
  ));
  assert.equal(missingWindow.storageLocal[STORAGE_KEY].tabLifecycle[10].groupId, 999);

  const groupQueryFailure = await loadBackground({
    tabs: [makeTab(10, { groupId: 999, windowId: 1 })],
    groups: [makeGroup(999, { title: 'Query fallback', windowId: 1 })],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.query': async () => { throw new Error('group query unavailable'); },
    },
  });
  await emitAndDrain(groupQueryFailure, () => groupQueryFailure.emitUpdated(
    10,
    { groupId: 999 },
    groupQueryFailure.tabs.get(10),
  ));
  assert.equal(groupQueryFailure.storageLocal[STORAGE_KEY].tabLifecycle[10].groupId, 100);

  const createdQueryFailure = await loadBackground({
    tabs: [makeTab(50, { groupId: 998, windowId: 1 })],
    groups: [makeGroup(998, { title: 'Unowned created group', windowId: 1 })],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.query': async () => { throw new Error('created group query unavailable'); },
    },
  });
  await emitAndDrain(createdQueryFailure, () => createdQueryFailure.emitCreated(
    createdQueryFailure.tabs.get(50),
  ));
  assert.equal(createdQueryFailure.storageLocal[STORAGE_KEY].tabLifecycle[50], undefined);

  const ownedQueryFailureState = lifecycleWorkspace();
  ownedQueryFailureState.groupSpaces[999] = 'work';
  const ownedQueryFailure = await loadBackground({
    tabs: [makeTab(10, { groupId: 999, windowId: 1 })],
    groups: [makeGroup(999, { title: 'Owned query fallback', windowId: 1 })],
    storage: lifecycleStorage(ownedQueryFailureState),
    behavior: {
      'tabs.query': async () => { throw new Error('owned group query unavailable'); },
    },
  });
  await emitAndDrain(ownedQueryFailure, () => ownedQueryFailure.emitUpdated(
    10,
    { groupId: 999 },
    ownedQueryFailure.tabs.get(10),
  ));
  assert.equal(ownedQueryFailure.storageLocal[STORAGE_KEY].groupSpaces[999], 'work');

  const groupMoveFallback = await loadBackground({
    tabs: [makeTab(10, { groupId: 100 }), makeTab(11, { groupId: 100 })],
    groups: [makeGroup(100, { title: 'Docs', collapsed: true })],
    storage: lifecycleStorage(),
  });
  groupMoveFallback.behavior['tabs.query'] = async () => { throw new Error('tab query unavailable'); };
  await emitAndDrain(groupMoveFallback, () => groupMoveFallback.emitGroupMoved(
    makeGroup(100, { title: 'Docs', collapsed: true }),
  ));
  stored = groupMoveFallback.storageLocal[STORAGE_KEY];
  assert.equal(stored.groupOrder.work, undefined);
  assert.equal(stored.spaceSnapshots.work.groups[0].collapsed, true);

  const movedTabMissing = await loadBackground({ storage: lifecycleStorage() });
  await emitAndDrain(movedTabMissing, () => movedTabMissing.emitMoved(10, {
    windowId: 1,
    fromIndex: 0,
    toIndex: 2,
  }));
  stored = movedTabMissing.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].index, 2);
  assert.deepEqual(stored.tabOrder.work['group:100'], [10, 11, 12]);

  const movedQueryFailure = await loadBackground({
    tabs: [makeTab(10, { groupId: 100, index: 2 })],
    storage: lifecycleStorage(),
  });
  movedQueryFailure.behavior['tabs.query'] = async () => { throw new Error('tab query unavailable'); };
  await emitAndDrain(movedQueryFailure, () => movedQueryFailure.emitMoved(10, {
    windowId: 1,
    fromIndex: 0,
    toIndex: 2,
  }));
  stored = movedQueryFailure.storageLocal[STORAGE_KEY];
  assert.equal(stored.tabLifecycle[10].index, 2);
  assert.deepEqual(stored.tabOrder.work['group:100'], [10, 11, 12]);
  assert.deepEqual(stored.spaceSnapshots.work.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'row-first', 'row-second', 'row-other',
  ]);
});

test('a failed suppression cleanup preserves the original Chrome close error', async () => {
  const background = await loadBackground({
    tabs: [makeTab(10)],
    storage: lifecycleStorage(),
    behavior: {
      'tabs.remove': async () => { throw new Error('Chrome rejected close'); },
      'storage.session.remove': async () => { throw new Error('session cleanup unavailable'); },
    },
  });

  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 10 }), {
    ok: false,
    error: 'Chrome rejected close',
  });
  assert.equal(
    background.storageSession[`${LIFECYCLE_SUPPRESSION_PREFIX}10`]?.disposition,
    'panel-managed',
  );
});

test('partial Chrome event payloads and malformed public ids are harmless no-ops', async () => {
  const background = await loadBackground({ storage: false });
  background.emitCreated(null);
  background.emitRemoved(1);
  background.emitUpdated(1, { title: '' }, null);
  background.emitUpdated(1, { status: 'complete' }, null);
  background.emitUpdated(1, null, null);
  background.emitMoved(1, { windowId: 1, fromIndex: 0, toIndex: 1 });
  background.emitGroupUpdated({ id: 1 });
  background.emitGroupUpdated({ id: 1, title: null });
  await settleAsyncWork();

  assert.deepEqual(await background.send({ type: 'tabs:close', tabId: 'not-a-tab' }), { ok: true });
  assert.deepEqual(await background.send({ type: 'tabs:group', tabIds: null }), {
    ok: true,
    groupId: null,
    missing: true,
  });

  const defaultCapture = await loadBackground({
    tabs: [makeTab(50, { title: 'Captured from defaults' })],
    storage: { local: {}, session: {} },
  });
  await emitAndDrain(defaultCapture, () => defaultCapture.emitUpdated(
    50,
    { title: 'Captured from defaults' },
    defaultCapture.tabs.get(50),
  ));
  assert.equal(defaultCapture.storageLocal[STORAGE_KEY].tabLifecycle[50].title, 'Captured from defaults');
});

test('openUnique closes every duplicate in one Chrome call when session storage is unavailable', async () => {
  const background = await loadBackground({
    storage: false,
    tabs: [
      makeTab(1, { url: 'https://app.test/old', active: true }),
      makeTab(2, { url: 'https://app.test/duplicate-a' }),
      makeTab(3, { url: 'https://app.test/duplicate-b' }),
    ],
  });

  const response = await background.send({
    type: 'tabs:openUnique',
    url: 'https://app.test/current',
    matchUrl: 'https://app.test/',
    preferredTabId: 1,
  });
  assert.equal(response.ok, true);
  assert.equal(response.reused, true);
  assert.equal(response.closedDuplicates, 2);
  assert.deepEqual(background.calls.findLast(([name]) => name === 'tabs.remove'), [
    'tabs.remove', [2, 3],
  ]);
  assert.deepEqual([...background.tabs.keys()], [1]);
});

test('expired panel-close suppression is treated as a native close and acknowledged', async () => {
  const suppressionKey = `${LIFECYCLE_SUPPRESSION_PREFIX}10`;
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [suppressionKey]: {
        tabId: 10,
        disposition: 'panel-managed',
        createdAt: 0,
      },
    }),
  });

  await emitAndDrain(background, () => background.emitRemoved(10, {
    windowId: 1,
    isWindowClosing: false,
  }));
  assert.equal(background.storageSession[suppressionKey], undefined);
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[10], undefined);
  assert.deepEqual(
    background.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups[0].tabs
      .map((tab) => tab.snapshotTabId),
    ['row-second', 'row-other'],
  );
});

test('lifecycle ids fall back safely when randomUUID is unavailable', async () => {
  const ownDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    const storage = lifecycleStorage();
    delete storage.session[BROWSER_SESSION_STORAGE_KEY];
    const background = await loadBackground({
      tabs: [makeTab(10, { groupId: 100, title: 'Fallback UUID' })],
      groups: [makeGroup(100)],
      storage,
    });
    await emitAndDrain(background, () => background.emitUpdated(
      10,
      { title: 'Fallback UUID' },
      background.tabs.get(10),
    ));

    assert.match(background.storageSession[BROWSER_SESSION_STORAGE_KEY], /^\d+-[a-z0-9]+$/);
    const journalWrite = background.calls.find(([name, values]) => (
      name === 'storage.session.set' && Object.keys(values || {})
        .some((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX))
    ));
    assert.ok(journalWrite);
    assert.match(
      Object.keys(journalWrite[1]).find((key) => key.startsWith(LIFECYCLE_EVENT_PREFIX)),
      /^spaceTabsLifecycleEvent:\d+-\d+-[a-z0-9]+$/,
    );
  } finally {
    if (ownDescriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', ownDescriptor);
    else delete globalThis.crypto.randomUUID;
  }
});

test('journal ordering and window ids remain deterministic with incomplete persisted events', async () => {
  const keys = {
    nullUpdate: `${LIFECYCLE_EVENT_PREFIX}null-update`,
    missingOrderA: `${LIFECYCLE_EVENT_PREFIX}missing-order-a`,
    missingOrderB: `${LIFECYCLE_EVENT_PREFIX}missing-order-b`,
    first: `${LIFECYCLE_EVENT_PREFIX}ordered-first`,
    second: `${LIFECYCLE_EVENT_PREFIX}ordered-second`,
    last: `${LIFECYCLE_EVENT_PREFIX}ordered-last`,
    groupWindow: `${LIFECYCLE_EVENT_PREFIX}group-window`,
    unknownWindow: `${LIFECYCLE_EVENT_PREFIX}unknown-window`,
  };
  const background = await loadBackground({
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [keys.nullUpdate]: {
        type: 'updated', tabId: 10, changeInfo: null,
        eventId: 'null-update', capturedAt: 0, sequence: 0,
      },
      [keys.missingOrderA]: {
        type: 'removed', tabId: 92,
        eventId: 'missing-order-a',
      },
      [keys.missingOrderB]: {
        type: 'removed', tabId: 93,
        eventId: 'missing-order-b',
      },
      [keys.second]: {
        type: 'updated', tabId: 10, changeInfo: { title: 'Second at same time' },
        eventId: 'ordered-second', capturedAt: 100, sequence: 2,
      },
      [keys.first]: {
        type: 'updated', tabId: 10, changeInfo: { title: 'First at same time' },
        eventId: 'ordered-first', capturedAt: 100, sequence: 1,
      },
      [keys.last]: {
        type: 'updated', tabId: 10, changeInfo: { title: 'Last by timestamp' },
        eventId: 'ordered-last', capturedAt: 200, sequence: 0,
      },
      [keys.groupWindow]: {
        type: 'removed', tabId: 90, isWindowClosing: true,
        windowId: null, tab: { windowId: null }, group: { windowId: 9 },
        eventId: 'group-window', capturedAt: 300, sequence: 0,
      },
      [keys.unknownWindow]: {
        type: 'removed', tabId: 91, isWindowClosing: true,
        eventId: 'unknown-window', capturedAt: 400, sequence: 0,
      },
    }),
  });

  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  const row = background.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups[0].tabs
    .find((tab) => tab.snapshotTabId === 'row-first');
  assert.equal(row.title, 'Last by timestamp');
  assert.deepEqual(Object.values(keys).filter((key) => Object.hasOwn(background.storageSession, key)), []);
});

test('window cleanup and title refresh tolerate missing browser metadata', async () => {
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: 100, title: '' })],
    groups: [makeGroup(100)],
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 1: 'work' } },
    }),
  });
  const before = structuredClone(background.storageSession[WINDOW_STATE_KEY]);
  background.emitWindowRemoved(99);
  await settleAsyncWork();
  assert.deepEqual(background.storageSession[WINDOW_STATE_KEY], before);

  await emitAndDrain(background, () => background.emitUpdated(
    10,
    { title: '' },
    background.tabs.get(10),
  ));
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[10].title, '');
});

test('ambiguous native group ownership never guesses a durable Space or Tag', async () => {
  const noBoundSnapshot = lifecycleWorkspace();
  noBoundSnapshot.groupSpaces[300] = 'work';
  noBoundSnapshot.tabLifecycle[42] = {
    tabId: 42,
    snapshotTabId: '',
    snapshotGroupId: null,
    spaceId: null,
    groupId: 300,
    sessionId: LIFECYCLE_SESSION_ID,
  };
  const noTarget = await loadBackground({
    groups: [makeGroup(300, { title: 'Unknown group' })],
    storage: lifecycleStorage(noBoundSnapshot),
  });
  const originalSnapshot = structuredClone(noTarget.storageLocal[STORAGE_KEY].spaceSnapshots.work);
  await emitAndDrain(noTarget, () => noTarget.emitGroupUpdated(makeGroup(300, {
    title: 'Must not overwrite a Tag',
  })));
  assert.deepEqual(noTarget.storageLocal[STORAGE_KEY].spaceSnapshots.work, originalSnapshot);

  const conflictingSpaces = lifecycleWorkspace({ includeFocusSpace: true });
  conflictingSpaces.groupSpaces[300] = 'work';
  conflictingSpaces.tabLifecycle[42] = {
    tabId: 42,
    snapshotTabId: 'row-focus',
    snapshotGroupId: 'group-focus',
    spaceId: 'focus',
    groupId: 300,
    sessionId: LIFECYCLE_SESSION_ID,
  };
  const conflictingOwner = await loadBackground({
    groups: [makeGroup(300)],
    storage: lifecycleStorage(conflictingSpaces),
  });
  await emitAndDrain(conflictingOwner, () => conflictingOwner.emitGroupUpdated(makeGroup(300, {
    title: 'Ambiguous owner',
  })));
  assert.equal(conflictingOwner.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups[0].title, 'Docs');
  assert.equal(conflictingOwner.storageLocal[STORAGE_KEY].spaceSnapshots.focus.groups[0].title, 'Focus');

  const conflictingTags = lifecycleWorkspace();
  conflictingTags.groupSpaces[300] = 'work';
  conflictingTags.tabLifecycle[42] = {
    tabId: 42, snapshotTabId: 'row-first', snapshotGroupId: 'group-docs',
    spaceId: 'work', groupId: 300, sessionId: LIFECYCLE_SESSION_ID,
  };
  conflictingTags.tabLifecycle[43] = {
    tabId: 43, snapshotTabId: 'row-other', snapshotGroupId: 'group-other',
    spaceId: 'work', groupId: 300, sessionId: LIFECYCLE_SESSION_ID,
  };
  const ambiguousTags = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [makeGroup(300)],
    storage: lifecycleStorage(conflictingTags),
  });
  await emitAndDrain(ambiguousTags, () => ambiguousTags.emitCreated(ambiguousTags.tabs.get(50)));
  assert.equal(ambiguousTags.storageLocal[STORAGE_KEY].tabLifecycle[50].spaceId, 'work');
  assert.notEqual(ambiguousTags.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId, 'group-docs');
  assert.notEqual(ambiguousTags.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId, 'group-other');
});

test('lifecycle group fallbacks handle invalid records, missing APIs, and duplicate metadata safely', async () => {
  const invalidGroup = await loadBackground({ storage: lifecycleStorage() });
  await emitAndDrain(invalidGroup, () => invalidGroup.emitGroupUpdated(makeGroup(-1, { windowId: undefined })));
  assert.deepEqual(invalidGroup.storageLocal[STORAGE_KEY].spaceSnapshots.work, lifecycleSnapshot());

  const noGroupApiState = lifecycleWorkspace();
  noGroupApiState.groupSpaces[300] = 'work';
  noGroupApiState.tabLifecycle[42] = {
    tabId: 42, snapshotTabId: 'row-first', snapshotGroupId: 'group-docs',
    spaceId: 'work', groupId: 300, sessionId: LIFECYCLE_SESSION_ID,
  };
  const noGroupApi = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    storage: lifecycleStorage(noGroupApiState),
  });
  noGroupApi.chrome.tabGroups.get = undefined;
  await emitAndDrain(noGroupApi, () => noGroupApi.emitCreated(noGroupApi.tabs.get(50)));
  assert.equal(noGroupApi.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId, 'group-docs');

  const duplicateMetadata = lifecycleWorkspace();
  duplicateMetadata.groupSpaces[300] = 'work';
  duplicateMetadata.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-docs-copy',
    title: 'Docs',
    color: 'blue',
    collapsed: false,
    tabs: [],
  });
  const ambiguousMetadata = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [makeGroup(300, { title: 'Docs', color: 'blue' })],
    storage: lifecycleStorage(duplicateMetadata),
  });
  await emitAndDrain(ambiguousMetadata, () => ambiguousMetadata.emitCreated(
    ambiguousMetadata.tabs.get(50),
  ));
  assert.notEqual(
    ambiguousMetadata.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId,
    'group-docs',
  );
  assert.notEqual(
    ambiguousMetadata.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId,
    'group-docs-copy',
  );
});

test('an exact restored tab-group binding keeps its historical Tag identity', async () => {
  const state = lifecycleWorkspace();
  state.groupSpaces[300] = 'work';
  state.tabLifecycle[50] = {
    tabId: 50,
    snapshotTabId: 'restored-row',
    snapshotGroupId: 'restored-historical-group',
    spaceId: 'work',
    groupId: 300,
    sessionId: LIFECYCLE_SESSION_ID,
  };
  const background = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [makeGroup(300, { title: 'Restored physical Tag', color: 'purple' })],
    storage: lifecycleStorage(state),
  });

  await emitAndDrain(background, () => background.emitUpdated(
    50,
    { groupId: 300 },
    background.tabs.get(50),
  ));

  assert.equal(
    background.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId,
    'restored-historical-group',
  );
});

test('ownerless lifecycle updates and moves avoid inventing group ownership', async () => {
  const state = lifecycleWorkspace();
  state.tabLifecycle[10].spaceId = '';
  state.tabLifecycle[10].groupId = -1;
  state.tabSpaces = {};
  const background = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 }), makeTab(99, { groupId: -1, index: 4 })],
    storage: lifecycleStorage(state),
  });
  await emitAndDrain(background, () => background.emitUpdated(
    10,
    { groupId: -1 },
    background.tabs.get(10),
  ));
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, '');

  const before = structuredClone(background.storageLocal[STORAGE_KEY]);
  await emitAndDrain(background, () => background.emitMoved(99, {
    windowId: 1,
    fromIndex: 1,
    toIndex: 4,
  }));
  assert.deepEqual(background.storageLocal[STORAGE_KEY], before);
});

test('raw Chrome error strings preserve missing and temporary-move semantics', async () => {
  const missing = await loadBackground({
    tabs: [makeTab(1), makeTab(2)],
    behavior: {
      'tabs.get': async () => { throw 'No tab with id: 1'; },
    },
  });
  assert.deepEqual(await missing.send({
    type: 'tabs:moveRelative',
    tabId: 1,
    anchorTabId: 2,
    edge: 'before',
    expectedGroupId: -1,
  }), {
    ok: true,
    missing: true,
    missingStage: 'reading source and anchor tabs',
    missingMessage: 'No tab with id: 1',
  });

  let attempts = 0;
  const blocked = await loadBackground({
    tabs: [makeTab(1)],
    behavior: {
      'tabs.move': async () => {
        attempts += 1;
        throw 'Tabs cannot be edited right now (user may be dragging a tab).';
      },
    },
  });
  assert.deepEqual(await blocked.send({ type: 'tabs:move', tabId: 1, index: 0 }), {
    ok: false,
    error: 'Tabs cannot be edited right now (user may be dragging a tab).',
  });
  assert.equal(attempts, 3);
});

test('created-tab capture handles invalid windows and an empty durable Space id', async () => {
  const invalidWindow = await loadBackground({
    tabs: [makeTab(50, { windowId: undefined, groupId: -1 })],
    storage: lifecycleStorage(),
  });
  await emitAndDrain(invalidWindow, () => invalidWindow.emitCreated(invalidWindow.tabs.get(50)));
  assert.equal(invalidWindow.storageLocal[STORAGE_KEY].tabLifecycle[50].spaceId, 'work');

  const emptySpaceState = lifecycleWorkspace();
  emptySpaceState.spaces = [
    { id: '', name: 'Blank', icon: '', color: 'blue' },
    { id: 'work', name: 'Work', icon: 'W', color: 'blue' },
  ];
  emptySpaceState.activeSpaceId = '';
  const noWindowSpace = await loadBackground({
    tabs: [makeTab(51, { windowId: 1, groupId: -1 })],
    storage: lifecycleStorage(emptySpaceState, {
      [WINDOW_STATE_KEY]: { activeSpaceIds: { 1: 'not-a-space' } },
    }),
  });
  await emitAndDrain(noWindowSpace, () => noWindowSpace.emitCreated(noWindowSpace.tabs.get(51)));
  assert.equal(noWindowSpace.storageLocal[STORAGE_KEY].tabLifecycle[51], undefined);
});

test('closing an unmapped window also tolerates a missing window-state record', async () => {
  const background = await loadBackground({ storage: lifecycleStorage() });
  background.emitWindowRemoved(99);
  await settleAsyncWork();
  assert.equal(background.storageSession[WINDOW_STATE_KEY], undefined);
});

test('persisted created and group events tolerate omitted ids and invalid records', async () => {
  const createdKey = `${LIFECYCLE_EVENT_PREFIX}created-tab-fallback`;
  const groupKey = `${LIFECYCLE_EVENT_PREFIX}group-id-fallback`;
  const background = await loadBackground({
    tabs: [makeTab(50, { groupId: -1, windowId: 1 })],
    groups: [makeGroup(300, { title: 'Unbound' })],
    storage: lifecycleStorage(lifecycleWorkspace(), {
      [createdKey]: {
        type: 'created',
        tab: makeTab(50, { groupId: -1, windowId: 1 }),
        windowSpaceId: 'work',
        eventId: 'created-tab-fallback',
        capturedAt: 100,
        sequence: 1,
      },
      [groupKey]: {
        type: 'group-updated',
        group: null,
        groupId: 300,
        eventId: 'group-id-fallback',
        capturedAt: 200,
        sequence: 2,
      },
    }),
  });
  await background.startup();
  await waitFor(() => lifecycleJournalKeys(background).length === 0);
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[50].spaceId, 'work');

  await emitAndDrain(background, () => background.emitCreated({}));
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle.undefined, undefined);
});

test('native group moves skip unrelated and differently-owned Chrome groups', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  state.groupSpaces[300] = 'focus';
  state.tabLifecycle[42] = {
    tabId: 42,
    snapshotTabId: 'row-focus',
    snapshotGroupId: 'group-focus',
    spaceId: 'focus',
    groupId: 300,
    sessionId: LIFECYCLE_SESSION_ID,
  };
  const background = await loadBackground({
    tabs: [
      makeTab(10, { groupId: 100, index: 0 }),
      makeTab(40, { groupId: 200, index: 1 }),
      makeTab(42, { groupId: 300, index: 2 }),
    ],
    groups: [makeGroup(100), makeGroup(200), makeGroup(300)],
    storage: lifecycleStorage(state),
  });
  await emitAndDrain(background, () => background.emitGroupMoved(makeGroup(100, {
    title: 'Docs',
    windowId: 1,
  })));
  assert.deepEqual(background.storageLocal[STORAGE_KEY].groupOrder.work, ['group:100']);
  assert.equal(background.storageLocal[STORAGE_KEY].groupOrder.focus, undefined);
});

test('created tabs reject ambiguous peer Spaces while retaining explicit tab ownership', async () => {
  const state = lifecycleWorkspace({ includeFocusSpace: true });
  delete state.groupSpaces[300];
  state.tabSpaces[50] = 'work';
  state.tabLifecycle[42] = {
    tabId: 42, snapshotTabId: 'row-first', snapshotGroupId: 'group-docs',
    spaceId: 'work', groupId: 300, sessionId: LIFECYCLE_SESSION_ID,
  };
  state.tabLifecycle[43] = {
    tabId: 43, snapshotTabId: 'row-focus', snapshotGroupId: 'group-focus',
    spaceId: 'focus', groupId: 300, sessionId: LIFECYCLE_SESSION_ID,
  };
  const background = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [makeGroup(300)],
    storage: lifecycleStorage(state),
  });
  await emitAndDrain(background, () => background.emitCreated(background.tabs.get(50)));
  assert.equal(background.storageLocal[STORAGE_KEY].tabLifecycle[50].spaceId, 'work');
  assert.notEqual(background.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId, 'group-docs');
  assert.notEqual(background.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId, 'group-focus');
});

test('group target enrichment handles invalid ids, absent Spaces, and mismatched bindings', async () => {
  const invalidId = lifecycleWorkspace();
  invalidId.tabLifecycle[10].provisional = true;
  const invalidGroup = await loadBackground({ storage: lifecycleStorage(invalidId) });
  await emitAndDrain(invalidGroup, () => invalidGroup.emitUpdated(
    10,
    { groupId: undefined },
    makeTab(10, { groupId: undefined }),
  ));
  assert.equal(invalidGroup.storageLocal[STORAGE_KEY].tabLifecycle[10].groupId, 100);

  const noSpace = lifecycleWorkspace();
  noSpace.tabLifecycle[10].spaceId = '';
  noSpace.tabLifecycle[10].groupId = 300;
  noSpace.tabSpaces = {};
  delete noSpace.groupSpaces[300];
  const ownerlessGroup = await loadBackground({
    tabs: [makeTab(10, { groupId: 300 })],
    groups: [makeGroup(300)],
    storage: lifecycleStorage(noSpace),
  });
  await emitAndDrain(ownerlessGroup, () => ownerlessGroup.emitUpdated(
    10,
    { groupId: 300 },
    ownerlessGroup.tabs.get(10),
  ));
  assert.equal(ownerlessGroup.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, '');

  const mismatchedBinding = lifecycleWorkspace({ includeFocusSpace: true });
  mismatchedBinding.tabLifecycle[10].spaceId = 'focus';
  mismatchedBinding.tabLifecycle[10].snapshotGroupId = 'group-focus';
  mismatchedBinding.tabLifecycle[10].groupId = -1;
  mismatchedBinding.tabSpaces[10] = 'work';
  const createdAgain = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(mismatchedBinding),
  });
  await emitAndDrain(createdAgain, () => createdAgain.emitCreated(createdAgain.tabs.get(10)));
  assert.equal(createdAgain.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, 'focus');
  assert.equal(createdAgain.storageLocal[STORAGE_KEY].tabLifecycle[10].snapshotGroupId, 'group-focus');
});

test('ungrouped target enrichment uses stable defaults for missing and blank snapshot groups', async () => {
  const missingSnapshot = lifecycleWorkspace();
  missingSnapshot.spaceSnapshots.work = null;
  missingSnapshot.tabLifecycle[10].groupId = -1;
  const withoutSnapshot = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(missingSnapshot),
  });
  await emitAndDrain(withoutSnapshot, () => withoutSnapshot.emitUpdated(
    10,
    { groupId: -1 },
    withoutSnapshot.tabs.get(10),
  ));
  assert.equal(withoutSnapshot.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, 'work');

  const blankBoundGroup = lifecycleWorkspace();
  blankBoundGroup.spaceSnapshots.work.groups = [{
    snapshotGroupId: 'group-blank',
    title: '',
    color: '',
    collapsed: false,
    tabs: [{ snapshotTabId: 'row-first', title: 'First', url: 'https://same.test/page' }],
  }];
  blankBoundGroup.tabLifecycle[10].snapshotGroupId = 'group-blank';
  blankBoundGroup.tabLifecycle[10].groupId = -1;
  const boundDefaults = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(blankBoundGroup),
  });
  await emitAndDrain(boundDefaults, () => boundDefaults.emitUpdated(
    10,
    { groupId: -1 },
    boundDefaults.tabs.get(10),
  ));
  const storedBlank = boundDefaults.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === 'group-blank');
  assert.equal(storedBlank.title || 'Ungrouped', 'Ungrouped');
  assert.equal(storedBlank.color || 'grey', 'grey');

  const blankExistingGroup = lifecycleWorkspace();
  blankExistingGroup.spaceSnapshots.work.groups.push({
    snapshotGroupId: 'group-empty-ungrouped',
    title: '',
    color: '',
    collapsed: false,
    tabs: [],
  });
  const existingDefaults = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(blankExistingGroup),
  });
  await emitAndDrain(existingDefaults, () => existingDefaults.emitUpdated(
    10,
    { groupId: -1 },
    existingDefaults.tabs.get(10),
  ));
  assert.equal(
    existingDefaults.storageLocal[STORAGE_KEY].tabLifecycle[10].snapshotGroupId,
    'group-empty-ungrouped',
  );
});

test('positive group targets distinguish omitted metadata from an explicitly empty title', async () => {
  const missingSnapshot = lifecycleWorkspace();
  missingSnapshot.groupSpaces[300] = 'work';
  missingSnapshot.spaceSnapshots.work = null;
  const defaultMetadata = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, title: null, color: '', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(missingSnapshot),
  });
  await emitAndDrain(defaultMetadata, () => defaultMetadata.emitCreated(defaultMetadata.tabs.get(50)));
  const defaultGroupId = defaultMetadata.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId;
  const createdDefault = defaultMetadata.storageLocal[STORAGE_KEY].spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === defaultGroupId);
  assert.equal(createdDefault.title, 'Tabs');
  assert.equal(createdDefault.color, 'blue');

  const blankSnapshot = lifecycleWorkspace();
  blankSnapshot.groupSpaces[300] = 'work';
  blankSnapshot.spaceSnapshots.work.groups = [{
    snapshotGroupId: 'group-blank-match',
    title: '',
    color: '',
    collapsed: false,
    tabs: [],
  }];
  const fallbackMatch = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, title: 'Tabs', color: 'blue', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(blankSnapshot),
  });
  await emitAndDrain(fallbackMatch, () => fallbackMatch.emitCreated(fallbackMatch.tabs.get(50)));
  const fallbackStored = fallbackMatch.storageLocal[STORAGE_KEY];
  assert.notEqual(fallbackStored.tabLifecycle[50].snapshotGroupId, 'group-blank-match');
  assert.equal(fallbackStored.spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === 'group-blank-match').title, '');
  assert.equal(fallbackStored.spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === fallbackStored.tabLifecycle[50].snapshotGroupId).title, 'Tabs');
});

test('group target fallbacks handle empty binding Space ids without guessing', async () => {
  const ungroupedState = lifecycleWorkspace();
  ungroupedState.tabLifecycle[10].spaceId = '';
  ungroupedState.tabLifecycle[10].groupId = -1;
  ungroupedState.tabSpaces[10] = 'work';
  const createdAgain = await loadBackground({
    tabs: [makeTab(10, { groupId: -1 })],
    storage: lifecycleStorage(ungroupedState),
  });
  await emitAndDrain(createdAgain, () => createdAgain.emitCreated(createdAgain.tabs.get(10)));
  assert.equal(createdAgain.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, '');

  const groupedState = lifecycleWorkspace();
  groupedState.groupSpaces[300] = 'work';
  groupedState.tabLifecycle[10].spaceId = '';
  groupedState.tabLifecycle[10].groupId = 300;
  groupedState.tabLifecycle[10].provisional = true;
  const grouped = await loadBackground({
    tabs: [makeTab(10, { groupId: 300 })],
    groups: [makeGroup(300, { title: 'Docs', color: 'blue' })],
    storage: lifecycleStorage(groupedState),
  });
  await emitAndDrain(grouped, () => grouped.emitUpdated(
    10,
    { groupId: 300 },
    grouped.tabs.get(10),
  ));
  assert.equal(grouped.storageLocal[STORAGE_KEY].tabLifecycle[10].spaceId, 'work');
  assert.equal(grouped.storageLocal[STORAGE_KEY].tabLifecycle[10].snapshotGroupId, 'group-docs');
});

test('Chrome group metadata matching normalizes missing title and color independently', async () => {
  const missingTitleState = lifecycleWorkspace();
  missingTitleState.groupSpaces[300] = 'work';
  const missingTitle = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, title: '', color: '', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(missingTitleState),
  });
  await emitAndDrain(missingTitle, () => missingTitle.emitCreated(missingTitle.tabs.get(50)));
  assert.equal(missingTitle.storageLocal[STORAGE_KEY].tabLifecycle[50].spaceId, 'work');

  const missingColorState = lifecycleWorkspace();
  missingColorState.groupSpaces[300] = 'work';
  const missingColor = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, title: 'Docs', color: '', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(missingColorState),
  });
  await emitAndDrain(missingColor, () => missingColor.emitCreated(missingColor.tabs.get(50)));
  assert.equal(
    missingColor.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId,
    'group-docs',
  );

  const defaultedSnapshotColor = lifecycleWorkspace();
  defaultedSnapshotColor.groupSpaces[300] = 'work';
  defaultedSnapshotColor.spaceSnapshots.work.groups[0].color = '';
  const defaultedColor = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, title: 'Docs', color: 'blue', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(defaultedSnapshotColor),
  });
  await emitAndDrain(defaultedColor, () => defaultedColor.emitCreated(defaultedColor.tabs.get(50)));
  assert.equal(
    defaultedColor.storageLocal[STORAGE_KEY].tabLifecycle[50].snapshotGroupId,
    'group-docs',
  );

  const omittedTitleState = lifecycleWorkspace();
  omittedTitleState.groupSpaces[300] = 'work';
  omittedTitleState.spaceSnapshots.work.groups = [{
    snapshotGroupId: 'group-without-title',
    color: 'blue',
    collapsed: false,
    tabs: [],
  }];
  const omittedTitle = await loadBackground({
    tabs: [makeTab(50, { groupId: 300 })],
    groups: [{ id: 300, color: 'blue', collapsed: false, windowId: 1 }],
    storage: lifecycleStorage(omittedTitleState),
  });
  await emitAndDrain(omittedTitle, () => omittedTitle.emitCreated(omittedTitle.tabs.get(50)));
  const omittedStored = omittedTitle.storageLocal[STORAGE_KEY];
  assert.equal(omittedStored.tabLifecycle[50].snapshotGroupId, 'group-without-title');
  assert.equal(omittedStored.spaceSnapshots.work.groups
    .find((group) => group.snapshotGroupId === 'group-without-title').title ?? 'Tabs', 'Tabs');
});
