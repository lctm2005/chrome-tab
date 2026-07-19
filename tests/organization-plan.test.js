import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOrganizationPlanToSnapshot,
  buildOrganizationCandidates,
  organizationCandidateIdsOpenInOtherWindows,
  rebaseOrganizationPlan,
  resolveOrganizationPlanChanges,
} from '../src/shared/organization-plan.js';

test('previews only real Auto Group moves and preserves existing target presentation', () => {
  const candidates = [
    { id: 1, currentGroup: { title: 'Research' } },
    { id: 2, currentGroup: { title: 'Docs' } },
    { id: 3, currentGroup: { title: 'Later' } },
  ];
  const resolved = resolveOrganizationPlanChanges({
    candidates,
    plannedGroups: [
      { title: 'docs', color: 'blue', tabIds: [1, 2] },
      { title: 'New group', color: '', collapsed: true, tabIds: [3] },
    ],
    existingGroups: [{ title: 'Docs', color: 'red', collapsed: true }],
  });

  assert.deepEqual(resolved, {
    previewGroups: [
      { title: 'Docs', color: 'red', collapsed: true, tabIds: [1, 2] },
      { title: 'New group', color: 'blue', collapsed: true, tabIds: [3] },
    ],
    plannedGroups: [
      { title: 'Docs', color: 'red', collapsed: true, tabIds: [1] },
      { title: 'New group', color: 'blue', collapsed: true, tabIds: [3] },
    ],
    unchangedCandidateIds: [2],
  });
});

test('does not preview a group when every proposed assignment is already true', () => {
  const resolved = resolveOrganizationPlanChanges({
    candidates: [{ id: 1, currentGroup: { title: 'Docs' } }],
    plannedGroups: [{ title: 'Docs', color: 'purple', tabIds: [1] }],
    existingGroups: [null, { title: '' }, { title: 'Docs', color: '', collapsed: false }],
  });

  assert.deepEqual(resolved, {
    previewGroups: [{ title: 'Docs', color: 'purple', collapsed: false, tabIds: [1] }],
    plannedGroups: [],
    unchangedCandidateIds: [1],
  });
});

test('builds stable numeric candidates from live and one-to-one dormant snapshot rows', () => {
  const input = {
    liveGroups: [
      {
        id: 10,
        key: 'group:10',
        title: 'Docs',
        color: 'blue',
        tabs: [
          { id: 101, title: 'Open spec', url: 'https://example.com/spec?live=1' },
          { id: 102, title: 'Open duplicate', url: 'https://example.com/shared' },
        ],
      },
      {
        id: 11,
        key: 'group:11',
        title: 'Research',
        color: 'green',
        tabs: [
          { id: 103, title: 'Second open duplicate', url: 'https://example.com/shared' },
          { id: 104, title: 'Not snapshotted', url: 'https://example.com/new' },
        ],
      },
    ],
    snapshot: {
      version: 1,
      updatedAt: 1,
      groups: [
        {
          title: 'Docs',
          color: 'blue',
          collapsed: true,
          tabs: [
            { title: 'Saved spec', url: 'https://example.com/spec?stored=1' },
            { title: 'Saved duplicate A', url: 'https://example.com/shared' },
            { title: 'Dormant docs', url: 'https://example.com/dormant' },
          ],
        },
        {
          title: 'Research',
          color: 'green',
          tabs: [
            { title: 'Saved duplicate B', url: 'https://example.com/shared' },
          ],
        },
      ],
    },
  };

  const first = buildOrganizationCandidates(input);
  const second = buildOrganizationCandidates(input);

  assert.deepEqual(first, second);
  assert.match(first.fingerprint, /^organization-v3-[0-9a-f]{8}-5$/);
  assert.deepEqual(first.candidates.map((candidate) => candidate.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(first.candidates.map((candidate) => candidate.dormant), [false, false, true, false, false]);
  assert.equal(first.candidates[0].source.live.tabId, 101);
  assert.deepEqual(first.candidates[0].source.snapshot, {
    groupIndex: 0,
    tabIndex: 0,
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://example.com/spec?stored=1',
  });
  assert.equal(first.candidates[1].source.live.tabId, 102);
  assert.equal(first.candidates[3].source.live.tabId, 103);
  assert.equal(first.candidates[2].currentGroup.title, 'Docs');
  assert.equal(first.candidates[2].source.kind, 'snapshot');
  assert.equal(first.candidates[4].source.snapshot, null);
});

test('fingerprints transient empty groups and legacy rows linked only by tab identity', () => {
  const liveGroups = [
    null,
    { id: -1, tabs: [] },
    {
      id: 10,
      title: null,
      tabs: [{
        id: 101,
        snapshotTabId: 'legacy-row',
        title: 'Legacy page',
        url: 'https://example.com/legacy',
        index: 2,
      }],
    },
  ];
  const snapshot = {
    groups: [{
      title: 'Legacy history',
      tabs: [{
        snapshotTabId: 'legacy-row',
        title: 'Legacy page',
        url: 'https://example.com/legacy',
      }],
    }],
  };

  const first = buildOrganizationCandidates({ liveGroups, snapshot });
  const second = buildOrganizationCandidates({ liveGroups, snapshot });

  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].source.live.tabId, 101);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(buildOrganizationCandidates({
    liveGroups,
    snapshot: {
      groups: [{
        ...snapshot.groups[0],
        custom: 'changed while preview was open',
      }],
    },
  }).fingerprint, first.fingerprint);
});

