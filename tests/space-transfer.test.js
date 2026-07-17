import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertWorkspaceStorageBudget,
  captureSnapshotIdentityOverlay,
  createSpaceBackup,
  fingerprintPortableSpaceContent,
  fingerprintPortableSpacesContent,
  fingerprintPortableWorkspaceContent,
  parseSpaceBackup,
  remapSnapshotGroupOrderKeys,
  restoreSnapshotIdentityOverlay,
  restoreSpaceBackup,
  serializedJsonBytes,
  SPACE_BACKUP_FORMAT,
  transferSnapshotGroupsBetweenSpaces,
} from '../src/shared/space-transfer.js';
import { ASK_SESSION_LIMITS, adoptPortableAskSession } from '../src/shared/ask-session.js';
import { sanitizeSnapshotWithLifecycleIds } from '../src/shared/tab-lifecycle.js';

test('measures UTF-8 storage bytes and rejects oversized workspace state before persistence', () => {
  assert.equal(serializedJsonBytes({ text: '空间' }), 17);
  assert.equal(assertWorkspaceStorageBudget({ text: 'ok' }, 32), 13);
  assert.throws(
    () => assertWorkspaceStorageBudget({ text: 'x'.repeat(64) }, 32),
    /above the safe 0 MB budget[\s\S]*Nothing was changed/,
  );
});
import { createDefaultState } from '../src/shared/state.js';

test('a compact Undo overlay restores local snapshot identities without changing portable backups', () => {
  const sourceSnapshots = {
    work: {
      version: 1,
      identityVersion: 1,
      groups: [
        {
          snapshotGroupId: ' group-work ',
          title: 'Work',
          color: 'blue',
          tabs: [
            { snapshotTabId: 'tab-one', title: 'One', url: 'https://example.com/one' },
            { snapshotTabId: 'tab-two', title: 'Two', url: 'https://example.com/two' },
          ],
        },
        {
          snapshotGroupId: 'invalid group id',
          title: 'Legacy',
          color: 'red',
          tabs: [{ snapshotTabId: 'x'.repeat(129), title: 'Three', url: 'https://example.com/three' }],
        },
      ],
    },
    noIds: {
      groups: [{ title: 'No ids', tabs: [{ title: 'Plain', url: 'https://example.com/plain' }] }],
    },
    damaged: null,
  };
  const original = structuredClone(sourceSnapshots);
  const overlay = captureSnapshotIdentityOverlay(sourceSnapshots);

  assert.deepEqual(sourceSnapshots, original);
  assert.deepEqual(overlay, {
    work: [
      ['group-work', ['tab-one', 'tab-two']],
      ['', ['']],
    ],
  });
  assert.deepEqual(captureSnapshotIdentityOverlay(null), {});

  const portable = {
    work: {
      version: 1,
      groups: [
        {
          title: 'Work', color: 'blue', tabs: [
            { title: 'One', url: 'https://example.com/one' },
            { title: 'Two', url: 'https://example.com/two' },
          ],
        },
        { title: 'Legacy', color: 'red', tabs: [{ title: 'Three', url: 'https://example.com/three' }] },
        { title: 'New', color: 'green', tabs: [{ title: 'Four', url: 'https://example.com/four' }] },
      ],
    },
    untouched: {
      groups: [{ title: 'Untouched', tabs: [{ title: 'Keep', url: 'https://example.com/keep' }] }],
    },
    emptyIdentity: {
      groups: [{ title: 'Empty identity', tabs: [{ title: 'No id', url: 'https://example.com/no-id' }] }],
    },
  };
  const restored = restoreSnapshotIdentityOverlay(portable, {
    work: [
      ['group-work', ['tab-one', 'tab-one']],
      ['invalid group id', 'not-an-array'],
    ],
    emptyIdentity: [['invalid id', ['also invalid']]],
    missing: [['missing-group', ['missing-tab']]],
  });

  assert.equal(restored.work.identityVersion, 1);
  assert.equal(restored.work.groups[0].snapshotGroupId, 'group-work');
  assert.equal(restored.work.groups[0].tabs[0].snapshotTabId, 'tab-one');
  assert.equal(restored.work.groups[0].tabs[1].snapshotTabId, undefined);
  assert.equal(restored.work.groups[1].snapshotGroupId, undefined);
  assert.equal(restored.work.groups[1].tabs[0].snapshotTabId, undefined);
  assert.equal(restored.work.groups[2].snapshotGroupId, undefined);
  assert.deepEqual(restored.untouched, portable.untouched);
  assert.equal(restored.emptyIdentity.identityVersion, undefined);
  assert.deepEqual(restoreSnapshotIdentityOverlay(null, null), {});
});

