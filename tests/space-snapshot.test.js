import test from 'node:test';
import assert from 'node:assert/strict';

import { chromeGroupTitle } from '../src/shared/group-title.js';

import {
  clearableUngroupedTabs,
  buildSpaceSnapshot,
  combineDuplicateTagMergePlans,
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isRestorableSnapshotTab,
  isUngroupedSnapshotGroup,
  mergeDuplicateSnapshotTags,
  mergeOpenSpaceSnapshot,
  mergeSpaceSnapshot,
  removeSnapshotTabs,
  removeSnapshotTab,
  retitleSnapshotGroup,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
  snapshotHasPersistentContent,
  snapshotGroupShouldPersist,
  snapshotTabIdentitiesConflict,
  snapshotTabCount,
  uniqueSnapshotGroupForTabId,
  updateSnapshotTab,
} from '../src/shared/space-snapshot.js';

test('stable saved row lookup survives Chrome-shortened long Tag titles', () => {
  const groups = [{
    title: 'Auto Group Canonical Duplicate E2E',
    snapshotGroupId: 'group:canonical',
    tabs: [{ snapshotTabId: 'tab:stable', url: 'https://example.com' }],
  }];

  assert.equal(uniqueSnapshotGroupForTabId(groups, 'tab:stable'), groups[0]);
  assert.notEqual(groups[0].title, chromeGroupTitle(groups[0].title));
});

test('stable saved row lookup refuses missing and ambiguous identities', () => {
  const duplicate = { tabs: [{ snapshotTabId: 'tab:duplicate' }] };
  assert.equal(uniqueSnapshotGroupForTabId([duplicate], ''), null);
  assert.equal(uniqueSnapshotGroupForTabId([duplicate], 'tab:missing'), null);
  assert.equal(uniqueSnapshotGroupForTabId([null, {}, { tabs: [null] }], 'tab:missing'), null);
  assert.equal(
    uniqueSnapshotGroupForTabId([duplicate, structuredClone(duplicate)], 'tab:duplicate'),
    null,
  );
});

test('Tidy merges normalized duplicate Tags into the first Tag without losing rows or metadata', () => {
  const snapshot = {
    version: 1,
    identityVersion: 1,
    preserveGroups: true,
    updatedAt: 10,
    customRoot: { retained: true },
    groups: [
      {
        snapshotGroupId: 'tag-docs-first',
        title: '  Project   Docs ',
        color: 'purple',
        collapsed: true,
        customGroup: { owner: 'first' },
        tabs: [{
          snapshotTabId: 'row-first',
          title: 'First',
          url: 'https://example.test/first',
          panelTitle: 'Pinned name',
          customRow: { retained: 'first' },
        }],
      },
      {
        snapshotGroupId: 'tag-other',
        title: 'Other',
        color: 'green',
        collapsed: false,
        tabs: [{ snapshotTabId: 'row-other', title: 'Other', url: 'https://example.test/other' }],
      },
      {
        snapshotGroupId: 'tag-docs-second',
        title: 'project docs',
        color: 'red',
        collapsed: false,
        customGroup: { owner: 'duplicate-must-not-win' },
        tabs: [{
          snapshotTabId: 'row-second',
          title: 'Second',
          url: 'https://example.test/second?query=kept#hash',
          panelTitle: 'Second panel name',
          snapshotGroupId: 'tag-docs-second',
          customRow: { retained: 'second' },
        }],
      },
      {
        snapshotGroupId: 'tag-docs-third',
        title: 'PROJECT DOCS',
        color: 'yellow',
        tabs: [{
          snapshotTabId: 'row-third',
          title: 'Third',
          url: 'https://example.test/third',
          customRow: { retained: 'third' },
        }],
      },
    ],
  };
  const frozen = structuredClone(snapshot);

  const result = mergeDuplicateSnapshotTags(snapshot, 99);

  assert.deepEqual(snapshot, frozen, 'planning must not mutate saved user data');
  assert.equal(result.mergedCount, 2);
  assert.deepEqual(result.merges, [{
    title: '  Project   Docs ',
    mergedCount: 2,
    appendedRowCount: 2,
  }]);
  assert.deepEqual(result.snapshotGroupIdReplacements, {
    'tag-docs-second': 'tag-docs-first',
    'tag-docs-third': 'tag-docs-first',
  });
  assert.equal(result.snapshot.updatedAt, 99);
  assert.deepEqual(result.snapshot.customRoot, { retained: true });
  assert.deepEqual(result.snapshot.groups.map((group) => group.snapshotGroupId), [
    'tag-docs-first',
    'tag-other',
  ]);
  assert.deepEqual(result.snapshot.groups[0], {
    ...snapshot.groups[0],
    tabs: [
      snapshot.groups[0].tabs[0],
      { ...snapshot.groups[2].tabs[0], snapshotGroupId: 'tag-docs-first' },
      snapshot.groups[3].tabs[0],
    ],
  }, 'the first Tag metadata wins while every complete row stays in source order');
  assert.deepEqual(result.snapshot.groups[1], snapshot.groups[1]);
});

test('Tidy Tag merging leaves Ungrouped, unnamed, unique, and already tidy snapshots untouched', () => {
  const invalid = { version: 1, groups: null };
  assert.deepEqual(mergeDuplicateSnapshotTags(null, 1), {
    snapshot: null,
    mergedCount: 0,
    merges: [],
    snapshotGroupIdReplacements: {},
  });
  assert.deepEqual(mergeDuplicateSnapshotTags(invalid, 1), {
    snapshot: invalid,
    mergedCount: 0,
    merges: [],
    snapshotGroupIdReplacements: {},
  });

  const snapshot = {
    version: 1,
    updatedAt: 10,
    preserveGroups: true,
    groups: [
      { title: 'Ungrouped', color: 'grey', tabs: [{ title: 'A', url: 'https://a.test' }] },
      { title: ' ungrouped ', color: 'grey', tabs: [{ title: 'B', url: 'https://b.test' }] },
      { title: '', color: 'blue', tabs: [{ title: 'C', url: 'https://c.test' }] },
      { title: '   ', color: 'red', tabs: [{ title: 'D', url: 'https://d.test' }] },
      { title: 'Unique', color: 'green', tabs: [] },
    ],
  };
  const result = mergeDuplicateSnapshotTags(snapshot, Number.NaN);
  assert.strictEqual(result.snapshot, snapshot);
  assert.deepEqual(result, {
    snapshot,
    mergedCount: 0,
    merges: [],
    snapshotGroupIdReplacements: {},
  });
});

test('Tidy Tag merging keeps the canonical identity when duplicate legacy metadata has no safe remap', () => {
  const snapshot = {
    version: 1,
    updatedAt: 4,
    groups: [
      { snapshotGroupId: 'canonical', title: 'Docs', color: 'blue', tabs: [] },
      { title: ' docs ', color: 'red', tabs: { malformed: true } },
      { snapshotGroupId: 'canonical', title: 'DOCS', color: 'yellow', tabs: [] },
      { title: 'Legacy', color: 'green', tabs: [] },
      { snapshotGroupId: 'later-legacy-id', title: ' legacy ', color: 'cyan', tabs: [] },
    ],
  };
  const result = mergeDuplicateSnapshotTags(snapshot, 'invalid');
  assert.equal(result.snapshot.updatedAt, 4);
  assert.equal(result.mergedCount, 3);
  assert.deepEqual(result.snapshotGroupIdReplacements, {});
  assert.deepEqual(result.snapshot.groups, [snapshot.groups[0], snapshot.groups[3]]);
});

test('Tidy previews the union of saved and live duplicate Tags without double-counting a shared title', () => {
  assert.deepEqual(combineDuplicateTagMergePlans(
    [
      { title: ' Docs ', mergedCount: 1, appendedRowCount: 2 },
      { title: 'Saved only', mergedCount: 2, appendedRowCount: 0 },
    ],
    [
      { title: 'docs', mergedCount: 2 },
      { title: 'Live only', mergedCount: 1 },
    ],
  ), {
    mergedCount: 5,
    merges: [
      {
        title: ' Docs ',
        snapshotMergedCount: 1,
        liveMergedCount: 2,
        appendedRowCount: 2,
        mergedCount: 2,
      },
      {
        title: 'Saved only',
        snapshotMergedCount: 2,
        liveMergedCount: 0,
        appendedRowCount: 0,
        mergedCount: 2,
      },
      {
        title: 'Live only',
        snapshotMergedCount: 0,
        liveMergedCount: 1,
        appendedRowCount: 0,
        mergedCount: 1,
      },
    ],
  });

  assert.deepEqual(combineDuplicateTagMergePlans(
    [
      null,
      { title: '', mergedCount: 9 },
      { title: 'No count' },
      { title: 'Docs', mergedCount: -2, appendedRowCount: -1 },
      { title: ' docs ', mergedCount: 1.9, appendedRowCount: 3.8 },
    ],
    { malformed: true },
  ), {
    mergedCount: 1,
    merges: [{
      title: 'Docs',
      snapshotMergedCount: 1,
      liveMergedCount: 0,
      appendedRowCount: 3,
      mergedCount: 1,
    }],
  });
  assert.deepEqual(combineDuplicateTagMergePlans(null, null), { mergedCount: 0, merges: [] });
});

test('live snapshot refresh keeps stored extension metadata while Chrome fields stay authoritative', () => {
  const merged = mergeSpaceSnapshot({
    version: 1,
    updatedAt: 2,
    groups: [{
      snapshotGroupId: 'docs',
      title: 'Docs',
      color: 'green',
      collapsed: false,
      tabs: [{ snapshotTabId: 'open', title: 'Open', url: 'https://example.test/open' }],
    }],
  }, {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'docs',
      title: 'Old title',
      color: 'purple',
      collapsed: true,
      customGroup: { retained: true },
      tabs: [{ snapshotTabId: 'open', title: 'Saved', url: 'https://example.test/open' }],
    }],
  });

  assert.equal(merged.groups[0].title, 'Docs');
  assert.equal(merged.groups[0].color, 'green');
  assert.equal(merged.groups[0].collapsed, false);
  assert.deepEqual(merged.groups[0].customGroup, { retained: true });
});