test('organization freshness ignores transient Chrome grouping coordinates but keeps physical tab order', () => {
  const snapshot = {
    version: 1,
    groups: [{
      snapshotGroupId: 'saved-docs',
      title: 'Docs',
      color: 'purple',
      collapsed: true,
      tabs: [
        { snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a' },
        { snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b' },
      ],
    }],
  };
  const built = (group) => buildOrganizationCandidates({ liveGroups: [group], snapshot });
  const before = built({
    id: 10,
    key: 'group:10',
    title: 'Docs',
    color: 'purple',
    collapsed: true,
    tabs: [
      { id: 101, snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a', windowId: 7, index: 4 },
      { id: 102, snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b', windowId: 7, index: 5 },
    ],
  });
  const afterReload = built({
    id: 999,
    key: 'group:999',
    title: 'Docs',
    color: 'purple',
    collapsed: true,
    tabs: [
      { id: 102, snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b', windowId: 7, index: 5 },
      { id: 101, snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a', windowId: 7, index: 4 },
    ],
  });

  assert.equal(afterReload.fingerprint, before.fingerprint);
  assert.equal(built({
    id: 999,
    key: 'group:999',
    title: 'Docs',
    color: 'purple',
    collapsed: true,
    tabs: [
      { id: 101, snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a', windowId: 7, index: 40 },
      { id: 102, snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b', windowId: 7, index: 41 },
    ],
  }).fingerprint, before.fingerprint, 'unrelated tabs may shift every absolute Chrome index');
  assert.notEqual(built({
    id: 999,
    key: 'group:999',
    title: 'Docs',
    color: 'purple',
    collapsed: true,
    tabs: [
      { id: 102, snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b', windowId: 7, index: 4 },
      { id: 101, snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a', windowId: 7, index: 5 },
    ],
  }).fingerprint, before.fingerprint);
  assert.notEqual(buildOrganizationCandidates({
    liveGroups: [{
      id: 999,
      key: 'group:999',
      title: 'Docs',
      color: 'orange',
      collapsed: true,
      tabs: [
        { id: 101, snapshotTabId: 'saved-a', title: 'A', url: 'https://example.com/a', windowId: 7, index: 4 },
        { id: 102, snapshotTabId: 'saved-b', title: 'B', url: 'https://example.com/b', windowId: 7, index: 5 },
      ],
    }],
    snapshot: {
      ...snapshot,
      groups: [{ ...snapshot.groups[0], color: 'orange' }],
    },
  }).fingerprint, before.fingerprint);
});

test('organization freshness ignores a lifecycle rebind between indistinguishable saved rows', () => {
  const snapshot = {
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'saved-docs',
      title: 'Docs',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'saved-a', title: 'Same', url: 'https://example.com/same' },
        { snapshotTabId: 'saved-b', title: 'Same', url: 'https://example.com/same' },
      ],
    }],
  };
  const liveGroup = {
    id: 10,
    title: 'Docs',
    color: 'blue',
    tabs: [
      { id: 101, snapshotTabId: 'saved-a', title: 'Same', url: 'https://example.com/same', index: 2 },
      { id: 102, snapshotTabId: 'saved-b', title: 'Same', url: 'https://example.com/same', index: 3 },
    ],
  };
  const before = buildOrganizationCandidates({ snapshot, liveGroups: [liveGroup] });
  const rebound = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      ...liveGroup,
      id: 50,
      tabs: [
        { ...liveGroup.tabs[0], snapshotTabId: 'saved-b' },
        { ...liveGroup.tabs[1], snapshotTabId: 'saved-a' },
      ],
    }],
  });

  assert.equal(rebound.fingerprint, before.fingerprint);
  assert.notDeepEqual(
    rebound.candidates.map((candidate) => candidate.source.live?.tabId),
    before.candidates.map((candidate) => candidate.source.live?.tabId),
    'candidate matching may change even though saved and live user data did not',
  );
});

test('organization freshness follows physical order for open Tags but preserves saved-only Tag order', () => {
  const liveGroups = [
    {
      id: 10,
      snapshotGroupId: 'saved-a',
      title: 'A',
      color: 'blue',
      tabs: [{
        id: 101,
        snapshotGroupId: 'saved-a',
        snapshotTabId: 'row-a',
        title: 'A page',
        url: 'https://example.com/a',
        index: 2,
      }],
    },
    {
      id: 20,
      snapshotGroupId: 'saved-b',
      title: 'B',
      color: 'green',
      tabs: [{
        id: 102,
        snapshotGroupId: 'saved-b',
        snapshotTabId: 'row-b',
        title: 'B page',
        url: 'https://example.com/b',
        index: 3,
      }],
    },
  ];
  const openA = {
    snapshotGroupId: 'saved-a',
    title: 'A',
    color: 'blue',
    tabs: [{ snapshotTabId: 'row-a', title: 'A page', url: 'https://example.com/a' }],
  };
  const openB = {
    snapshotGroupId: 'saved-b',
    title: 'B',
    color: 'green',
    tabs: [{ snapshotTabId: 'row-b', title: 'B page', url: 'https://example.com/b' }],
  };
  const savedC = { snapshotGroupId: 'saved-c', title: 'Saved C', color: 'orange', tabs: [] };
  const savedD = { snapshotGroupId: 'saved-d', title: 'Saved D', color: 'pink', tabs: [] };
  const before = buildOrganizationCandidates({
    liveGroups,
    snapshot: { groups: [openA, openB, savedC, savedD] },
  }).fingerprint;

  assert.equal(buildOrganizationCandidates({
    liveGroups,
    snapshot: { groups: [openB, openA, savedC, savedD] },
  }).fingerprint, before, 'background refresh may reorder live-backed snapshot records');
  assert.notEqual(buildOrganizationCandidates({
    liveGroups,
    snapshot: { groups: [openA, openB, savedD, savedC] },
  }).fingerprint, before, 'saved-only Tag order remains user data');
});

test('organization freshness ignores mirrored open-row order but preserves dormant positions and row metadata', () => {
  const liveGroups = [{
    id: 10,
    snapshotGroupId: 'saved-docs',
    title: 'Docs',
    color: 'blue',
    tabs: [
      {
        id: 101,
        snapshotGroupId: 'saved-docs',
        snapshotTabId: 'row-a',
        title: 'A',
        url: 'https://example.com/a',
        index: 2,
      },
      {
        id: 102,
        snapshotGroupId: 'saved-docs',
        snapshotTabId: 'row-b',
        title: 'B',
        url: 'https://example.com/b',
        index: 3,
      },
    ],
  }];
  const rowA = {
    snapshotTabId: 'row-a',
    title: 'A',
    url: 'https://example.com/a',
    custom: 'keep-a',
  };
  const rowB = {
    snapshotTabId: 'row-b',
    title: 'B',
    url: 'https://example.com/b',
  };
  const dormant = {
    snapshotTabId: 'row-dormant',
    title: 'Saved',
    url: 'https://example.com/saved',
  };
  const built = (tabs) => buildOrganizationCandidates({
    liveGroups,
    snapshot: {
      identityVersion: 1,
      groups: [{
        snapshotGroupId: 'saved-docs',
        title: 'Docs',
        color: 'blue',
        tabs,
      }],
    },
  });
  const before = built([rowA, rowB, dormant]);

  assert.equal(
    built([rowB, rowA, dormant]).fingerprint,
    before.fingerprint,
    'a lifecycle refresh may mirror physical order for rows that are already open',
  );
  assert.notEqual(
    built([dormant, rowA, rowB]).fingerprint,
    before.fingerprint,
    'moving a dormant saved row remains an organization change',
  );
  assert.notEqual(
    built([{ ...rowA, custom: 'changed-a' }, rowB, dormant]).fingerprint,
    before.fingerprint,
    'metadata stored on an open row remains protected',
  );
});

test('foreign matching reserves local snapshot rows before consuming equal-URL dormant siblings', () => {
  const sharedUrl = 'https://example.com/shared?copy=1#saved';
  const candidates = [
    {
      id: 1,
      url: sharedUrl,
      source: {
        kind: 'live',
        live: { tabId: 101 },
        snapshot: {
          snapshotTabId: 'row-local',
          snapshotGroupId: 'group-a',
          url: sharedUrl,
        },
      },
    },
    {
      id: 2,
      url: sharedUrl,
      source: {
        kind: 'snapshot',
        snapshot: {
          snapshotTabId: 'row-foreign-legacy',
          snapshotGroupId: 'group-a',
          url: sharedUrl,
        },
      },
    },
    {
      id: 3,
      source: {
        kind: 'snapshot',
        snapshot: {
          snapshotTabId: 'row-foreign-stable',
          snapshotGroupId: 'group-b',
          url: 'https://example.com/stable',
        },
      },
    },
    { id: 4, url: sharedUrl, source: { kind: 'live', live: { tabId: 104 }, snapshot: null } },
  ];

  const foreignIds = organizationCandidateIdsOpenInOtherWindows(candidates, [
    {
      id: 201,
      snapshotGroupId: 'group-a',
      url: sharedUrl,
    },
    {
      id: 202,
      snapshotTabId: 'row-foreign-stable',
      snapshotGroupId: 'group-b',
      url: 'https://example.com/stable?new-navigation=1',
    },
  ]);

  assert.deepEqual([...foreignIds], [3, 2]);
  assert.equal(foreignIds.has(1), false, 'the panel window keeps its reserved snapshot row');
  assert.equal(foreignIds.has(4), false, 'an unmatched local live tab is never URL-matched as foreign');
});

test('same stable identity in the panel and another window fails closed for every claimed candidate', () => {
  const candidates = [
    {
      id: 1,
      source: {
        live: { tabId: 101 },
        snapshot: {
          snapshotTabId: 'row-shared',
          snapshotGroupId: 'group-local',
          url: 'https://example.com/shared',
        },
      },
    },
    {
      id: 2,
      source: {
        snapshot: {
          snapshotTabId: 'row-shared',
          snapshotGroupId: 'group-duplicate',
          url: 'https://example.com/shared',
        },
      },
    },
    {
      id: 3,
      source: {
        snapshot: {
          snapshotTabId: 'row-other',
          snapshotGroupId: 'group-local',
          url: 'https://example.com/other',
        },
      },
    },
  ];

  const foreignIds = organizationCandidateIdsOpenInOtherWindows(candidates, [
    {
      id: 201,
      snapshotTabId: 'row-shared',
      snapshotGroupId: 'group-foreign',
      url: 'https://example.com/shared',
    },
    {
      id: 202,
      snapshotTabId: 'row-missing',
      snapshotGroupId: 'group-local',
      url: 'https://example.com/other',
    },
  ]);

  assert.deepEqual([...foreignIds], [1, 2]);
});

test('foreign URL fallback is one-to-one, exact-first, and rejects contradictory identities', () => {
  const candidates = [
    {
      id: 1,
      source: { snapshot: { url: 'https://example.com/doc?id=1#exact' } },
    },
    {
      id: 2,
      source: { snapshot: { url: 'https://example.com/doc?id=2#saved' } },
    },
    {
      id: 3,
      source: {
        snapshot: {
          snapshotTabId: 'row-a',
          snapshotGroupId: 'group-a',
          url: 'https://example.com/contradiction',
        },
      },
    },
    { id: 4, source: { snapshot: { url: '' } } },
    { id: 'invalid', source: { snapshot: { url: 'https://example.com/invalid' } } },
    { id: 5, source: {} },
    { id: 6, url: 'https://example.com/candidate-url', source: { snapshot: {} } },
  ];
  const foreignIds = organizationCandidateIdsOpenInOtherWindows(candidates, [
    { id: 201, url: 'https://example.com/doc?id=3#navigated' },
    { id: 202, url: 'https://example.com/doc?id=1#exact' },
    {
      id: 203,
      snapshotTabId: 'row-b',
      snapshotGroupId: 'group-a',
      url: 'https://example.com/contradiction',
    },
    { id: 204, url: 'https://example.com/candidate-url' },
    { id: 'invalid', url: 'https://example.com/invalid' },
  ]);

  assert.deepEqual([...foreignIds], [1, 6, 2]);
  assert.deepEqual(organizationCandidateIdsOpenInOtherWindows([
    {
      id: 6,
      source: {
        snapshot: {
          snapshotGroupId: 'group-a',
          url: 'https://example.com/group-conflict',
        },
      },
    },
  ], [{
    id: 205,
    snapshotGroupId: 'group-b',
    url: 'https://example.com/group-conflict',
  }]), new Set());
  assert.deepEqual(organizationCandidateIdsOpenInOtherWindows(null, null), new Set());
});

test('keeps planner ids anchored to snapshot rows when a live tab changes group', () => {
  const snapshot = {
    groups: [{
      title: 'Historical',
      color: 'blue',
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    }],
  };
  const before = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      id: 1,
      title: 'Historical',
      color: 'blue',
      tabs: [{ id: 10, title: 'Spec', url: 'https://example.com/spec' }],
    }],
  });
  const after = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      id: 2,
      title: 'AI Proposal',
      color: 'purple',
      tabs: [{ id: 10, title: 'Spec', url: 'https://example.com/spec' }],
    }],
  });

  assert.equal(before.candidates[0].id, 1);
  assert.equal(after.candidates[0].id, 1);
  assert.equal(before.candidates[0].source.snapshot.tabIndex, after.candidates[0].source.snapshot.tabIndex);
  assert.equal(after.candidates[0].currentGroup.title, 'AI Proposal');
  assert.notEqual(before.fingerprint, after.fingerprint);
});