test('exports portable Space data without AI settings, secrets, or live tab ids', () => {
  const state = createDefaultState();
  state.activeSpaceId = 'launch';
  state.spaces = [{ id: 'launch', name: 'Launch', icon: 'L', color: 'green' }];
  state.spaceContexts = { launch: '# Outcome\nPublish the extension.' };
  state.spaceSnapshots = {
    launch: {
      version: 1,
      identityVersion: 1,
      groups: [{
        title: 'Research',
        color: 'blue',
        snapshotGroupId: 'local-snapshot-group',
        tabs: [{
          id: 42,
          snapshotTabId: 'local-snapshot-tab',
          title: 'Competitor',
          url: 'https://example.com/competitor',
        }],
      }],
    },
  };
  state.tabLifecycle = {
    42: {
      snapshotGroupId: 'local-snapshot-group',
      snapshotTabId: 'local-snapshot-tab',
      spaceId: 'launch',
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
  assert.equal('identityVersion' in backup.spaceSnapshots.launch, false);
  assert.equal('snapshotGroupId' in backup.spaceSnapshots.launch.groups[0], false);
  assert.equal('snapshotTabId' in backup.spaceSnapshots.launch.groups[0].tabs[0], false);
  assert.equal('tabLifecycle' in backup, false);
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
  target.tabLifecycle = {
    3: {
      snapshotGroupId: 'old-group',
      snapshotTabId: 'old-row',
      spaceId: 'default',
      trackingMode: 'saved-target',
    },
  };
  target.lastArcImport = { spaceIds: ['launch'], importedAt: 10 };

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
  assert.deepEqual(target.tabLifecycle, {});
  assert.equal(target.lastArcImport, null);
  assert.deepEqual(summary, { spaces: 1, contexts: 1, savedTabs: 0, askConversations: 0 });
});

test('exports real tab-scoped Ask Page history without stale tab ids and restores every conversation', () => {
  const source = createDefaultState();
  source.askSessions = {
    'tab:41:https://example.com/brief': {
      key: 'tab:41:https://example.com/brief',
      tabId: 41,
      title: 'Launch brief',
      url: 'https://example.com/brief',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        { id: 'm1', role: 'user', text: 'What changed?', createdAt: 10 },
        { id: 'm2', role: 'assistant', text: 'The launch moved to Tuesday.', createdAt: 20 },
      ],
    },
    'tab:77:https://example.com/brief': {
      key: 'tab:77:https://example.com/brief',
      tabId: 77,
      title: 'Second conversation',
      url: 'https://example.com/brief',
      createdAt: 30,
      updatedAt: 40,
      messages: [{ id: 'm3', role: 'user', text: 'Who owns it?', createdAt: 30 }],
    },
    'tab:88:chrome://settings/': {
      key: 'tab:88:chrome://settings/',
      tabId: 88,
      title: 'Restricted page',
      url: 'chrome://settings/',
      messages: [{ id: 'm4', role: 'user', text: 'Never readable', createdAt: 50 }],
    },
  };

  const backup = createSpaceBackup(source, 100);
  const serialized = JSON.stringify(backup);
  const pageSessions = Object.entries(backup.askSessions)
    .filter(([key]) => key.startsWith('page:'));

  assert.equal(pageSessions.length, 2, 'two separate conversations for the same page must both survive');
  assert.ok(pageSessions.every(([key, session]) => (
    /^page:[0-9a-f]{8}:\d+$/.test(key) && session.tabId === undefined
  )), 'portable history must not retain ephemeral Chrome tab ids');
  assert.equal(serialized.includes('tab:41:'), false);
  assert.equal(serialized.includes('"tabId":41'), false);
  assert.ok(pageSessions.every(([, session]) => session.url === 'https://example.com/brief'));
  assert.equal(serialized.includes('Never readable'), false, 'restricted-page placeholders are not Ask Page history');

  const target = createDefaultState();
  const summary = restoreSpaceBackup(target, JSON.stringify(backup));
  assert.deepEqual(target.askSessions, backup.askSessions);
  assert.deepEqual(summary, { spaces: 1, contexts: 0, savedTabs: 0, askConversations: 2 });
});

test('portable Ask backup keeps SPA hash routes isolated through restore and adoption', () => {
  const source = createDefaultState();
  source.askSessions = {
    'tab:1:https://app.example/#/customer/1': {
      key: 'tab:1:https://app.example/#/customer/1',
      tabId: 1,
      title: 'Customer one',
      url: 'https://app.example/#/customer/1',
      updatedAt: 10,
      messages: [{ id: 'one', role: 'user', text: 'History one', createdAt: 1 }],
    },
    'tab:1:https://app.example/#/customer/2': {
      key: 'tab:1:https://app.example/#/customer/2',
      tabId: 1,
      title: 'Customer two',
      url: 'https://app.example/#/customer/2',
      updatedAt: 20,
      messages: [{ id: 'two', role: 'user', text: 'History two', createdAt: 2 }],
    },
  };

  const target = createDefaultState();
  restoreSpaceBackup(target, JSON.stringify(createSpaceBackup(source, 100)));
  const routeOne = adoptPortableAskSession(target.askSessions, {
    id: 11,
    url: 'https://app.example/#/customer/1',
  });
  const routeTwo = adoptPortableAskSession(target.askSessions, {
    id: 12,
    url: 'https://app.example/#/customer/2',
  });

  assert.equal(routeOne.messages[0].text, 'History one');
  assert.equal(routeTwo.messages[0].text, 'History two');
  assert.notEqual(routeOne.key, routeTwo.key);
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
  assert.deepEqual(summary, { spaces: 1, contexts: 0, savedTabs: 1, askConversations: 0 });
});

test('portable backup round trip preserves intentional duplicate URLs without exporting local identities', () => {
  const source = createDefaultState();
  source.spaceSnapshots.default = {
    version: 1,
    identityVersion: 1,
    groups: [
      {
        title: 'Duplicates',
        color: 'blue',
        snapshotGroupId: 'private-group-one',
        tabs: [
          { title: 'First copy', url: 'https://same.example/page', snapshotTabId: 'private-row-one' },
          { title: 'Second copy', url: 'https://same.example/page', snapshotTabId: 'private-row-two' },
        ],
      },
      {
        title: 'Another Tag',
        color: 'green',
        snapshotGroupId: 'private-group-two',
        tabs: [
          { title: 'Third copy', url: 'https://same.example/page', snapshotTabId: 'private-row-three' },
        ],
      },
    ],
  };

  const exported = createSpaceBackup(source, 100);
  const serialized = JSON.stringify(exported);
  const parsed = parseSpaceBackup(serialized);
  const restored = createDefaultState();
  restoreSpaceBackup(restored, parsed);

  assert.deepEqual(exported.spaceSnapshots.default.groups.map((group) => group.tabs.length), [2, 1]);
  assert.deepEqual(parsed.spaceSnapshots.default.groups.map((group) => group.tabs.length), [2, 1]);
  assert.deepEqual(restored.spaceSnapshots.default.groups.map((group) => group.tabs.length), [2, 1]);
  assert.equal(serialized.includes('private-group'), false);
  assert.equal(serialized.includes('private-row'), false);
});

test('reloading an inactive restored Space keeps intentional same-URL copies', () => {
  const source = createDefaultState();
  source.activeSpaceId = 'active';
  source.spaces = [
    { id: 'active', name: 'Active' },
    { id: 'inactive', name: 'Inactive' },
  ];
  source.spaceContexts = { active: '', inactive: '' };
  source.spaceSnapshots = {
    inactive: {
      version: 1,
      identityVersion: 1,
      groups: [{
        snapshotGroupId: 'private-group',
        title: 'Duplicates',
        color: 'blue',
        tabs: [
          { snapshotTabId: 'private-first', title: 'First', url: 'https://same.test/page' },
          { snapshotTabId: 'private-second', title: 'Second', url: 'https://same.test/page' },
        ],
      }],
    },
  };

  const restored = createDefaultState();
  restoreSpaceBackup(restored, JSON.stringify(createSpaceBackup(source, 100)));
  assert.equal(restored.activeSpaceId, 'active');
  assert.equal(restored.spaceSnapshots.inactive.groups[0].tabs.length, 2);
  assert.equal(restored.spaceSnapshots.inactive.groups[0].tabs[0].snapshotTabId, undefined);

  restored.spaceSnapshots.inactive = sanitizeSnapshotWithLifecycleIds(
    restored.spaceSnapshots.inactive,
    (kind, index) => `${kind}-restored-${index}`,
  );
  restored.spaceSnapshots.inactive = sanitizeSnapshotWithLifecycleIds(
    restored.spaceSnapshots.inactive,
    () => 'must-not-replace-valid-identities',
  );

  assert.equal(restored.spaceSnapshots.inactive.groups[0].tabs.length, 2);
  assert.deepEqual(restored.spaceSnapshots.inactive.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'tab-restored-0',
    'tab-restored-1',
  ]);
});

