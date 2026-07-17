import test from 'node:test';
import assert from 'node:assert/strict';

import {
  arcImportRecordIdentity,
  canPreserveUnconfiguredSettingsAI,
  captureAIAuthTarget,
  captureSettingsBaseline,
  EDITABLE_SHORTCUT_IDS,
  mergeConcurrentSettings,
  normalizeArcImportToken,
  renameTargetReviewFingerprint,
  resolveOperationUndoTarget,
  reviewedRenameTargetIsCurrent,
  sameAIAuthTarget,
  sameArcImportRecord,
} from '../src/shared/action-safety.js';
import { mergeShortcuts } from '../src/shared/shortcuts.js';

test('resolves only the exact applied Undo record without falling back to the latest operation', () => {
  const first = { id: 'first', status: 'applied', summary: 'First' };
  const latest = { id: 'latest', status: 'applied', summary: 'Latest' };

  assert.deepEqual(resolveOperationUndoTarget([first, latest], 'first'), {
    status: 'ready',
    operation: first,
  });
  assert.deepEqual(resolveOperationUndoTarget([first, latest], 'missing'), {
    status: 'missing',
    operation: null,
  });
  assert.deepEqual(resolveOperationUndoTarget(null, 'latest'), {
    status: 'missing',
    operation: null,
  });
  assert.deepEqual(resolveOperationUndoTarget([latest]), {
    status: 'missing',
    operation: null,
  });
});

test('stops exact Undo records that are undone, unavailable, or ambiguous', () => {
  const undone = { id: 'same', status: 'undone' };
  const unavailable = { id: 'waiting', status: 'waiting' };

  assert.deepEqual(resolveOperationUndoTarget([undone], 'same'), {
    status: 'undone',
    operation: undone,
  });
  assert.deepEqual(resolveOperationUndoTarget([unavailable], 'waiting'), {
    status: 'unavailable',
    operation: unavailable,
  });
  assert.deepEqual(resolveOperationUndoTarget([
    { id: ' duplicate ', status: 'applied' },
    { id: 'duplicate', status: 'applied' },
  ], 'duplicate'), {
    status: 'ambiguous',
    operation: null,
  });
});

test('normalizes Arc import tokens and binds both new and legacy records exactly', () => {
  assert.equal(normalizeArcImportToken(' import:abc-123 '), 'import:abc-123');
  assert.equal(normalizeArcImportToken(''), '');
  assert.equal(normalizeArcImportToken('contains a space'), '');
  assert.equal(normalizeArcImportToken('x'.repeat(201)), '');

  const legacy = {
    spaceIds: ['b', 'a', 'b'],
    importedAt: '500',
    afterFingerprints: { a: ' fingerprint-a ', b: 'fingerprint-b' },
  };
  const reordered = {
    spaceIds: ['a', 'b'],
    importedAt: 500,
    afterFingerprints: { b: 'fingerprint-b', a: 'fingerprint-a' },
  };
  assert.equal(sameArcImportRecord(legacy, reordered), true);
  assert.equal(sameArcImportRecord(
    { ...legacy, token: 'new-token' },
    { ...reordered, token: 'new-token' },
  ), true);
  assert.equal(sameArcImportRecord(
    { ...legacy, token: 'new-token' },
    { ...reordered, token: 'other-token' },
  ), false);
  assert.equal(sameArcImportRecord(legacy, {
    ...reordered,
    afterFingerprints: { ...reordered.afterFingerprints, b: 'changed' },
  }), false);
  assert.equal(sameArcImportRecord(legacy, { ...reordered, importedAt: 501 }), false);
  assert.equal(sameArcImportRecord(null, reordered), false);
  assert.equal(arcImportRecordIdentity([]), '');
  assert.equal(arcImportRecordIdentity({ spaceIds: 'a' }), '');
  assert.equal(arcImportRecordIdentity({ spaceIds: [] }), '');
  assert.match(arcImportRecordIdentity({
    spaceIds: ['a'],
    importedAt: Number.NaN,
    afterFingerprints: [],
    token: 'bad token',
  }), /"token":"".*"importedAt":0/);
});

