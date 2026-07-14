import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertWorkspaceStorageBudget,
  createSpaceBackup,
  fingerprintPortableSpaceContent,
  fingerprintPortableSpacesContent,
  fingerprintPortableWorkspaceContent,
  parseSpaceBackup,
  restoreSpaceBackup,
  serializedJsonBytes,
  SPACE_BACKUP_FORMAT,
} from '../src/shared/space-transfer.js';

test('measures UTF-8 storage bytes and rejects oversized workspace state before persistence', () => {
  assert.equal(serializedJsonBytes({ text: '空间' }), 17);
  assert.equal(assertWorkspaceStorageBudget({ text: 'ok' }, 32), 13);
  assert.throws(
    () => assertWorkspaceStorageBudget({ text: 'x'.repeat(64) }, 32),
    /above the safe 0 MB budget[\s\S]*Nothing was changed/,
  );
});
import { createDefaultState } from '../src/shared/state.js';

test('exports portable Space data without AI settings, secrets, or live tab ids', () => {
  const state = createDefaultState();
  state.activeSpaceId = 'launch';
  state.spaces = [{ id: 'launch', name: 'Launch', icon: 'L', color: 'green' }];
  state.spaceContexts = { launch: '# Outcome\nPublish the extension.' };
  state.spaceSnapshots = {
    launch: {
      version: 1,
      groups: [{
        title: 'Research',
        color: 'blue',
        tabs: [{ id: 42, title: 'Competitor', url: 'https://example.com/competitor' }],
      }],
    },
  };
  state.askSessions = {
    'space:launch': {
      key: 'space:launch',
      spaceId: 'launch',
      title: 'Launch',
      messages: [{ id: 'm1', role: 'user', text: 'What is next?', createdAt: 10 }],
    },
  };
  state.ai.apiKey = 'secret';
  state.ai.baseUrl = 'https://llm.example.com/v1';

  const backup = createSpaceBackup(state, Date.UTC(2026, 6, 12));
  const serialized = JSON.stringify(backup);

  assert.equal(backup.format, SPACE_BACKUP_FORMAT);
  assert.equal(backup.exportedAt, '2026-07-12T00:00:00.000Z');
  assert.equal(backup.spaceContexts.launch, '# Outcome\nPublish the extension.');
  assert.equal(backup.spaceSnapshots.launch.groups[0].tabs[0].url, 'https://example.com/competitor');
  assert.equal('id' in backup.spaceSnapshots.launch.groups[0].tabs[0], false);
  assert.equal('ai' in backup, false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('llm.example.com'), false);
});

test('restores portable Space data while preserving local AI and shortcut settings', () => {
  const target = createDefaultState();
  target.ai.apiKey = 'keep-local-secret';
  target.ai.model = 'local-model';
  target.shortcuts.togglePanel = 'Control+Shift+S';
  target.groupSpaces = { 7: 'default' };
  target.tabSpaces = { 3: 'default' };

  const backup = createSpaceBackup({
    activeSpaceId: 'launch',
    spaces: [{ id: 'launch', name: 'Launch', icon: 'L', color: 'green' }],
    spaceContexts: { launch: '# Launch plan' },
    spaceSnapshots: {},
    askSessions: {},
    collapsedSpaceGroups: { launch: true },
  }, 100);

  const summary = restoreSpaceBackup(target, JSON.stringify(backup));

  assert.equal(target.activeSpaceId, 'launch');
  assert.deepEqual(target.spaces, [{ id: 'launch', name: 'Launch', icon: 'L', color: 'green' }]);
  assert.equal(target.spaceContexts.launch, '# Launch plan');
  assert.equal(target.ai.apiKey, 'keep-local-secret');
  assert.equal(target.ai.model, 'local-model');
  assert.equal(target.shortcuts.togglePanel, 'Control+Shift+S');
  assert.deepEqual(target.groupSpaces, {});
  assert.deepEqual(target.tabSpaces, {});
  assert.deepEqual(summary, { spaces: 1, contexts: 1, savedTabs: 0 });
});

test('portable round trip preserves historical Tags without persisting empty Ungrouped', () => {
  const source = createDefaultState();
  source.activeSpaceId = 'history';
  source.spaces = [{ id: 'history', name: 'History', icon: 'H', color: 'purple' }];
  source.spaceSnapshots = {
    history: {
      version: 1,
      updatedAt: 123,
      preserveGroups: true,
      groups: [
        { title: 'Arc History', color: 'purple', collapsed: true, tabs: [] },
        {
          title: 'Research',
          color: 'blue',
          tabs: [{ title: 'Saved', url: 'https://example.com/saved', panelTitle: 'Read later' }],
        },
        { title: 'Ungrouped', color: 'grey', restorable: true, tabs: [] },
      ],
    },
  };

  const exported = createSpaceBackup(source, 456);
  const parsed = parseSpaceBackup(JSON.stringify(exported));
  const target = createDefaultState();
  const summary = restoreSpaceBackup(target, parsed);

  assert.equal(parsed.spaceSnapshots.history.preserveGroups, true);
  assert.deepEqual(parsed.spaceSnapshots.history.groups, [
    { title: 'Arc History', color: 'purple', collapsed: true, tabs: [] },
    {
      title: 'Research',
      color: 'blue',
      collapsed: false,
      tabs: [{ title: 'Saved', url: 'https://example.com/saved', panelTitle: 'Read later' }],
    },
  ]);
  assert.deepEqual(target.spaceSnapshots, parsed.spaceSnapshots);
  assert.deepEqual(summary, { spaces: 1, contexts: 0, savedTabs: 1 });
});

