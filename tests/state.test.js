import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeSpaceForStorage,
  activeSpaceForWindow,
  createDefaultState,
  forgetActiveSpaceForWindow,
  mergeStoredState,
  normalizeWindowSpaceState,
  reassignDeletedSpaceWindows,
  rememberActiveSpaceForWindow,
  resetChromeSessionBindings,
  tabWindowBelongsToSpace,
  serializeGroup,
  serializeTab,
  STORAGE_KEY,
  WINDOW_STATE_KEY,
} from '../src/shared/state.js';

test('keeps the durable browser fallback independent from per-window active Spaces', () => {
  const spaces = [
    { id: 'work' },
    { id: 'focus' },
  ];

  assert.equal(activeSpaceForStorage(spaces, 'focus', 'work'), 'focus');
  assert.equal(activeSpaceForStorage(spaces, 'deleted', 'work'), 'work');
  assert.equal(activeSpaceForStorage(spaces, 'deleted', 'also-deleted'), 'work');
  assert.equal(activeSpaceForStorage([{}, null, { id: '' }], 'focus', 'work'), '');
  assert.equal(activeSpaceForStorage(null, 'focus', 'work'), '');
});

test('normalizes safe browser session ids at state creation and storage boundaries', () => {
  const defaults = createDefaultState({ browserSessionId: '  default-session_1  ' });
  assert.equal(defaults.browserSessionId, 'default-session_1');

  const stored = mergeStoredState({
    version: 9,
    browserSessionId: '  restored-session:2  ',
  }, defaults);
  assert.equal(stored.browserSessionId, 'restored-session:2');

  const invalidType = mergeStoredState({
    version: 9,
    browserSessionId: { unexpected: true },
  }, defaults);
  assert.equal(invalidType.browserSessionId, 'default-session_1');

  const unsafeText = mergeStoredState({
    version: 9,
    browserSessionId: '__proto__',
  }, createDefaultState());
  assert.equal(unsafeText.browserSessionId, '');

  const oversized = createDefaultState({ browserSessionId: 'a'.repeat(201) });
  assert.equal(oversized.browserSessionId, '');
});

test('keeps the exact state object when the normalized browser session is unchanged or unusable', () => {
  const state = {
    ...createDefaultState(),
    browserSessionId: ' current-session ',
    groupSpaces: { 7: 'work' },
  };

  assert.strictEqual(resetChromeSessionBindings(state, ' current-session '), state);
  assert.strictEqual(resetChromeSessionBindings(state, 'current-session'), state);
  assert.strictEqual(resetChromeSessionBindings(state, '   '), state);
  assert.strictEqual(resetChromeSessionBindings(state, '__proto__'), state);
  assert.strictEqual(resetChromeSessionBindings(state, 'bad\u0000session'), state);
  assert.strictEqual(resetChromeSessionBindings(null, 'next-session'), null);
  assert.strictEqual(resetChromeSessionBindings('invalid-state', 'next-session'), 'invalid-state');
  const invalidArrayState = [];
  assert.strictEqual(resetChromeSessionBindings(invalidArrayState, 'next-session'), invalidArrayState);

  const resetWithoutHistory = resetChromeSessionBindings({
    ...state,
    operationHistory: null,
  }, 'next-session');
  assert.deepEqual(resetWithoutHistory.operationHistory, []);
});

