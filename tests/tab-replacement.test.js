import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAskSession,
  sessionKeyForTab,
} from '../src/shared/ask-session.js';
import { migratePanelTabIdReplacement } from '../src/shared/tab-replacement.js';

test('tab replacement migrates every panel identity without mutating the source model', () => {
  const oldTab = { id: 7, url: 'https://same.example/page', title: 'Old page' };
  const newTab = {
    id: 70,
    url: 'https://same.example/replaced',
    title: 'Replacement page',
    active: true,
  };
  const oldKey = sessionKeyForTab(oldTab);
  const duplicateUrlKey = sessionKeyForTab({ id: 8, url: oldTab.url });
  const oldSession = createAskSession(oldTab, 10);
  oldSession.messages = [{ id: 'old-answer', role: 'assistant', text: 'Kept', createdAt: 11 }];
  const duplicateUrlSession = createAskSession({ id: 8, url: oldTab.url }, 20);
  const unchangedStream = {
    messageRef: {
      sessionKey: duplicateUrlKey,
      sourceTab: { id: 8, url: oldTab.url },
    },
    page: { tabId: 8, text: 'Other tab' },
  };
  const changedStream = {
    requestId: 'request-old',
    text: 'Partial response',
    messageRef: {
      sessionKey: oldKey,
      messageId: 'assistant-message',
      tabReplacements: [{ removedTabId: 3, addedTabId: 4 }],
      sourceTab: { ...oldTab, favIconUrl: 'old.png' },
    },
    page: { tabId: 7, title: 'Extracted old page' },
  };
  const model = {
    marker: 'preserved',
    tabs: [
      { ...oldTab, active: true, snapshotTabId: 'stable-old' },
      { id: 8, title: 'Other live tab' },
    ],
    foreignLiveTabs: [{ id: 9, title: 'Other window' }],
    selectedTabIds: new Set([7, 8]),
    selectionAnchorTabId: 7,
    askSessions: {
      [oldKey]: oldSession,
      [duplicateUrlKey]: duplicateUrlSession,
    },
    activeAskSessionKey: oldKey,
    lastActivatedAskPageTab: { ...oldTab, active: true, pinned: true },
    recentlyOpenedDormantTabs: [
      { tabId: '7', snapshotTabId: 'snapshot-old' },
      { tabId: 8, snapshotTabId: 'snapshot-other' },
      null,
    ],
    syntheticPlaceholderTabIds: new Set([7, 70, 9]),
    activeAskStreams: new Map([
      ['changed', changedStream],
      ['unchanged', unchangedStream],
      ['primitive', 'still-running'],
    ]),
    dragState: { type: 'tab', tabId: '7' },
  };
  const sourceSnapshot = structuredClone(model);

  const result = migratePanelTabIdReplacement(model, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: newTab,
  });

  assert.equal(result.replacementApplied, true);
  assert.equal(result.dragInvalidated, true);
  assert.equal(result.marker, 'preserved');
  assert.equal(result.visibleTabsChanged, true);
  assert.deepEqual(result.tabs, [
    {
      ...oldTab,
      active: true,
      snapshotTabId: 'stable-old',
      ...newTab,
      id: 70,
    },
    { id: 8, title: 'Other live tab' },
  ]);
  assert.equal(result.foreignLiveTabs, model.foreignLiveTabs);
  assert.deepEqual(result.selectedTabIds, [70, 8]);
  assert.equal(result.selectionAnchorTabId, 70);
  const migratedOldKey = sessionKeyForTab({ id: 70, url: oldTab.url });
  assert.equal(result.activeAskSessionKey, migratedOldKey);
  assert.equal(result.askSessions[oldKey], undefined);
  assert.deepEqual(result.askSessions[migratedOldKey].messages, oldSession.messages);
  assert.equal(result.askSessions[duplicateUrlKey], duplicateUrlSession);
  assert.deepEqual(result.lastActivatedAskPageTab, {
    id: 70,
    url: newTab.url,
    title: newTab.title,
    pinned: true,
    active: false,
  });
  assert.deepEqual(result.recentlyOpenedDormantTabs, [
    { tabId: 70, snapshotTabId: 'snapshot-old' },
    { tabId: 8, snapshotTabId: 'snapshot-other' },
    null,
  ]);
  assert.deepEqual(result.syntheticPlaceholderTabIds, [70, 9]);

  const migratedStream = result.activeAskStreams.get('changed');
  assert.notEqual(migratedStream, changedStream);
  assert.notEqual(migratedStream.messageRef, changedStream.messageRef);
  assert.notEqual(migratedStream.page, changedStream.page);
  assert.equal(migratedStream.messageRef.sessionKey, migratedOldKey);
  assert.deepEqual(migratedStream.messageRef.tabReplacements, [
    { removedTabId: 3, addedTabId: 4 },
    { removedTabId: 7, addedTabId: 70 },
  ]);
  assert.deepEqual(migratedStream.messageRef.sourceTab, {
    ...oldTab,
    favIconUrl: 'old.png',
    ...newTab,
    id: 70,
  });
  assert.deepEqual(migratedStream.page, { tabId: 70, title: 'Extracted old page' });
  assert.equal(result.activeAskStreams.get('unchanged'), unchangedStream);
  assert.equal(result.activeAskStreams.get('primitive'), 'still-running');
  assert.deepEqual(model, sourceSnapshot);
});