test('moving a live group transfers its saved siblings without merging same-URL identities', () => {
  const result = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot: {
      version: 1,
      identityVersion: 1,
      groups: [
        {
          snapshotGroupId: 'moving-group',
          title: 'Work',
          color: 'blue',
          tabs: [
            { snapshotTabId: 'live-row', title: 'Live', url: 'https://same.test/page' },
            { snapshotTabId: 'saved-row', title: 'Saved sibling', url: 'https://same.test/page' },
          ],
        },
        {
          snapshotGroupId: 'remaining-group',
          title: 'Keep',
          color: 'green',
          tabs: [{ snapshotTabId: 'keep-row', title: 'Keep', url: 'https://keep.test/page' }],
        },
      ],
    },
    targetSnapshot: {
      version: 2,
      identityVersion: 1,
      groups: [{
        snapshotGroupId: 'target-group',
        title: 'Existing',
        color: 'red',
        tabs: [{ snapshotTabId: 'target-row', title: 'Target copy', url: 'https://same.test/page' }],
      }],
    },
    snapshotGroupIds: [' moving-group '],
    now: 50,
  });

  assert.deepEqual(result.sourceSnapshot.groups.map((group) => group.snapshotGroupId), ['remaining-group']);
  assert.deepEqual(result.targetSnapshot.groups.map((group) => ({
    id: group.snapshotGroupId,
    rows: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { id: 'target-group', rows: ['target-row'] },
    { id: 'moving-group', rows: ['live-row', 'saved-row'] },
  ]);
  assert.deepEqual(result.movedGroups[0].tabs.map((tab) => tab.title), ['Live', 'Saved sibling']);
  assert.equal(result.sourceSnapshot.updatedAt, 50);
  assert.equal(result.targetSnapshot.version, 2);
});

