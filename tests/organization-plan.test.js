import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOrganizationPlanToSnapshot,
  buildOrganizationCandidates,
  rebaseOrganizationPlan,
} from '../src/shared/organization-plan.js';

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
  assert.match(first.fingerprint, /^organization-v2-[0-9a-f]{8}-5$/);
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

test('preserves an empty historical Tag when its only live row is regrouped', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Historical Tag',
      color: 'orange',
      collapsed: true,
      tabs: [{ title: 'Current', url: 'https://example.com/current' }],
    }],
  };
  const built = buildOrganizationCandidates({
    snapshot,
    liveGroups: [{
      id: 10,
      title: 'Historical Tag',
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
      title: 'Historical Tag',
      color: 'orange',
      collapsed: true,
      tabs: [],
    },
    {
      title: 'New Work',
      color: 'cyan',
      collapsed: false,
      tabs: [{ title: 'Current', url: 'https://example.com/current' }],
    },
  ]);
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
  assert.equal(result.groups.find((group) => group.title === 'Beta').tabs.length, 0);
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