test('tab replacement updates visible collections immediately, preserves order, and removes stale duplicates', () => {
  const oldLiveTab = {
    id: 7,
    title: 'Old live title',
    url: 'https://old.example/',
    snapshotTabId: 'stable-row',
  };
  const existingReplacement = {
    id: 70,
    title: 'Already observed replacement',
    url: 'https://intermediate.example/',
    groupId: 4,
  };
  const otherTab = { id: 8, title: 'Keep position' };
  const primitive = 'malformed-but-preserved';
  const foreignOld = { id: '7', title: 'Foreign old', windowId: 2 };
  const model = {
    tabs: [otherTab, oldLiveTab, primitive, existingReplacement],
    foreignLiveTabs: [foreignOld, { id: 9, title: 'Foreign other' }],
  };
  const source = structuredClone(model);

  const migrated = migratePanelTabIdReplacement(model, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: {
      id: 70,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
    },
  });

  assert.equal(migrated.visibleTabsChanged, true);
  assert.deepEqual(migrated.tabs, [
    otherTab,
    {
      ...oldLiveTab,
      ...existingReplacement,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
      id: 70,
    },
    primitive,
  ]);
  assert.deepEqual(migrated.foreignLiveTabs, [
    {
      ...foreignOld,
      id: 70,
      title: 'Final replacement',
      url: 'https://final.example/',
      active: true,
    },
    { id: 9, title: 'Foreign other' },
  ]);
  assert.deepEqual(model, source);
});

test('a repeated replacement enriches the already-rendered row without changing its position', () => {
  const tabs = [
    { id: 1, title: 'Before' },
    { id: 70, title: 'Loading', snapshotTabId: 'stable-row' },
    { id: 2, title: 'After' },
  ];
  const result = migratePanelTabIdReplacement({ tabs, foreignLiveTabs: [] }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: { id: 70, title: 'Loaded', status: 'complete' },
  });

  assert.equal(result.visibleTabsChanged, true);
  assert.deepEqual(result.tabs, [
    tabs[0],
    { id: 70, title: 'Loaded', snapshotTabId: 'stable-row', status: 'complete' },
    tabs[2],
  ]);
  assert.deepEqual(result.foreignLiveTabs, []);
});