test('reserves query and hash exact matches before base-URL fallback without losing siblings', () => {
  const snapshot = {
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Saved one', url: 'https://example.com/item?id=1#one' }],
      },
      {
        title: 'Research',
        color: 'green',
        tabs: [{ title: 'Saved two', url: 'https://example.com/item?id=2#two' }],
      },
    ],
  };
  const built = buildOrganizationCandidates({
    snapshot,
    liveGroups: [
      {
        id: 10,
        title: 'Docs',
        color: 'blue',
        tabs: [
          { id: 101, title: 'Navigated sibling', url: 'https://example.com/item?id=3#three' },
          { id: 102, title: 'Exact one', url: ' https://example.com/item?id=1#one ' },
        ],
      },
      {
        id: 11,
        title: 'Research',
        color: 'green',
        tabs: [{ id: 103, title: 'Exact two', url: 'https://example.com/item?id=2#two' }],
      },
    ],
  });

  assert.equal(built.candidates.length, 3);
  assert.equal(built.candidates[0].source.live.tabId, 102);
  assert.equal(built.candidates[1].source.live.tabId, 103);
  assert.equal(built.candidates[2].source.live.tabId, 101);
  assert.equal(built.candidates[2].source.snapshot, null);
  assert.deepEqual(built.candidates.map((candidate) => candidate.url), [
    ' https://example.com/item?id=1#one ',
    'https://example.com/item?id=2#two',
    'https://example.com/item?id=3#three',
  ]);
});