test('snapshots a Space as TabGroup -> Tab restore data', () => {
  const snapshot = buildSpaceSnapshot({
    view: [
      {
        id: 4,
        title: 'Docs',
        color: 'blue',
        collapsed: true,
        key: 'group:4',
        tabs: [
          { id: 1, title: 'A', url: 'https://example.com/a', pinned: false },
          { id: 2, title: 'B', url: 'https://example.com/b#section', pinned: false },
        ],
      },
      {
        id: 'ungrouped',
        title: 'Ungrouped',
        color: 'grey',
        key: 'ungrouped',
        tabs: [
          { id: 3, title: 'Chrome', url: 'chrome://extensions', pinned: false },
          { id: 4, title: 'Pinned', url: 'https://example.com/pinned', pinned: true },
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.groups, [
    {
      title: 'Docs',
      color: 'blue',
      collapsed: true,
      tabs: [
        { title: 'A', url: 'https://example.com/a' },
        { title: 'B', url: 'https://example.com/b#section' },
      ],
    },
  ]);
});

test('snapshots panel-only tab names without replacing the page title', () => {
  const snapshot = buildSpaceSnapshot({
    view: [
      {
        title: 'Servers',
        color: 'blue',
        tabs: [
          {
            id: 1,
            title: '67.216.201.49 - 入站',
            displayTitle: '3X-UI',
            panelTitle: '3X-UI',
            url: 'https://67.216.201.49:44374/secret/panel/inbounds',
          },
          {
            id: 2,
            title: '',
            displayTitle: 'Private dashboard',
            panelTitle: 'Private dashboard',
            url: 'https://example.com/dashboard',
          },
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.groups[0].tabs, [
    {
      title: '67.216.201.49 - 入站',
      panelTitle: '3X-UI',
      url: 'https://67.216.201.49:44374/secret/panel/inbounds',
    },
    {
      title: 'https://example.com/dashboard',
      panelTitle: 'Private dashboard',
      url: 'https://example.com/dashboard',
    },
  ]);
});

test('preserves stable lifecycle identities while refreshing an open snapshot', () => {
  const snapshot = mergeOpenSpaceSnapshot([{
    title: 'Docs',
    color: 'blue',
    collapsed: true,
    snapshotGroupId: 'snapshot-group-docs',
    tabs: [{
      id: 42,
      title: 'Live title',
      displayTitle: 'My spec',
      panelTitle: 'My spec',
      url: 'https://example.com/spec',
      pinned: false,
      snapshotTabId: 'snapshot-tab-spec',
    }],
  }], {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      collapsed: false,
      snapshotGroupId: 'snapshot-group-docs',
      tabs: [{
        title: 'Stored title',
        panelTitle: 'Old panel name',
        url: 'https://example.com/spec',
        snapshotTabId: 'snapshot-tab-spec',
      }],
    }],
  });

  assert.deepEqual(snapshot, {
    version: 1,
    identityVersion: 1,
    updatedAt: snapshot.updatedAt,
    groups: [{
      title: 'Docs',
      color: 'blue',
      collapsed: true,
      snapshotGroupId: 'snapshot-group-docs',
      tabs: [{
        title: 'Live title',
        panelTitle: 'My spec',
        url: 'https://example.com/spec',
        snapshotTabId: 'snapshot-tab-spec',
      }],
    }],
  });
});

test('identity-aware snapshots retain distinct same-URL tabs while legacy snapshots stay deduplicated', () => {
  const snapshot = buildSpaceSnapshot({
    now: 10,
    view: [{
      title: 'Duplicates',
      color: 'purple',
      snapshotGroupId: 'snapshot-group-duplicates',
      tabs: [
        {
          title: 'First copy',
          url: 'https://example.com/same',
          snapshotTabId: 'snapshot-tab-first',
        },
        {
          title: 'Second copy',
          url: 'https://example.com/same',
          snapshotTabId: 'snapshot-tab-second',
        },
      ],
    }],
  });

  assert.equal(snapshot.identityVersion, 1);
  assert.equal(sanitizeSpaceSnapshot(snapshot).groups[0].tabs.length, 2);
  assert.equal(sanitizeSpaceSnapshot({
    ...snapshot,
    identityVersion: 0,
    groups: snapshot.groups.map((group) => ({
      ...group,
      tabs: group.tabs.map(({ snapshotTabId, ...tab }) => tab),
    })),
  }).groups[0].tabs.length, 1);
  assert.equal(mergeSpaceSnapshot({
    version: 1,
    updatedAt: 11,
    groups: [{
      title: 'Live only',
      color: 'blue',
      tabs: [{ title: 'Live', url: 'https://example.com/live' }],
    }],
  }, snapshot).identityVersion, 1, 'stored identity metadata survives a legacy live input');
});

test('stable tab identity treats a navigation raced with panel refresh as one row', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'group-docs',
      title: 'Docs',
      color: 'blue',
      collapsed: false,
      tabs: [
        { snapshotTabId: 'row-live', title: 'Old page', url: 'https://example.com/old' },
        { snapshotTabId: 'row-dormant', title: 'Saved', url: 'https://example.com/saved' },
      ],
    }],
  };

  const merged = mergeOpenSpaceSnapshot([{
    snapshotGroupId: 'group-docs',
    title: 'Docs',
    color: 'blue',
    tabs: [{
      id: 10,
      snapshotTabId: 'row-live',
      title: 'New page',
      url: 'https://example.com/new',
    }],
  }], stored);

  assert.deepEqual(merged.groups[0].tabs, [
    { snapshotTabId: 'row-live', title: 'New page', url: 'https://example.com/new' },
    { snapshotTabId: 'row-dormant', title: 'Saved', url: 'https://example.com/saved' },
  ]);
});

test('opening a saved row preserves its exact position between dormant siblings', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'group-docs',
      title: 'Docs',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'row-a', title: 'A saved', url: 'https://example.com/a' },
        { snapshotTabId: 'row-b', title: 'B saved', url: 'https://example.com/b' },
        { snapshotTabId: 'row-c', title: 'C saved', url: 'https://example.com/c' },
      ],
    }],
  };

  const merged = mergeOpenSpaceSnapshot([{
    snapshotGroupId: 'group-docs',
    title: 'Docs',
    color: 'blue',
    tabs: [{
      id: 20,
      snapshotTabId: 'row-b',
      title: 'B live',
      url: 'https://example.com/b',
    }],
  }], stored);

  assert.deepEqual(merged.groups[0].tabs, [
    { snapshotTabId: 'row-a', title: 'A saved', url: 'https://example.com/a' },
    { snapshotTabId: 'row-b', title: 'B live', url: 'https://example.com/b' },
    { snapshotTabId: 'row-c', title: 'C saved', url: 'https://example.com/c' },
  ]);
});

test('stable group identity keeps same-title same-color groups separate during refresh', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [
      {
        snapshotGroupId: 'group-a', title: 'Same', color: 'blue', collapsed: false,
        tabs: [
          { snapshotTabId: 'row-a-live', title: 'A old', url: 'https://same.test/item' },
          { snapshotTabId: 'row-a-saved', title: 'A saved', url: 'https://a.test/saved' },
        ],
      },
      {
        snapshotGroupId: 'group-b', title: 'Same', color: 'blue', collapsed: false,
        tabs: [
          { snapshotTabId: 'row-b-live', title: 'B old', url: 'https://same.test/item' },
          { snapshotTabId: 'row-b-saved', title: 'B saved', url: 'https://b.test/saved' },
        ],
      },
    ],
  };
  const live = {
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [
      {
        snapshotGroupId: 'group-b', title: 'Same', color: 'blue', collapsed: false,
        tabs: [{ snapshotTabId: 'row-b-live', title: 'B new', url: 'https://b.test/new' }],
      },
      {
        snapshotGroupId: 'group-a', title: 'Same', color: 'blue', collapsed: false,
        tabs: [{ snapshotTabId: 'row-a-live', title: 'A new', url: 'https://a.test/new' }],
      },
    ],
  };

  const merged = mergeSpaceSnapshot(live, stored);
  assert.deepEqual(merged.groups.map((group) => ({
    id: group.snapshotGroupId,
    tabs: group.tabs.map((tab) => tab.snapshotTabId),
  })), [
    { id: 'group-a', tabs: ['row-a-live', 'row-a-saved'] },
    { id: 'group-b', tabs: ['row-b-live', 'row-b-saved'] },
  ]);
});

test('same-title saved and live Tags with different stable identities remain visible to Tidy', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'saved-tag', title: 'Docs', color: 'blue',
      tabs: [{ snapshotTabId: 'saved-row', title: 'Saved', url: 'https://example.test/saved' }],
    }],
  };
  const live = {
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [{
      snapshotGroupId: 'live-tag', title: 'Docs', color: 'blue',
      tabs: [{ snapshotTabId: 'live-row', title: 'Live', url: 'https://example.test/live' }],
    }],
  };

  const refreshed = mergeSpaceSnapshot(live, stored);
  assert.deepEqual(refreshed.groups.map((group) => group.snapshotGroupId), [
    'saved-tag', 'live-tag',
  ]);
  const tidyPlan = mergeDuplicateSnapshotTags(refreshed);
  assert.equal(tidyPlan.mergedCount, 1);
  assert.deepEqual(tidyPlan.snapshot.groups.map((group) => ({
    id: group.snapshotGroupId,
    rows: group.tabs.map((tab) => tab.snapshotTabId),
  })), [{ id: 'saved-tag', rows: ['saved-row', 'live-row'] }]);
});

test('duplicate live claims for one stable group preserve every row instead of overwriting a group', () => {
  const live = {
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [
      {
        snapshotGroupId: 'group-shared', title: 'Shared', color: 'blue',
        tabs: [{ snapshotTabId: 'row-a', title: 'A live', url: 'https://shared.test/a' }],
      },
      {
        snapshotGroupId: 'group-shared', title: 'Shared', color: 'blue',
        tabs: [{ snapshotTabId: 'row-b', title: 'B live', url: 'https://shared.test/b' }],
      },
    ],
  };
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'group-shared', title: 'Shared', color: 'blue',
      tabs: [
        { snapshotTabId: 'row-a', title: 'A stored', url: 'https://shared.test/a' },
        { snapshotTabId: 'row-b', title: 'B stored', url: 'https://shared.test/b' },
        { snapshotTabId: 'row-saved', title: 'Saved', url: 'https://shared.test/saved' },
      ],
    }],
  };

  assert.deepEqual(
    mergeSpaceSnapshot(live, stored).groups[0].tabs.map((tab) => tab.snapshotTabId),
    ['row-a', 'row-b', 'row-saved'],
  );
});

test('keeps a renamed stable group when its tab identity and URL still agree', () => {
  const merged = mergeSpaceSnapshot({
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [{
      snapshotGroupId: 'renamed-group',
      title: 'New name',
      color: 'cyan',
      tabs: [{
        snapshotTabId: 'shared-row',
        title: 'Live page',
        url: 'https://rename.test/page',
      }],
    }],
  }, {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'renamed-group',
      title: 'Old name',
      color: 'purple',
      tabs: [
        { snapshotTabId: 'shared-row', title: 'Stored page', url: 'https://rename.test/page' },
        { snapshotTabId: 'saved-row', title: 'Saved page', url: 'https://rename.test/saved' },
      ],
    }],
  });

  assert.deepEqual(merged.groups, [{
    snapshotGroupId: 'renamed-group',
    title: 'New name',
    color: 'cyan',
    tabs: [
      { snapshotTabId: 'shared-row', title: 'Live page', url: 'https://rename.test/page' },
      { snapshotTabId: 'saved-row', title: 'Saved page', url: 'https://rename.test/saved' },
    ],
  }]);
});

