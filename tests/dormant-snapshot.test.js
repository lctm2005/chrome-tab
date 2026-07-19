import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dormantSnapshotGroupIndexFromKey,
  dormantSnapshotGroupKey,
  projectSnapshotGroupOrder,
  projectSnapshotTabOrder,
  projectDormantSnapshotGroupRemoval,
  projectDormantSnapshotGroupRename,
  projectDormantSnapshotGroupUpdate,
  projectOpenedDormantTabRemoval,
  projectSnapshotTabsRemoval,
  remapSnapshotGroupIndexedState,
  resolveDormantGroupReference,
  resolveDormantTabReference,
  resolveOpenedDormantRecordForLiveTab,
  resolveSnapshotTabRemovalMatch,
} from '../src/shared/dormant-snapshot.js';

const fixedNow = 1_725_000_000_123;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function tab(snapshotTabId, title, url) {
  return { snapshotTabId, title, url };
}

function group(snapshotGroupId, title, color, tabs) {
  return { snapshotGroupId, title, color, collapsed: false, tabs };
}

function durableSnapshot(overrides = {}) {
  return {
    version: 1,
    identityVersion: 1,
    updatedAt: 100,
    groups: [
      group('group-a', 'Docs', 'blue', [
        tab('tab-a', 'Shared', 'https://example.test/shared'),
        tab('tab-b', 'Shared', 'https://example.test/shared'),
      ]),
      group('group-b', 'Plans', 'red', [
        tab('tab-c', 'Roadmap', 'https://example.test/roadmap'),
      ]),
    ],
    ...overrides,
  };
}

test('dormant snapshot keys parse safe indexes and preserve the rendered identity', () => {
  for (const [key, expected] of [
    ['snapshot:0:space:group', 0],
    ['snapshot:42:space:group', 42],
    ['', -1],
    [null, -1],
    ['snapshot:nope:space:group', -1],
    [`snapshot:${Number.MAX_SAFE_INTEGER}0:space:group`, -1],
  ]) {
    assert.equal(dormantSnapshotGroupIndexFromKey(key), expected, String(key));
  }

  assert.equal(
    dormantSnapshotGroupKey(2, { snapshotGroupId: ' durable-id ', title: 'Ignored' }, 'space / one'),
    'snapshot:2:space%20%2F%20one:durable-id',
  );
  assert.equal(dormantSnapshotGroupKey(1, { snapshotGroupId: ' ', title: 'Legacy' }, 'work'), 'snapshot:1:work:Legacy');
  assert.equal(dormantSnapshotGroupKey(1, { snapshotGroupId: ' ', title: '' }, 'work'), 'snapshot:1:work:');
  assert.equal(dormantSnapshotGroupKey(0, null, null), 'snapshot:0::Ungrouped');
  assert.equal(dormantSnapshotGroupKey(0), 'snapshot:0::Ungrouped');
});

test('visible stable identities reorder the whole snapshot without guessing ambiguous legacy groups', () => {
  const snapshot = deepFreeze({
    version: 1,
    identityVersion: 1,
    updatedAt: 100,
    groups: [
      group('group-a', 'A', 'blue', [tab('tab-a', 'A', 'https://a.test')]),
      group('group-b', 'B', 'red', [tab('tab-b', 'B', 'https://b.test')]),
      { title: 'Legacy', color: 'green', collapsed: true, tabs: [
        { title: 'One', url: 'https://legacy-one.test' },
      ] },
      { title: 'Legacy', color: 'green', collapsed: false, tabs: [
        { title: 'Two', url: 'https://legacy-two.test' },
      ] },
    ],
  });
  const before = structuredClone(snapshot);

  const reordered = projectSnapshotGroupOrder(snapshot, [
    { key: 'group:52', snapshotGroupId: 'group-b', title: 'Renamed B', color: 'red' },
    { key: 'snapshot:0:work:group-a', snapshotGroupId: 'group-a' },
    { snapshotGroupId: 'group-b' },
    { title: 'Legacy', color: 'green' },
    null,
  ], fixedNow);

  assert.deepEqual(reordered.groups.map((item) => item.snapshotGroupId || item.tabs[0].title), [
    'group-b',
    'group-a',
    'One',
    'Two',
  ]);
  assert.equal(reordered.updatedAt, fixedNow);
  assert.notStrictEqual(reordered.groups[0], snapshot.groups[1]);
  assert.notStrictEqual(reordered.groups[0].tabs[0], snapshot.groups[1].tabs[0]);
  assert.deepEqual(snapshot, before);
});

test('snapshot order projection is conservative for invalid, missing, and unchanged references', () => {
  const snapshot = durableSnapshot();
  assert.equal(projectSnapshotGroupOrder(null, []), null);
  assert.strictEqual(projectSnapshotGroupOrder(snapshot, null), snapshot);
  assert.strictEqual(projectSnapshotGroupOrder(snapshot, [{ snapshotGroupId: 'missing' }]), snapshot);
  assert.strictEqual(projectSnapshotGroupOrder(snapshot, [
    { snapshotGroupId: 'group-a' },
    { snapshotGroupId: 'group-b' },
  ]), snapshot);
  const reordered = projectSnapshotGroupOrder(snapshot, [
    { snapshotGroupId: 'group-b' },
  ], Number.NaN);
  assert.equal(Number.isFinite(reordered.updatedAt), true);
  assert.deepEqual(reordered.groups.map((item) => item.snapshotGroupId), ['group-b', 'group-a']);
});

test('mixed visible tab order becomes the exact durable order for its stable Tag', () => {
  const snapshot = deepFreeze(durableSnapshot());
  const before = structuredClone(snapshot);
  const savedA = snapshot.groups[0].tabs[0];
  const savedB = snapshot.groups[0].tabs[1];
  const moved = {
    id: 30,
    snapshotTabId: 'tab-c',
    title: 'Roadmap page',
    displayTitle: 'My roadmap',
    panelTitle: 'My roadmap',
    url: 'https://example.test/roadmap',
    dormant: false,
  };
  const reordered = projectSnapshotTabOrder(snapshot, {
    key: 'group:77',
    snapshotGroupId: 'group-a',
  }, [
    { ...savedA, id: 10, dormant: true },
    moved,
    { ...savedB, id: 'saved-b', dormant: true },
  ], fixedNow);

  assert.deepEqual(reordered.groups[0].tabs, [
    savedA,
    {
      title: 'Roadmap page',
      url: 'https://example.test/roadmap',
      snapshotTabId: 'tab-c',
      panelTitle: 'My roadmap',
    },
    savedB,
  ]);
  assert.deepEqual(reordered.groups[1], snapshot.groups[1]);
  assert.equal(reordered.updatedAt, fixedNow);
  assert.deepEqual(snapshot, before);
});