test('clears only Chrome-session bindings and live-id undo after the browser session changes', () => {
  const tidyOperation = {
    id: 'tidy-1',
    type: 'tidy-names',
    before: { renamedTabs: { 11: null } },
    after: { renamedTabs: { 11: 'Docs' } },
  };
  const autoGroupOperation = {
    id: 'auto-1',
    type: 'auto-group',
    before: { live: { groups: [{ tabIds: [11, 12] }] } },
  };
  const restoreOperation = {
    id: 'restore-1',
    type: 'restore-backup',
    before: { backup: { format: 'space-tabs-backup', spaces: [{ id: 'work' }] } },
    after: { portableFingerprint: 'portable-workspace-v1-12345678' },
  };
  const portableOperation = {
    id: 'portable-1',
    type: 'workspace',
    before: { portableValue: 'keep' },
  };
  const state = {
    ...createDefaultState(),
    browserSessionId: 'old-session',
    activeSpaceId: 'work',
    spaces: [{ id: 'work', name: 'Work', icon: 'W', color: 'blue' }],
    groupSpaces: { 7: 'work' },
    tabSpaces: { 11: 'work' },
    renamedTabs: { 11: 'Readable title' },
    tabGroups: { 11: 'Docs' },
    tabLifecycle: { 11: { snapshotTabId: 'row-11', spaceId: 'work' } },
    virtualGroups: { 11: { title: 'Docs', color: 'blue' } },
    ephemeralTabIds: [11],
    groupOrder: { work: [7] },
    tabOrder: { work: [11] },
    collapsedGroups: { 7: true },
    collapsedSpaceGroups: { 'work:Docs': true },
    spaceContexts: { work: '# Keep this context' },
    spaceSnapshots: { work: { version: 1, groups: [{ title: 'Docs', tabs: [{ url: 'https://example.com' }] }] } },
    askSessions: { 'space:work': { messages: [{ role: 'user', content: 'Keep this chat' }] } },
    activeAskSessionKey: 'space:work',
    lastArcImport: { spaceIds: ['work'], importedAt: 123 },
    operationHistory: [tidyOperation, restoreOperation, autoGroupOperation, portableOperation],
    ai: { provider: 'openai-compatible', baseUrl: 'https://llm.example/v1', model: 'model', apiKey: 'secret' },
  };

  const reset = resetChromeSessionBindings(state, '  new-session  ');

  assert.notStrictEqual(reset, state);
  assert.equal(reset.browserSessionId, 'new-session');
  assert.deepEqual(reset.groupSpaces, {});
  assert.deepEqual(reset.tabSpaces, {});
  assert.deepEqual(reset.renamedTabs, {});
  assert.deepEqual(reset.tabGroups, {});
  assert.deepEqual(reset.tabLifecycle, {});
  assert.deepEqual(reset.virtualGroups, {});
  assert.deepEqual(reset.ephemeralTabIds, []);
  assert.deepEqual(reset.groupOrder, {});
  assert.deepEqual(reset.tabOrder, {});
  assert.deepEqual(reset.collapsedGroups, {});
  assert.deepEqual(reset.operationHistory, [portableOperation]);

  for (const portableKey of [
    'spaces',
    'spaceSnapshots',
    'spaceContexts',
    'askSessions',
    'ai',
    'collapsedSpaceGroups',
    'lastArcImport',
  ]) {
    assert.strictEqual(reset[portableKey], state[portableKey]);
  }
  assert.equal(reset.activeSpaceId, 'work');
  assert.equal(reset.activeAskSessionKey, 'space:work');
  assert.deepEqual(state.groupSpaces, { 7: 'work' }, 'the pure reset must not mutate its input');
  assert.equal(state.browserSessionId, 'old-session');
});

test('merges only object-shaped lifecycle bindings in compatible local state', () => {
  const binding = { snapshotTabId: 'row-1', spaceId: 'default' };
  assert.deepEqual(mergeStoredState({
    version: 9,
    tabLifecycle: { 1: binding },
  }).tabLifecycle, { 1: binding });
  assert.deepEqual(mergeStoredState({ version: 9, tabLifecycle: [] }).tabLifecycle, {});
  assert.deepEqual(mergeStoredState({ version: 9, tabLifecycle: 'broken' }).tabLifecycle, {});
  assert.deepEqual(mergeStoredState({ version: 3, tabLifecycle: { 1: binding } }).tabLifecycle, {});
});

test('prevents recycled Chrome ids from inheriting ownership from the previous browser session', () => {
  const previousSession = {
    ...createDefaultState({ browserSessionId: 'session-before-restart' }),
    groupSpaces: { 7: 'work' },
    tabSpaces: { 11: 'work' },
    renamedTabs: { 11: 'Old tab name' },
  };

  const restarted = resetChromeSessionBindings(previousSession, 'session-after-restart');

  assert.equal(restarted.groupSpaces[7], undefined);
  assert.equal(restarted.tabSpaces[11], undefined);
  assert.equal(restarted.renamedTabs[11], undefined);
  restarted.tabSpaces[11] = 'personal';
  assert.equal(previousSession.tabSpaces[11], 'work');
});