test('a unique stable tab identity stays authoritative across navigation and group changes', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [
      {
        snapshotGroupId: 'stale-group',
        title: 'Historical',
        color: 'purple',
        collapsed: false,
        tabs: [
          {
            snapshotTabId: 'stale-row',
            title: 'Historical page',
            url: 'https://history.test/old',
          },
          { title: 'Legacy history', url: 'https://history.test/legacy' },
        ],
      },
      {
        title: 'Current Group',
        color: 'cyan',
        collapsed: false,
        tabs: [
          { title: 'Current page', url: 'https://current.test/page' },
          { title: 'Second current page', url: 'https://current.test/second' },
          { title: 'Saved page', url: 'https://current.test/saved' },
        ],
      },
    ],
  };
  const live = {
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [{
      snapshotGroupId: 'stale-group',
      title: 'Current Group',
      color: 'cyan',
      collapsed: false,
      tabs: [
        {
          snapshotTabId: 'stale-row',
          title: 'Current page',
          url: 'https://current.test/page',
        },
        { title: 'Second current page', url: 'https://current.test/second' },
      ],
    }],
  };

  const merged = mergeSpaceSnapshot(live, stored);
  assert.deepEqual(merged.groups.map((group) => ({
    title: group.title,
    rows: group.tabs.map((tab) => ({ id: tab.snapshotTabId || '', url: tab.url })),
  })), [
    {
      title: 'Historical',
      rows: [{ id: '', url: 'https://history.test/legacy' }],
    },
    {
      title: 'Current Group',
      rows: [
        { id: '', url: 'https://current.test/page' },
        { id: '', url: 'https://current.test/second' },
        { id: '', url: 'https://current.test/saved' },
        { id: 'stale-row', url: 'https://current.test/page' },
      ],
    },
  ]);
  assert.equal(merged.groups.flatMap((group) => group.tabs)
    .filter((tab) => tab.snapshotTabId === 'stale-row').length, 1);
});

test('stable removal survives simultaneous navigation and group changes', () => {
  const snapshot = {
    version: 1,
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'old-group',
      title: 'Old',
      color: 'purple',
      tabs: [
        { snapshotTabId: 'row-a', title: 'Old page', url: 'https://old.test/page' },
        { snapshotTabId: 'row-b', title: 'Keep', url: 'https://keep.test/page' },
      ],
    }],
  };

  const removed = removeSnapshotTabs(snapshot, [{
    snapshotTabId: 'row-a',
    groupTitle: 'New',
    groupColor: 'cyan',
    url: 'https://new.test/page',
  }]);

  assert.deepEqual(removed.groups[0].tabs.map((tab) => tab.snapshotTabId), ['row-b']);
});

test('auto closes only unpinned tabs that can be durably reopened', () => {
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'http://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'chrome://extensions', pinned: false }), false);
  assert.equal(shouldAutoCloseTab({ url: 'chrome-extension://abc/page.html', pinned: false }), false);
  assert.equal(shouldAutoCloseTab({ url: 'file:///tmp/report.pdf', pinned: false }), false);
  assert.equal(shouldAutoCloseTab(
    { url: 'file:///tmp/report.pdf', pinned: false },
    { fileSchemeAccess: true },
  ), true);
  for (const url of ['blob:https://example.com/id', 'data:text/plain,large', 'about:blank', 'javascript:alert(1)', 'not a url']) {
    assert.equal(shouldAutoCloseTab({ url, pinned: false }), false);
    assert.equal(isRestorableSnapshotTab({ url }), false);
  }
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: true }), false);
});

test('clears only local restorable ungrouped tabs without coercing foreign markers', () => {
  const tabs = [
    { id: 1, url: 'https://example.com/local' },
    { id: 2, url: 'http://example.com/local', foreignWindowTabId: null },
    { id: 3, url: 'https://example.com/string-marker', foreignWindowTabId: '5' },
    { id: 4, url: 'https://example.com/foreign-zero', foreignWindowTabId: 0 },
    { id: 5, url: 'https://example.com/foreign', foreignWindowTabId: 5 },
    { id: 6, url: 'https://example.com/pinned', pinned: true },
    { id: 7, url: 'chrome://extensions' },
    { id: 8, url: 'data:text/plain,keep' },
    { id: 9, url: 'file:///tmp/keep-without-access.pdf' },
  ];

  assert.deepEqual(clearableUngroupedTabs(tabs).map((tab) => tab.id), [1, 2, 3]);
  assert.deepEqual(clearableUngroupedTabs(tabs, { fileSchemeAccess: true }).map((tab) => tab.id), [1, 2, 3, 9]);
  assert.deepEqual(clearableUngroupedTabs(null), []);
});

test('drops temporary ungrouped tabs from a stored snapshot', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
      },
      {
        title: 'Ungrouped',
        color: 'grey',
        tabs: [{ title: 'Search', url: 'https://google.com' }],
      },
    ],
  };

  assert.deepEqual(dropTemporarySnapshotGroups(snapshot), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
      },
    ],
  });
});

test('keeps restorable ungrouped tabs from a stored snapshot', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Ungrouped',
        color: 'grey',
        restorable: true,
        tabs: [{ title: 'Loose', url: 'https://example.com/loose' }],
      },
    ],
  };

  assert.deepEqual(dropTemporarySnapshotGroups(snapshot), snapshot);
  assert.deepEqual(mergeOpenSpaceSnapshot([], snapshot), snapshot);
});

test('open Space refresh preserves portable top-level snapshot metadata', () => {
  const snapshot = mergeOpenSpaceSnapshot([{
    key: 'group:7',
    snapshotGroupId: 'stable-docs',
    title: 'Docs',
    color: 'blue',
    collapsed: false,
    tabs: [{
      id: 7,
      snapshotTabId: 'stable-row',
      snapshotGroupId: 'stable-docs',
      title: 'Spec',
      url: 'https://example.com/spec',
    }],
  }], {
    version: 1,
    identityVersion: 1,
    preserveGroups: true,
    updatedAt: 1,
    customMetadata: { importer: 'future-version', revision: 9 },
    groups: [{
      snapshotGroupId: 'stable-docs',
      title: 'Docs',
      color: 'blue',
      collapsed: false,
      tabs: [{
        snapshotTabId: 'stable-row',
        title: 'Spec',
        url: 'https://example.com/spec',
      }],
    }],
  });

  assert.deepEqual(snapshot.customMetadata, {
    importer: 'future-version',
    revision: 9,
  });
  assert.equal(snapshot.groups[0].tabs[0].snapshotTabId, 'stable-row');
});

test('open Space snapshots preserve live ungrouped tabs while dropping stored-only ungrouped rows', () => {
  const snapshot = mergeOpenSpaceSnapshot([
    {
      title: 'Docs',
      color: 'blue',
      collapsed: true,
      key: 'group:4',
      tabs: [{ id: 1, title: 'Spec', url: 'https://example.com/spec', pinned: false }],
    },
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      key: 'ungrouped',
      tabs: [
        { id: 2, title: 'Loose', url: 'https://example.com/loose', pinned: false },
        { id: 3, title: 'New Tab', url: 'chrome://newtab', pinned: false },
      ],
    },
  ], {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Ungrouped',
        color: 'grey',
        tabs: [{ title: 'Legacy temporary', url: 'https://example.com/legacy' }],
      },
      {
        title: 'Saved',
        color: 'green',
        tabs: [{ title: 'Saved dormant', url: 'https://example.com/saved' }],
      },
    ],
  });

  assert.deepEqual(snapshot.groups, [
    {
      title: 'Saved',
      color: 'green',
      tabs: [{ title: 'Saved dormant', url: 'https://example.com/saved' }],
    },
    {
      title: 'Docs',
      color: 'blue',
      collapsed: true,
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    },
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      restorable: true,
      tabs: [{ title: 'Loose', url: 'https://example.com/loose' }],
    },
  ]);
});

test('a vanished Chrome group reconciles its stable live row as ungrouped instead of a cached Tag ghost', () => {
  const snapshot = mergeOpenSpaceSnapshot([{
    key: 'ungrouped',
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    snapshotGroupId: 'stable-docs',
    tabs: [{
      id: 1,
      title: 'Spec',
      url: 'https://example.com/spec',
      snapshotTabId: 'row-spec',
      snapshotGroupId: 'stable-docs',
    }],
  }], {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      collapsed: true,
      snapshotGroupId: 'stable-docs',
      tabs: [{
        title: 'Spec',
        url: 'https://example.com/spec',
        snapshotTabId: 'row-spec',
      }],
    }],
  });

  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].title, 'Ungrouped');
  assert.equal(snapshot.groups[0].color, 'grey');
  assert.equal(snapshot.groups[0].snapshotGroupId, 'stable-docs');
  assert.equal(snapshot.groups[0].tabs.length, 1);
});

test('mergeOpenSpaceSnapshot consumes one exact live row without dropping query/hash history', () => {
  const snapshot = mergeOpenSpaceSnapshot([{
    title: 'History',
    color: 'blue',
    collapsed: false,
    tabs: [{
      id: 2,
      title: 'Item 2 live',
      url: 'https://app.test/item?id=2',
      pinned: false,
    }],
  }], {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'History',
      color: 'blue',
      collapsed: true,
      tabs: [
        { title: 'Item 1 saved', url: 'https://app.test/item?id=1' },
        { title: 'Item 2 saved', url: 'https://app.test/item?id=2' },
        { title: 'Third section saved', url: 'https://app.test/item#third' },
      ],
    }],
  });

  assert.deepEqual(snapshot.groups, [{
    title: 'History',
    color: 'blue',
    collapsed: false,
    tabs: [
      { title: 'Item 1 saved', url: 'https://app.test/item?id=1' },
      { title: 'Item 2 live', url: 'https://app.test/item?id=2' },
      { title: 'Third section saved', url: 'https://app.test/item#third' },
    ],
  }]);
  assert.equal(snapshotTabCount(snapshot), 3);
});

test('different stable tab identities never consume saved rows by exact or fallback URL', () => {
  const stored = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'group-history',
      title: 'History',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'saved-exact', title: 'Saved exact', url: 'https://app.test/exact' },
        { snapshotTabId: 'saved-query', title: 'Saved query', url: 'https://app.test/item?id=saved' },
        { snapshotTabId: 'saved-hash', title: 'Saved section', url: 'https://app.test/docs#saved' },
      ],
    }],
  };
  const live = {
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [{
      snapshotGroupId: 'group-history',
      title: 'History',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'live-exact', title: 'Live exact', url: 'https://app.test/exact' },
        { snapshotTabId: 'live-query', title: 'Live query', url: 'https://app.test/item?id=live' },
        { snapshotTabId: 'live-hash', title: 'Live section', url: 'https://app.test/docs#live' },
      ],
    }],
  };

  const merged = mergeSpaceSnapshot(live, stored);

  assert.deepEqual(merged.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'saved-exact',
    'saved-query',
    'saved-hash',
    'live-exact',
    'live-query',
    'live-hash',
  ]);
  assert.equal(snapshotTabCount(merged), 6);
});