test('Space rename reviews reject a concurrent name or icon change without blocking unrelated edits', () => {
  const reviewed = renameTargetReviewFingerprint('space', {
    id: ' work ',
    name: ' Work ',
    icon: ' W ',
    color: 'blue',
  });

  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'space', {
    id: 'work',
    name: 'Work',
    icon: 'W',
    color: 'green',
  }), true, 'a concurrent color edit can merge with the rename');
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'space', {
    id: 'work',
    name: 'Newer name',
    icon: 'W',
  }), false, 'an older dialog cannot overwrite a newer Space name');
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'space', {
    id: 'work',
    name: 'Work',
    icon: 'X',
  }), false, 'the icon changed by a rename is part of the reviewed write target');
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'space', {
    id: 'replacement',
    name: 'Work',
    icon: 'W',
  }), false);
});

test('Tab rename reviews reject concurrent manual names while allowing ordinary page-title updates', () => {
  const tab = {
    id: 0,
    url: 'https://example.com/spec',
    title: 'Loading title',
    displayTitle: 'Reviewed display title',
    panelTitle: 'Stale decorated value',
    snapshotTabId: 'snapshot-tab-0',
    sessionId: 'browser-session-a',
    pinned: false,
  };
  const reviewed = renameTargetReviewFingerprint('tab', tab, {
    renamedTabs: { 0: 'Reviewed panel name' },
  });

  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    title: 'Finished page title',
    displayTitle: 'Finished page title',
    panelTitle: 'Another stale decorated value',
  }, { renamedTabs: { 0: 'Reviewed panel name' } }), true,
  'a page loading a new automatic title is not a competing manual rename');
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', tab, {
    renamedTabs: { 0: 'Newer panel name' },
  }), false, 'an older dialog cannot overwrite a newer panel name');
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    url: 'https://example.com/other',
  }, { renamedTabs: { 0: 'Reviewed panel name' } }), false);
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    pinned: true,
  }, { renamedTabs: { 0: 'Reviewed panel name' } }), false);
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    id: 1,
  }, { renamedTabs: { 1: 'Reviewed panel name' } }), false);
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    snapshotTabId: 'recycled-tab-0',
  }, { renamedTabs: { 0: 'Reviewed panel name' } }), false);
  assert.equal(reviewedRenameTargetIsCurrent(reviewed, 'tab', {
    ...tab,
    sessionId: 'browser-session-b',
  }, { renamedTabs: { 0: 'Reviewed panel name' } }), false);

  const fallback = renameTargetReviewFingerprint('tab', {
    id: 7,
    panelTitle: ' Local name ',
  }, null);
  assert.equal(reviewedRenameTargetIsCurrent(fallback, 'tab', {
    id: 7,
    panelTitle: 'Local name',
  }), true);
  assert.equal(reviewedRenameTargetIsCurrent(fallback, 'tab', {
    id: 7,
  }), false);
});

test('rename reviews fail closed for malformed or missing targets and fingerprints', () => {
  assert.equal(renameTargetReviewFingerprint(), '');
  assert.equal(renameTargetReviewFingerprint('unknown'), '');
  assert.equal(renameTargetReviewFingerprint('space'), '');
  assert.equal(renameTargetReviewFingerprint('space', null), '');
  assert.equal(renameTargetReviewFingerprint('tab', null), '');
  assert.equal(renameTargetReviewFingerprint('tab', { id: -1 }), '');
  assert.equal(renameTargetReviewFingerprint('tab', { id: 1.5 }), '');
  assert.match(renameTargetReviewFingerprint('tab', { id: 9 }), /"url":""/);

  assert.equal(reviewedRenameTargetIsCurrent(), false);
  assert.equal(reviewedRenameTargetIsCurrent(null, 'tab', { id: 9 }), false);
  assert.equal(reviewedRenameTargetIsCurrent('', 'tab', { id: 9 }), false);
  assert.equal(reviewedRenameTargetIsCurrent('reviewed', 'unknown'), false);
  assert.equal(reviewedRenameTargetIsCurrent('reviewed', 'tab', { id: 9 }), false);
});

function settings(overrides = {}) {
  return {
    ai: {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
      apiKey: 'key-a',
      thinking: 'disabled',
      language: 'en',
      temperature: 0.6,
      serverOwned: 'keep-latest',
      ...(overrides.ai || {}),
    },
    theme: overrides.theme || 'purple',
    shortcuts: mergeShortcuts(overrides.shortcuts),
  };
}