test('live reorder keeps an empty page title separate from its panel-only name', () => {
  const snapshot = durableSnapshot();
  const projected = projectSnapshotTabOrder(snapshot, {
    snapshotGroupId: 'group-a',
  }, [
    {
      id: 10,
      snapshotTabId: 'tab-a',
      title: '',
      displayTitle: 'Private dashboard',
      panelTitle: 'Private dashboard',
      url: 'https://example.test/shared',
      dormant: false,
    },
    { ...snapshot.groups[0].tabs[1], id: 'saved-b', dormant: true },
  ], fixedNow);

  assert.deepEqual(projected.groups[0].tabs[0], {
    title: 'https://example.test/shared',
    url: 'https://example.test/shared',
    snapshotTabId: 'tab-a',
    panelTitle: 'Private dashboard',
  });
});

test('cross-Tag projection composes with source removal and keeps target tail semantics', () => {
  const snapshot = durableSnapshot();
  const moved = snapshot.groups[1].tabs[0];
  const withoutSource = projectSnapshotTabsRemoval(snapshot, [{
    snapshotTabId: moved.snapshotTabId,
    url: moved.url,
  }], fixedNow - 1);
  const reordered = projectSnapshotTabOrder(withoutSource, {
    snapshotGroupId: 'group-a',
  }, [
    { ...snapshot.groups[0].tabs[0], dormant: true },
    { ...snapshot.groups[0].tabs[1], dormant: true },
    { id: 30, ...moved, dormant: false },
  ], fixedNow);

  assert.deepEqual(reordered.groups.map((item) => [
    item.snapshotGroupId,
    item.tabs.map((row) => row.snapshotTabId),
  ]), [
    ['group-a', ['tab-a', 'tab-b', 'tab-c']],
  ]);
});

test('snapshot tab order skips pinned and non-restorable live rows without inventing saved pages', () => {
  const snapshot = durableSnapshot();
  const reordered = projectSnapshotTabOrder(snapshot, {
    snapshotGroupId: 'group-a',
  }, [
    { id: 1, title: 'Pinned', url: 'https://pinned.test', pinned: true },
    { id: 2, title: 'Settings', url: 'chrome://settings', pinned: false },
    { id: 3, title: 'No stable id', url: 'https://new.test', pinned: false },
  ], Number.NaN);

  assert.deepEqual(reordered.groups[0].tabs, [{
    title: 'No stable id',
    url: 'https://new.test',
  }]);
  assert.equal(Number.isFinite(reordered.updatedAt), true);
});

test('snapshot tab records use honest URL fallbacks and compare semantic fields, not object key order', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'fallbacks',
      title: 'Fallbacks',
      color: 'blue',
      tabs: [
        { title: 'Old live title', url: 'https://live-only.test', snapshotTabId: 'live-only' },
        { title: 'Old saved title', url: 'https://saved-only.test', extra: 'removed' },
      ],
    }],
  };
  const projected = projectSnapshotTabOrder(snapshot, {
    snapshotGroupId: 'fallbacks',
  }, [
    { id: 1, snapshotTabId: 'live-only', url: 'https://live-only.test', dormant: false },
    { id: 'saved', url: 'https://saved-only.test', dormant: true },
  ], fixedNow);

  assert.deepEqual(projected.groups[0].tabs, [
    { title: 'https://live-only.test', url: 'https://live-only.test', snapshotTabId: 'live-only' },
    { title: 'https://saved-only.test', url: 'https://saved-only.test' },
  ]);

  const differentKeys = projectSnapshotTabOrder({
    ...snapshot,
    groups: [{
      ...snapshot.groups[0],
      tabs: [{
        title: 'https://live-only.test',
        url: 'https://live-only.test',
        other: 'different key',
        extra: 'different count',
      }],
    }],
  }, { snapshotGroupId: 'fallbacks' }, [
    { id: 1, snapshotTabId: 'live-only', url: 'https://live-only.test' },
  ], fixedNow);
  assert.equal(differentKeys.groups[0].tabs[0].snapshotTabId, 'live-only');

  const differentKeyNames = projectSnapshotTabOrder({
    ...snapshot,
    groups: [{
      ...snapshot.groups[0],
      tabs: [{ title: 'https://live-only.test', url: 'https://live-only.test', other: 'same count' }],
    }],
  }, { snapshotGroupId: 'fallbacks' }, [
    { id: 1, snapshotTabId: 'live-only', url: 'https://live-only.test' },
  ], fixedNow);
  assert.equal(differentKeyNames.groups[0].tabs[0].snapshotTabId, 'live-only');
});

test('snapshot tab order projection is conservative for stale and malformed views', () => {
  const snapshot = durableSnapshot();
  const unchangedRows = snapshot.groups[0].tabs.map((row, index) => ({
    ...row,
    id: `saved-${index}`,
    dormant: true,
  }));
  assert.strictEqual(projectSnapshotTabOrder(snapshot, {
    snapshotGroupId: 'group-a',
  }, unchangedRows, fixedNow), snapshot);
  for (const [candidate, reference, rows] of [
    [null, { snapshotGroupId: 'group-a' }, []],
    [{ groups: 'bad' }, { snapshotGroupId: 'group-a' }, []],
    [snapshot, { snapshotGroupId: 'group-a' }, null],
    [snapshot, { snapshotGroupId: 'group-a' }, [null]],
    [snapshot, { snapshotGroupId: 'missing' }, []],
  ]) {
    assert.strictEqual(projectSnapshotTabOrder(candidate, reference, rows, fixedNow), candidate);
  }

  const removed = projectSnapshotTabOrder({
    version: 1,
    updatedAt: 1,
    groups: [group('only', 'Only', 'blue', [tab('one', 'One', 'https://one.test')])],
  }, { snapshotGroupId: 'only' }, [
    { id: 1, title: 'Pinned', url: 'https://pinned.test', pinned: true },
  ], fixedNow);
  assert.equal(removed, null);

  const preserved = projectSnapshotTabOrder({
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [group('only', 'Only', 'blue', [tab('one', 'One', 'https://one.test')])],
  }, { snapshotGroupId: 'only' }, [], fixedNow);
  assert.deepEqual(preserved.groups[0].tabs, []);
});