test('URL matching skips a conflicting stable row but can consume a compatible legacy row', () => {
  const merged = mergeSpaceSnapshot({
    version: 1,
    identityVersion: 1,
    updatedAt: 2,
    groups: [{
      title: 'Docs',
      color: 'blue',
      tabs: [{ snapshotTabId: 'live-row', title: 'Live', url: 'https://same.test/page' }],
    }],
  }, {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      tabs: [
        { snapshotTabId: 'saved-row', title: 'Saved stable', url: 'https://same.test/page' },
        { title: 'Legacy duplicate', url: 'https://same.test/page' },
      ],
    }],
  });

  assert.deepEqual(merged.groups[0].tabs.map((tab) => tab.snapshotTabId || ''), [
    'saved-row',
    'live-row',
  ]);
});

test('stable tab identity conflicts require two distinct non-empty identities', () => {
  assert.equal(snapshotTabIdentitiesConflict(), false);
  assert.equal(snapshotTabIdentitiesConflict(null, { snapshotTabId: 'right' }), false);
  assert.equal(snapshotTabIdentitiesConflict({ snapshotTabId: 'left' }, null), false);
  assert.equal(snapshotTabIdentitiesConflict(
    { snapshotTabId: ' row ' },
    { snapshotTabId: 'row' },
  ), false);
  assert.equal(snapshotTabIdentitiesConflict(
    { snapshotTabId: 'left' },
    { snapshotTabId: 'right' },
  ), true);
});

test('sanitizes invalid and new-tab placeholder rows from stored grouped snapshots', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Bigmodel',
        color: 'blue',
        tabs: [
          { title: '智谱AI开放平台', url: 'https://bigmodel.cn/glm-coding' },
          { title: 'Untitled' },
          { title: 'New Tab', url: 'chrome://newtab' },
          { title: '', url: '   ' },
        ],
      },
      {
        title: 'Only placeholders',
        color: 'grey',
        tabs: [
          { title: 'Untitled' },
          { title: 'New Tab', url: 'chrome://newtab' },
        ],
      },
    ],
  };

  assert.deepEqual(sanitizeSpaceSnapshot(snapshot), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Bigmodel',
        color: 'blue',
        tabs: [
          { title: '智谱AI开放平台', url: 'https://bigmodel.cn/glm-coding' },
        ],
      },
    ],
  });
});

test('never persists the trailing-slash new-tab URL returned by real Chrome', () => {
  const snapshot = buildSpaceSnapshot({
    view: [{
      title: 'Ungrouped',
      color: 'grey',
      tabs: [
        { id: 1, title: 'New Tab', url: 'chrome://newtab/' },
        { id: 2, title: 'Keep me', url: 'https://example.com/real-page' },
      ],
    }],
  });

  assert.deepEqual(snapshot.groups[0].tabs.map((tab) => tab.url), [
    'https://example.com/real-page',
  ]);
  assert.equal(isRestorableSnapshotTab({ url: 'chrome://newtab/' }), false);
});

test('trims snapshot URLs, fills default metadata, and counts remaining tabs', () => {
  const snapshot = sanitizeSpaceSnapshot({
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: '',
        tabs: [
          { title: '', url: ' https://example.com/a ' },
          { title: 'New tab', url: 'chrome://newtab' },
        ],
      },
      {
        title: 'No tabs',
        color: 'purple',
        tabs: [{ title: '', url: '   ' }],
      },
    ],
  });

  assert.deepEqual(snapshot, {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: '',
        color: 'blue',
        tabs: [{ title: ' https://example.com/a ', url: 'https://example.com/a' }],
      },
    ],
  });
  assert.equal(snapshotTabCount(snapshot), 1);
  assert.equal(isRestorableSnapshotTab({ url: 'chrome://newtab' }), false);
  assert.equal(isRestorableSnapshotTab({ url: 'chrome-extension://abc/sidepanel.html?layout=workbench' }), false);
  assert.equal(isRestorableSnapshotTab({ url: ' file:///tmp/demo.html ' }), true);
  assert.equal(isRestorableSnapshotTab({ url: 'https://example.com' }), true);
  assert.equal(isRestorableSnapshotTab({ url: 'http://example.com' }), true);
});

test('preserves an explicitly empty Chrome group title through build, sanitize, and merge', () => {
  const built = buildSpaceSnapshot({
    now: 10,
    view: [{
      snapshotGroupId: 'untitled-group',
      title: '',
      color: 'cyan',
      tabs: [{
        snapshotTabId: 'live-row',
        title: 'Live',
        url: 'https://example.com/live',
      }],
    }],
  });
  assert.equal(built.groups[0].title, '');
  assert.equal(built.groups[0].restorable, undefined);
  assert.equal(isUngroupedSnapshotGroup(built.groups[0]), false);

  const sanitized = sanitizeSpaceSnapshot({
    ...built,
    preserveGroups: true,
    groups: [
      built.groups[0],
      { snapshotGroupId: 'empty-tag', title: '', color: 'orange', tabs: [] },
      { snapshotGroupId: 'missing-title', color: 'grey', tabs: [] },
    ],
  });
  assert.deepEqual(sanitized.groups.map(({ title, color }) => ({ title, color })), [
    { title: '', color: 'cyan' },
    { title: '', color: 'orange' },
  ]);

  const merged = mergeSpaceSnapshot(built, {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      snapshotGroupId: 'untitled-group',
      title: '',
      color: 'cyan',
      tabs: [
        { snapshotTabId: 'live-row', title: 'Old live', url: 'https://example.com/live' },
        { snapshotTabId: 'saved-row', title: 'Saved', url: 'https://example.com/saved' },
      ],
    }],
  });
  assert.equal(merged.groups[0].title, '');
  assert.deepEqual(merged.groups[0].tabs.map((tab) => tab.snapshotTabId), [
    'live-row',
    'saved-row',
  ]);
});

test('removes extension-owned pages from old Space snapshots', () => {
  const snapshot = sanitizeSpaceSnapshot({
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Pbknggfleiabfibnhebdkgmghlagiohp',
      color: 'pink',
      tabs: [{
        title: 'Space',
        url: 'chrome-extension://pbknggfleiabfibnhebdkgmghlagiohp/sidepanel.html?layout=workbench',
      }],
    }],
  });

  assert.deepEqual(snapshot.groups, []);
});

test('sanitizing preserves query and hash identities while deduplicating exact URLs', () => {
  const snapshot = sanitizeSpaceSnapshot({
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'History',
        color: 'blue',
        tabs: [
          { title: 'Item 1', url: 'https://app.test/item?id=1' },
          { title: 'Item 2', url: 'https://app.test/item?id=2' },
          { title: 'Third section', url: 'https://app.test/item#third' },
          { title: 'Exact duplicate is ignored', url: 'https://app.test/item?id=1' },
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.groups[0].tabs, [
    { title: 'Item 1', url: 'https://app.test/item?id=1' },
    { title: 'Item 2', url: 'https://app.test/item?id=2' },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);
});

test('keeps the same normalized URL in different snapshot groups', () => {
  const snapshot = sanitizeSpaceSnapshot({
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Primary',
        color: 'blue',
        tabs: [{ title: 'Spec A', url: 'https://example.com/spec?view=a' }],
      },
      {
        title: 'Reference',
        color: 'green',
        tabs: [{ title: 'Spec B', url: 'https://example.com/spec?view=b' }],
      },
    ],
  });

  assert.equal(snapshotTabCount(snapshot), 2);
});

test('keeps the full logical title when Chrome reports its compact physical title', () => {
  const logicalTitle = `${'研究'.repeat(16)}甲`;
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [{
      title: chromeGroupTitle(logicalTitle),
      color: 'purple',
      tabs: [{ title: 'Open', url: 'https://example.com/open' }],
    }],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [{
      title: logicalTitle,
      color: 'purple',
      tabs: [
        { title: 'Open', url: 'https://example.com/open' },
        { title: 'Saved', url: 'https://example.com/saved' },
      ],
    }],
  };

  const merged = mergeSpaceSnapshot(liveSnapshot, storedSnapshot);

  assert.equal(merged.groups.length, 1);
  assert.equal(merged.groups[0].title, logicalTitle);
  assert.deepEqual(merged.groups[0].tabs.map((tab) => tab.url), [
    'https://example.com/open',
    'https://example.com/saved',
  ]);
});

test('does not merge two long logical titles that share Chrome-visible prefixes', () => {
  const prefix = 'project-title-prefix'.padEnd(32, 'x');
  const firstTitle = `${prefix}A`;
  const secondTitle = `${prefix}B`;
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: chromeGroupTitle(firstTitle),
        color: 'blue',
        tabs: [{ title: 'First open', url: 'https://example.com/first/open' }],
      },
      {
        title: chromeGroupTitle(secondTitle),
        color: 'blue',
        tabs: [{ title: 'Second open', url: 'https://example.com/second/open' }],
      },
    ],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: firstTitle,
        color: 'blue',
        tabs: [
          { title: 'First open', url: 'https://example.com/first/open' },
          { title: 'First saved', url: 'https://example.com/first/saved' },
        ],
      },
      {
        title: secondTitle,
        color: 'blue',
        tabs: [
          { title: 'Second open', url: 'https://example.com/second/open' },
          { title: 'Second saved', url: 'https://example.com/second/saved' },
        ],
      },
    ],
  };

  const merged = mergeSpaceSnapshot(liveSnapshot, storedSnapshot);
  const groupsByTitle = new Map(merged.groups.map((group) => [group.title, group]));

  assert.equal(merged.groups.length, 2);
  assert.deepEqual(groupsByTitle.get(firstTitle).tabs.map((tab) => tab.url), [
    'https://example.com/first/open',
    'https://example.com/first/saved',
  ]);
  assert.deepEqual(groupsByTitle.get(secondTitle).tabs.map((tab) => tab.url), [
    'https://example.com/second/open',
    'https://example.com/second/saved',
  ]);
});

test('does not confuse a long title with a short title equal to its physical identity', () => {
  const longTitle = `${'collision-candidate-'.repeat(3)}long`;
  const shortTitle = chromeGroupTitle(longTitle);
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [{
      title: shortTitle,
      color: 'blue',
      tabs: [{ title: 'Short', url: 'https://example.com/short' }],
    }],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: longTitle,
        color: 'blue',
        tabs: [{ title: 'Long', url: 'https://example.com/long' }],
      },
      {
        title: shortTitle,
        color: 'blue',
        tabs: [{ title: 'Short', url: 'https://example.com/short' }],
      },
    ],
  };

  const groupsByTitle = new Map(
    mergeSpaceSnapshot(liveSnapshot, storedSnapshot).groups.map((group) => [group.title, group]),
  );

  assert.deepEqual(groupsByTitle.get(longTitle).tabs.map((tab) => tab.url), [
    'https://example.com/long',
  ]);
  assert.deepEqual(groupsByTitle.get(shortTitle).tabs.map((tab) => tab.url), [
    'https://example.com/short',
  ]);
});