test('moving by tab identity reconciles target ghosts and preserves target-only siblings', () => {
  const result = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot: {
      version: 1,
      identityVersion: 1,
      preserveGroups: true,
      groups: [{
        snapshotGroupId: 'moving-group',
        title: 'Work',
        color: 'blue',
        tabs: [
          { snapshotTabId: 'row-a', title: 'A current', url: 'https://a.test' },
          { snapshotTabId: 'row-b', title: 'B current', url: 'https://b.test' },
        ],
      }],
    },
    targetSnapshot: {
      version: 1,
      identityVersion: 1,
      preserveGroups: true,
      groups: [
        {
          snapshotGroupId: 'moving-group',
          title: 'Old ghost',
          color: 'purple',
          tabs: [
            { snapshotTabId: 'row-a', title: 'A ghost', url: 'https://old-a.test' },
            { snapshotTabId: 'target-only', title: 'Target only', url: 'https://target.test' },
          ],
        },
        {
          snapshotGroupId: 'other-ghost',
          title: 'Other ghost',
          color: 'red',
          tabs: [{ snapshotTabId: 'row-b', title: 'B ghost', url: 'https://old-b.test' }],
        },
        {
          snapshotGroupId: 'empty-history',
          title: 'Empty history',
          color: 'grey',
          tabs: [],
        },
      ],
    },
    snapshotTabIds: ['row-a'],
    now: 75,
  });

  assert.equal(result.sourceSnapshot, null);
  assert.deepEqual(result.targetSnapshot.groups.map((group) => ({
    id: group.snapshotGroupId,
    rows: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { id: 'other-ghost', rows: [] },
    { id: 'empty-history', rows: [] },
    { id: 'moving-group', rows: ['row-a', 'row-b', 'target-only'] },
  ]);
  const allIds = result.targetSnapshot.groups.flatMap((group) => (
    group.tabs.map((tab) => tab.snapshotTabId).filter(Boolean)
  ));
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(result.targetSnapshot.preserveGroups, true);
});

test('snapshot group transfer is a no-op without a matching durable identity', () => {
  assert.deepEqual(transferSnapshotGroupsBetweenSpaces(), {
    sourceSnapshot: null,
    targetSnapshot: null,
    movedGroups: [],
  });
  const sourceSnapshot = {
    version: 1,
    groups: [{ title: 'Legacy', color: 'blue', tabs: [{ title: 'Page', url: 'https://legacy.test' }] }],
  };
  const result = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot,
    snapshotGroupIds: ['missing-group'],
    snapshotTabIds: null,
    now: Number.NaN,
  });
  assert.deepEqual(result.sourceSnapshot.groups[0].tabs, sourceSnapshot.groups[0].tabs);
  assert.equal(result.targetSnapshot, null);
  assert.deepEqual(result.movedGroups, []);
});