test('snapshot index remapping moves collapse and tab order atomically during a swap', () => {
  const beforeSnapshot = deepFreeze(durableSnapshot());
  const afterSnapshot = deepFreeze({
    ...beforeSnapshot,
    groups: [beforeSnapshot.groups[1], beforeSnapshot.groups[0]],
  });
  const oldA = dormantSnapshotGroupKey(0, beforeSnapshot.groups[0], 'focus mode');
  const oldB = dormantSnapshotGroupKey(1, beforeSnapshot.groups[1], 'focus mode');
  const newB = dormantSnapshotGroupKey(0, afterSnapshot.groups[0], 'focus mode');
  const newA = dormantSnapshotGroupKey(1, afterSnapshot.groups[1], 'focus mode');
  const collapsedGroups = deepFreeze({
    [oldA]: false,
    [oldB]: true,
    'group:7': false,
    unrelated: { nested: ['kept'] },
  });
  const tabOrder = deepFreeze({ [oldA]: [10, 11], [oldB]: [20], 'group:7': [70] });

  const remapped = remapSnapshotGroupIndexedState({
    beforeSnapshot,
    afterSnapshot,
    spaceId: 'focus mode',
    groupOrder: [oldB, 'group:7', oldA, oldB],
    collapsedGroups,
    tabOrder,
  });

  assert.deepEqual(remapped.groupOrder, [newB, 'group:7', newA]);
  assert.deepEqual(remapped.collapsedGroups, {
    'group:7': false,
    unrelated: { nested: ['kept'] },
    [newA]: false,
    [newB]: true,
  });
  assert.deepEqual(remapped.tabOrder, {
    'group:7': [70],
    [newA]: [10, 11],
    [newB]: [20],
  });
  assert.deepEqual(remapped.replacements, { [oldA]: newA, [oldB]: newB });
  assert.deepEqual(collapsedGroups, {
    [oldA]: false,
    [oldB]: true,
    'group:7': false,
    unrelated: { nested: ['kept'] },
  });
  assert.deepEqual(tabOrder, { [oldA]: [10, 11], [oldB]: [20], 'group:7': [70] });
});

test('snapshot index remapping drops removed, legacy, duplicate, and malformed keyed state safely', () => {
  const beforeSnapshot = {
    groups: [
      group('removed', 'Removed', 'red', [tab('row-r', 'R', 'https://r.test')]),
      group('duplicate', 'Duplicate', 'blue', [tab('row-d', 'D', 'https://d.test')]),
      { title: 'Legacy', color: 'green', tabs: [{ title: 'L', url: 'https://l.test' }] },
    ],
  };
  const afterSnapshot = {
    groups: [
      group('duplicate', 'One', 'blue', [tab('row-1', 'One', 'https://one.test')]),
      group('duplicate', 'Two', 'blue', [tab('row-2', 'Two', 'https://two.test')]),
      { title: 'Legacy after', color: 'green', tabs: [{ title: 'L', url: 'https://l.test' }] },
    ],
  };
  const removedKey = dormantSnapshotGroupKey(0, beforeSnapshot.groups[0], 'work');
  const duplicateKey = dormantSnapshotGroupKey(1, beforeSnapshot.groups[1], 'work');
  const legacyKey = dormantSnapshotGroupKey(2, beforeSnapshot.groups[2], 'work');
  const remapped = remapSnapshotGroupIndexedState({
    beforeSnapshot,
    afterSnapshot,
    spaceId: 'work',
    groupOrder: [removedKey, duplicateKey, legacyKey, 'group:9'],
    collapsedGroups: { [removedKey]: true, [duplicateKey]: false, [legacyKey]: true },
    tabOrder: { [removedKey]: [1], [duplicateKey]: [2], [legacyKey]: [3] },
  });

  assert.deepEqual(remapped, {
    groupOrder: ['group:9'],
    collapsedGroups: {},
    tabOrder: {},
    replacements: {},
  });
  assert.deepEqual(remapSnapshotGroupIndexedState({
    beforeSnapshot: { groups: 'invalid' },
    afterSnapshot: null,
    groupOrder: null,
    collapsedGroups: null,
    tabOrder: [],
  }), {
    groupOrder: [],
    collapsedGroups: {},
    tabOrder: {},
    replacements: {},
  });
  assert.deepEqual(remapSnapshotGroupIndexedState(), {
    groupOrder: [],
    collapsedGroups: {},
    tabOrder: {},
    replacements: {},
  });
});

test('dormant group resolution uses stable identity first and legacy keys only when unique', () => {
  const stable = { key: 'snapshot:0:work:group-a', snapshotGroupId: 'group-a' };
  const other = { key: 'snapshot:1:work:group-b', snapshotGroupId: 'group-b' };
  const legacy = { key: 'snapshot:2:work:Legacy', snapshotGroupId: '' };
  const duplicateLegacy = { key: legacy.key, snapshotGroupId: '' };

  const cases = [
    {
      name: 'stable id ignores a conflicting legacy key',
      groups: [stable, other],
      reference: { snapshotGroupId: ' group-b ', dormantGroupKey: stable.key },
      groupKey: stable.key,
      expected: other,
    },
    {
      name: 'unknown stable id never falls back',
      groups: [stable, legacy],
      reference: { snapshotGroupId: 'missing', dormantGroupKey: legacy.key },
      groupKey: legacy.key,
      expected: null,
    },
    {
      name: 'duplicate stable ids are ambiguous',
      groups: [stable, { ...other, snapshotGroupId: 'group-a' }],
      reference: { snapshotGroupId: 'group-a' },
      expected: null,
    },
    {
      name: 'blank stable id falls back to the argument key',
      groups: [stable, legacy],
      reference: { snapshotGroupId: ' ' },
      groupKey: legacy.key,
      expected: legacy,
    },
    {
      name: 'reference key is a legacy fallback',
      groups: [legacy],
      reference: { key: legacy.key },
      expected: legacy,
    },
    {
      name: 'dormant key is a legacy fallback',
      groups: [legacy],
      reference: { dormantGroupKey: legacy.key },
      expected: legacy,
    },
    {
      name: 'duplicate legacy keys are ambiguous',
      groups: [legacy, duplicateLegacy],
      reference: { dormantGroupKey: legacy.key },
      expected: null,
    },
    { name: 'missing legacy key cannot identify a group', groups: [legacy], reference: {}, expected: null },
    { name: 'malformed collections are empty', groups: 'bad', reference: {}, expected: null },
    { name: 'malformed candidates are ignored', groups: [null, [], legacy], reference: { key: legacy.key }, expected: legacy },
  ];

  for (const scenario of cases) {
    assert.equal(
      resolveDormantGroupReference(scenario.groups, scenario.reference, scenario.groupKey),
      scenario.expected,
      scenario.name,
    );
  }
});