test('keeps dormant tabs with a live group after the group is renamed', () => {
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'Deep Work',
        color: 'blue',
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
    ],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Research',
        color: 'blue',
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Plan', url: 'https://example.com/plan' },
          { title: 'Archive', url: 'https://example.com/archive' },
        ],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot(liveSnapshot, storedSnapshot).groups, [
    {
      title: 'Deep Work',
      color: 'blue',
      tabs: [
        { title: 'Spec', url: 'https://example.com/spec' },
        { title: 'Plan', url: 'https://example.com/plan' },
        { title: 'Archive', url: 'https://example.com/archive' },
      ],
    },
  ]);
});

test('explicitly retitles preserved snapshot history with its live Chrome group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Research',
        color: 'blue',
        collapsed: true,
        custom: 'keep-source-metadata',
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Archive', url: 'https://example.com/archive' },
        ],
      },
      {
        title: 'Preserved Empty',
        color: 'orange',
        collapsed: true,
        custom: 'unrelated-history',
        tabs: [],
      },
    ],
  };
  const original = structuredClone(snapshot);
  const renamed = retitleSnapshotGroup(snapshot, {
    title: 'Research',
    color: 'blue',
    tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
  }, 'Deep Work', 2);

  assert.deepEqual(renamed, {
    version: 1,
    updatedAt: 2,
    preserveGroups: true,
    groups: [
      {
        title: 'Deep Work',
        color: 'blue',
        collapsed: true,
        custom: 'keep-source-metadata',
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Archive', url: 'https://example.com/archive' },
        ],
      },
      {
        title: 'Preserved Empty',
        color: 'orange',
        collapsed: true,
        custom: 'unrelated-history',
        tabs: [],
      },
    ],
  });
  assert.equal(snapshotTabCount(renamed), snapshotTabCount(snapshot));
  assert.deepEqual(snapshot, original);

  const merged = mergeOpenSpaceSnapshot([{
    title: 'Deep Work',
    color: 'blue',
    tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
  }], renamed);
  assert.equal(merged.preserveGroups, true);
  assert.equal(merged.groups.some((group) => group.title === 'Research'), false);
  assert.deepEqual(merged.groups, [
    {
      title: 'Deep Work',
      color: 'blue',
      collapsed: false,
      custom: 'keep-source-metadata',
      tabs: [
        { title: 'Spec', url: 'https://example.com/spec' },
        { title: 'Archive', url: 'https://example.com/archive' },
      ],
    },
    {
      title: 'Preserved Empty',
      color: 'orange',
      collapsed: true,
      custom: 'unrelated-history',
      tabs: [],
    },
  ]);
});

test('retitles only the unique stored group matching the live group URLs', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Same Name',
        color: 'blue',
        tabs: [{ title: 'Alpha', url: 'https://example.com/alpha' }],
      },
      {
        title: 'Same Name',
        color: 'blue',
        tabs: [{ title: 'Beta', url: 'https://example.com/beta' }],
      },
    ],
  };

  const renamed = retitleSnapshotGroup(snapshot, {
    title: 'Same Name',
    color: 'blue',
    tabs: [{ title: 'Beta live', url: 'https://example.com/beta' }],
  }, 'Beta Renamed', 2);

  assert.deepEqual(renamed.groups.map((group) => ({
    title: group.title,
    urls: group.tabs.map((tab) => tab.url),
  })), [
    { title: 'Same Name', urls: ['https://example.com/alpha'] },
    { title: 'Beta Renamed', urls: ['https://example.com/beta'] },
  ]);
});

test('does not guess when duplicate stored groups match the same live URL equally', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Ambiguous',
        color: 'blue',
        custom: 'first',
        tabs: [{ title: 'Shared A', url: 'https://example.com/shared' }],
      },
      {
        title: 'Ambiguous',
        color: 'blue',
        custom: 'second',
        tabs: [{ title: 'Shared B', url: 'https://example.com/shared' }],
      },
    ],
  };

  const result = retitleSnapshotGroup(snapshot, {
    title: 'Ambiguous',
    color: 'blue',
    tabs: [{ title: 'Shared live', url: 'https://example.com/shared' }],
  }, 'Must Not Guess', 2);

  assert.deepEqual(result, snapshot);
});

test('preserveGroups keeps dormant history under its original Tag when a live tab is regrouped', () => {
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'AI Proposal',
        color: 'purple',
        tabs: [{ title: 'Current', url: 'https://example.com/current?live=1' }],
      },
    ],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Historical Tag',
        color: 'blue',
        collapsed: true,
        custom: 'keep-history-metadata',
        tabs: [
          { title: 'Current', url: 'https://example.com/current?stored=1' },
          { title: 'Saved history', url: 'https://example.com/history' },
        ],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot(liveSnapshot, storedSnapshot), {
    version: 1,
    updatedAt: 2,
    preserveGroups: true,
    groups: [
      {
        title: 'Historical Tag',
        color: 'blue',
        collapsed: true,
        custom: 'keep-history-metadata',
        tabs: [{ title: 'Saved history', url: 'https://example.com/history' }],
      },
      {
        title: 'AI Proposal',
        color: 'purple',
        tabs: [{ title: 'Current', url: 'https://example.com/current?live=1' }],
      },
    ],
  });
});

test('preserveGroups keeps an empty historical Tag beside newly regrouped live tabs', () => {
  const liveSnapshot = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'New Work',
        color: 'cyan',
        tabs: [{ title: 'Current', url: 'https://example.com/current' }],
      },
    ],
  };
  const storedSnapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Historical Tag',
        color: 'orange',
        collapsed: true,
        tabs: [],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot(liveSnapshot, storedSnapshot), {
    version: 1,
    updatedAt: 2,
    preserveGroups: true,
    groups: [
      {
        title: 'Historical Tag',
        color: 'orange',
        collapsed: true,
        tabs: [],
      },
      {
        title: 'New Work',
        color: 'cyan',
        tabs: [{ title: 'Current', url: 'https://example.com/current' }],
      },
    ],
  });
});

test('preserveGroups survives sanitizing and removing the final saved row', () => {
  const snapshot = {
    version: 1,
    preserveGroups: true,
    groups: [{
      title: 'Historical Tag',
      color: 'orange',
      collapsed: true,
      custom: 'keep-metadata',
      tabs: [{ title: 'Last row', url: 'https://example.com/last' }],
    }],
  };

  const removed = removeSnapshotTab(snapshot, {
    groupTitle: 'Historical Tag',
    groupColor: 'orange',
    url: 'https://example.com/last',
  });

  assert.deepEqual(removed.groups, [{
    title: 'Historical Tag',
    color: 'orange',
    collapsed: true,
    custom: 'keep-metadata',
    tabs: [],
  }]);
  assert.equal(snapshotTabCount(removed), 0);
  assert.equal(snapshotHasPersistentContent(removed), true);
  assert.deepEqual(sanitizeSpaceSnapshot(removed), removed);
});

test('an empty temporary Ungrouped group is not persistent history', () => {
  const snapshot = {
    version: 1,
    preserveGroups: true,
    groups: [{ title: 'Ungrouped', color: 'grey', restorable: true, tabs: [] }],
  };

  assert.equal(snapshotHasPersistentContent(snapshot), false);
  assert.deepEqual(sanitizeSpaceSnapshot(snapshot).groups, []);
});

test('removes one opened dormant tab from its snapshot group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        tabs: [{ title: 'Paper', url: 'https://example.com/paper' }],
      },
    ],
  };

  assert.deepEqual(removeSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://example.com/spec',
  }), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        tabs: [{ title: 'Paper', url: 'https://example.com/paper' }],
      },
    ],
  });
});

test('removes only the exact dormant URL and preserves query/hash siblings', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Item 1', url: 'https://app.test/item?id=1' },
          { title: 'Item 2', url: 'https://app.test/item?id=2' },
          { title: 'Third section', url: 'https://app.test/item#third' },
        ],
      },
    ],
  };

  const result = removeSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://app.test/item?id=2',
  });

  assert.deepEqual(result.groups[0].tabs, [
    { title: 'Item 1', url: 'https://app.test/item?id=1' },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);
});

test('updates only the exact dormant URL and preserves query/hash siblings', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      tabs: [
        { title: 'Item 1', url: 'https://app.test/item?id=1' },
        { title: 'Item 2', url: 'https://app.test/item?id=2', snapshotTabId: 'saved-item-2' },
        { title: 'Third section', url: 'https://app.test/item#third' },
      ],
    }],
  };

  const result = updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://app.test/item?id=2',
  }, {
    title: 'Item 2 updated',
    url: 'https://app.test/item?id=2&view=full',
    panelTitle: '  Read   later  ',
  });

  assert.deepEqual(result.groups[0].tabs, [
    { title: 'Item 1', url: 'https://app.test/item?id=1' },
    {
      title: 'Item 2 updated',
      url: 'https://app.test/item?id=2&view=full',
      snapshotTabId: 'saved-item-2',
      panelTitle: 'Read later',
    },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);
});

test('updates only the stable target among same-URL lifecycle rows', () => {
  const snapshot = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [{
      title: 'Duplicates',
      color: 'blue',
      tabs: [
        { title: 'Legacy sibling', url: 'https://example.com/legacy' },
        { title: 'First', url: 'https://example.com/same', snapshotTabId: 'row-first' },
        { title: 'Second', url: 'https://example.com/same', snapshotTabId: 'row-second' },
      ],
    }],
  };

  const result = updateSnapshotTab(snapshot, {
    groupTitle: 'Wrong current group title',
    snapshotTabId: 'row-second',
    url: 'https://example.com/same',
  }, {
    title: 'Second updated',
    url: 'https://example.com/updated',
  });

  assert.deepEqual(result.groups[0].tabs, [
    { title: 'Legacy sibling', url: 'https://example.com/legacy' },
    { title: 'First', url: 'https://example.com/same', snapshotTabId: 'row-first' },
    { title: 'Second updated', url: 'https://example.com/updated', snapshotTabId: 'row-second' },
  ]);
  assert.deepEqual(removeSnapshotTab(snapshot, {
    groupTitle: 'Wrong current group title',
    snapshotTabId: 'row-second',
  }).groups[0].tabs, [
    { title: 'Legacy sibling', url: 'https://example.com/legacy' },
    { title: 'First', url: 'https://example.com/same', snapshotTabId: 'row-first' },
  ]);
});