test('captures only editable Settings fields while retaining an exact auth target', () => {
  const baseline = captureSettingsBaseline(settings({
    ai: { thinking: 'enabled' },
    shortcuts: { addSpace: ' control + alt + k ' },
  }));

  assert.equal(baseline.version, 1);
  assert.deepEqual(baseline.aiScope, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    thinking: 'enabled',
    apiKey: 'key-a',
  });
  assert.deepEqual(baseline.auth, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'key-a',
  });
  assert.equal(baseline.shortcuts.addSpace, 'Control+Alt+K');
  assert.equal(Object.hasOwn(baseline.shortcuts, 'togglePanel'), false);
  assert.equal(EDITABLE_SHORTCUT_IDS.includes('togglePanel'), false);

  const fallback = captureSettingsBaseline(null);
  assert.equal(fallback.language, 'zh-CN');
  assert.equal(fallback.theme, 'purple');
});

test('three-way Settings merge preserves unrelated concurrent edits and non-editable fields', () => {
  const before = settings();
  const baseline = captureSettingsBaseline(before);
  const draft = settings({
    theme: 'ocean',
    shortcuts: { addSpace: 'Control+Alt+K' },
  });
  const latest = settings({
    ai: {
      apiKey: 'key-b',
      temperature: 0.2,
      serverOwned: 'newest',
    },
    shortcuts: {
      nextSpace: 'Control+Alt+J',
      togglePanel: 'Meta+Shift+S',
    },
  });

  const merged = mergeConcurrentSettings({ baseline, draft, latest });

  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.userChanged, ['theme', 'shortcut:addSpace']);
  assert.equal(merged.settings.theme, 'ocean');
  assert.equal(merged.settings.ai.apiKey, 'key-b');
  assert.equal(merged.settings.ai.temperature, 0.2);
  assert.equal(merged.settings.ai.serverOwned, 'newest');
  assert.equal(merged.settings.shortcuts.addSpace, 'Control+Alt+K');
  assert.equal(merged.settings.shortcuts.nextSpace, 'Control+Alt+J');
  assert.equal(merged.settings.shortcuts.togglePanel, 'Shift+Meta+S');
});

test('unchanged unconfigured AI does not block unrelated Settings saves', () => {
  const unconfigured = settings({
    ai: {
      provider: 'openai-compatible',
      baseUrl: '',
      model: '',
      apiKey: '',
    },
  });
  const merged = mergeConcurrentSettings({
    baseline: captureSettingsBaseline(unconfigured),
    draft: settings({
      ai: unconfigured.ai,
      theme: 'ocean',
      shortcuts: { addSpace: 'Control+Alt+K' },
    }),
    latest: unconfigured,
  });

  assert.deepEqual(merged.userChanged, ['theme', 'shortcut:addSpace']);
  assert.equal(canPreserveUnconfiguredSettingsAI(merged.settings, merged.userChanged), false);
  assert.equal(canPreserveUnconfiguredSettingsAI(merged.settings.ai, merged.userChanged), true);
  assert.equal(canPreserveUnconfiguredSettingsAI(merged.settings.ai, null), true);
  assert.equal(canPreserveUnconfiguredSettingsAI(null, []), false);
  assert.equal(canPreserveUnconfiguredSettingsAI([], []), false);
});

test('unconfigured AI preservation never masks an AI edit or a concurrent configured provider', () => {
  const unconfiguredAI = {
    provider: 'openai-compatible',
    baseUrl: '',
    model: '',
    apiKey: '',
    thinking: 'disabled',
    language: 'en',
  };

  assert.equal(canPreserveUnconfiguredSettingsAI(unconfiguredAI, ['ai']), false);
  assert.equal(canPreserveUnconfiguredSettingsAI({
    ...unconfiguredAI,
    baseUrl: 'not-a-url',
  }, []), false);
  assert.equal(canPreserveUnconfiguredSettingsAI(settings().ai, []), false);

  const configuredCustom = settings({
    ai: {
      provider: 'openai-compatible',
      baseUrl: 'https://ai.example/v1',
      model: 'example-model',
      apiKey: 'configured-key',
    },
  });
  const clearedAI = settings({ ai: unconfiguredAI });
  const cleared = mergeConcurrentSettings({
    baseline: captureSettingsBaseline(configuredCustom),
    draft: clearedAI,
    latest: configuredCustom,
  });
  assert.deepEqual(cleared.userChanged, ['ai']);
  assert.equal(canPreserveUnconfiguredSettingsAI(cleared.settings.ai, cleared.userChanged), false);

  const merged = mergeConcurrentSettings({
    baseline: captureSettingsBaseline(settings({ ai: unconfiguredAI })),
    draft: settings({ ai: unconfiguredAI, theme: 'ocean' }),
    latest: settings({ ai: { apiKey: 'concurrent-key' } }),
  });
  assert.deepEqual(merged.userChanged, ['theme']);
  assert.equal(merged.settings.ai.apiKey, 'concurrent-key');
  assert.equal(canPreserveUnconfiguredSettingsAI(merged.settings.ai, merged.userChanged), false);
});