test('a replacement outside the visible collections preserves their references and skips rendering work', () => {
  const tabs = [{ id: 1, title: 'Visible' }, null];
  const foreignLiveTabs = [{ id: 2, title: 'Other window' }];
  const result = migratePanelTabIdReplacement({ tabs, foreignLiveTabs }, {
    removedTabId: 7,
    addedTabId: 70,
  });

  assert.equal(result.visibleTabsChanged, false);
  assert.equal(result.tabs, tabs);
  assert.equal(result.foreignLiveTabs, foreignLiveTabs);
});

test('same-URL Ask sessions remain tab-scoped and merge only on a real target-key collision', () => {
  const url = 'https://duplicate.example/article';
  const oldTab = { id: 7, url, title: 'Old' };
  const targetTab = { id: 70, url, title: 'Target' };
  const duplicateTab = { id: 8, url, title: 'Duplicate URL in another tab' };
  const oldSession = createAskSession(oldTab, 10);
  oldSession.updatedAt = 30;
  oldSession.messages = [
    { id: 'old', role: 'user', text: 'From old tab' },
    { id: 'shared', role: 'assistant', text: 'Older shared answer' },
  ];
  const targetSession = createAskSession(targetTab, 20);
  targetSession.updatedAt = 40;
  targetSession.messages = [
    { id: 'shared', role: 'assistant', text: 'Newest shared answer' },
    { id: 'target', role: 'user', text: 'From target tab' },
  ];
  const duplicateSession = createAskSession(duplicateTab, 50);
  duplicateSession.messages = [{ id: 'duplicate', role: 'user', text: 'Do not merge me' }];

  const result = migratePanelTabIdReplacement({
    askSessions: {
      [sessionKeyForTab(targetTab)]: targetSession,
      [sessionKeyForTab(duplicateTab)]: duplicateSession,
      [sessionKeyForTab(oldTab)]: oldSession,
    },
    activeAskSessionKey: sessionKeyForTab(oldTab),
  }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: targetTab,
  });

  const targetKey = sessionKeyForTab(targetTab);
  assert.equal(Object.keys(result.askSessions).length, 2);
  assert.equal(result.askSessions[sessionKeyForTab(oldTab)], undefined);
  assert.equal(result.askSessions[sessionKeyForTab(duplicateTab)], duplicateSession);
  assert.equal(result.activeAskSessionKey, targetKey);
  assert.deepEqual(result.askSessions[targetKey].messages, [
    { id: 'old', role: 'user', text: 'From old tab' },
    { id: 'shared', role: 'assistant', text: 'Newest shared answer' },
    { id: 'target', role: 'user', text: 'From target tab' },
  ]);
  assert.equal(result.askSessions[targetKey].createdAt, 10);
  assert.equal(result.askSessions[targetKey].updatedAt, 40);
});

test('repeating a replacement enriches the remembered tab without duplicating stream history', () => {
  const oldTab = { id: 7, url: 'https://example.test/old', title: 'Old' };
  const oldKey = sessionKeyForTab(oldTab);
  const first = migratePanelTabIdReplacement({
    selectedTabIds: [7],
    selectionAnchorTabId: 7,
    askSessions: { [oldKey]: createAskSession(oldTab, 1) },
    activeAskSessionKey: oldKey,
    lastActivatedAskPageTab: oldTab,
    recentlyOpenedDormantTabs: [{ tabId: 7 }],
    syntheticPlaceholderTabIds: [7],
    activeAskStreams: new Map([['request', {
      messageRef: { sessionKey: oldKey, sourceTab: oldTab },
      page: { tabId: 7 },
    }]]),
    dragState: { type: 'group', tabId: 7 },
  }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: { id: 70 },
  });
  const streamAfterFirstPass = first.activeAskStreams.get('request');

  const second = migratePanelTabIdReplacement(first, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: {
      id: 70,
      url: 'https://example.test/final',
      title: 'Loaded replacement',
    },
  });

  assert.equal(first.dragInvalidated, false);
  assert.equal(second.dragInvalidated, false);
  assert.deepEqual(second.selectedTabIds, [70]);
  assert.equal(second.selectionAnchorTabId, 70);
  assert.deepEqual(second.syntheticPlaceholderTabIds, [70]);
  assert.deepEqual(second.lastActivatedAskPageTab, {
    id: 70,
    url: 'https://example.test/final',
    title: 'Loaded replacement',
    active: false,
  });
  assert.equal(second.activeAskStreams.get('request'), streamAfterFirstPass);
  assert.deepEqual(second.activeAskStreams.get('request').messageRef.tabReplacements, [
    { removedTabId: 7, addedTabId: 70 },
  ]);
});