test('serializes the numeric last-accessed time used to resolve the current page', () => {
  assert.equal(serializeTab({ id: 1, lastAccessed: 1_726_000_123_456 }).lastAccessed, 1_726_000_123_456);
  assert.equal(serializeTab({ id: 2, lastAccessed: '1726000123456' }).lastAccessed, 1_726_000_123_456);
  assert.equal(serializeTab({ id: 3 }).lastAccessed, 0);
});

test('serializes complete Chrome tab and group boundaries without losing zero ids or indexes', () => {
  assert.deepEqual(serializeTab({
    id: 0,
    title: 'Muted tab',
    url: 'https://example.com',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned: true,
    mutedInfo: { muted: true },
    active: true,
    groupId: 0,
    index: 0,
    windowId: 2,
    audible: true,
    lastAccessed: 'not-a-time',
  }), {
    id: 0,
    title: 'Muted tab',
    url: 'https://example.com',
    favIconUrl: 'https://example.com/favicon.ico',
    pinned: true,
    muted: true,
    active: true,
    groupId: 0,
    index: 0,
    windowId: 2,
    audible: true,
    lastAccessed: 0,
  });
  assert.deepEqual(serializeGroup({ id: 0 }), {
    id: 0,
    title: 'Group',
    color: 'grey',
    collapsed: false,
  });
  assert.deepEqual(serializeGroup({ id: 7, title: 'Docs', color: 'blue', collapsed: true }), {
    id: 7,
    title: 'Docs',
    color: 'blue',
    collapsed: true,
  });
  assert.deepEqual(serializeGroup({ id: 8, title: '', color: 'cyan' }), {
    id: 8,
    title: '',
    color: 'cyan',
    collapsed: false,
  });
});

test('serializes a pending navigation as the restorable tab URL', () => {
  assert.equal(serializeTab({
    id: 4,
    url: 'chrome://newtab/',
    pendingUrl: 'https://pending.example/path',
  }).url, 'https://pending.example/path');
});

test('creates a single fallback Space with blank BYOK AI settings', () => {
  const state = createDefaultState();

  assert.equal(state.version, 12);
  assert.equal(state.browserSessionId, '');
  assert.equal(state.spaces.length, 1);
  assert.equal(state.activeSpaceId, 'default');
  assert.deepEqual(state.spaces.map((space) => space.name), ['Default']);
  assert.equal(Object.hasOwn(state.ai, 'maxTokens'), false);
  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.virtualGroups, {});
  assert.deepEqual(state.tabGroups, {});
  assert.deepEqual(state.ephemeralTabIds, []);
  assert.deepEqual(state.groupOrder, {});
  assert.deepEqual(state.tabOrder, {});
  assert.deepEqual(state.collapsedGroups, {});
  assert.deepEqual(state.collapsedSpaceGroups, {});
  assert.deepEqual(state.askSessions, {});
  assert.deepEqual(state.spaceContexts, {});
  assert.deepEqual(state.onboarding, { version: 2, completed: false, stage: 'choose' });
  assert.equal(state.lastArcImport, null);
  assert.deepEqual(state.operationHistory, []);
  assert.equal(state.shortcuts.askSubmit, 'Primary+Enter');
  assert.equal(state.shortcuts.askAbort, 'Escape');
  assert.equal(state.shortcuts.togglePanel, 'Alt+S');
  assert.equal(state.ai.model, '');
  assert.equal(state.ai.baseUrl, '');
  assert.equal(state.ai.apiKey, '');
  assert.equal(state.ai.language, 'zh-CN');
  assert.equal(STORAGE_KEY, 'spaceTabsState');
  assert.equal(WINDOW_STATE_KEY, 'spaceTabsWindowState');
});