test('three-way Settings merge rejects overlapping AI, language, theme, and shortcut edits', () => {
  const before = settings();
  const baseline = captureSettingsBaseline(before);
  const draft = settings({
    ai: { model: 'gpt-5.4', language: 'zh-CN' },
    theme: 'ocean',
    shortcuts: { addSpace: 'Control+Alt+K' },
  });
  const latest = settings({
    ai: { model: 'gpt-5.5', language: 'ja' },
    theme: 'graphite',
    shortcuts: { addSpace: 'Control+Alt+L' },
  });

  const merged = mergeConcurrentSettings({ baseline, draft, latest });

  assert.deepEqual(merged.conflicts, [
    'ai',
    'language',
    'theme',
    'shortcut:addSpace',
  ]);
  assert.equal(merged.settings.ai.model, 'gpt-5.5');
  assert.equal(merged.settings.ai.language, 'ja');
  assert.equal(merged.settings.theme, 'graphite');
  assert.equal(merged.settings.shortcuts.addSpace, 'Control+Alt+L');
});

test('same-field concurrent Settings edits conflict explicitly, even when values match', () => {
  const before = settings();
  const matching = settings({
    ai: { model: 'gpt-5.5' },
    theme: 'ocean',
    shortcuts: { addSpace: 'Control+Alt+K' },
  });
  const merged = mergeConcurrentSettings({
    baseline: captureSettingsBaseline(before),
    draft: matching,
    latest: matching,
  });
  assert.deepEqual(merged.conflicts, ['ai', 'theme', 'shortcut:addSpace']);
  assert.deepEqual(merged.userChanged, ['ai', 'theme', 'shortcut:addSpace']);
});

test('invalid Settings baselines fail safe and normalize baseline fields', () => {
  const before = settings();
  const latest = settings({ ai: { apiKey: 'latest' }, theme: 'graphite' });
  const invalidBaseline = mergeConcurrentSettings({
    baseline: { version: 999 },
    draft: before,
    latest,
  });
  assert.deepEqual(invalidBaseline.conflicts, ['baseline']);
  assert.deepEqual(invalidBaseline.userChanged, []);
  assert.deepEqual(invalidBaseline.settings, latest);

  const normalizedBaseline = captureSettingsBaseline(before);
  normalizedBaseline.aiScope = { ...normalizedBaseline.aiScope, model: ' gpt-5.4-mini ' };
  normalizedBaseline.language = '';
  normalizedBaseline.theme = '';
  normalizedBaseline.shortcuts.addSpace = ' ctrl + alt + n ';
  normalizedBaseline.auth = null;
  const normalized = mergeConcurrentSettings({
    baseline: normalizedBaseline,
    draft: before,
    latest: before,
  });
  assert.deepEqual(normalized.conflicts, ['language']);
});

test('Clear Key target requires the exact rendered provider scope and secret', () => {
  const expected = captureAIAuthTarget(settings().ai);
  assert.deepEqual(expected, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'key-a',
  });
  assert.equal(sameAIAuthTarget(expected, settings().ai), true);
  assert.equal(sameAIAuthTarget(expected, settings({ ai: { apiKey: 'key-b' } }).ai), false);
  assert.equal(sameAIAuthTarget(expected, settings({
    ai: {
      provider: 'openai-compatible',
      baseUrl: 'https://other.example/v1',
    },
  }).ai), false);
  assert.equal(sameAIAuthTarget(null, null), false);
  assert.equal(sameAIAuthTarget({ ...expected, apiKey: '' }, settings().ai), false);
});