test('stream migration handles key-only, source-only, page-only, malformed-history, and primitive streams', () => {
  const oldKey = sessionKeyForTab({ id: 7, url: 'https://example.test/page' });
  const newKey = sessionKeyForTab({ id: 70, url: 'https://example.test/page' });
  const sourceOnly = {
    messageRef: {
      sessionKey: 'space:work',
      sourceTab: { id: 7, title: 'Old source' },
    },
    page: { tabId: 99 },
  };
  const missingKey = { messageRef: {}, page: { tabId: 99 } };
  const result = migratePanelTabIdReplacement({
    activeAskStreams: new Map([
      ['key-only', {
        messageRef: {
          sessionKey: oldKey,
          tabReplacements: 'malformed',
          sourceTab: { id: 99 },
        },
        page: { tabId: 99 },
      }],
      ['source-only', sourceOnly],
      ['page-only', { messageRef: null, page: { tabId: 7, text: 'page' } }],
      ['missing-key', missingKey],
      ['primitive', null],
    ]),
  }, {
    removedTabId: 7,
    addedTabId: 70,
    replacementTab: { title: 'New source', url: 'https://example.test/new' },
  });

  assert.deepEqual(result.activeAskStreams.get('key-only').messageRef, {
    sessionKey: newKey,
    tabReplacements: [{ removedTabId: 7, addedTabId: 70 }],
    sourceTab: { id: 99 },
  });
  assert.deepEqual(result.activeAskStreams.get('source-only').messageRef, {
    sessionKey: 'space:work',
    sourceTab: {
      id: 70,
      title: 'New source',
      url: 'https://example.test/new',
    },
  });
  assert.equal(result.activeAskStreams.get('source-only').messageRef.tabReplacements, undefined);
  assert.deepEqual(result.activeAskStreams.get('page-only').page, { tabId: 70, text: 'page' });
  assert.equal(result.activeAskStreams.get('page-only').messageRef, null);
  assert.equal(result.activeAskStreams.get('missing-key'), missingKey);
  assert.equal(result.activeAskStreams.get('missing-key').messageRef.sessionKey, undefined);
  assert.equal(result.activeAskStreams.get('primitive'), null);
});

test('malformed optional state is normalized safely for a valid numeric-string replacement', () => {
  const result = migratePanelTabIdReplacement({
    selectedTabIds: ['7', 'bad', 7],
    selectionAnchorTabId: '7',
    askSessions: null,
    activeAskSessionKey: null,
    lastActivatedAskPageTab: null,
    recentlyOpenedDormantTabs: null,
    syntheticPlaceholderTabIds: 'not-iterable',
    activeAskStreams: {},
    dragState: null,
  }, {
    removedTabId: '7',
    addedTabId: '70',
    replacementTab: [],
  });

  assert.equal(result.replacementApplied, true);
  assert.equal(result.dragInvalidated, false);
  assert.deepEqual(result.selectedTabIds, [70]);
  assert.equal(result.selectionAnchorTabId, 70);
  assert.equal(result.askSessions, null);
  assert.equal(result.activeAskSessionKey, '');
  assert.equal(result.lastActivatedAskPageTab, null);
  assert.deepEqual(result.recentlyOpenedDormantTabs, []);
  assert.deepEqual(result.syntheticPlaceholderTabIds, []);
  assert.deepEqual([...result.activeAskStreams], []);

  const emptyModel = migratePanelTabIdReplacement([], {
    removedTabId: 2,
    addedTabId: 3,
  });
  assert.deepEqual(emptyModel.selectedTabIds, []);
  assert.deepEqual(emptyModel.recentlyOpenedDormantTabs, []);
  assert.deepEqual(emptyModel.syntheticPlaceholderTabIds, []);
  assert.deepEqual([...emptyModel.activeAskStreams], []);
});