test('keeps active Spaces independent per Chrome window and repairs stale session entries', () => {
  const spaces = [
    { id: 'work', name: 'Work' },
    { id: 'personal', name: 'Personal' },
  ];
  const stored = {
    activeSpaceIds: {
      0: 'work',
      17: 'personal',
      '-1': 'work',
      '2.5': 'work',
      nope: 'work',
      19: 'deleted',
      9007199254740992: 'work',
    },
  };

  assert.deepEqual(normalizeWindowSpaceState(stored, spaces), {
    activeSpaceIds: { 0: 'work', 17: 'personal' },
  });
  assert.equal(activeSpaceForWindow(stored, 0, spaces, 'personal'), 'work');
  assert.equal(activeSpaceForWindow(stored, '17', spaces, 'work'), 'personal');
  assert.equal(activeSpaceForWindow(stored, 18, spaces, 'personal'), 'personal');
  assert.equal(activeSpaceForWindow(stored, null, spaces, 'deleted'), 'work');
  assert.equal(activeSpaceForWindow({}, 1, [], 'missing'), '');
  assert.equal(tabWindowBelongsToSpace({ id: 1, windowId: 0 }, stored, spaces, 'work', 'personal'), true);
  assert.equal(tabWindowBelongsToSpace({ id: 2, windowId: 17 }, stored, spaces, 'work', 'work'), false);
  assert.equal(tabWindowBelongsToSpace({ id: 3, windowId: 18 }, stored, spaces, 'personal', 'personal'), true);
  assert.equal(
    tabWindowBelongsToSpace({ id: 30, windowId: 30 }, {}, spaces, 'personal', 'work'),
    false,
    'an unmapped foreign-window placeholder must follow the pre-delete active Space, not an inactive deleted Space',
  );
  assert.equal(tabWindowBelongsToSpace({ id: 4, windowId: null }, stored, spaces, 'work', 'work'), false);
  assert.equal(tabWindowBelongsToSpace({ id: 5, windowId: 0 }, stored, spaces, '', 'work'), false);

  assert.deepEqual(rememberActiveSpaceForWindow(stored, 18, 'work', spaces), {
    activeSpaceIds: { 0: 'work', 17: 'personal', 18: 'work' },
  });
  assert.deepEqual(rememberActiveSpaceForWindow(stored, -1, 'personal', spaces), {
    activeSpaceIds: { 0: 'work', 17: 'personal' },
  });
  assert.deepEqual(rememberActiveSpaceForWindow(stored, 18, 'deleted', spaces), {
    activeSpaceIds: { 0: 'work', 17: 'personal' },
  });
  assert.deepEqual(normalizeWindowSpaceState({ activeSpaceIds: null }, null), { activeSpaceIds: {} });
  assert.deepEqual(normalizeWindowSpaceState({ activeSpaceIds: 'invalid' }, 'invalid'), { activeSpaceIds: {} });
  assert.deepEqual(normalizeWindowSpaceState(null, [{ id: 1 }]), { activeSpaceIds: {} });
  assert.equal(activeSpaceForWindow({}, 1, [null, { id: 1 }], ''), '');
  assert.equal(activeSpaceForWindow({}, 'invalid', null, ''), '');
  assert.deepEqual(rememberActiveSpaceForWindow({}, '0018', 'work', spaces), {
    activeSpaceIds: { 18: 'work' },
  });
  assert.deepEqual(rememberActiveSpaceForWindow({}, 18, 'work', null), { activeSpaceIds: {} });
  assert.deepEqual(rememberActiveSpaceForWindow({}, 18, 'work', [null]), { activeSpaceIds: {} });
  assert.deepEqual(forgetActiveSpaceForWindow({
    activeSpaceIds: { 17: 'personal', 18: 'work' },
    retained: true,
  }, '0018'), {
    activeSpaceIds: { 17: 'personal' },
    retained: true,
  });
  assert.deepEqual(forgetActiveSpaceForWindow(null, 'invalid'), { activeSpaceIds: {} });
  assert.deepEqual(forgetActiveSpaceForWindow({ activeSpaceIds: [] }, 17), { activeSpaceIds: {} });
});