test('different stable identities stay separate despite exact and navigation-fallback URLs', () => {
  const built = buildOrganizationCandidates({
    snapshot: {
      identityVersion: 1,
      groups: [{
        title: 'Docs',
        color: 'blue',
        tabs: [
          {
            snapshotTabId: 'saved-exact',
            title: 'Saved exact',
            url: 'https://example.com/exact',
          },
          {
            snapshotTabId: 'saved-query',
            title: 'Saved query',
            url: 'https://example.com/item?version=saved#saved',
          },
        ],
      }],
    },
    liveGroups: [{
      id: 10,
      title: 'Docs',
      color: 'blue',
      tabs: [
        {
          id: 101,
          snapshotTabId: 'live-exact',
          title: 'Live exact',
          url: 'https://example.com/exact',
        },
        {
          id: 102,
          snapshotTabId: 'live-query',
          title: 'Live query',
          url: 'https://example.com/item?version=live#live',
        },
      ],
    }],
  });

  assert.deepEqual(built.candidates.map((candidate) => ({
    dormant: candidate.dormant,
    liveTabId: candidate.source.live?.tabId ?? null,
    snapshotTabIndex: candidate.source.snapshot?.tabIndex ?? null,
  })), [
    { dormant: true, liveTabId: null, snapshotTabIndex: 0 },
    { dormant: true, liveTabId: null, snapshotTabIndex: 1 },
    { dormant: false, liveTabId: 101, snapshotTabIndex: null },
    { dormant: false, liveTabId: 102, snapshotTabIndex: null },
  ]);
});

test('prefers the same Tag when a live navigation only has a base-URL fallback', () => {
  const built = buildOrganizationCandidates({
    snapshot: {
      groups: [
        {
          title: 'Alpha',
          color: 'blue',
          tabs: [{ title: 'Alpha history', url: 'https://example.com/item?id=1' }],
        },
        {
          title: 'Beta',
          color: 'green',
          tabs: [{ title: 'Beta history', url: 'https://example.com/item?id=2' }],
        },
      ],
    },
    liveGroups: [{
      id: 20,
      title: 'Beta',
      color: 'green',
      tabs: [{ id: 201, title: 'Beta navigation', url: 'https://example.com/item?id=3' }],
    }],
  });

  assert.equal(built.candidates[0].dormant, true);
  assert.equal(built.candidates[1].source.live.tabId, 201);
  assert.equal(built.candidates[1].source.snapshot.groupTitle, 'Beta');
});

test('invalidates an organization preview when titles, panel names, or empty Tag metadata change', () => {
  const snapshot = {
    preserveGroups: true,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Saved title', panelTitle: 'Saved name', url: 'https://example.com/spec' }],
      },
      { title: 'Empty history', color: 'orange', collapsed: true, tabs: [] },
    ],
  };
  const liveGroups = [{
    id: 10,
    title: 'Docs',
    color: 'blue',
    tabs: [{
      id: 101,
      title: 'Live title',
      displayTitle: 'Panel name',
      panelTitle: 'Panel name',
      url: 'https://example.com/spec',
    }],
  }];
  const initial = buildOrganizationCandidates({ snapshot, liveGroups }).fingerprint;

  assert.notEqual(buildOrganizationCandidates({
    snapshot,
    liveGroups: [{ ...liveGroups[0], tabs: [{ ...liveGroups[0].tabs[0], title: 'New live title' }] }],
  }).fingerprint, initial);
  assert.notEqual(buildOrganizationCandidates({
    snapshot,
    liveGroups: [{ ...liveGroups[0], tabs: [{ ...liveGroups[0].tabs[0], panelTitle: 'New name', displayTitle: 'New name' }] }],
  }).fingerprint, initial);
  assert.notEqual(buildOrganizationCandidates({
    snapshot: {
      ...snapshot,
      groups: [snapshot.groups[0], { ...snapshot.groups[1], collapsed: false }],
    },
    liveGroups,
  }).fingerprint, initial);
});

test('organization fingerprints retain logical identity across Chrome tab replacement', () => {
  const liveGroups = [{
    id: 10,
    title: 'Docs',
    color: 'blue',
    tabs: [{ id: 101, title: 'Spec', url: 'https://example.com/spec' }],
  }];
  const before = buildOrganizationCandidates({ liveGroups }).fingerprint;
  const replacementGroups = [{
    ...liveGroups[0],
    tabs: [{ ...liveGroups[0].tabs[0], id: 202 }],
  }];

  assert.equal(buildOrganizationCandidates({
    liveGroups: replacementGroups,
    tabIdAliases: { 202: 101 },
  }).fingerprint, before);
  assert.notEqual(buildOrganizationCandidates({ liveGroups: replacementGroups }).fingerprint, before);
  assert.equal(buildOrganizationCandidates({
    liveGroups: replacementGroups,
    tabIdAliases: { 202: 'bad' },
  }).fingerprint, buildOrganizationCandidates({ liveGroups: replacementGroups }).fingerprint);
  assert.equal(buildOrganizationCandidates({
    liveGroups: replacementGroups,
    tabIdAliases: null,
  }).fingerprint, buildOrganizationCandidates({ liveGroups: replacementGroups }).fingerprint);
});