test('required existing updates change exactly one saved row and never append or guess', () => {
  const snapshot = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Legacy target', url: 'https://legacy.test/target' },
          { title: 'Other', url: 'https://docs.test/other' },
        ],
      },
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Same metadata', url: 'https://docs.test/other-group' }],
      },
      {
        title: 'Docs',
        color: 'red',
        tabs: [{ title: 'Wrong color', url: 'https://legacy.test/target' }],
      },
      {
        title: 'Plans',
        color: 'blue',
        tabs: [
          { title: 'Wrong title', url: 'https://legacy.test/target' },
          { title: 'Stable target', url: 'https://stable.test/old', snapshotTabId: 'stable-row' },
        ],
      },
    ],
  };

  const legacyUpdated = updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://legacy.test/target',
  }, {
    title: 'Legacy updated',
    url: 'https://legacy.test/updated',
  }, { requireExisting: true });
  assert.deepEqual(legacyUpdated.groups[0].tabs[0], {
    title: 'Legacy updated',
    url: 'https://legacy.test/updated',
  });
  assert.deepEqual(legacyUpdated.groups[1], snapshot.groups[1], 'a same-metadata Tag gets no appended row');
  assert.deepEqual(legacyUpdated.groups[2], snapshot.groups[2], 'a different color is untouched');
  assert.deepEqual(legacyUpdated.groups[3], snapshot.groups[3], 'a different title is untouched');

  const stableUpdated = updateSnapshotTab(snapshot, {
    snapshotTabId: 'stable-row',
    groupTitle: 'Wrong current title',
    url: 'https://wrong.test',
  }, {
    title: 'Stable updated',
    url: 'https://stable.test/new',
  }, { requireExisting: true });
  assert.deepEqual(stableUpdated.groups[3].tabs[1], {
    title: 'Stable updated',
    url: 'https://stable.test/new',
    snapshotTabId: 'stable-row',
  });

  const colorOnly = updateSnapshotTab(snapshot, {
    groupColor: 'red',
    url: 'https://legacy.test/target',
  }, {
    title: 'Color target',
    url: 'https://color.test/new',
  }, { requireExisting: true });
  assert.equal(colorOnly.groups[2].tabs[0].url, 'https://color.test/new');

  for (const [name, source, target] of [
    ['missing row', snapshot, { groupTitle: 'Docs', groupColor: 'blue', url: 'https://missing.test' }],
    ['ambiguous legacy rows', snapshot, { url: 'https://legacy.test/target' }],
    ['duplicated stable ids', {
      ...snapshot,
      groups: [{ title: 'Duplicate', color: 'blue', tabs: [
        { title: 'One', url: 'https://one.test', snapshotTabId: 'duplicate-row' },
        { title: 'Two', url: 'https://two.test', snapshotTabId: 'duplicate-row' },
      ] }],
    }, { snapshotTabId: 'duplicate-row', url: 'https://one.test' }],
  ]) {
    assert.deepEqual(updateSnapshotTab(source, target, {
      title: 'Must not be written',
      url: 'https://wrong.test/new',
    }, { requireExisting: true }), sanitizeSpaceSnapshot(source, {
      preserveDuplicateUrls: true,
    }), name);
  }
});

test('updates a saved snapshot tab URL inside the matching group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Old Spec', url: 'https://example.com/old' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        tabs: [{ title: 'Old Spec copy', url: 'https://example.com/old' }],
      },
    ],
  };

  assert.deepEqual(updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://example.com/old',
  }, {
    title: 'Better Spec',
    url: 'https://example.com/better',
  }), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Better Spec', url: 'https://example.com/better' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        tabs: [{ title: 'Old Spec copy', url: 'https://example.com/old' }],
      },
    ],
  });
});

test('adds a saved snapshot tab when the old URL is not present in the matching group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Plan', url: 'https://example.com/plan' }],
      },
    ],
  };

  assert.deepEqual(updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://example.com/missing',
  }, {
    title: 'Better Spec',
    url: 'https://example.com/better',
    snapshotTabId: 'new-saved-spec',
  }), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Plan', url: 'https://example.com/plan' },
          {
            title: 'Better Spec',
            url: 'https://example.com/better',
            snapshotTabId: 'new-saved-spec',
          },
        ],
      },
    ],
  });
});

test('removes disappeared live tabs from stored dormant snapshots', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Async Extend',
        color: 'blue',
        tabs: [
          { title: '执行日志', url: 'https://tesla.bytedance.net/runs/42?tab=logs' },
          { title: '总览', url: 'https://tesla.bytedance.net/runs/42/overview' },
        ],
      },
      {
        title: 'Argos',
        color: 'green',
        tabs: [
          { title: '链路日志 | Argos-BOE', url: 'https://cloud-boe.bytedance.net/trace?id=old#span' },
        ],
      },
    ],
  };

  assert.deepEqual(removeSnapshotTabs(snapshot, [
    { title: '执行日志', url: 'https://tesla.bytedance.net/runs/42?tab=logs#tail' },
    { title: '链路日志 | Argos-BOE', url: 'https://cloud-boe.bytedance.net/trace?id=new' },
  ]), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Async Extend',
        color: 'blue',
        tabs: [
          { title: '总览', url: 'https://tesla.bytedance.net/runs/42/overview' },
        ],
      },
    ],
  });
});

test('bulk snapshot removal is an exact-first one-to-one multiset match', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'History',
      color: 'blue',
      tabs: [
        { title: 'Item 1', url: 'https://app.test/item?id=1' },
        { title: 'Item 2', url: 'https://app.test/item?id=2' },
        { title: 'Third section', url: 'https://app.test/item#third' },
      ],
    }],
  };

  const exactOnly = removeSnapshotTabs(snapshot, [
    { url: 'https://app.test/item?id=2' },
  ]);
  assert.deepEqual(exactOnly.groups[0].tabs, [
    { title: 'Item 1', url: 'https://app.test/item?id=1' },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);

  const fallbackOnly = removeSnapshotTabs(snapshot, [
    { url: 'https://app.test/item?id=missing' },
  ]);
  assert.deepEqual(fallbackOnly.groups[0].tabs, [
    { title: 'Item 2', url: 'https://app.test/item?id=2' },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);

  const exactAndFallback = removeSnapshotTabs(snapshot, [
    { url: 'https://app.test/item?id=missing' },
    { url: 'https://app.test/item?id=2' },
  ]);
  assert.deepEqual(exactAndFallback.groups[0].tabs, [
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);
});

test('merges live tabs without dropping dormant snapshot content', () => {
  const stored = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        collapsed: true,
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        collapsed: true,
        tabs: [
          { title: 'Paper', url: 'https://example.com/paper' },
        ],
      },
    ],
  };
  const live = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        collapsed: false,
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
        ],
      },
      {
        title: 'Ungrouped',
        color: 'grey',
        collapsed: false,
        tabs: [],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot(live, stored), {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        collapsed: false,
        tabs: [
          { title: 'Spec', url: 'https://example.com/spec' },
          { title: 'Plan', url: 'https://example.com/plan' },
        ],
      },
      {
        title: 'Research',
        color: 'green',
        collapsed: true,
        tabs: [
          { title: 'Paper', url: 'https://example.com/paper' },
        ],
      },
    ],
  });
});

test('keeps stored dormant snapshots when live content is empty', () => {
  const stored = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot({ version: 1, updatedAt: 2, groups: [] }, stored), stored);
  assert.equal(mergeSpaceSnapshot(null, { version: 1, updatedAt: 1, groups: [] }), null);
});

test('uses a query/hash-insensitive URL only as a merge fallback', () => {
  assert.equal(
    comparableSnapshotUrl('https://cloud-boe.bytedance.net/logs?keyword=old#top'),
    'https://cloud-boe.bytedance.net/logs'
  );
  assert.equal(comparableSnapshotUrl('/logs?keyword=old#top'), '/logs');

  const stored = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Argos',
        color: 'blue',
        tabs: [
          { title: '日志关键字检索 | Argos-BOE', url: 'https://cloud-boe.bytedance.net/logs?keyword=old' },
          { title: '发布详情 - Lark-DevOps', url: 'https://lark-devops.bytedance.net/releases/42?tab=overview' },
        ],
      },
    ],
  };
  const live = {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'Argos',
        color: 'blue',
        tabs: [
          { title: '日志关键字检索 | Argos-BOE', url: 'https://cloud-boe.bytedance.net/logs?keyword=new&page=2#result' },
        ],
      },
    ],
  };

  assert.deepEqual(mergeSpaceSnapshot(live, stored), {
    version: 1,
    updatedAt: 2,
    groups: [
      {
        title: 'Argos',
        color: 'blue',
        tabs: [
          { title: '日志关键字检索 | Argos-BOE', url: 'https://cloud-boe.bytedance.net/logs?keyword=new&page=2#result' },
          { title: '发布详情 - Lark-DevOps', url: 'https://lark-devops.bytedance.net/releases/42?tab=overview' },
        ],
      },
    ],
  });
});

test('merge fallback consumes only one stored base-URL match', () => {
  const stored = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'History',
      color: 'blue',
      tabs: [
        { title: 'Item 1 saved', url: 'https://app.test/item?id=1' },
        { title: 'Item 2 saved', url: 'https://app.test/item?id=2' },
        { title: 'Third section saved', url: 'https://app.test/item#third' },
      ],
    }],
  };
  const live = {
    version: 1,
    updatedAt: 2,
    groups: [{
      title: 'History',
      color: 'blue',
      tabs: [{ title: 'Current navigation', url: 'https://app.test/item?id=current' }],
    }],
  };

  assert.deepEqual(mergeSpaceSnapshot(live, stored).groups[0].tabs, [
    { title: 'Current navigation', url: 'https://app.test/item?id=current' },
    { title: 'Item 2 saved', url: 'https://app.test/item?id=2' },
    { title: 'Third section saved', url: 'https://app.test/item#third' },
  ]);
});

test('merge consumes an exact duplicate from the corresponding group first', () => {
  const sharedUrl = 'https://app.test/item?id=1';
  const stored = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Archive',
        color: 'green',
        tabs: [{ title: 'Archived copy', url: sharedUrl }],
      },
      {
        title: 'Current',
        color: 'blue',
        tabs: [{ title: 'Saved current copy', url: sharedUrl }],
      },
    ],
  };
  const live = {
    version: 1,
    updatedAt: 2,
    groups: [{
      title: 'Current',
      color: 'blue',
      tabs: [{ title: 'Live current copy', url: sharedUrl }],
    }],
  };

  assert.deepEqual(mergeSpaceSnapshot(live, stored).groups, [
    {
      title: 'Archive',
      color: 'green',
      tabs: [{ title: 'Archived copy', url: sharedUrl }],
    },
    {
      title: 'Current',
      color: 'blue',
      tabs: [{ title: 'Live current copy', url: sharedUrl }],
    },
  ]);
});