test('moving an empty dormant Tag preserves it only in the target Space', () => {
  const result = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot: {
      version: 1,
      identityVersion: 1,
      preserveGroups: true,
      groups: [{
        snapshotGroupId: 'empty-saved-group',
        title: 'Keep for later',
        color: 'cyan',
        tabs: [],
      }],
    },
    snapshotGroupIds: ['empty-saved-group'],
    now: 90,
  });

  assert.equal(result.sourceSnapshot, null);
  assert.equal(result.targetSnapshot.preserveGroups, true);
  assert.deepEqual(result.targetSnapshot.groups, [{
    snapshotGroupId: 'empty-saved-group',
    title: 'Keep for later',
    color: 'cyan',
    tabs: [],
  }]);
});

test('moving an identity-only legacy group fills safe metadata defaults', () => {
  const result = transferSnapshotGroupsBetweenSpaces({
    sourceSnapshot: {
      version: 0,
      groups: [{
        title: 'Identity only',
        tabs: [{ snapshotTabId: 'legacy-row', title: 'Page', url: 'https://legacy.test/page' }],
      }],
    },
    snapshotGroupIds: null,
    snapshotTabIds: ['legacy-row'],
    now: Number.NaN,
  });

  assert.equal(result.sourceSnapshot, null);
  assert.equal(result.targetSnapshot.version, 1);
  assert.equal(result.targetSnapshot.identityVersion, undefined);
  assert.equal(result.targetSnapshot.preserveGroups, undefined);
  assert.equal(Number.isFinite(result.targetSnapshot.updatedAt), true);
  assert.equal(result.targetSnapshot.groups[0].snapshotGroupId, undefined);
  assert.deepEqual(result.targetSnapshot.groups[0].tabs.map((tab) => tab.snapshotTabId), ['legacy-row']);
});

test('snapshot group ordering follows stable identity when transfer changes array indexes', () => {
  const beforeSnapshot = {
    identityVersion: 1,
    groups: [
      {
        snapshotGroupId: 'moved-a', title: 'A', color: 'blue',
        tabs: [{ snapshotTabId: 'row-a', title: 'A', url: 'https://a.test' }],
      },
      {
        snapshotGroupId: 'kept-b', title: 'B', color: 'green',
        tabs: [{ snapshotTabId: 'row-b', title: 'B', url: 'https://b.test' }],
      },
    ],
  };
  const afterSnapshot = {
    identityVersion: 1,
    groups: [beforeSnapshot.groups[1]],
  };

  assert.deepEqual(remapSnapshotGroupOrderKeys({
    order: [
      'snapshot:1:work:kept-b',
      'group:42',
      'snapshot:0:work:moved-a',
      'snapshot:99:work:stale',
      'group:42',
    ],
    beforeSnapshot,
    afterSnapshot,
    spaceId: 'work',
  }), [
    'snapshot:0:work:kept-b',
    'group:42',
  ]);
});