test('rebases planned targets across display updates and unrelated candidate insertions', () => {
  const previewSnapshot = {
    groups: [{
      title: 'Historical',
      color: 'purple',
      collapsed: false,
      tabs: [{ title: 'Saved title', panelTitle: 'Saved panel name', url: 'https://saved.example/item?id=1' }],
    }],
  };
  const previewLiveGroups = [{
    id: 10,
    title: 'Current',
    color: 'blue',
    collapsed: false,
    tabs: [{
      id: 101,
      title: 'Original live title',
      displayTitle: 'Original panel title',
      panelTitle: 'Original panel title',
      url: 'https://live.example/item?id=1#old',
    }],
  }];
  const preview = buildOrganizationCandidates({ snapshot: previewSnapshot, liveGroups: previewLiveGroups });
  const savedPreview = preview.candidates.find((candidate) => candidate.dormant);
  const livePreview = preview.candidates.find((candidate) => candidate.source.live?.tabId === 101);

  const current = buildOrganizationCandidates({
    snapshot: {
      groups: [
        {
          title: 'Unrelated',
          color: 'orange',
          tabs: [{ title: 'Inserted row', url: 'https://unrelated.example/' }],
        },
        {
          title: 'Historical',
          color: 'green',
          collapsed: true,
          tabs: [{ title: 'Updated saved title', panelTitle: 'Updated saved name', url: 'https://saved.example/item?id=1' }],
        },
      ],
    },
    liveGroups: [{
      ...previewLiveGroups[0],
      color: 'cyan',
      collapsed: true,
      tabs: [{
        ...previewLiveGroups[0].tabs[0],
        title: '(3) Updated live title',
        displayTitle: 'Updated panel title',
        panelTitle: 'Updated panel title',
      }],
    }],
  });
  const savedCurrent = current.candidates.find((candidate) => (
    candidate.source.snapshot?.url === 'https://saved.example/item?id=1'
  ));
  const liveCurrent = current.candidates.find((candidate) => candidate.source.live?.tabId === 101);

  const rebased = rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: current.candidates,
    plannedGroups: [{
      title: 'Proposal',
      color: 'green',
      tabIds: [livePreview.id, savedPreview.id],
    }],
  });

  assert.deepEqual(rebased, [{
    title: 'Proposal',
    color: 'green',
    tabIds: [liveCurrent.id, savedCurrent.id],
  }]);
  assert.notDeepEqual(rebased[0].tabIds, [livePreview.id, savedPreview.id]);
});

test('stable snapshot identities rebase same-URL duplicates after row reordering', () => {
  const previewSnapshot = {
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'group-duplicates',
      title: 'Duplicates',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'row-a', title: 'First', url: 'https://same.test/page' },
        { snapshotTabId: 'row-b', title: 'Second', url: 'https://same.test/page' },
      ],
    }],
  };
  const currentSnapshot = {
    ...previewSnapshot,
    groups: [{
      ...previewSnapshot.groups[0],
      tabs: [...previewSnapshot.groups[0].tabs].reverse(),
    }],
  };
  const preview = buildOrganizationCandidates({ snapshot: previewSnapshot });
  const unchanged = buildOrganizationCandidates({ snapshot: previewSnapshot });
  const current = buildOrganizationCandidates({ snapshot: currentSnapshot });
  const plannedGroups = [{ title: 'Target', color: 'green', tabIds: [preview.candidates[0].id] }];

  assert.equal(preview.candidates[0].source.snapshot.snapshotTabId, 'row-a');
  assert.deepEqual(rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: unchanged.candidates,
    plannedGroups,
  }), plannedGroups);

  const rebased = rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: current.candidates,
    plannedGroups,
  });
  const currentRowA = current.candidates.find((candidate) => (
    candidate.source.snapshot?.snapshotTabId === 'row-a'
  ));
  assert.deepEqual(rebased, [{ title: 'Target', color: 'green', tabIds: [currentRowA.id] }]);

  const applied = applyOrganizationPlanToSnapshot({
    snapshot: currentSnapshot,
    candidates: current.candidates,
    plannedGroups: rebased,
    now: 10,
  });
  assert.deepEqual(applied.groups.map((group) => ({
    title: group.title,
    rows: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { title: 'Duplicates', rows: ['row-b'] },
    { title: 'Target', rows: ['row-a'] },
  ]);
});

test('applying a stable candidate rejects stale tab or group identity at its old row index', () => {
  const snapshot = {
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'group-a',
      title: 'Source',
      color: 'blue',
      tabs: [{ snapshotTabId: 'row-a', title: 'Page', url: 'https://same.test/page' }],
    }],
  };
  const built = buildOrganizationCandidates({ snapshot });
  const plannedGroups = [{ title: 'Target', tabIds: [built.candidates[0].id] }];

  for (const identityPatch of [
    { snapshotTabId: 'row-b' },
    { snapshotGroupId: 'group-b' },
  ]) {
    const candidates = structuredClone(built.candidates);
    Object.assign(candidates[0].source.snapshot, identityPatch);
    assert.throws(() => applyOrganizationPlanToSnapshot({
      snapshot,
      candidates,
      plannedGroups,
    }), /snapshot row 0:0 changed/);
  }
});

test('rejects rebasing when a planned live target meaningfully changes', () => {
  const preview = buildOrganizationCandidates({
    snapshot: { groups: [] },
    liveGroups: [{
      id: 10,
      title: 'Current',
      tabs: [{ id: 101, title: 'Page', url: 'https://example.com/original?id=1' }],
    }],
  });
  const plannedGroups = [{ title: 'Proposal', tabIds: [preview.candidates[0].id] }];
  const rebase = (liveGroups) => rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: buildOrganizationCandidates({ snapshot: { groups: [] }, liveGroups }).candidates,
    plannedGroups,
  });

  assert.throws(() => rebase([]), /no longer open/);
  assert.throws(() => rebase([{
    id: 10,
    title: 'Current',
    tabs: [{ id: 101, title: 'Page', url: 'https://example.com/original?id=1', pinned: true }],
  }]), /was pinned/);
  assert.throws(() => rebase([{
    id: 10,
    title: 'Current',
    tabs: [{ id: 101, title: 'Page', url: 'https://example.com/another-path' }],
  }]), /navigated to another page/);
  assert.throws(() => rebase([{
    id: 10,
    title: 'Current',
    tabs: [{ id: 101, title: 'Page', url: 'https://example.com/original?id=2' }],
  }]), /navigated to another page/);
  assert.throws(() => rebase([{
    id: 10,
    title: 'Current',
    tabs: [{ id: 101, title: 'Page', url: 'https://example.com/original?id=1#section' }],
  }]), /navigated to another page/);
  assert.throws(() => rebase([{
    id: 11,
    title: 'Another Tag',
    tabs: [{ id: 101, title: 'Page', url: 'https://example.com/original?id=1' }],
  }]), /moved to another Tag/);
});