test('deleting a Space moves every affected window to the fallback without changing peers', () => {
  const spaces = [
    null,
    { id: 'default', name: 'Default' },
    { id: 'personal', name: 'Personal' },
    { id: 7, name: 'Invalid id' },
  ];
  const stored = {
    activeSpaceIds: {
      10: 'deleted',
      11: 'personal',
      12: 'deleted',
      13: 'already-gone',
      nope: 'deleted',
    },
  };

  assert.deepEqual(reassignDeletedSpaceWindows(
    stored,
    'deleted',
    'default',
    spaces,
  ), {
    activeSpaceIds: {
      10: 'default',
      11: 'personal',
      12: 'default',
    },
  });
  assert.deepEqual(stored.activeSpaceIds, {
    10: 'deleted',
    11: 'personal',
    12: 'deleted',
    13: 'already-gone',
    nope: 'deleted',
  });

  assert.deepEqual(reassignDeletedSpaceWindows(stored, 'deleted', '', spaces), {
    activeSpaceIds: { 11: 'personal' },
  });
  assert.deepEqual(reassignDeletedSpaceWindows(stored, '', 'default', spaces), {
    activeSpaceIds: { 11: 'personal' },
  });
  assert.deepEqual(reassignDeletedSpaceWindows(null, 'deleted', 'default', spaces), {
    activeSpaceIds: {},
  });
  assert.deepEqual(reassignDeletedSpaceWindows(
    { activeSpaceIds: [] },
    'deleted',
    'default',
    null,
  ), { activeSpaceIds: {} });
});

test('keeps explicitly configured BYOK AI settings and the selected GLM-5.2 model', () => {
  const state = createDefaultState({
    ai: {
      provider: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4/',
      model: 'glm-5.1',
      apiKey: 'secret',
      maxTokens: 131_072,
    },
  });

  assert.equal(state.ai.provider, 'z-ai');
  assert.equal(state.ai.baseUrl, 'https://api.z.ai/api/paas/v4');
  assert.equal(state.ai.model, 'glm-5.2');
  assert.equal(state.ai.apiKey, 'secret');
  assert.equal(Object.hasOwn(state.ai, 'maxTokens'), false);
});

test('migrates the saved Coding Plan model to GLM-5.2 once without overriding later choices', () => {
  const codingSettings = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.1',
  };
  const migrated = mergeStoredState({ version: 10, ai: codingSettings }, createDefaultState());
  assert.equal(migrated.ai.provider, 'openai-compatible');
  assert.equal(migrated.ai.baseUrl, 'https://open.bigmodel.cn/api/coding/paas/v4');
  assert.equal(migrated.ai.model, 'glm-5.2');

  const current = mergeStoredState({ version: 12, ai: codingSettings }, createDefaultState());
  assert.equal(current.ai.model, 'glm-5.1');
});

test('returns supplied defaults when top-level stored state is missing or corrupt', () => {
  const defaults = createDefaultState();

  assert.strictEqual(mergeStoredState(null, defaults), defaults);
  assert.strictEqual(mergeStoredState('not-an-object', defaults), defaults);
});

test('normalizes current storage fallbacks, generated Space display fields, and ephemeral ids', () => {
  const defaultsWithoutTheme = createDefaultState();
  defaultsWithoutTheme.theme = '';
  const merged = mergeStoredState({
    version: 8,
    theme: '',
    activeSpaceId: 'missing',
    spaces: [
      { id: 42, name: 'Invalid id type' },
      { id: 'custom', name: 'Custom' },
    ],
    ephemeralTabIds: [4, '5', 'not-a-tab'],
  }, defaultsWithoutTheme);

  assert.equal(merged.theme, 'purple');
  assert.equal(merged.activeSpaceId, 'custom');
  assert.deepEqual(merged.spaces, [
    { id: 'custom', name: 'Custom', icon: 'C', color: 'blue' },
  ]);
  assert.deepEqual(merged.ephemeralTabIds, [4, 5]);

  const allInvalid = mergeStoredState({
    version: 8,
    spaces: [{ id: 42, name: 'Invalid id type' }],
  }, createDefaultState());
  assert.deepEqual(allInvalid.spaces, createDefaultState().spaces);
});

test('drops unusable Arc undo metadata and normalizes empty optional values', () => {
  const invalidIds = mergeStoredState({
    version: 8,
    lastArcImport: { spaceIds: 'arc-work' },
  }, createDefaultState());
  assert.equal(invalidIds.lastArcImport, null);

  const emptyValues = mergeStoredState({
    version: 8,
    lastArcImport: {
      spaceIds: ['arc-work'],
      importedAt: 'not-a-time',
      afterFingerprints: { 'arc-work': null },
    },
  }, createDefaultState());
  assert.deepEqual(emptyValues.lastArcImport, {
    spaceIds: ['arc-work'],
    importedAt: 0,
  });

  const invalidToken = mergeStoredState({
    version: 10,
    lastArcImport: {
      spaceIds: ['arc-work'],
      importedAt: 123,
      token: 'not a legal token',
    },
  }, createDefaultState());
  assert.deepEqual(invalidToken.lastArcImport, {
    spaceIds: ['arc-work'],
    importedAt: 123,
  });
});