test('target snapshot ordering keeps an existing identity rank and encodes Space ids safely', () => {
  const beforeSnapshot = {
    identityVersion: 1,
    preserveGroups: true,
    groups: [
      { snapshotGroupId: 'first', title: 'First', color: 'blue', tabs: [] },
      { snapshotGroupId: 'returning', title: 'Old', color: 'red', tabs: [] },
      { snapshotGroupId: 'last', title: 'Last', color: 'green', tabs: [] },
    ],
  };
  const afterSnapshot = {
    ...beforeSnapshot,
    groups: [beforeSnapshot.groups[0], beforeSnapshot.groups[2], {
      ...beforeSnapshot.groups[1], title: 'Current',
    }],
  };

  assert.deepEqual(remapSnapshotGroupOrderKeys({
    order: ['snapshot:1:focus%20mode:returning', 'vgroup:local'],
    beforeSnapshot,
    afterSnapshot,
    spaceId: 'focus mode',
  }), ['snapshot:2:focus%20mode:returning', 'vgroup:local']);
  const legacySnapshot = {
    groups: [{ title: 'Legacy', color: 'blue', tabs: [{ title: 'Page', url: 'https://legacy.test' }] }],
  };
  assert.deepEqual(remapSnapshotGroupOrderKeys({
    order: ['snapshot:0::Legacy'],
    beforeSnapshot: legacySnapshot,
    afterSnapshot: legacySnapshot,
  }), []);
  assert.deepEqual(remapSnapshotGroupOrderKeys({ order: null }), []);
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

test('rejects malformed backup envelopes and unsupported versions with specific errors', () => {
  assert.throws(() => createSpaceBackup(), /at least one valid Space/);
  assert.throws(() => parseSpaceBackup('{broken'), /not valid JSON/);
  assert.throws(() => parseSpaceBackup(null), /not a Space backup/);
  assert.throws(() => parseSpaceBackup(7), /not a Space backup/);
  assert.throws(() => parseSpaceBackup([]), /not a Space backup/);
  assert.throws(
    () => parseSpaceBackup({ format: SPACE_BACKUP_FORMAT, version: 2 }),
    /Unsupported Space backup version: 2/,
  );
  assert.throws(
    () => parseSpaceBackup({ format: SPACE_BACKUP_FORMAT }),
    /Unsupported Space backup version: unknown/,
  );
});

test('normalizes hostile and partial portable state without leaking invalid records', () => {
  const longId = 'x'.repeat(140);
  let changingUrlReads = 0;
  const changingUrlTab = {
    title: 'Changed while exporting',
    get url() {
      changingUrlReads += 1;
      return changingUrlReads === 1 ? 'https://example.com/initially-valid' : 'not a url';
    },
  };
  const backup = createSpaceBackup({
    activeSpaceId: 'missing',
    spaces: [
      null,
      { id: '', name: 'Missing id' },
      { id: 'missing-name', name: '' },
      { id: '__proto__', name: 'Unsafe' },
      { id: 'prototype', name: 'Unsafe' },
      { id: 'constructor', name: 'Unsafe' },
      { id: 'safe', name: ' Safe ' },
      { id: 'safe', name: 'Duplicate' },
      { id: longId, name: 'N'.repeat(205), icon: '🧭', color: 'cyan' },
    ],
    spaceContexts: {
      safe: null,
      missing: 'must be dropped',
    },
    spaceSnapshots: {
      missing: { groups: [{ tabs: [{ url: 'https://example.com/missing' }] }] },
      [longId.slice(0, 128)]: null,
      safe: {
        version: 0,
        updatedAt: 'not-a-timestamp',
        preserveGroups: true,
        groups: [
          {
            restorable: true,
            collapsed: true,
            tabs: [
              { url: 'https://example.com/http', panelTitle: ' Read later ' },
              { title: 'Local file', url: 'file:///tmp/readme.html' },
              { title: 'Chrome settings', url: 'chrome://settings/' },
              { title: 'Script', url: 'javascript:alert(1)' },
              { title: 'Malformed', url: 'not a url' },
              changingUrlTab,
              { title: 'New tab', url: 'chrome://newtab/' },
              { title: 'Extension', url: 'chrome-extension://abc/page.html' },
            ],
          },
          { title: 'Empty history', color: 'purple', tabs: [] },
          { title: 'Ungrouped', color: 'grey', tabs: [] },
        ],
      },
    },
    askSessions: null,
    collapsedSpaceGroups: { safe: 1, missing: true },
  }, 0);

  assert.equal(backup.activeSpaceId, 'safe');
  assert.deepEqual(backup.spaces, [
    { id: 'safe', name: 'Safe', icon: 'S', color: 'blue' },
    { id: longId.slice(0, 128), name: 'N'.repeat(200), icon: '🧭', color: 'cyan' },
  ]);
  assert.deepEqual(backup.spaceContexts, { safe: '' });
  assert.deepEqual(backup.collapsedSpaceGroups, { safe: true });
  assert.deepEqual(Object.keys(backup.spaceSnapshots), ['safe']);
  assert.equal(backup.spaceSnapshots.safe.version, 1);
  assert.equal(backup.spaceSnapshots.safe.preserveGroups, true);
  assert.equal(Number.isFinite(backup.spaceSnapshots.safe.updatedAt), true);
  assert.deepEqual(backup.spaceSnapshots.safe.groups, [
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: true,
      restorable: true,
      tabs: [
        { title: 'https://example.com/http', url: 'https://example.com/http', panelTitle: 'Read later' },
        { title: 'Local file', url: 'file:///tmp/readme.html' },
      ],
    },
    { title: 'Empty history', color: 'purple', collapsed: false, tabs: [] },
  ]);
  assert.ok(changingUrlReads > 1, 'a URL that changes after validation is still rejected during export');

  const withoutOptionalMaps = createSpaceBackup({
    spaces: [{ id: 'minimal', name: 'Minimal' }],
    spaceContexts: null,
    spaceSnapshots: null,
    askSessions: null,
    collapsedSpaceGroups: null,
  }, 1);
  assert.deepEqual(withoutOptionalMaps.spaceContexts, {});
  assert.deepEqual(withoutOptionalMaps.spaceSnapshots, {});
  assert.deepEqual(withoutOptionalMaps.askSessions, {});
});

test('portable Ask history is bounded, deterministic, sanitized, and fingerprinted', () => {
  const state = createDefaultState();
  const retainedMessages = Array.from({ length: ASK_SESSION_LIMITS.maxMessagesPerSession + 3 }, (_, index) => {
    if (index === 7) return null;
    return {
      ...(index === 3 ? {} : { id: `m-${index}` }),
      role: index % 2 === 0 ? 'user' : 'tool',
      text: index === 4 ? '' : index === 5 ? 'x'.repeat(ASK_SESSION_LIMITS.maxMessageChars + 20) : `message-${index}`,
      createdAt: index === 6 ? undefined : index,
      ...(index === 8 ? { updatedAt: 99 } : {}),
    };
  });
  state.askSessions = {
    'space:default': {
      key: 'space:default',
      spaceId: 'default',
      title: '',
      createdAt: undefined,
      updatedAt: undefined,
      messages: null,
    },
    'tab:1:https://example.com/special#section': {
      title: '',
      url: 'https://example.com/special#section',
      createdAt: 1,
      updatedAt: 100,
      messages: retainedMessages,
    },
    ...Object.fromEntries(Array.from({ length: ASK_SESSION_LIMITS.maxSessions + 1 }, (_, index) => [
      `tab:${index + 2}:https://example.com/page-${index}`,
      {
        title: `Page ${index}`,
        url: index === 0 ? 'https://example.com/special' : `https://example.com/page-${index}`,
        createdAt: index,
        updatedAt: index + 1,
        messages: [{ role: 'user', text: `question-${index}`, createdAt: index }],
      },
    ])),
    'tab:null': null,
    'tab:bad-url': { url: 'not a url', messages: [{ role: 'user', text: 'drop malformed' }] },
    'page:file': { url: 'file:///tmp/private', messages: [{ role: 'user', text: 'drop file' }] },
    'page:empty': { url: 'https://example.com/empty', messages: [] },
    unrelated: { url: 'https://example.com/ignored', messages: [{ role: 'user', text: 'drop key' }] },
  };

  const backup = createSpaceBackup(state, 500);
  const pageSessions = Object.entries(backup.askSessions).filter(([key]) => key.startsWith('page:'));
  assert.equal(pageSessions.length, ASK_SESSION_LIMITS.maxSessions);
  assert.ok(pageSessions.every(([key]) => /^page:[0-9a-f]{8}:\d+$/.test(key)));
  assert.equal(JSON.stringify(backup).includes('drop malformed'), false);
  assert.equal(JSON.stringify(backup).includes('drop file'), false);
  assert.equal(JSON.stringify(backup).includes('drop key'), false);

  const special = pageSessions.find(([, session]) => session.url === 'https://example.com/special#section');
  assert.ok(special);
  assert.equal(special[1].title, 'Current page');
  assert.ok(special[1].messages.length <= ASK_SESSION_LIMITS.maxMessagesPerSession);
  assert.ok(special[1].messages.some((message) => message.id === '0-0' || /^\d+-0$/.test(message.id)));
  assert.ok(special[1].messages.some((message) => message.text.length === ASK_SESSION_LIMITS.maxMessageChars));
  assert.ok(special[1].messages.some((message) => message.updatedAt === 99));
  assert.ok(special[1].messages.some((message) => message.role === 'assistant'));
  assert.ok(
    special[1].messages.reduce((total, message) => total + message.text.length, 0)
      <= ASK_SESSION_LIMITS.maxSessionChars,
    'portable page history must obey the same total character budget as live history',
  );

  const reparsed = parseSpaceBackup(JSON.stringify(backup));
  assert.deepEqual(reparsed.askSessions, backup.askSessions);
  const originalFingerprint = fingerprintPortableWorkspaceContent(state);
  const timestampOnly = structuredClone(state);
  timestampOnly.askSessions['tab:1:https://example.com/special#section'].updatedAt = 9999;
  assert.equal(fingerprintPortableWorkspaceContent(timestampOnly), originalFingerprint);
  const edited = structuredClone(state);
  edited.askSessions['tab:1:https://example.com/special#section'].messages.at(-1).text = 'edited';
  assert.notEqual(fingerprintPortableWorkspaceContent(edited), originalFingerprint);
});

test('portable Space and Page histories retain the latest complete turn within the session budget', () => {
  const state = createDefaultState();
  const oversizedMessages = Array.from({ length: ASK_SESSION_LIMITS.maxMessagesPerSession }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `${index}:`.padEnd(ASK_SESSION_LIMITS.maxMessageChars, 'x'),
    createdAt: index,
  }));
  state.askSessions = {
    'space:default': {
      key: 'space:default',
      spaceId: 'default',
      title: 'Default',
      createdAt: 1,
      updatedAt: 2,
      messages: oversizedMessages,
    },
    'tab:7:https://example.com/large': {
      title: 'Large page',
      url: 'https://example.com/large',
      createdAt: 1,
      updatedAt: 3,
      messages: oversizedMessages,
    },
  };

  const backup = createSpaceBackup(state, 500);
  const pageSession = Object.values(backup.askSessions)
    .find((session) => session.url === 'https://example.com/large');
  for (const session of [backup.askSessions['space:default'], pageSession]) {
    assert.ok(session);
    assert.equal(session.messages.length, 2);
    assert.deepEqual(session.messages.map((message) => message.id), [
      `message-${ASK_SESSION_LIMITS.maxMessagesPerSession - 2}`,
      `message-${ASK_SESSION_LIMITS.maxMessagesPerSession - 1}`,
    ]);
    assert.deepEqual(session.messages.map((message) => message.role), ['user', 'assistant']);
    assert.ok(
      session.messages.reduce((total, message) => total + message.text.length, 0)
        <= ASK_SESSION_LIMITS.maxSessionChars,
    );
  }

  const reparsed = parseSpaceBackup(JSON.stringify(backup));
  assert.deepEqual(reparsed.askSessions, backup.askSessions);
});