test('rejects rebasing when a planned saved target changes or is removed', () => {
  const preview = buildOrganizationCandidates({
    snapshot: {
      groups: [{
        title: 'Historical',
        tabs: [{ title: 'Saved', url: 'https://example.com/saved?id=1' }],
      }],
    },
    liveGroups: [],
  });
  const plannedGroups = [{ title: 'Proposal', tabIds: [preview.candidates[0].id] }];
  const rebase = (snapshot) => rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: buildOrganizationCandidates({ snapshot, liveGroups: [] }).candidates,
    plannedGroups,
  });

  assert.throws(() => rebase({ groups: [] }), /saved row changed or was removed/);
  assert.throws(() => rebase({
    groups: [{
      title: 'Historical',
      tabs: [{ title: 'Saved', url: 'https://example.com/saved?id=2' }],
    }],
  }), /saved row changed or was removed/);
  assert.throws(() => rebase({
    groups: [{
      title: 'Renamed Tag',
      tabs: [{ title: 'Saved', url: 'https://example.com/saved?id=1' }],
    }],
  }), /saved row changed or was removed/);
});

test('rejects ambiguous saved targets instead of rebinding by row position', () => {
  const preview = buildOrganizationCandidates({
    snapshot: {
      groups: [
        {
          title: 'Historical',
          color: 'red',
          tabs: [{ title: 'A', panelTitle: 'A', url: 'https://example.com/saved' }],
        },
        {
          title: 'Historical',
          color: 'blue',
          tabs: [{ title: 'B', panelTitle: 'B', url: 'https://example.com/saved' }],
        },
      ],
    },
    liveGroups: [],
  });
  const current = buildOrganizationCandidates({
    snapshot: {
      groups: [
        {
          title: 'Historical',
          color: 'blue',
          tabs: [{ title: 'B', panelTitle: 'B', url: 'https://example.com/saved' }],
        },
        {
          title: 'Historical',
          color: 'red',
          tabs: [{ title: 'A', panelTitle: 'A', url: 'https://example.com/saved' }],
        },
      ],
    },
    liveGroups: [],
  });

  assert.throws(() => rebaseOrganizationPlan({
    previewCandidates: preview.candidates,
    currentCandidates: current.candidates,
    plannedGroups: [{ title: 'Proposal', tabIds: [preview.candidates[0].id] }],
  }), /could not be matched unambiguously/);
});

test('moves a planned live row without absorbing unplanned dormant tabs or history metadata', () => {
  const snapshot = {
    version: 1,
    updatedAt: 10,
    groups: [
      {
        title: 'Historical Tag',
        color: 'blue',
        collapsed: true,
        custom: 'keep-me',
        tabs: [
          { title: 'Current', url: 'https://example.com/current' },
          { title: 'Saved history', url: 'https://example.com/history', panelTitle: 'History' },
        ],
      },
      {
        title: 'Untouched Tag',
        color: 'green',
        collapsed: false,
        tabs: [{ title: 'Untouched', url: 'https://example.com/untouched' }],
      },
    ],
  };
  const built = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      id: 10,
      title: 'Historical Tag',
      color: 'blue',
      tabs: [{ id: 101, title: 'Current', url: 'https://example.com/current' }],
    }],
  });
  const current = built.candidates.find((candidate) => candidate.source.live?.tabId === 101);

  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'AI Proposal', color: 'purple', tabIds: [current.id] }],
    now: 20,
  });

  assert.deepEqual(result, {
    version: 1,
    preserveGroups: true,
    updatedAt: 20,
    groups: [
      {
        title: 'Historical Tag',
        color: 'blue',
        collapsed: true,
        custom: 'keep-me',
        tabs: [{ title: 'Saved history', url: 'https://example.com/history', panelTitle: 'History' }],
      },
      {
        title: 'Untouched Tag',
        color: 'green',
        collapsed: false,
        tabs: [{ title: 'Untouched', url: 'https://example.com/untouched' }],
      },
      {
        title: 'AI Proposal',
        color: 'purple',
        collapsed: false,
        tabs: [{ title: 'Current', url: 'https://example.com/current' }],
      },
    ],
  });
  assert.deepEqual(snapshot.groups[0].tabs.map((tab) => tab.title), ['Current', 'Saved history']);
});

test('removes a source folder emptied by Auto Group while preserving pre-existing empty history', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Historical Folder / Only Tag',
        color: 'orange',
        collapsed: true,
        tabs: [{ title: 'Current', url: 'https://example.com/current' }],
      },
      {
        title: 'Kept Empty History',
        color: 'green',
        collapsed: false,
        custom: 'keep-me',
        tabs: [],
      },
    ],
  };
  const original = structuredClone(snapshot);
  const originalTabCount = snapshot.groups.reduce((total, group) => total + group.tabs.length, 0);
  const built = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      id: 10,
      title: 'Historical Folder / Only Tag',
      color: 'orange',
      tabs: [{ id: 101, title: 'Current', url: 'https://example.com/current' }],
    }],
  });

  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'New Work', color: 'cyan', tabIds: [1] }],
    now: 2,
  });

  assert.deepEqual(result.groups, [
    {
      title: 'Kept Empty History',
      color: 'green',
      collapsed: false,
      custom: 'keep-me',
      tabs: [],
    },
    {
      title: 'New Work',
      color: 'cyan',
      collapsed: false,
      tabs: [{ title: 'Current', url: 'https://example.com/current' }],
    },
  ]);
  assert.equal(
    result.groups.reduce((total, group) => total + group.tabs.length, 0),
    originalTabCount,
  );
  assert.deepEqual(snapshot, original);
});

test('absorbs empty same-named history into a populated planned target without deleting unrelated history', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Inbox',
        color: 'blue',
        tabs: [
          { title: 'Open page', url: 'https://example.com/open' },
          { title: 'Saved page', url: 'https://example.com/saved' },
        ],
      },
      {
        title: 'Project',
        color: 'purple',
        collapsed: true,
        custom: 'target-kept',
        tabs: [],
      },
      {
        title: ' project ',
        color: 'orange',
        collapsed: false,
        custom: 'duplicate-removed',
        tabs: [],
      },
      {
        title: 'Unrelated Empty History',
        color: 'green',
        collapsed: true,
        custom: 'unrelated-kept',
        tabs: [],
      },
    ],
  };
  const built = buildOrganizationCandidates({ snapshot, liveGroups: [] });

  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'Project', color: 'cyan', tabIds: [1, 2] }],
    now: 2,
  });

  assert.deepEqual(result.groups, [
    {
      title: 'Project',
      color: 'purple',
      collapsed: true,
      custom: 'target-kept',
      tabs: [
        { title: 'Open page', url: 'https://example.com/open' },
        { title: 'Saved page', url: 'https://example.com/saved' },
      ],
    },
    {
      title: 'Unrelated Empty History',
      color: 'green',
      collapsed: true,
      custom: 'unrelated-kept',
      tabs: [],
    },
  ]);
  assert.equal(result.groups.filter((group) => group.title.trim().toLowerCase() === 'project').length, 1);
});

