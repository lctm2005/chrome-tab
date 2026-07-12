import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultState, mergeStoredState, STORAGE_KEY } from '../src/shared/state.js';

test('creates a single fallback Space with blank BYOK AI settings', () => {
  const state = createDefaultState();

  assert.equal(state.version, 7);
  assert.equal(state.spaces.length, 1);
  assert.equal(state.activeSpaceId, 'default');
  assert.deepEqual(state.spaces.map((space) => space.name), ['Default']);
  assert.equal(state.ai.maxTokens, 1_000_000);
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
  assert.deepEqual(state.onboarding, { version: 1, completed: false });
  assert.equal(state.lastArcImport, null);
  assert.equal(state.shortcuts.askSubmit, 'Meta+Enter');
  assert.equal(state.shortcuts.askAbort, 'Control+C');
  assert.equal(state.shortcuts.togglePanel, 'Alt+S');
  assert.equal(state.ai.model, '');
  assert.equal(state.ai.baseUrl, '');
  assert.equal(state.ai.apiKey, '');
  assert.equal(state.ai.language, 'zh-CN');
  assert.equal(STORAGE_KEY, 'spaceTabsState');
});

test('keeps explicitly configured BYOK AI settings', () => {
  const state = createDefaultState({
    ai: {
      baseUrl: 'https://api.z.ai/api/coding/paas/v4/',
      model: 'glm-5.2',
      apiKey: 'secret',
    },
  });

  assert.equal(state.ai.provider, 'z-ai');
  assert.equal(state.ai.baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(state.ai.model, 'glm-5.2');
  assert.equal(state.ai.apiKey, 'secret');
});

test('recognizes stored built-in provider settings without losing explicit choice', () => {
  const merged = mergeStoredState({
    version: 4,
    ai: {
      provider: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.2',
      apiKey: '',
    },
  }, createDefaultState());

  assert.equal(merged.ai.provider, 'z-ai');
  assert.equal(merged.ai.baseUrl, 'https://api.z.ai/api/coding/paas/v4');
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

test('migrates v4 Space ownership into v7 without resetting shortcuts', () => {
  const merged = mergeStoredState({
    version: 4,
    activeSpaceId: 'work',
    spaces: [{ id: 'work', name: 'Work', icon: 'W', color: 'blue' }],
    groupSpaces: { 7: 'work' },
    tabSpaces: { 4: 'work' },
    spaceContexts: { work: '# Launch\nShip the store update.' },
    shortcuts: { togglePanel: 'Meta+S' },
  }, createDefaultState());

  assert.equal(merged.version, 7);
  assert.equal(merged.activeSpaceId, 'work');
  assert.deepEqual(merged.groupSpaces, { 7: 'work' });
  assert.deepEqual(merged.tabSpaces, { 4: 'work' });
  assert.equal(merged.spaceContexts.work, '# Launch\nShip the store update.');
  assert.equal(merged.shortcuts.togglePanel, 'Meta+S');
  assert.deepEqual(merged.onboarding, { version: 1, completed: false });
});

test('preserves completed onboarding and a valid Arc import undo record', () => {
  const merged = mergeStoredState({
    version: 7,
    onboarding: { version: 1, completed: true },
    lastArcImport: { spaceIds: ['arc-work', 'arc-work', 'arc-home'], importedAt: 123 },
  }, createDefaultState());

  assert.deepEqual(merged.onboarding, { version: 1, completed: true });
  assert.deepEqual(merged.lastArcImport, {
    spaceIds: ['arc-work', 'arc-home'],
    importedAt: 123,
  });
});

test('migrates the legacy default Space and max token defaults', () => {
  const merged = mergeStoredState({
    version: 6,
    activeSpaceId: 'default',
    spaces: [{ id: 'default', name: 'Launch review', icon: 'L', color: 'blue' }],
    ai: { maxTokens: 1024 },
  }, createDefaultState());

  assert.deepEqual(merged.spaces[0], { id: 'default', name: 'Default', icon: 'D', color: 'blue' });
  assert.equal(merged.ai.maxTokens, 1_000_000);
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
  assert.equal(merged.shortcuts.askAbort, 'Control+C');
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
  assert.equal(merged.shortcuts.askSubmit, 'Meta+Enter');
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