test('rejects unrelated JSON files as Space backups', () => {
  assert.throws(
    () => parseSpaceBackup('{"spaces":[]}'),
    /not exported by Space/,
  );
});

test('drops unsafe Space ids and executable URLs from restored backups', () => {
  const backup = {
    format: SPACE_BACKUP_FORMAT,
    version: 1,
    exportedAt: '2026-07-12T00:00:00.000Z',
    activeSpaceId: 'safe',
    spaces: [
      { id: 'safe', name: 'Safe' },
      { id: 'constructor', name: 'Unsafe key' },
    ],
    spaceContexts: { safe: '# Safe' },
    spaceSnapshots: {
      safe: {
        groups: [{
          title: 'Links',
          tabs: [
            { title: 'Safe', url: 'https://example.com' },
            { title: 'Unsafe', url: 'javascript:alert(1)' },
          ],
        }],
      },
    },
  };

  const parsed = parseSpaceBackup(JSON.stringify(backup));

  assert.deepEqual(parsed.spaces.map((space) => space.id), ['safe']);
  assert.deepEqual(parsed.spaceSnapshots.safe.groups[0].tabs.map((tab) => tab.url), ['https://example.com']);
});

test('portable workspace fingerprints detect restored user content changes', () => {
  const state = createDefaultState();
  state.activeSpaceId = 'launch';
  state.spaces = [{ id: 'launch', name: 'Launch', icon: 'L', color: 'green' }];
  state.spaceContexts = { launch: '# Launch plan' };
  state.spaceSnapshots = {
    launch: {
      version: 1,
      updatedAt: 100,
      groups: [{
        title: 'Research',
        color: 'blue',
        collapsed: false,
        tabs: [{ title: 'Brief', url: 'https://example.com/brief' }],
      }],
    },
  };
  state.askSessions = {
    'space:launch': {
      key: 'space:launch',
      spaceId: 'launch',
      title: 'Launch',
      createdAt: 10,
      updatedAt: 20,
      messages: [{ id: 'm1', role: 'user', text: 'What ships next?', createdAt: 10 }],
    },
  };

  const original = fingerprintPortableWorkspaceContent(state);
  assert.match(original, /^portable-workspace-v1-[0-9a-f]{8}$/);

  const viewOnlyChange = structuredClone(state);
  viewOnlyChange.activeSpaceId = 'missing';
  viewOnlyChange.collapsedSpaceGroups = { launch: true };
  viewOnlyChange.spaceSnapshots.launch.updatedAt = 999;
  viewOnlyChange.spaceSnapshots.launch.groups[0].collapsed = true;
  viewOnlyChange.askSessions['space:launch'].updatedAt = 999;
  assert.equal(fingerprintPortableWorkspaceContent(viewOnlyChange), original);

  for (const mutate of [
    (next) => { next.spaces[0].name = 'Launch 2'; },
    (next) => { next.spaceContexts.launch = '# Revised plan'; },
    (next) => { next.spaceSnapshots.launch.groups[0].title = 'Decisions'; },
    (next) => { next.spaceSnapshots.launch.groups[0].tabs[0].url += '?v=2'; },
    (next) => { next.askSessions['space:launch'].messages[0].text = 'What changed?'; },
  ]) {
    const changed = structuredClone(state);
    mutate(changed);
    assert.notEqual(fingerprintPortableWorkspaceContent(changed), original);
  }
});

test('per-Space portable fingerprints isolate Arc import content', () => {
  const state = createDefaultState();
  state.spaces.push({ id: 'arc-work', name: 'Arc Work', icon: 'A', color: 'purple' });
  state.spaceSnapshots['arc-work'] = {
    version: 1,
    updatedAt: 10,
    groups: [{
      title: 'History',
      color: 'purple',
      tabs: [{ title: 'Saved', url: 'https://example.com/saved' }],
    }],
  };
  const original = fingerprintPortableSpaceContent(state, 'arc-work');
  assert.match(original, /^portable-space-v1-[0-9a-f]{8}$/);
  assert.deepEqual(fingerprintPortableSpacesContent(state, ['arc-work', 'arc-work']), {
    'arc-work': original,
  });

  const unrelated = structuredClone(state);
  unrelated.spaces[0].name = 'Other Space';
  unrelated.spaceContexts.default = '# Unrelated';
  assert.equal(fingerprintPortableSpaceContent(unrelated, 'arc-work'), original);

  const emptyAskView = structuredClone(state);
  emptyAskView.askSessions['space:arc-work'] = {
    key: 'space:arc-work',
    spaceId: 'arc-work',
    title: 'Arc Work',
    messages: [],
  };
  assert.equal(fingerprintPortableSpaceContent(emptyAskView, 'arc-work'), original);

  const renamed = structuredClone(state);
  renamed.spaces.find((space) => space.id === 'arc-work').name = 'Edited Arc Work';
  assert.notEqual(fingerprintPortableSpaceContent(renamed, 'arc-work'), original);

  const asked = structuredClone(state);
  asked.askSessions['space:arc-work'] = {
    key: 'space:arc-work',
    spaceId: 'arc-work',
    title: 'Arc Work',
    messages: [{ id: 'm1', role: 'user', text: 'New question', createdAt: 1 }],
  };
  assert.notEqual(fingerprintPortableSpaceContent(asked, 'arc-work'), original);

  const deleted = structuredClone(state);
  deleted.spaces = deleted.spaces.filter((space) => space.id !== 'arc-work');
  delete deleted.spaceSnapshots['arc-work'];
  assert.notEqual(fingerprintPortableSpaceContent(deleted, 'arc-work'), original);
});
