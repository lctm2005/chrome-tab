import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSpaceBackup,
  parseSpaceBackup,
  restoreSpaceBackup,
  SPACE_BACKUP_FORMAT,
} from '../src/shared/space-transfer.js';
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
