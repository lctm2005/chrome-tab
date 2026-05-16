import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultState, mergeStoredState, STORAGE_KEY } from '../src/shared/state.js';

test('creates a single fallback Space preconfigured for GLM-5.1 BYOK', () => {
  const state = createDefaultState({
    ai: {
      apiKey: 'secret',
    },
  });

  assert.equal(state.version, 4);
  assert.equal(state.spaces.length, 1);
  assert.equal(state.activeSpaceId, 'default');
  assert.deepEqual(state.spaces.map((space) => space.name), ['Space']);
  assert.deepEqual(state.groupSpaces, {});
  assert.deepEqual(state.groupOrder, {});
  assert.deepEqual(state.tabOrder, {});
  assert.deepEqual(state.collapsedGroups, {});
  assert.deepEqual(state.collapsedSpaceGroups, {});
  assert.deepEqual(state.askSessions, {});
  assert.equal(state.shortcuts.askSubmit, 'Meta+Enter');
  assert.equal(state.shortcuts.askAbort, 'Control+C');
  assert.equal(state.shortcuts.togglePanel, 'Meta+S');
  assert.equal(state.ai.model, 'glm-5.1');
  assert.equal(state.ai.baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(state.ai.apiKey, 'secret');
  assert.equal(state.ai.language, 'zh-CN');
  assert.equal(STORAGE_KEY, 'spaceTabsState');
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