test('moves an exact dormant duplicate once and leaves unplanned duplicates in place', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Alpha',
        color: 'blue',
        tabs: [
          { title: 'Duplicate A', url: 'https://example.com/shared' },
          { title: 'Alpha only', url: 'https://example.com/alpha' },
        ],
      },
      {
        title: 'Beta',
        color: 'green',
        tabs: [{ title: 'Duplicate B', url: 'https://example.com/shared' }],
      },
    ],
  };
  const built = buildOrganizationCandidates({ snapshot, liveGroups: [] });
  const duplicateB = built.candidates.find((candidate) => (
    candidate.title === 'Duplicate B' && candidate.currentGroup.title === 'Beta'
  ));

  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'Gamma', color: 'purple', tabIds: [duplicateB.id] }],
    now: 2,
  });
  const rows = result.groups.flatMap((group) => group.tabs.map((tab) => `${group.title}:${tab.title}:${tab.url}`));

  assert.deepEqual(rows, [
    'Alpha:Duplicate A:https://example.com/shared',
    'Alpha:Alpha only:https://example.com/alpha',
    'Gamma:Duplicate B:https://example.com/shared',
  ]);
  assert.equal(result.groups.find((group) => group.title === 'Beta'), undefined);
});

test('keeps planned rows in place when their confirmed group is unchanged', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      custom: 'unchanged',
      tabs: [
        { title: 'First', url: 'https://example.com/first' },
        { title: 'Second', url: 'https://example.com/second' },
      ],
    }],
  };
  const built = buildOrganizationCandidates({ snapshot, liveGroups: [] });

  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'Docs', color: 'purple', tabIds: [1] }],
    now: 99,
  });

  assert.deepEqual(result, snapshot);
  assert.notEqual(result, snapshot);
});

test('keeps same-named dormant Tags distinct when their planned title is unchanged', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        custom: 'first',
        tabs: [{ title: 'A', url: 'https://a.example/' }],
      },
      {
        title: 'Docs',
        color: 'blue',
        custom: 'second',
        tabs: [{ title: 'B', url: 'https://b.example/' }],
      },
    ],
  };
  const built = buildOrganizationCandidates({ snapshot });
  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'Docs', color: 'purple', tabIds: [1, 2] }],
  });

  assert.deepEqual(result.groups, snapshot.groups);
});

test('adds an unmatched planned live tab to the snapshot exactly once', () => {
  const built = buildOrganizationCandidates({
    snapshot: { version: 1, updatedAt: 1, groups: [] },
    liveGroups: [{
      id: 10,
      title: 'Open',
      color: 'blue',
      tabs: [{
        id: 101,
        title: 'Raw page title',
        displayTitle: 'Panel name',
        panelTitle: 'Panel name',
        url: 'https://example.com/live',
      }],
    }],
  });

  const result = applyOrganizationPlanToSnapshot({
    snapshot: { version: 1, updatedAt: 1, groups: [] },
    candidates: built.candidates,
    plannedGroups: [{ title: 'Planned', color: 'yellow', tabIds: [1] }],
    now: 2,
  });

  assert.deepEqual(result.groups[0].tabs, [{
    title: 'Raw page title',
    url: 'https://example.com/live',
    panelTitle: 'Panel name',
  }]);
});

test('rejects stale, unknown, and multiply assigned candidates without mutating input', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    }],
  };
  const original = structuredClone(snapshot);
  const built = buildOrganizationCandidates({ snapshot, liveGroups: [] });

  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [{ title: 'Other', tabIds: [999] }],
  }), /unknown candidate id/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: built.candidates,
    plannedGroups: [
      { title: 'One', tabIds: [1] },
      { title: 'Two', tabIds: [1] },
    ],
  }), /more than once/);

  const stale = structuredClone(built.candidates);
  stale[0].source.snapshot.url = 'https://example.com/changed';
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: stale,
    plannedGroups: [{ title: 'Other', tabIds: [1] }],
  }), /changed while the plan was open/);
  assert.deepEqual(snapshot, original);
});

test('rejects applying a preview when its exact snapshot URL query or hash changed', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'History',
      color: 'blue',
      tabs: [
        { title: 'First', url: 'https://example.com/item?id=1#one' },
        { title: 'Second', url: 'https://example.com/item?id=2#two' },
      ],
    }],
  };
  const built = buildOrganizationCandidates({ snapshot, liveGroups: [] });
  const changed = structuredClone(snapshot);
  changed.groups[0].tabs[0].url = 'https://example.com/item?id=2#two';
  const originalChanged = structuredClone(changed);

  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot: changed,
    candidates: built.candidates,
    plannedGroups: [{ title: 'New Tag', color: 'purple', tabIds: [1] }],
  }), /changed while the plan was open/);
  assert.deepEqual(changed, originalChanged);

  for (const url of [
    'https://example.com/item?id=9#one',
    'https://example.com/item?id=1#changed',
  ]) {
    const navigated = structuredClone(snapshot);
    navigated.groups[0].tabs[0].url = url;
    assert.throws(() => applyOrganizationPlanToSnapshot({
      snapshot: navigated,
      candidates: built.candidates,
      plannedGroups: [{ title: 'New Tag', color: 'purple', tabIds: [1] }],
    }), /changed while the plan was open/);
  }
});