test('dormant tab resolution protects duplicate URLs and titles from accidental mutation', () => {
  const first = tab('tab-a', 'Shared', 'https://example.test/shared');
  const second = tab('tab-b', 'Shared', 'https://example.test/shared');
  const legacy = { title: 'Unique', url: 'https://example.test/legacy' };
  const displayOnly = { displayTitle: 'Display only', url: 'https://example.test/display' };

  const cases = [
    {
      name: 'stable id selects the intended duplicate',
      group: { tabs: [first, second] },
      reference: { snapshotTabId: ' tab-b ', title: 'Shared', url: first.url },
      expected: second,
    },
    {
      name: 'unknown stable id never falls back by URL',
      group: { tabs: [first] },
      reference: { snapshotTabId: 'missing', title: first.title, url: first.url },
      expected: null,
    },
    {
      name: 'duplicate stable ids are ambiguous',
      group: { tabs: [first, { ...second, snapshotTabId: 'tab-a' }] },
      reference: { snapshotTabId: 'tab-a' },
      expected: null,
    },
    {
      name: 'blank id uses a unique legacy URL and title',
      group: { tabs: [first, legacy] },
      reference: { snapshotTabId: ' ', title: legacy.title, url: legacy.url },
      expected: legacy,
    },
    {
      name: 'duplicate legacy URL and title is ambiguous',
      group: { tabs: [legacy, { ...legacy }] },
      reference: legacy,
      expected: null,
    },
    {
      name: 'same URL with a different title remains distinguishable',
      group: { tabs: [legacy, { ...legacy, title: 'Other' }] },
      reference: { ...legacy, title: 'Other' },
      expectedIndex: 1,
    },
    {
      name: 'display title supports legacy rows without a title',
      group: { tabs: [displayOnly] },
      reference: { displayTitle: displayOnly.displayTitle, url: displayOnly.url },
      expected: displayOnly,
    },
    { name: 'missing URL cannot identify a legacy row', group: { tabs: [legacy] }, reference: { title: legacy.title }, expected: null },
    { name: 'malformed groups are empty', group: null, reference: legacy, expected: null },
    { name: 'malformed rows are ignored', group: { tabs: [null, [], legacy] }, reference: legacy, expected: legacy },
  ];

  for (const scenario of cases) {
    const expected = scenario.expectedIndex === undefined
      ? scenario.expected
      : scenario.group.tabs[scenario.expectedIndex];
    assert.equal(resolveDormantTabReference(scenario.group, scenario.reference), expected, scenario.name);
  }
});

test('group projections are immutable, timestamped, and change exactly one stable group', () => {
  const source = durableSnapshot();
  const before = structuredClone(source);
  const next = projectDormantSnapshotGroupRename(source, {
    snapshotGroupId: 'group-b',
    key: 'snapshot:0:work:group-a',
    title: 'Docs',
    color: 'blue',
  }, 'Renamed plans', fixedNow);

  assert.deepEqual(source, before, 'the source snapshot must stay untouched');
  assert.notEqual(next, source);
  assert.equal(next.updatedAt, fixedNow);
  assert.equal(next.groups[0], source.groups[0], 'unrelated groups retain their exact record');
  assert.deepEqual(next.groups[1], { ...source.groups[1], title: 'Renamed plans' });
  assert.notEqual(next.groups[1], source.groups[1]);
  assert.notEqual(next.groups[1].tabs, source.groups[1].tabs);
});

test('stable dormant identity can rename an untitled group without legacy fallback ambiguity', () => {
  const untitled = group('untitled-group', '', 'cyan', [
    tab('untitled-tab', 'Saved', 'https://example.test/saved'),
  ]);
  const source = durableSnapshot({ groups: [
    untitled,
    group('named-group', 'Ungrouped', 'grey', [
      tab('named-tab', 'Loose', 'https://example.test/loose'),
    ]),
  ] });

  const renamed = projectDormantSnapshotGroupRename(
    source,
    { snapshotGroupId: 'untitled-group', title: 'Ungrouped', color: 'grey' },
    'Named later',
    fixedNow,
  );
  assert.deepEqual(renamed.groups.map((item) => item.title), ['Named later', 'Ungrouped']);
  assert.equal(renamed.groups[0].color, 'cyan');
  assert.equal(source.groups[0].title, '');

  assert.strictEqual(projectDormantSnapshotGroupRename(
    source,
    { title: 'Ungrouped', color: 'grey' },
    'Legacy rename',
    fixedNow,
  ).groups[0], source.groups[0]);
});