test('duplicate exact URLs preserve candidate order, group priority, and one-to-one consumption', () => {
  const sharedUrl = 'https://app.test/shared';
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Archive',
        color: 'green',
        tabs: [{ title: 'Archive copy', url: sharedUrl }],
      },
      {
        title: 'Current',
        color: 'blue',
        tabs: [{ title: 'Current copy', url: sharedUrl }],
      },
      {
        title: 'Later',
        color: 'purple',
        tabs: [{ title: 'Later copy', url: sharedUrl }],
      },
    ],
  };

  const result = removeSnapshotTabs(snapshot, [
    { url: sharedUrl, groupTitle: 'Current', groupColor: 'blue' },
    { url: sharedUrl, groupTitle: 'Archive', groupColor: 'green' },
  ]);

  assert.deepEqual(result.groups, [
    {
      title: 'Archive',
      color: 'green',
      tabs: [],
    },
    {
      title: 'Current',
      color: 'blue',
      tabs: [],
    },
    {
      title: 'Later',
      color: 'purple',
      tabs: [{ title: 'Later copy', url: sharedUrl }],
    },
  ]);
});

test('large disjoint live and saved snapshots merge in bounded time without reordering tabs', () => {
  const tabCount = 2_000;
  const storedTabs = Array.from({ length: tabCount }, (_, index) => ({
    title: `Saved ${index}`,
    url: `https://saved.example/items/${index}`,
  }));
  const liveTabs = Array.from({ length: tabCount }, (_, index) => ({
    title: `Live ${index}`,
    url: `https://live.example/items/${index}`,
  }));
  const startedAt = performance.now();
  const merged = mergeSpaceSnapshot({
    version: 1,
    updatedAt: 2,
    groups: [{ title: 'Live', color: 'blue', tabs: liveTabs }],
  }, {
    version: 1,
    updatedAt: 1,
    groups: [{ title: 'Saved', color: 'green', tabs: storedTabs }],
  });
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(merged.groups.map((group) => group.title), ['Saved', 'Live']);
  assert.equal(merged.groups[0].tabs.length, tabCount);
  assert.equal(merged.groups[0].tabs[0].title, 'Saved 0');
  assert.equal(merged.groups[0].tabs.at(-1).title, `Saved ${tabCount - 1}`);
  assert.equal(merged.groups[1].tabs.length, tabCount);
  assert.equal(merged.groups[1].tabs[0].title, 'Live 0');
  assert.equal(merged.groups[1].tabs.at(-1).title, `Live ${tabCount - 1}`);
  assert.ok(elapsedMs < 2_500, `large disjoint merge took ${elapsedMs.toFixed(1)} ms`);
});

test('treats missing snapshot inputs as empty, safe lifecycle states', () => {
  assert.deepEqual(buildSpaceSnapshot({ now: 0 }), {
    version: 1,
    updatedAt: 0,
    groups: [],
  });
  assert.deepEqual(buildSpaceSnapshot().groups, []);
  assert.equal(shouldAutoCloseTab(), false);
  assert.equal(isRestorableSnapshotTab(), false);
  assert.equal(snapshotTabCount(), 0);
  assert.equal(snapshotTabCount(null), 0);
  assert.equal(snapshotTabCount({ groups: [{}] }), 0);
  assert.equal(snapshotGroupShouldPersist(), false);
  assert.equal(snapshotGroupShouldPersist({ preserveGroups: true }, {
    title: 'Saved tag',
    tabs: [],
  }), true);
  assert.equal(snapshotGroupShouldPersist({ preserveGroups: true }, {
    title: 'Ungrouped',
    tabs: [],
  }), false);
  assert.equal(snapshotHasPersistentContent(), false);
  assert.equal(snapshotHasPersistentContent({
    preserveGroups: true,
    groups: [{ title: 'Saved tag', tabs: [] }],
  }), true);
  assert.equal(snapshotHasPersistentContent({ preserveGroups: true, groups: null }), false);
  assert.equal(isUngroupedSnapshotGroup(), false);
  assert.equal(isUngroupedSnapshotGroup({ title: 'Ungrouped' }), true);
  assert.equal(isUngroupedSnapshotGroup({ title: 'Ungrouped', color: 'blue' }), false);
  assert.equal(comparableSnapshotUrl(), '');
  assert.equal(comparableSnapshotUrl('?query-only'), '?query-only');
  assert.equal(dropTemporarySnapshotGroups(null), null);
  assert.equal(sanitizeSpaceSnapshot(null), null);
  assert.deepEqual(sanitizeSpaceSnapshot({ groups: null }), { groups: [] });
  assert.equal(removeSnapshotTab(null), null);
  assert.equal(removeSnapshotTabs(null), null);
  assert.equal(updateSnapshotTab(null), null);
  assert.equal(mergeSpaceSnapshot(null, null), null);
});

test('builds readable default records and cleans panel-only metadata', () => {
  const snapshot = buildSpaceSnapshot({
    now: 10,
    view: [
      {
        tabs: [{ title: '', panelTitle: '   ', url: ' https://example.com/loose ' }],
      },
      {
        title: 'Saved',
        tabs: [{
          title: 'Browser title',
          displayTitle: 'Display title',
          panelTitle: '  Custom   name  ',
          url: 'https://example.com/saved',
        }],
      },
      { title: 'Empty', tabs: [] },
      { title: 'Missing tabs' },
    ],
  });

  assert.deepEqual(snapshot, {
    version: 1,
    updatedAt: 10,
    groups: [
      {
        title: 'Ungrouped',
        color: 'grey',
        collapsed: false,
        restorable: true,
        tabs: [{ title: ' https://example.com/loose ', url: 'https://example.com/loose' }],
      },
      {
        title: 'Saved',
        color: 'grey',
        collapsed: false,
        tabs: [{
          title: 'Browser title',
          panelTitle: 'Custom name',
          url: 'https://example.com/saved',
        }],
      },
    ],
  });

  assert.deepEqual(sanitizeSpaceSnapshot({
    preserveGroups: true,
    groups: [
      {
        title: 'Saved empty tag',
      },
      {
        title: 'Docs',
        tabs: [
          { title: '', panelTitle: '   ', url: ' https://example.com/docs ' },
          { title: 'Named', panelTitle: '  Saved   panel name ', url: 'https://example.com/named' },
        ],
      },
    ],
  }), {
    preserveGroups: true,
    groups: [
      { title: 'Saved empty tag', color: 'blue', tabs: [] },
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: ' https://example.com/docs ', url: 'https://example.com/docs' },
          {
            title: 'Named',
            panelTitle: 'Saved panel name',
            url: 'https://example.com/named',
          },
        ],
      },
    ],
  });
});

test('portable sanitization keeps an explicitly empty saved group without inventing tabs', () => {
  assert.deepEqual(sanitizeSpaceSnapshot({
    preserveGroups: true,
    groups: [{ title: 'Saved empty tag' }],
  }, { preserveDuplicateUrls: true }), {
    preserveGroups: true,
    groups: [{ title: 'Saved empty tag', color: 'blue', tabs: [] }],
  });
});

test('creates the expected destination group when a saved tab moves to a new group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Docs',
      color: 'green',
      tabs: [{ title: 'Plan', url: 'https://example.com/plan' }],
    }],
  };

  const research = updateSnapshotTab(snapshot, {
    groupTitle: 'Research',
    url: 'https://example.com/missing',
  }, {
    url: ' https://example.com/paper ',
  });
  assert.deepEqual(research.groups.at(-1), {
    title: 'Research',
    color: 'blue',
    tabs: [{ title: 'https://example.com/paper', url: 'https://example.com/paper' }],
  });

  const ungrouped = updateSnapshotTab(snapshot, {
    groupTitle: 'Ungrouped',
  }, {
    title: 'Loose',
    url: 'https://example.com/loose',
  });
  assert.deepEqual(ungrouped.groups.at(-1), {
    title: 'Ungrouped',
    color: 'grey',
    tabs: [{ title: 'Loose', url: 'https://example.com/loose' }],
  });

  const colorOnly = updateSnapshotTab(snapshot, {
    groupColor: 'orange',
  }, {
    title: 'Color only',
    url: 'https://example.com/color-only',
  });
  assert.deepEqual(colorOnly.groups.at(-1), {
    title: 'Ungrouped',
    color: 'orange',
    tabs: [{ title: 'Color only', url: 'https://example.com/color-only' }],
  });

  assert.deepEqual(updateSnapshotTab(snapshot, {}, {
    title: 'New Tab',
    url: 'chrome://newtab/',
  }), snapshot);
  assert.deepEqual(updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    url: 'https://example.com/plan',
  }, {
    title: 'Settings',
    url: 'chrome://settings/',
  }), snapshot);
  assert.deepEqual(updateSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    url: 'https://example.com/plan',
  }, {
    title: 'Inline data',
    url: 'data:text/plain,not-portable',
  }), snapshot);
});

test('retitles a uniquely identified stored group even before live URLs are available', () => {
  const snapshot = {
    version: 1,
    updatedAt: 7,
    groups: [{
      title: 'Research',
      color: 'blue',
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    }],
  };

  assert.deepEqual(retitleSnapshotGroup(snapshot, {
    title: 'Research',
  }, 'Deep Work', 'not-a-time'), {
    version: 1,
    updatedAt: 7,
    groups: [{
      title: 'Deep Work',
      color: 'blue',
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    }],
  });

  assert.deepEqual(retitleSnapshotGroup(snapshot), snapshot);
  assert.deepEqual(retitleSnapshotGroup(snapshot, { title: 'Research' }, ''), snapshot);
  assert.deepEqual(retitleSnapshotGroup(snapshot, { title: 'Research' }, 'Research'), snapshot);
  assert.deepEqual(retitleSnapshotGroup(snapshot, { title: 'Missing' }, 'New'), snapshot);
  assert.deepEqual(retitleSnapshotGroup(snapshot, {}, 'New'), snapshot);
  assert.equal(retitleSnapshotGroup(null, { title: 'Missing' }, 'New'), null);

  assert.equal(retitleSnapshotGroup({
    version: 1,
    groups: [{
      title: 'Ungrouped',
      tabs: [{ title: 'Loose', url: 'https://example.com/loose' }],
    }],
  }, {
    title: 'Ungrouped',
    tabs: [{ url: 'https://example.com/loose' }],
  }, 'Inbox').groups[0].title, 'Inbox');
});