test('invalid and no-op replacements preserve the source model and report no UI invalidation', () => {
  const marker = { nested: true };
  const model = { marker, selectedTabIds: new Set([7]), dragState: { type: 'tab', tabId: 7 } };
  const invalidReplacements = [
    undefined,
    null,
    [],
    {},
    { removedTabId: null, addedTabId: 70 },
    { removedTabId: 7, addedTabId: undefined },
    { removedTabId: 7, addedTabId: '' },
    { removedTabId: 7, addedTabId: 'not-a-tab' },
    { removedTabId: 7.5, addedTabId: 70 },
    { removedTabId: -1, addedTabId: 70 },
    { removedTabId: 7, addedTabId: Number.MAX_SAFE_INTEGER + 1 },
    { removedTabId: 7, addedTabId: 7 },
  ];

  for (const replacement of invalidReplacements) {
    const result = migratePanelTabIdReplacement(model, replacement);
    assert.equal(result.replacementApplied, false);
    assert.equal(result.dragInvalidated, false);
    assert.equal(result.marker, marker);
    assert.equal(result.selectedTabIds, model.selectedTabIds);
  }

  assert.deepEqual(migratePanelTabIdReplacement(), {
    replacementApplied: false,
    dragInvalidated: false,
  });
  assert.deepEqual(migratePanelTabIdReplacement(null, null), {
    replacementApplied: false,
    dragInvalidated: false,
  });
});

test('only a live tab drag for the removed id is invalidated', () => {
  for (const dragState of [
    undefined,
    null,
    { type: 'group', tabId: 7 },
    { type: 'tab', tabId: 8 },
    { type: 'tab', tabId: null },
  ]) {
    const result = migratePanelTabIdReplacement({ dragState }, {
      removedTabId: 7,
      addedTabId: 70,
    });
    assert.equal(result.dragInvalidated, false);
  }

  assert.equal(migratePanelTabIdReplacement({
    dragState: { type: 'tab', tabId: '7' },
  }, {
    removedTabId: 7,
    addedTabId: 70,
  }).dragInvalidated, true);
});

test('null metadata never aliases the legitimate Chrome tab id zero', () => {
  const untouchedStream = {
    messageRef: { sessionKey: 'space:work', sourceTab: { id: null } },
    page: { tabId: null },
  };
  const remembered = { id: null, title: 'No live tab' };
  const dormant = { tabId: null, snapshotTabId: 'snapshot-only' };
  const result = migratePanelTabIdReplacement({
    selectedTabIds: [0],
    selectionAnchorTabId: 0,
    lastActivatedAskPageTab: remembered,
    recentlyOpenedDormantTabs: [dormant],
    syntheticPlaceholderTabIds: new Set([0]),
    activeAskStreams: new Map([['request', untouchedStream]]),
    dragState: { type: 'tab', tabId: null },
  }, {
    removedTabId: 0,
    addedTabId: 1,
  });

  assert.deepEqual(result.selectedTabIds, [1]);
  assert.equal(result.selectionAnchorTabId, 1);
  assert.equal(result.lastActivatedAskPageTab, remembered);
  assert.equal(result.recentlyOpenedDormantTabs[0], dormant);
  assert.deepEqual(result.syntheticPlaceholderTabIds, [1]);
  assert.equal(result.activeAskStreams.get('request'), untouchedStream);
  assert.equal(result.dragInvalidated, false);
});