test('group update projections support safe legacy matching and reject stale or malformed input', () => {
  const legacyA = group('', 'Legacy', 'blue', [tab('', 'One', 'https://example.test/one')]);
  const legacyB = group('', 'Other', 'red', [tab('', 'Two', 'https://example.test/two')]);
  const legacySnapshot = durableSnapshot({ identityVersion: 0, groups: [legacyA, legacyB] });

  const scenarios = [
    {
      name: 'unique legacy metadata and current key match',
      snapshot: legacySnapshot,
      reference: { snapshotGroupId: ' ', key: 'snapshot:0:work:Legacy', title: 'Legacy', color: 'blue' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: true,
    },
    {
      name: 'unique metadata works without an indexed key',
      snapshot: legacySnapshot,
      reference: { title: 'Other', color: 'red' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: true,
    },
    {
      name: 'legacy ungrouped metadata uses its default title and color',
      snapshot: durableSnapshot({ groups: [{
        snapshotGroupId: '',
        color: '',
        tabs: [{ title: 'Loose', url: 'https://example.test/loose' }],
      }] }),
      reference: { title: 'Ungrouped' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: true,
    },
    {
      name: 'an explicit empty title is not legacy Ungrouped metadata',
      snapshot: durableSnapshot({ groups: [{
        snapshotGroupId: '',
        title: '',
        color: '',
        tabs: [{ title: 'Loose', url: 'https://example.test/loose' }],
      }] }),
      reference: { title: 'Ungrouped' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    {
      name: 'legacy named metadata uses the default blue color',
      snapshot: durableSnapshot({ groups: [{
        snapshotGroupId: '',
        title: 'Colorless',
        color: '',
        tabs: [{ title: 'Loose', url: 'https://example.test/loose' }],
      }] }),
      reference: { title: 'Colorless' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: true,
    },
    {
      name: 'a stale legacy index cannot mutate another group',
      snapshot: legacySnapshot,
      reference: { key: 'snapshot:1:work:Legacy', title: 'Legacy', color: 'blue' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    {
      name: 'duplicate legacy metadata is ambiguous',
      snapshot: durableSnapshot({ groups: [legacyA, structuredClone(legacyA)] }),
      reference: { title: 'Legacy', color: 'blue' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    {
      name: 'unknown stable group never falls back to legacy metadata',
      snapshot: legacySnapshot,
      reference: { snapshotGroupId: 'missing', title: 'Legacy', color: 'blue' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    {
      name: 'duplicate stable group ids are ambiguous',
      snapshot: durableSnapshot({ groups: [
        group('duplicate', 'First', 'blue', [tab('one', 'One', 'https://example.test/one')]),
        group('duplicate', 'Second', 'red', [tab('two', 'Two', 'https://example.test/two')]),
      ] }),
      reference: { snapshotGroupId: 'duplicate' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    {
      name: 'missing legacy title is not an identity',
      snapshot: legacySnapshot,
      reference: { key: 'snapshot:0:work:Legacy' },
      updater: (candidate) => ({ ...candidate, collapsed: true }),
      changed: false,
    },
    { name: 'missing snapshot is a no-op', snapshot: null, reference: {}, updater: () => null, changed: false },
    { name: 'non-object group references are malformed', snapshot: legacySnapshot, reference: null, updater: () => null, changed: false },
    { name: 'array snapshots are malformed', snapshot: [], reference: {}, updater: () => null, changed: false },
    { name: 'missing groups are malformed', snapshot: { version: 1 }, reference: {}, updater: () => null, changed: false },
    { name: 'non-array groups are malformed', snapshot: { groups: {} }, reference: {}, updater: () => null, changed: false },
    { name: 'malformed group rows are rejected', snapshot: { groups: [{ title: 'Bad', tabs: [null] }] }, reference: { title: 'Bad' }, updater: () => null, changed: false },
    { name: 'updater must be callable', snapshot: durableSnapshot(), reference: { snapshotGroupId: 'group-a' }, updater: null, changed: false },
    { name: 'malformed updater output is rejected', snapshot: durableSnapshot(), reference: { snapshotGroupId: 'group-a' }, updater: () => ({ title: 'Bad' }), changed: false },
    { name: 'undefined updater output is rejected', snapshot: durableSnapshot(), reference: { snapshotGroupId: 'group-a' }, updater: () => undefined, changed: false },
  ];

  for (const scenario of scenarios) {
    const before = structuredClone(scenario.snapshot);
    const result = projectDormantSnapshotGroupUpdate(
      scenario.snapshot,
      scenario.reference,
      scenario.updater,
      fixedNow,
    );
    assert.deepEqual(scenario.snapshot, before, `${scenario.name}: immutable input`);
    assert.equal(result === scenario.snapshot, !scenario.changed, scenario.name);
    if (scenario.changed) assert.equal(result.updatedAt, fixedNow, scenario.name);
  }
  const defaultTimestamp = projectDormantSnapshotGroupUpdate(
    durableSnapshot(),
    { snapshotGroupId: 'group-a' },
    (candidate) => ({ ...candidate, collapsed: true }),
  );
  assert.equal(Number.isFinite(defaultTimestamp.updatedAt), true);
  const fallbackTimestamp = projectDormantSnapshotGroupUpdate(
    durableSnapshot(),
    { snapshotGroupId: 'group-a' },
    (candidate) => ({ ...candidate, collapsed: true }),
    Number.NaN,
  );
  assert.equal(Number.isFinite(fallbackTimestamp.updatedAt), true);
});

test('group projections remove empty transient content while retaining explicitly persistent groups', () => {
  const remaining = group('remaining', 'Remaining', 'blue', [
    tab('remaining-tab', 'Remaining', 'https://example.test/remaining'),
  ]);
  const transient = group('transient', 'Transient', 'red', [
    tab('transient-tab', 'Transient', 'https://example.test/transient'),
  ]);

  const emptied = projectDormantSnapshotGroupUpdate(
    durableSnapshot({ groups: [transient, remaining] }),
    { snapshotGroupId: 'transient' },
    (candidate) => ({ ...candidate, tabs: [] }),
    fixedNow,
  );
  assert.deepEqual(emptied.groups, [remaining]);

  const preserved = projectDormantSnapshotGroupUpdate(
    durableSnapshot({ preserveGroups: true, groups: [transient] }),
    { snapshotGroupId: 'transient' },
    (candidate) => ({ ...candidate, tabs: [] }),
    fixedNow,
  );
  assert.equal(preserved.groups.length, 1);
  assert.deepEqual(preserved.groups[0].tabs, []);

  const emptyUngrouped = projectDormantSnapshotGroupUpdate(
    durableSnapshot({ preserveGroups: true, groups: [
      group('ungrouped', 'Ungrouped', 'grey', [tab('temp', 'Temp', 'https://example.test/temp')]),
      remaining,
    ] }),
    { snapshotGroupId: 'ungrouped' },
    (candidate) => ({ ...candidate, tabs: [] }),
    fixedNow,
  );
  assert.deepEqual(emptyUngrouped.groups, [remaining]);

  assert.equal(projectDormantSnapshotGroupRemoval(
    durableSnapshot({ groups: [transient] }),
    { snapshotGroupId: 'transient' },
    fixedNow,
  ), null, 'removing the final persistent group clears the whole snapshot');

  const retainedAfterRemoval = projectDormantSnapshotGroupRemoval(
    durableSnapshot({ groups: [transient, remaining] }),
    { snapshotGroupId: 'transient' },
    fixedNow,
  );
  assert.deepEqual(retainedAfterRemoval.groups, [remaining]);
  assert.equal(retainedAfterRemoval.updatedAt, fixedNow);
});

test('group updater receives a defensive copy of the group and its tab records', () => {
  const source = durableSnapshot();
  const before = structuredClone(source);
  const next = projectDormantSnapshotGroupUpdate(source, { snapshotGroupId: 'group-a' }, (candidate) => {
    candidate.title = 'Mutated copy';
    candidate.tabs[0].title = 'Mutated tab copy';
    return candidate;
  }, fixedNow);

  assert.deepEqual(source, before);
  assert.equal(next.groups[0].title, 'Mutated copy');
  assert.equal(next.groups[0].tabs[0].title, 'Mutated tab copy');
  assert.notEqual(next.groups[0].tabs[0], source.groups[0].tabs[0]);
});

test('opened dormant tab removal honors stable group and tab identities before legacy metadata', () => {
  const source = durableSnapshot();
  const before = structuredClone(source);
  const next = projectOpenedDormantTabRemoval(source, {
    snapshotGroupId: 'group-a',
    snapshotTabId: 'tab-b',
    title: 'Shared',
    url: 'https://example.test/shared',
  }, {
    snapshotGroupId: 'group-b',
    title: 'Plans',
    color: 'red',
  }, fixedNow);

  assert.deepEqual(source, before);
  assert.equal(next.updatedAt, fixedNow);
  assert.deepEqual(next.groups[0].tabs.map((item) => item.snapshotTabId), ['tab-a']);

  const repeatedStableTarget = projectSnapshotTabsRemoval(source, [
    { snapshotTabId: 'tab-b', url: 'https://example.test/shared' },
    { snapshotTabId: 'tab-b', url: 'https://example.test/shared' },
  ], fixedNow);
  assert.deepEqual(repeatedStableTarget.groups[0].tabs.map((item) => item.snapshotTabId), ['tab-a']);
  assert.equal(next.groups[1], source.groups[1]);
});

test('opened dormant tab removal refuses ambiguous or stale identity fallbacks', () => {
  const legacyTab = { title: 'Shared', url: 'https://example.test/shared' };
  const legacyGroup = group('', 'Legacy', 'blue', [legacyTab]);
  const base = durableSnapshot({ identityVersion: 0, groups: [legacyGroup] });
  const cases = [
    {
      name: 'unknown stable group id does not fall back to metadata',
      snapshot: base,
      tab: { snapshotGroupId: 'missing', ...legacyTab },
      group: { title: 'Legacy', color: 'blue' },
    },
    {
      name: 'unknown stable tab id does not fall back to URL and title',
      snapshot: base,
      tab: { snapshotTabId: 'missing', ...legacyTab },
      group: { title: 'Legacy', color: 'blue' },
    },
    {
      name: 'duplicate stable group ids are ambiguous',
      snapshot: durableSnapshot({ groups: [
        group('same', 'First', 'blue', [tab('one', 'One', 'https://example.test/one')]),
        group('same', 'Second', 'red', [tab('two', 'Two', 'https://example.test/two')]),
      ] }),
      tab: { snapshotGroupId: 'same', snapshotTabId: 'one', title: 'One', url: 'https://example.test/one' },
      group: { snapshotGroupId: 'same' },
    },
    {
      name: 'duplicate stable tab ids are ambiguous',
      snapshot: durableSnapshot({ groups: [group('one', 'One', 'blue', [
        tab('same', 'First', 'https://example.test/one'),
        tab('same', 'Second', 'https://example.test/two'),
      ])] }),
      tab: { snapshotGroupId: 'one', snapshotTabId: 'same' },
      group: { snapshotGroupId: 'one' },
    },
    {
      name: 'duplicate legacy group metadata is ambiguous',
      snapshot: durableSnapshot({ identityVersion: 0, groups: [legacyGroup, structuredClone(legacyGroup)] }),
      tab: legacyTab,
      group: { title: 'Legacy', color: 'blue' },
    },
    {
      name: 'duplicate legacy URL and title is ambiguous',
      snapshot: durableSnapshot({ identityVersion: 0, groups: [{ ...legacyGroup, tabs: [legacyTab, { ...legacyTab }] }] }),
      tab: legacyTab,
      group: { title: 'Legacy', color: 'blue' },
    },
    { name: 'missing group reference is not enough', snapshot: base, tab: legacyTab, group: null },
    { name: 'malformed snapshot is unchanged', snapshot: { groups: [null] }, tab: legacyTab, group: { title: 'Legacy' } },
  ];

  for (const scenario of cases) {
    const before = structuredClone(scenario.snapshot);
    assert.equal(
      projectOpenedDormantTabRemoval(scenario.snapshot, scenario.tab, scenario.group, fixedNow),
      scenario.snapshot,
      scenario.name,
    );
    assert.deepEqual(scenario.snapshot, before, `${scenario.name}: immutable input`);
  }
});

test('legacy opened-tab removal requires one exact row and applies persistence rules', () => {
  const unique = { title: 'Unique', url: 'https://example.test/shared' };
  const otherTitle = { title: 'Other', url: unique.url };
  const remaining = group('', 'Remaining', 'red', [
    { title: 'Remaining', url: 'https://example.test/remaining' },
  ]);
  const source = durableSnapshot({ identityVersion: 0, groups: [
    group('', 'Legacy', 'blue', [unique, otherTitle]),
    remaining,
  ] });
  const removed = projectOpenedDormantTabRemoval(
    source,
    { snapshotGroupId: ' ', snapshotTabId: ' ', ...otherTitle },
    { snapshotGroupId: '', key: 'snapshot:0:work:Legacy', title: 'Legacy', color: 'blue' },
    fixedNow,
  );
  assert.deepEqual(removed.groups[0].tabs, [unique]);
  assert.equal(removed.updatedAt, fixedNow);

  const preserved = projectOpenedDormantTabRemoval(
    durableSnapshot({ identityVersion: 0, preserveGroups: true, groups: [group('', 'Legacy', 'blue', [unique])] }),
    unique,
    { title: 'Legacy', color: 'blue' },
    fixedNow,
  );
  assert.deepEqual(preserved.groups[0].tabs, []);

  const ungroupedRemoved = projectOpenedDormantTabRemoval(
    durableSnapshot({ identityVersion: 0, preserveGroups: true, groups: [
      group('', 'Ungrouped', 'grey', [unique]),
      remaining,
    ] }),
    unique,
    { title: 'Ungrouped', color: 'grey' },
    fixedNow,
  );
  assert.deepEqual(ungroupedRemoved.groups, [remaining]);

  assert.equal(projectOpenedDormantTabRemoval(
    durableSnapshot({ identityVersion: 0, groups: [group('', 'Legacy', 'blue', [unique])] }),
    unique,
    { title: 'Legacy', color: 'blue' },
    fixedNow,
  ), null);
});

test('bulk snapshot removal timestamps real changes and leaves missing or malformed targets alone', () => {
  const source = durableSnapshot();
  const before = structuredClone(source);
  const next = projectSnapshotTabsRemoval(source, [{
    snapshotTabId: 'tab-b',
    url: 'https://example.test/shared',
    groupTitle: 'Docs',
    groupColor: 'blue',
  }], fixedNow);
  assert.deepEqual(source, before);
  assert.equal(next.updatedAt, fixedNow);
  assert.deepEqual(next.groups[0].tabs.map((item) => item.snapshotTabId), ['tab-a']);

  for (const [name, snapshot, targets] of [
    ['non-array targets', source, null],
    ['missing target', source, [{ snapshotTabId: 'missing', url: 'https://example.test/missing' }]],
    ['empty targets', source, []],
    ['malformed targets', source, [null, [], {}, { snapshotTabId: ' ', url: ' ' }]],
    ['malformed snapshot', { groups: {} }, []],
    ['duplicate stable ids', durableSnapshot({ groups: [group('duplicate', 'Duplicate', 'blue', [
      tab('same-tab', 'First', 'https://example.test/first'),
      tab('same-tab', 'Second', 'https://example.test/second'),
    ])] }), [{ snapshotTabId: 'same-tab', url: 'https://example.test/first' }]],
    ['duplicate legacy URLs', durableSnapshot({ identityVersion: 0, groups: [group('', 'Legacy', 'blue', [
      { title: 'Shared', url: 'https://example.test/shared' },
      { title: 'Shared', url: 'https://example.test/shared' },
    ])] }), [{ snapshotTabId: '', title: 'Shared', url: 'https://example.test/shared' }]],
  ]) {
    assert.equal(projectSnapshotTabsRemoval(snapshot, targets, fixedNow), snapshot, name);
  }

  const legacyAcrossGroups = durableSnapshot({ identityVersion: 0, groups: [
    group('', 'First', 'blue', [{ title: 'Shared', url: 'https://example.test/shared' }]),
    group('', 'Second', 'red', [{ title: 'Shared', url: 'https://example.test/shared' }]),
  ] });
  const legacyRemoved = projectSnapshotTabsRemoval(legacyAcrossGroups, [{
    snapshotTabId: ' ',
    url: 'https://example.test/shared',
    groupTitle: 'Second',
    groupColor: 'red',
  }], fixedNow);
  assert.equal(legacyRemoved.updatedAt, fixedNow);
  assert.equal(legacyRemoved.groups[0], legacyAcrossGroups.groups[0]);
  assert.deepEqual(legacyRemoved.groups.map((item) => item.title), ['First']);

  const preservedEmptyGroup = projectSnapshotTabsRemoval(
    durableSnapshot({ preserveGroups: true, groups: [group('', 'Colorless', '', [
      { title: 'Only', url: 'https://example.test/only' },
    ])] }),
    [{ url: 'https://example.test/only', groupTitle: 'Colorless', groupColor: 'blue' }],
    fixedNow,
  );
  assert.deepEqual(preservedEmptyGroup.groups[0].tabs, []);

  const explicitUntitledSnapshot = durableSnapshot({ groups: [
    { snapshotGroupId: '', title: '', color: '', tabs: [
      { title: 'Loose', url: 'https://example.test/loose' },
    ] },
    group('', 'Kept', 'red', [{ title: 'Kept', url: 'https://example.test/kept' }]),
  ] });
  const defaultUngroupedRemoved = projectSnapshotTabsRemoval(
    explicitUntitledSnapshot,
    [{
      url: 'https://example.test/loose',
      groupTitle: 'Ungrouped',
      groupColor: 'grey',
    }],
    fixedNow,
  );
  assert.strictEqual(defaultUngroupedRemoved, explicitUntitledSnapshot);

  const explicitlyUntitledRemoved = projectSnapshotTabsRemoval(
    explicitUntitledSnapshot,
    [{
      url: 'https://example.test/loose',
      groupTitle: '',
      groupColor: 'blue',
    }],
    fixedNow,
  );
  assert.deepEqual(explicitlyUntitledRemoved.groups.map((item) => item.title), ['Kept']);

  const missingTitleRemaining = group('', 'Remaining', 'red', [
    { title: 'Remaining', url: 'https://example.test/remaining' },
  ]);
  const missingTitleUngroupedRemoved = projectSnapshotTabsRemoval(
    durableSnapshot({ groups: [{
      snapshotGroupId: '',
      color: '',
      tabs: [{ title: 'Loose', url: 'https://example.test/missing-title' }],
    }, missingTitleRemaining] }),
    [{
      url: 'https://example.test/missing-title',
      groupTitle: 'Ungrouped',
      groupColor: 'grey',
    }],
    fixedNow,
  );
  assert.deepEqual(missingTitleUngroupedRemoved.groups, [missingTitleRemaining]);

  assert.equal(projectSnapshotTabsRemoval(
    durableSnapshot({ groups: [group('last', 'Last', 'blue', [
      tab('last-tab', 'Last', 'https://example.test/last'),
    ])] }),
    [{ snapshotTabId: 'last-tab', url: 'https://example.test/last' }],
    fixedNow,
  ), null);
});

test('close-event saved-row matching uses stable identity and refuses ambiguous URL fallbacks', () => {
  const shared = 'https://example.test/shared';
  const source = deepFreeze(durableSnapshot({ groups: [
    group('group-a', 'Docs', 'blue', [
      tab('row-a', 'Shared A', shared),
      tab('row-b', 'Shared B', shared),
      tab('', 'Navigated', 'https://navigation.test/page?saved=1#old'),
    ]),
    group('group-b', 'Plans', 'red', [
      tab('row-c', 'Shared C', shared),
      tab('', 'Unique', 'https://unique.test/page'),
    ]),
  ] }));

  const stable = resolveSnapshotTabRemovalMatch(source, {
    snapshotTabId: 'row-c',
    urlIdentities: [shared],
    groupKey: 'docs',
  }, { requireGroup: true });
  assert.deepEqual(
    { groupIndex: stable.groupIndex, tabIndex: stable.tabIndex, id: stable.tab.snapshotTabId },
    { groupIndex: 1, tabIndex: 0, id: 'row-c' },
    'a durable row id remains authoritative after the live tab moves Tags',
  );

  for (const [name, snapshot, target, options] of [
    [
      'unknown durable id never falls back to a same-URL row',
      source,
      { snapshotTabId: 'missing', urlIdentities: ['https://unique.test/page'] },
      {},
    ],
    [
      'duplicate durable ids are corrupt and ambiguous',
      durableSnapshot({ groups: [group('group-a', 'Docs', 'blue', [
        tab('same', 'First', 'https://one.test'),
        tab('same', 'Second', 'https://two.test'),
      ])] }),
      { snapshotTabId: 'same', urlIdentities: ['https://one.test'] },
      {},
    ],
    [
      'same-Tag duplicate URLs never delete the first row',
      source,
      { snapshotTabId: '', urlIdentities: [shared], groupKey: 'docs' },
      { requireGroup: true },
    ],
    [
      'cross-Tag duplicate URLs are ambiguous without a Tag constraint',
      source,
      { urlIdentities: [shared], groupKey: 'plans' },
      { requireGroup: false },
    ],
    [
      'multiple exact aliases pointing at different rows are ambiguous',
      source,
      { urlIdentities: [shared, 'https://unique.test/page'], groupKey: 'plans' },
      { requireGroup: true },
    ],
    [
      'duplicate navigation fallbacks never guess',
      durableSnapshot({ groups: [group('', 'Docs', 'blue', [
        { title: 'One', url: 'https://navigation.test/page?one=1' },
        { title: 'Two', url: 'https://navigation.test/page?two=2' },
      ])] }),
      { urlIdentities: ['https://missing.test'], navigationUrlKeys: ['https://navigation.test/page'] },
      {},
    ],
    ['malformed snapshot is ignored', { groups: [null] }, { urlIdentities: [shared] }, {}],
    ['malformed target is ignored', source, null, {}],
  ]) {
    assert.equal(resolveSnapshotTabRemovalMatch(snapshot, target, options), null, name);
  }

  const groupScoped = resolveSnapshotTabRemovalMatch(source, {
    urlIdentities: ['https://unique.test/page', '', 'https://unique.test/page'],
    groupKey: 'plans',
  }, { requireGroup: true });
  assert.equal(groupScoped.tab.title, 'Unique');

  const navigation = resolveSnapshotTabRemovalMatch(source, {
    urlIdentities: ['https://navigation.test/page?current=2'],
    navigationUrlKeys: ['https://navigation.test/page'],
    groupKey: 'docs',
  }, { requireGroup: true });
  assert.equal(navigation.tab.title, 'Navigated');
  assert.equal(resolveSnapshotTabRemovalMatch(source, {
    urlIdentities: ['https://not-saved.test/page'],
  }), null, 'an unmatched exact URL cannot degrade to title metadata');

  const titleDomain = resolveSnapshotTabRemovalMatch(source, {
    urlIdentities: [],
    navigationUrlKeys: [],
    titleDomainPairs: [
      null,
      { titleKey: '', domain: 'unique.test' },
      { titleKey: 'unique', domain: 'unknown' },
      { titleKey: 'unique', domain: 'unique.test' },
    ],
    groupKey: 'plans',
  }, { requireGroup: true });
  assert.equal(titleDomain.tab.title, 'Unique');
  const presentationFallbacks = durableSnapshot({ groups: [
    group('', 'Docs', 'blue', [
      { displayTitle: 'Panel alias', title: 'Page title', url: 'https://alias.test/page' },
      { url: 'https://title-from-url.test/page' },
    ]),
  ] });
  assert.equal(resolveSnapshotTabRemovalMatch(presentationFallbacks, {
    titleDomainPairs: [{ titleKey: 'panel alias', domain: 'alias.test' }],
  }).tab.displayTitle, 'Panel alias');
  assert.equal(resolveSnapshotTabRemovalMatch(presentationFallbacks, {
    titleDomainPairs: [{
      titleKey: 'https://title-from-url.test/page',
      domain: 'title-from-url.test',
    }],
  }).tab.url, 'https://title-from-url.test/page');
  assert.equal(resolveSnapshotTabRemovalMatch(durableSnapshot({ groups: [
    group('', 'Docs', 'blue', [
      { title: 'Same', url: 'https://example.test/one' },
      { title: 'Same', url: 'https://example.test/two' },
    ]),
  ] }), {
    titleDomainPairs: [{ titleKey: 'same', domain: 'example.test' }],
  }), null, 'duplicate title/domain fallbacks never guess');
});

test('opened dormant records require a unique durable, Chrome-tab, or legacy identity', () => {
  const stableRecord = deepFreeze({
    tabId: 10,
    snapshotTabId: 'row-a',
    snapshotGroupId: 'group-a',
    urlIdentity: 'https://saved.test/old',
    groupKey: 'docs',
    groupColor: 'blue',
  });
  const legacyRecord = deepFreeze({
    tabId: 20,
    snapshotTabId: '',
    urlIdentity: 'https://legacy.test/page',
    groupTitle: 'Docs',
    groupColor: 'blue',
  });
  const stableTab = { id: 99, snapshotTabId: 'row-a', url: 'https://saved.test/new' };
  assert.equal(
    resolveOpenedDormantRecordForLiveTab(stableTab, [legacyRecord, stableRecord]),
    stableRecord,
    'durable identity survives navigation and tab replacement',
  );
  assert.equal(resolveOpenedDormantRecordForLiveTab(stableTab, [
    stableRecord,
    { ...stableRecord, tabId: 11 },
  ]), null, 'duplicated durable identities are ambiguous');
  assert.equal(resolveOpenedDormantRecordForLiveTab({
    id: '20', snapshotTabId: 'new-row-id', url: 'https://changed.test',
  }, [legacyRecord]), legacyRecord, 'an exact Chrome tab id can migrate a legacy record');
  assert.equal(resolveOpenedDormantRecordForLiveTab({
    id: 10, snapshotTabId: 'different-row', url: stableRecord.urlIdentity,
  }, [stableRecord]), null, 'a contradictory durable identity invalidates the reused Chrome tab id');
  assert.equal(resolveOpenedDormantRecordForLiveTab({
    id: 77, snapshotTabId: 'missing', url: stableRecord.urlIdentity,
  }, [stableRecord]), null, 'a missing durable identity never degrades to URL');

  const exactIdTab = { id: 20, url: 'https://legacy.test/navigated' };
  assert.equal(resolveOpenedDormantRecordForLiveTab(exactIdTab, [legacyRecord]), legacyRecord);
  assert.equal(resolveOpenedDormantRecordForLiveTab(exactIdTab, [
    legacyRecord,
    { ...legacyRecord },
  ]), null, 'duplicate transient tab ids are ambiguous');

  const legacyTab = { id: 21, url: legacyRecord.urlIdentity };
  const docs = { title: 'Docs', color: 'blue' };
  assert.equal(resolveOpenedDormantRecordForLiveTab(legacyTab, [legacyRecord], {
    groupReference: docs,
    liveTabs: [legacyTab],
  }), legacyRecord, 'one legacy record and one live URL peer is a safe fallback');
  const urlOnlyRecord = { url: legacyRecord.urlIdentity, groupTitle: 'Docs' };
  const noIdLegacyTab = { url: legacyRecord.urlIdentity };
  assert.equal(resolveOpenedDormantRecordForLiveTab(noIdLegacyTab, [urlOnlyRecord], {
    groupReference: { displayTitle: 'Docs' },
  }), urlOnlyRecord, 'legacy records and groups may use their older URL and display-title fields');
  assert.equal(resolveOpenedDormantRecordForLiveTab(legacyTab, [
    legacyRecord,
    { ...legacyRecord, tabId: 22 },
  ], {
    groupReference: docs,
    liveTabs: [legacyTab],
  }), null, 'same-Tag duplicate records never choose the first');
  assert.equal(resolveOpenedDormantRecordForLiveTab(legacyTab, [
    legacyRecord,
    { ...legacyRecord, tabId: 22, groupTitle: 'Plans', groupColor: 'red' },
  ], {
    groupReference: docs,
    liveTabs: [legacyTab],
  }), legacyRecord, 'cross-Tag records are disambiguated by compatible metadata');
  assert.equal(resolveOpenedDormantRecordForLiveTab(legacyTab, [legacyRecord], {
    groupReference: docs,
    liveTabs: [legacyTab, { id: 22, url: legacyRecord.urlIdentity }],
  }), null, 'two live tabs with the same URL make a legacy replacement ambiguous');
  assert.equal(resolveOpenedDormantRecordForLiveTab(legacyTab, [legacyRecord], {
    groupReference: docs,
    liveTabs: [{ id: 22, url: legacyRecord.urlIdentity }],
  }), null, 'the one live fallback candidate must be the requested tab');

  const identityGroupedRecord = {
    ...legacyRecord,
    tabId: null,
    snapshotGroupId: 'group-a',
    groupTitle: 'Old name',
    groupColor: 'red',
  };
  const noIdTab = { id: null, snapshotGroupId: 'group-a', url: legacyRecord.urlIdentity };
  assert.equal(resolveOpenedDormantRecordForLiveTab(noIdTab, [identityGroupedRecord], {
    groupReference: { snapshotGroupId: 'group-a', title: 'Renamed', color: 'green' },
  }), identityGroupedRecord, 'stable Tag identity survives a rename');
  assert.equal(resolveOpenedDormantRecordForLiveTab(noIdTab, [{
    ...identityGroupedRecord,
    snapshotGroupId: 'group-b',
  }], {
    groupReference: { snapshotGroupId: 'group-a', title: 'Old name', color: 'red' },
  }), null, 'conflicting stable Tag identities never fall back to metadata');
  assert.equal(resolveOpenedDormantRecordForLiveTab({ id: -1, url: 'https://different.test' }, [
    { ...legacyRecord, tabId: -1 },
  ], { groupReference: docs }), null, 'invalid ids cannot masquerade as an exact tab identity');
  assert.equal(resolveOpenedDormantRecordForLiveTab({ id: 1.5, url: '' }, [legacyRecord]), null);
  assert.equal(resolveOpenedDormantRecordForLiveTab(null, [legacyRecord]), null);
});