test('repairs malformed operation entries and null AI settings with user-safe defaults', () => {
  const merged = mergeStoredState({
    version: 8,
    ai: null,
    operationHistory: [null, 'invalid', {}],
  }, createDefaultState());

  assert.deepEqual(merged.operationHistory, [{
    id: '0-0',
    type: 'workspace',
    summary: 'Workspace change',
    createdAt: 0,
    status: 'applied',
  }]);
  assert.equal(merged.ai.baseUrl, '');
  assert.equal(merged.ai.model, '');

  const incompleteLegacyAI = mergeStoredState({
    version: 8,
    ai: { baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
  }, createDefaultState());
  assert.equal(incompleteLegacyAI.ai.provider, 'z-ai');
  assert.equal(incompleteLegacyAI.ai.baseUrl, 'https://api.z.ai/api/paas/v4');
  assert.equal(incompleteLegacyAI.ai.model, 'glm-5.2');
});

test('recognizes stored built-in provider settings without losing explicit choice', () => {
  const merged = mergeStoredState({
    version: 4,
    ai: {
      provider: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.1',
      apiKey: '',
    },
  }, createDefaultState());

  assert.equal(merged.ai.provider, 'z-ai');
  assert.equal(merged.ai.baseUrl, 'https://api.z.ai/api/paas/v4');
  assert.equal(merged.ai.model, 'glm-5.2');
});

test('preserves unknown stored BYOK endpoints as custom providers', () => {
  const merged = mergeStoredState({
    version: 4,
    ai: {
      baseUrl: 'https://llm.example.com/v1/',
      model: 'example-model',
    },
  }, createDefaultState());

  assert.equal(merged.ai.provider, 'openai-compatible');
  assert.equal(merged.ai.baseUrl, 'https://llm.example.com/v1');
  assert.equal(merged.ai.model, 'example-model');
});

test('drops legacy built-in BYOK defaults from stored state', () => {
  const merged = mergeStoredState({
    version: 4,
    ai: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.1',
      apiKey: '',
    },
  }, createDefaultState());

  assert.equal(merged.ai.baseUrl, '');
  assert.equal(merged.ai.model, '');
});

test('migrates the old Cmd+S toggle shortcut to avoid Chrome Save Page', () => {
  const merged = mergeStoredState({
    version: 3,
    shortcuts: {
      togglePanel: 'Meta+S',
      askSubmit: 'Control+Enter',
    },
  }, createDefaultState());

  assert.equal(merged.shortcuts.togglePanel, 'Alt+S');
  assert.equal(merged.shortcuts.askSubmit, 'Control+Enter');
});

test('preserves an explicitly saved Cmd+S toggle shortcut in current state', () => {
  const merged = mergeStoredState({
    version: 4,
    shortcuts: {
      togglePanel: 'Meta+S',
      askSubmit: 'Control+Enter',
    },
  }, createDefaultState());

  assert.equal(merged.shortcuts.togglePanel, 'Meta+S');
  assert.equal(merged.shortcuts.askSubmit, 'Control+Enter');
});

test('migrates the old Mac-only Ask default while preserving an explicit current binding', () => {
  const migrated = mergeStoredState({
    version: 8,
    shortcuts: { askSubmit: 'Meta+Enter' },
  }, createDefaultState());
  assert.equal(migrated.shortcuts.askSubmit, 'Primary+Enter');

  const current = mergeStoredState({
    version: 9,
    shortcuts: { askSubmit: 'Meta+Enter' },
  }, createDefaultState());
  assert.equal(current.shortcuts.askSubmit, 'Meta+Enter');
});

test('migrates the old Ctrl+C Ask abort default without breaking intentional current bindings', () => {
  const migrated = mergeStoredState({
    version: 9,
    shortcuts: { askAbort: 'Control+C' },
  }, createDefaultState());
  assert.equal(migrated.shortcuts.askAbort, 'Escape');

  const current = mergeStoredState({
    version: 10,
    shortcuts: { askAbort: 'Control+C' },
  }, createDefaultState());
  assert.equal(current.shortcuts.askAbort, 'Control+C');
});