test('retitles an untitled group only by a unique stable group identity', () => {
  const snapshot = {
    version: 1,
    identityVersion: 1,
    updatedAt: 1,
    groups: [
      {
        snapshotGroupId: 'untitled-a',
        title: '',
        color: 'blue',
        tabs: [{ snapshotTabId: 'row-a', title: 'A', url: 'https://example.com/a' }],
      },
      {
        snapshotGroupId: 'untitled-b',
        title: '',
        color: 'blue',
        tabs: [{ snapshotTabId: 'row-b', title: 'B', url: 'https://example.com/b' }],
      },
    ],
  };

  const renamed = retitleSnapshotGroup(snapshot, {
    snapshotGroupId: 'untitled-b',
    title: '',
    color: 'red',
    tabs: [],
  }, 'Named B', 2);
  assert.deepEqual(renamed.groups.map((group) => group.title), ['', 'Named B']);
  assert.equal(renamed.updatedAt, 2);
  assert.deepEqual(snapshot.groups.map((group) => group.title), ['', '']);

  assert.deepEqual(retitleSnapshotGroup(snapshot, {
    snapshotGroupId: 'missing',
    title: '',
  }, 'Do not guess'), snapshot);
  assert.deepEqual(retitleSnapshotGroup(snapshot, {
    title: '',
    color: 'blue',
    tabs: [{ url: 'https://example.com/b' }],
  }, 'Legacy must stay conservative'), snapshot);

  const duplicateIdentity = {
    ...snapshot,
    groups: snapshot.groups.map((group) => ({ ...group, snapshotGroupId: 'duplicate' })),
  };
  assert.deepEqual(retitleSnapshotGroup(duplicateIdentity, {
    snapshotGroupId: 'duplicate',
  }, 'Do not guess'), duplicateIdentity);
  assert.deepEqual(retitleSnapshotGroup(renamed, {
    snapshotGroupId: 'untitled-b',
  }, 'Named B'), renamed);

  const identityBesideLegacy = {
    ...snapshot,
    groups: [snapshot.groups[0], {
      title: 'Legacy without identity',
      color: 'red',
      tabs: [{ title: 'Legacy', url: 'https://example.com/legacy' }],
    }],
  };
  assert.deepEqual(retitleSnapshotGroup(identityBesideLegacy, {
    snapshotGroupId: 'untitled-a',
  }, 'Named A').groups.map((group) => group.title), [
    'Named A',
    'Legacy without identity',
  ]);
});

test('targets an explicitly untitled snapshot group without treating it as a wildcard', () => {
  const sharedUrl = 'https://example.com/shared';
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: '',
        color: 'blue',
        tabs: [{ title: 'Untitled copy', url: sharedUrl }],
      },
      {
        title: 'Ungrouped',
        color: 'grey',
        restorable: true,
        tabs: [{ title: 'Loose copy', url: sharedUrl }],
      },
    ],
  };

  const removed = removeSnapshotTab(snapshot, {
    groupTitle: '',
    groupColor: 'blue',
    url: sharedUrl,
  });
  assert.deepEqual(removed.groups.map(({ title, tabs }) => ({ title, count: tabs.length })), [
    { title: 'Ungrouped', count: 1 },
  ]);

  const bulkRemoved = removeSnapshotTabs(snapshot, [{
    groupTitle: '',
    groupColor: 'blue',
    url: sharedUrl,
  }]);
  assert.deepEqual(bulkRemoved.groups.map(({ title, tabs }) => ({ title, count: tabs.length })), [
    { title: 'Ungrouped', count: 1 },
  ]);

  const created = updateSnapshotTab({ version: 1, updatedAt: 1, groups: [] }, {
    groupTitle: '',
    groupColor: 'cyan',
  }, {
    title: 'Created',
    url: 'https://example.com/created',
  });
  assert.deepEqual(created.groups, [{
    title: '',
    color: 'cyan',
    tabs: [{ title: 'Created', url: 'https://example.com/created' }],
  }]);
});

test('retitles only the strongest URL match when duplicate group names differ in history', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    preserveGroups: true,
    groups: [
      {
        title: 'Research',
        color: 'blue',
        tabs: [
          { title: 'A', url: 'https://example.com/a' },
          { title: 'B', url: 'https://example.com/b' },
        ],
      },
      {
        title: 'Research',
        color: 'blue',
        tabs: [{ title: 'A copy', url: 'https://example.com/a' }],
      },
    ],
  };

  const renamed = retitleSnapshotGroup(snapshot, {
    title: 'Research',
    color: 'blue',
    tabs: [
      { url: 'https://example.com/a' },
      { url: 'https://example.com/b' },
    ],
  }, 'Deep Work', 2);

  assert.deepEqual(renamed.groups.map((group) => group.title), ['Deep Work', 'Research']);
});

test('does not guess a renamed merge target when two live groups overlap equally', () => {
  const sharedUrl = 'https://example.com/shared';
  const merged = mergeSpaceSnapshot({
    version: 1,
    updatedAt: 2,
    groups: [
      { title: 'One', color: 'green', tabs: [{ title: 'One', url: sharedUrl }] },
      { title: 'Two', color: 'purple', tabs: [{ title: 'Two', url: sharedUrl }] },
    ],
  }, {
    version: 1,
    updatedAt: 1,
    groups: [{
      title: 'Old name',
      color: 'blue',
      tabs: [
        { title: 'Saved shared', url: sharedUrl },
        { title: 'Dormant', url: 'https://example.com/dormant' },
      ],
    }],
  });

  assert.deepEqual(merged.groups.map((group) => ({
    title: group.title,
    urls: group.tabs.map((tab) => tab.url),
  })), [
    { title: 'Old name', urls: ['https://example.com/dormant'] },
    { title: 'One', urls: [sharedUrl] },
    { title: 'Two', urls: [sharedUrl] },
  ]);
});

test('matching a live row refreshes browser fields without dropping saved row metadata', () => {
  const stored = {
    version: 1,
    updatedAt: 1,
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'saved-docs',
      title: 'Docs',
      color: 'purple',
      customGroup: 'keep-group',
      tabs: [{
        snapshotTabId: 'saved-spec',
        title: 'Saved title',
        panelTitle: 'My spec alias',
        url: 'https://example.com/spec',
        customRow: 'keep-row',
      }],
    }],
  };
  const live = {
    version: 1,
    updatedAt: 2,
    identityVersion: 1,
    groups: [{
      snapshotGroupId: 'saved-docs',
      title: 'Docs',
      color: 'blue',
      tabs: [{
        snapshotTabId: 'saved-spec',
        title: 'Current browser title',
        url: 'https://example.com/spec',
      }],
    }],
  };

  const merged = mergeSpaceSnapshot(live, stored);

  assert.deepEqual(merged.groups[0], {
    snapshotGroupId: 'saved-docs',
    title: 'Docs',
    color: 'blue',
    customGroup: 'keep-group',
    tabs: [{
      snapshotTabId: 'saved-spec',
      title: 'Current browser title',
      panelTitle: 'My spec alias',
      url: 'https://example.com/spec',
      customRow: 'keep-row',
    }],
  });
  assert.equal(stored.groups[0].tabs[0].title, 'Saved title');
  assert.equal(Object.hasOwn(live.groups[0].tabs[0], 'customRow'), false);
});

test('advances duplicate URL cursors while preserving one-to-one group-aware removal', () => {
  const sharedUrl = 'https://example.com/shared';
  const result = removeSnapshotTabs({
    version: 1,
    preserveGroups: true,
    groups: [
      { title: 'Current', color: 'blue', tabs: [{ title: 'Current', url: sharedUrl }] },
      { title: 'Archive', color: 'green', tabs: [{ title: 'Archive', url: sharedUrl }] },
    ],
  }, [
    { groupTitle: 'Current', groupColor: 'blue', url: sharedUrl },
    { groupTitle: 'Current', groupColor: 'blue', url: sharedUrl },
  ]);

  assert.deepEqual(result.groups, [
    { title: 'Current', color: 'blue', tabs: [] },
    { title: 'Archive', color: 'green', tabs: [] },
  ]);
});

test('bulk removal ignores unusable targets and leaves unmatched history intact', () => {
  const snapshot = {
    version: 1,
    groups: [{
      title: 'Docs',
      color: 'blue',
      tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
    }],
  };

  assert.deepEqual(removeSnapshotTabs(snapshot, null), snapshot);
  assert.deepEqual(removeSnapshotTabs(snapshot, [null, {}, { url: '   ' }]), snapshot);
  assert.deepEqual(removeSnapshotTabs(snapshot, [{ url: 'https://example.com/missing' }]), snapshot);
  assert.deepEqual(removeSnapshotTab(snapshot), snapshot);
});

test('derives group preference defaults from partial bulk-removal targets', () => {
  const result = removeSnapshotTabs({
    version: 1,
    preserveGroups: true,
    groups: [
      { title: 'Ungrouped', color: 'grey', tabs: [{ title: 'Loose', url: 'https://example.com/loose' }] },
      { title: 'Docs', color: 'blue', tabs: [{ title: 'Spec', url: 'https://example.com/spec' }] },
      { title: 'Ungrouped', color: 'green', tabs: [{ title: 'Green', url: 'https://example.com/green' }] },
    ],
  }, [
    { groupTitle: 'Ungrouped', url: 'https://example.com/loose' },
    { groupTitle: 'Docs', url: 'https://example.com/spec' },
    { groupColor: 'green', url: 'https://example.com/green' },
  ]);

  assert.deepEqual(result.groups, [
    { title: 'Docs', color: 'blue', tabs: [] },
    { title: 'Ungrouped', color: 'green', tabs: [] },
  ]);
});

test('uses stable merge metadata defaults and honors preserveGroups from either side', () => {
  const startedAt = Date.now();
  const merged = mergeSpaceSnapshot({
    version: 0,
    updatedAt: 0,
    preserveGroups: true,
    groups: [{ title: 'Live', color: 'blue', tabs: [{ title: 'Live', url: 'https://example.com/live' }] }],
  }, {
    version: 2,
    updatedAt: 1,
    groups: [{ title: 'Saved', color: 'green', tabs: [{ title: 'Saved', url: 'https://example.com/saved' }] }],
  });

  assert.equal(merged.version, 2);
  assert.ok(merged.updatedAt >= startedAt);
  assert.equal(merged.preserveGroups, true);
  assert.deepEqual(merged.groups.map((group) => group.title), ['Saved', 'Live']);

  const liveOnly = sanitizeSpaceSnapshot({
    version: 3,
    groups: [{ title: 'Live', tabs: [{ title: 'Live', url: 'https://example.com/live' }] }],
  });
  assert.deepEqual(mergeSpaceSnapshot(liveOnly, null), liveOnly);

  const storedOnly = sanitizeSpaceSnapshot({
    version: 4,
    groups: [{ title: 'Saved', tabs: [{ title: 'Saved', url: 'https://example.com/saved' }] }],
  });
  assert.deepEqual(mergeSpaceSnapshot(null, storedOnly), storedOnly);

  const defaultVersion = mergeSpaceSnapshot({
    version: 0,
    updatedAt: 5,
    groups: [{ title: 'Live', tabs: [{ title: 'Live', url: 'https://example.com/live' }] }],
  }, {
    version: 0,
    groups: [{ title: 'Saved', tabs: [{ title: 'Saved', url: 'https://example.com/saved' }] }],
  });
  assert.equal(defaultVersion.version, 1);
  assert.equal(defaultVersion.updatedAt, 5);
});