test('restore activates legacy Space history and clears every live-browser mapping', () => {
  const backup = createSpaceBackup({
    activeSpaceId: 'restored',
    spaces: [{ id: 'restored', name: 'Restored' }],
    spaceContexts: { restored: '', ignored: 'drop' },
    spaceSnapshots: {},
    askSessions: {
      'space:restored': {
        key: 'space:restored',
        spaceId: 'restored',
        title: '',
        messages: [{ role: 'assistant', text: 'Recovered answer', createdAt: 1 }],
      },
    },
  }, 10);
  const target = {
    ai: { apiKey: 'keep' },
    shortcuts: { addSpace: 'Control+Alt+N' },
    groupSpaces: { 1: 'old' },
    tabSpaces: { 2: 'old' },
    virtualGroups: { old: {} },
    tabGroups: { 2: 'old' },
    ephemeralTabIds: [3],
    renamedTabs: { 2: 'Old title' },
    groupOrder: { old: ['old'] },
    tabOrder: { old: { old: [2] } },
    collapsedGroups: { old: true },
  };

  const summary = restoreSpaceBackup(target, backup);

  assert.equal(target.activeAskSessionKey, 'space:restored');
  assert.equal(target.askSessions['space:restored'].title, 'Space');
  assert.deepEqual(summary, { spaces: 1, contexts: 0, savedTabs: 0, askConversations: 1 });
  for (const key of [
    'groupSpaces',
    'tabSpaces',
    'virtualGroups',
    'tabGroups',
    'renamedTabs',
    'groupOrder',
    'tabOrder',
    'collapsedGroups',
  ]) assert.deepEqual(target[key], {});
  assert.deepEqual(target.ephemeralTabIds, []);
  assert.equal(target.ai.apiKey, 'keep');
});

test('repairs invalid export dates and handles empty fingerprint selections', () => {
  const backup = {
    format: SPACE_BACKUP_FORMAT,
    version: 1,
    exportedAt: null,
    activeSpaceId: 'default',
    spaces: [{ id: 'default', name: 'Default' }],
  };
  const before = Date.now();
  const parsed = parseSpaceBackup(backup);
  const after = Date.now();

  assert.ok(Date.parse(parsed.exportedAt) >= before);
  assert.ok(Date.parse(parsed.exportedAt) <= after);
  assert.deepEqual(fingerprintPortableSpacesContent(parsed, null), {});
  assert.match(fingerprintPortableSpaceContent(parsed), /^portable-space-v1-[0-9a-f]{8}$/);
});