test('migrates v4 Space ownership into v12 without resetting shortcuts', () => {
  const merged = mergeStoredState({
    version: 4,
    activeSpaceId: 'work',
    spaces: [{ id: 'work', name: 'Work', icon: 'W', color: 'blue' }],
    groupSpaces: { 7: 'work' },
    tabSpaces: { 4: 'work' },
    spaceContexts: { work: '# Launch\nShip the store update.' },
    shortcuts: { togglePanel: 'Meta+S' },
  }, createDefaultState());

  assert.equal(merged.version, 12);
  assert.equal(merged.activeSpaceId, 'work');
  assert.deepEqual(merged.groupSpaces, { 7: 'work' });
  assert.deepEqual(merged.tabSpaces, { 4: 'work' });
  assert.equal(merged.spaceContexts.work, '# Launch\nShip the store update.');
  assert.equal(merged.shortcuts.togglePanel, 'Meta+S');
  assert.deepEqual(merged.onboarding, { version: 2, completed: false, stage: 'choose' });
});

test('preserves completed onboarding and a valid Arc import undo record', () => {
  const merged = mergeStoredState({
    version: 7,
    onboarding: { version: 1, completed: true },
    lastArcImport: { spaceIds: ['arc-work', 'arc-work', 'arc-home'], importedAt: 123 },
  }, createDefaultState());

  assert.deepEqual(merged.onboarding, { version: 2, completed: true, stage: 'done' });
  assert.deepEqual(merged.lastArcImport, {
    spaceIds: ['arc-work', 'arc-home'],
    importedAt: 123,
  });
});

test('normalizes onboarding v2 to choose, AI, or done stages', () => {
  const choose = mergeStoredState({
    version: 8,
    onboarding: { version: 2, completed: false, stage: 'unexpected' },
  }, createDefaultState());
  const ai = mergeStoredState({
    version: 8,
    onboarding: { version: 2, completed: false, stage: 'ai' },
  }, createDefaultState());
  const done = mergeStoredState({
    version: 8,
    onboarding: { version: 2, completed: true, stage: 'choose' },
  }, createDefaultState());

  assert.deepEqual(choose.onboarding, { version: 2, completed: false, stage: 'choose' });
  assert.deepEqual(ai.onboarding, { version: 2, completed: false, stage: 'ai' });
  assert.deepEqual(done.onboarding, { version: 2, completed: true, stage: 'done' });
});

test('normalizes per-Space Arc import safety fingerprints while preserving legacy records', () => {
  const merged = mergeStoredState({
    version: 8,
    lastArcImport: {
      spaceIds: ['arc-work', 'arc-home', 'arc-work', '__proto__'],
      importedAt: 456,
      token: ' arc-import:456 ',
      afterFingerprints: {
        'arc-work': ' portable-space-v1-12345678 ',
        'arc-home': 'portable-space-v1-abcdef12',
        unrelated: 'portable-space-v1-deadbeef',
      },
    },
  }, createDefaultState());

  assert.deepEqual(merged.lastArcImport, {
    spaceIds: ['arc-work', 'arc-home'],
    importedAt: 456,
    token: 'arc-import:456',
    afterFingerprints: {
      'arc-work': 'portable-space-v1-12345678',
      'arc-home': 'portable-space-v1-abcdef12',
    },
  });

  const legacy = mergeStoredState({
    version: 7,
    lastArcImport: { spaceIds: ['arc-work'], importedAt: 123 },
  }, createDefaultState());
  assert.deepEqual(legacy.lastArcImport, { spaceIds: ['arc-work'], importedAt: 123 });
});