test('candidate building gives malformed or untitled live and saved rows stable user-visible fallbacks', () => {
  const built = buildOrganizationCandidates({
    liveGroups: [
      {
        tabs: [{ id: null, title: '', url: '' }],
      },
      {
        title: 'Named',
        tabs: [{ id: 2, title: '', url: 'https://example.com/saved' }],
      },
    ],
    snapshot: {
      groups: [
        { title: '', tabs: [{ title: '', url: '' }] },
        { title: 'Named', tabs: [{ title: '', url: 'https://example.com/saved' }] },
      ],
    },
  });

  assert.equal(built.candidates.length, 3);
  assert.deepEqual(built.candidates[0], {
    id: 1,
    title: 'Untitled',
    pageTitle: 'Untitled',
    panelTitle: '',
    url: '',
    pinned: false,
    dormant: true,
    currentGroup: {
      id: null,
      key: 'snapshot:0:Ungrouped',
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      source: 'snapshot',
    },
    source: {
      kind: 'snapshot',
      snapshot: {
        groupIndex: 0,
        tabIndex: 0,
        groupTitle: 'Ungrouped',
        groupColor: 'grey',
        url: '',
      },
    },
  });
  assert.equal(built.candidates[1].title, 'https://example.com/saved');
  assert.equal(built.candidates[1].pageTitle, 'https://example.com/saved');
  assert.equal(built.candidates[1].dormant, false);
  assert.equal(built.candidates[1].currentGroup.color, 'blue');
  assert.equal(built.candidates[2].title, 'Untitled');
  assert.equal(built.candidates[2].pageTitle, 'Untitled');
  assert.equal(built.candidates[2].url, '');
  assert.equal(built.candidates[2].source.live.tabId, null);
  assert.equal(built.candidates[2].source.live.groupId, null);
  assert.match(built.fingerprint, /^organization-v3-/);
  assert.deepEqual(buildOrganizationCandidates(), buildOrganizationCandidates({ liveGroups: null }));
});

test('applying a plan normalizes malformed snapshots and joins an existing target without relocating history', () => {
  assert.deepEqual(applyOrganizationPlanToSnapshot(), {
    version: 1,
    updatedAt: 0,
    groups: [],
  });

  const snapshot = {
    version: 0,
    updatedAt: 'invalid',
    custom: 'preserved',
    groups: [
      { title: '', tabs: null, custom: 'empty-history' },
      {
        title: 'Target',
        color: 'orange',
        tabs: [{ title: 'Historical', url: 'https://example.com/history' }],
      },
    ],
  };
  const result = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [
      {
        id: 1,
        title: 'Panel alias',
        pageTitle: '',
        panelTitle: 'Panel alias',
        url: 'https://example.com/live-title',
        source: { kind: 'live', live: { tabId: 10 }, snapshot: null },
      },
      {
        id: 2,
        title: '',
        pageTitle: '',
        panelTitle: '',
        url: 'https://example.com/live-url',
        source: { kind: 'live', live: { tabId: 11 }, snapshot: null },
      },
    ],
    plannedGroups: [{ title: 'Target', color: '', tabIds: [1, 2] }],
    now: Number.NaN,
  });

  assert.equal(result.version, 1);
  assert.equal(result.updatedAt, 0);
  assert.equal(result.custom, 'preserved');
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0], { title: '', tabs: [], custom: 'empty-history' });
  assert.deepEqual(result.groups[1].tabs, [
    { title: 'Historical', url: 'https://example.com/history' },
    {
      title: 'https://example.com/live-title',
      panelTitle: 'Panel alias',
      url: 'https://example.com/live-title',
    },
    { title: 'https://example.com/live-url', url: 'https://example.com/live-url' },
  ]);
  assert.equal(snapshot.groups[1].tabs.length, 1);
});

test('applying a plan rejects corrupt candidate identities and snapshot locations before mutation', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Source',
      tabs: [{ title: 'One', url: 'https://example.com/one' }],
    }],
  };
  const original = structuredClone(snapshot);
  const snapshotCandidate = (id, snapshotSource) => ({
    id,
    title: 'One',
    pageTitle: 'One',
    url: 'https://example.com/one',
    source: { kind: 'snapshot', snapshot: snapshotSource },
  });

  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [
      snapshotCandidate(1, { groupIndex: 0, tabIndex: 0, url: 'https://example.com/one' }),
      snapshotCandidate(2, { groupIndex: 0, tabIndex: 0, url: 'https://example.com/one' }),
    ],
    plannedGroups: [{ title: 'Target', tabIds: [1, 2] }],
  }), /reuse snapshot row 0:0/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [snapshotCandidate(1, { groupIndex: -1, tabIndex: 0 })],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  }), /invalid snapshot location/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [snapshotCandidate(1, { groupIndex: 9, tabIndex: 0 })],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  }), /snapshot row 9:0 no longer exists/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [{ id: 1, source: { kind: 'unknown' } }],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  }), /has no usable source/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [{ id: 1, source: { kind: 'live' }, url: '' }],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  }), /has no URL to save/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [snapshotCandidate(1, { groupIndex: 0, tabIndex: 0 })],
    plannedGroups: [{ title: '', tabIds: [1] }],
  }), /group title is required/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [{ id: 0 }],
  }), /Invalid organization candidate id/);
  assert.throws(() => applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [{ id: 1 }, { id: 1 }],
  }), /Duplicate organization candidate id/);
  assert.deepEqual(snapshot, original);

  const moved = applyOrganizationPlanToSnapshot({
    snapshot,
    candidates: [snapshotCandidate(1, { groupIndex: 0, tabIndex: 0 })],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
    now: 5,
  });
  assert.equal(moved.groups[0].title, 'Target');
  assert.equal(moved.groups[0].tabs[0].url, 'https://example.com/one');
});

test('rebasing rejects two preview identities resolving to one current row and supports snapshot fallbacks', () => {
  const live = (id, tabId) => ({
    id,
    url: 'https://example.com/live',
    pinned: false,
    currentGroup: { title: 'Source' },
    source: { kind: 'live', live: { tabId }, snapshot: null },
  });
  assert.throws(() => rebaseOrganizationPlan({
    previewCandidates: [live(1, 10), live(2, 10)],
    currentCandidates: [live(9, 10)],
    plannedGroups: [{ title: 'Target', tabIds: [1, 2] }],
  }), /matched unambiguously/);

  const savedPreview = {
    id: 1,
    url: 'https://example.com/saved',
    pinned: false,
    currentGroup: { title: 'Saved' },
    source: { kind: 'snapshot', snapshot: {} },
  };
  const savedCurrent = { ...structuredClone(savedPreview), id: 7 };
  assert.deepEqual(rebaseOrganizationPlan({
    previewCandidates: [savedPreview],
    currentCandidates: [savedCurrent],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  })[0].tabIds, [7]);
  assert.deepEqual(rebaseOrganizationPlan({ plannedGroups: null }), []);
  assert.throws(() => rebaseOrganizationPlan({
    previewCandidates: [{ id: 1, currentGroup: { title: 'Saved' }, source: null }],
    currentCandidates: [],
    plannedGroups: [{ title: 'Target', tabIds: [1] }],
  }), /saved row changed or was removed/);
  assert.throws(() => rebaseOrganizationPlan({
    previewCandidates: [{ id: 0 }],
  }), /Invalid organization candidate id/);
  assert.throws(() => rebaseOrganizationPlan({
    previewCandidates: [{ id: 1 }, { id: 1 }],
  }), /Duplicate organization candidate id/);
});