test('preserves a bounded normalized operation history for Undo', () => {
  const operationHistory = Array.from({ length: 12 }, (_, index) => ({
    id: `operation-${index}`,
    type: index % 2 ? 'auto-group' : 'tidy-names',
    summary: `Change ${index}`,
    createdAt: index,
    status: index === 11 ? 'undone' : 'applied',
    before: { value: index },
    after: { fingerprint: `fingerprint-${index}` },
  }));
  const merged = mergeStoredState({ version: 8, operationHistory }, createDefaultState());

  assert.equal(merged.operationHistory.length, 10);
  assert.equal(merged.operationHistory[0].id, 'operation-2');
  assert.equal(merged.operationHistory.at(-1).status, 'undone');
  assert.deepEqual(merged.operationHistory[0].before, { value: 2 });
  assert.deepEqual(merged.operationHistory[0].after, { fingerprint: 'fingerprint-2' });
});

test('migrates the legacy default Space and removes obsolete max tokens', () => {
  const merged = mergeStoredState({
    version: 6,
    activeSpaceId: 'default',
    spaces: [{ id: 'default', name: 'Launch review', icon: 'L', color: 'blue' }],
    ai: { maxTokens: 1024 },
  }, createDefaultState());

  assert.deepEqual(merged.spaces[0], { id: 'default', name: 'Default', icon: 'D', color: 'blue' });
  assert.equal(Object.hasOwn(merged.ai, 'maxTokens'), false);
});

test('removes the invalid v7 one-million token default', () => {
  const merged = mergeStoredState({
    version: 7,
    ai: { maxTokens: 1_000_000 },
  }, createDefaultState());

  assert.equal(Object.hasOwn(merged.ai, 'maxTokens'), false);
});

test('removes explicit max tokens from current settings while preserving other AI fields', () => {
  const merged = mergeStoredState({
    version: 8,
    ai: {
      baseUrl: 'https://llm.example.com/v1',
      model: 'custom-model',
      maxTokens: 131_072,
    },
  }, createDefaultState());

  assert.equal(merged.ai.baseUrl, 'https://llm.example.com/v1');
  assert.equal(merged.ai.model, 'custom-model');
  assert.equal(Object.hasOwn(merged.ai, 'maxTokens'), false);
});

test('preserves empty current shortcuts as disabled actions', () => {
  const merged = mergeStoredState({
    version: 4,
    shortcuts: {
      openAsk: '',
      askSubmit: 'Control+Enter',
    },
  }, createDefaultState());

  assert.equal(merged.shortcuts.openAsk, '');
  assert.equal(merged.shortcuts.askSubmit, 'Control+Enter');
  assert.equal(merged.shortcuts.askAbort, 'Escape');
});

test('merges stored state without dropping new defaults', () => {
  const merged = mergeStoredState({
    spaces: [{ id: 'custom', name: 'Custom', icon: 'C', color: 'blue' }],
    activeSpaceId: 'custom',
    collapsedSpaceGroups: { custom: true },
    ai: { model: 'glm-5' },
  }, createDefaultState());

  assert.equal(merged.activeSpaceId, 'custom');
  assert.equal(merged.spaces[0].name, 'Custom');
  assert.equal(merged.ai.model, 'glm-5');
  assert.equal(merged.ai.provider, 'openai-compatible');
  assert.equal(merged.ai.language, 'zh-CN');
  assert.equal(merged.shortcuts.askSubmit, 'Primary+Enter');
  assert.deepEqual(merged.groupSpaces, {});
  assert.equal(merged.collapsedSpaceGroups.custom, true);
});

test('resets old built-in Spaces during v4 migration and drops old clutter fields', () => {
  const merged = mergeStoredState({
    version: 3,
    activeSpaceId: 'work',
    spaces: [
      { id: 'work', name: 'Work', icon: 'W', color: 'blue' },
      { id: 'focus', name: 'Focus', icon: 'F', color: 'purple' },
      { id: 'personal', name: 'Personal', icon: 'P', color: 'green' },
    ],
    groupSpaces: { 3: 'focus' },
    favorites: [{ url: 'https://example.com' }],
    pinned: [{ url: 'https://example.com' }],
    archived: [{ url: 'https://example.com' }],
    limits: { splitView: 'old copy' },
  }, createDefaultState());

  assert.equal(merged.activeSpaceId, 'default');
  assert.deepEqual(merged.spaces.map((space) => space.id), ['default']);
  assert.deepEqual(merged.groupSpaces, {});
  assert.equal('favorites' in merged, false);
  assert.equal('pinned' in merged, false);
  assert.equal('archived' in merged, false);
  assert.equal('limits' in merged, false);
});
