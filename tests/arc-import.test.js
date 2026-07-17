import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  appendArcImportPlan,
  createArcImportPlan,
  selectArcImportPlan,
} from '../src/shared/arc-import.js';
import {
  dropTemporarySnapshotGroups,
  mergeOpenSpaceSnapshot,
  sanitizeSpaceSnapshot,
} from '../src/shared/space-snapshot.js';

function readArcFixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

test('creates an append-only import plan from Arc Spaces and folders', () => {
  const arcData = {
    firebaseSyncState: {
      syncData: {
        orderedSpaceIDs: { value: ['space-a'] },
        spaceModels: [
          'space-a',
          {
            value: {
              id: 'space-a',
              title: 'Work',
              customInfo: { iconType: { emoji_v2: '🛠' } },
              newContainerIDs: [
                { pinned: {} },
                'pinned-container',
                { unpinned: { _0: { shared: {} } } },
                'unpinned-container',
              ],
            },
          },
        ],
        items: [
          'pinned-container',
          {
            value: {
              id: 'pinned-container',
              data: { itemContainer: { containerType: { spaceItems: { _0: 'space-a' } } } },
              childrenIds: ['folder-docs', 'root-tab'],
            },
          },
          'folder-docs',
          {
            value: {
              id: 'folder-docs',
              title: 'Docs',
              data: { list: {} },
              childrenIds: ['tab-a', 'nested-folder'],
            },
          },
          'tab-a',
          {
            value: {
              id: 'tab-a',
              title: 'Spec',
              data: { tab: { savedTitle: 'Spec draft', savedURL: 'https://example.com/spec' } },
              childrenIds: [],
            },
          },
          'nested-folder',
          {
            value: {
              id: 'nested-folder',
              title: 'Deep',
              data: { list: {} },
              childrenIds: ['tab-b'],
            },
          },
          'tab-b',
          {
            value: {
              id: 'tab-b',
              data: { tab: { savedTitle: 'Architecture', savedURL: 'https://example.com/arch' } },
              childrenIds: [],
            },
          },
          'root-tab',
          {
            value: {
              id: 'root-tab',
              data: { tab: { savedTitle: 'Inbox', savedURL: 'https://example.com/inbox' } },
              childrenIds: [],
            },
          },
          'unpinned-container',
          {
            value: {
              id: 'unpinned-container',
              data: { itemContainer: { containerType: { spaceItems: { _0: 'space-a' } } } },
              childrenIds: ['loose-tab'],
            },
          },
          'loose-tab',
          {
            value: {
              id: 'loose-tab',
              data: { tab: { savedTitle: 'Later', savedURL: 'https://example.com/later' } },
              childrenIds: [],
            },
          },
        ],
      },
    },
  };

  const plan = createArcImportPlan(arcData, {
    existingSpaces: [{ id: 'work', name: 'Work' }],
    now: 1778930000000,
  });

  assert.equal(plan.summary.source, 'firebaseSyncState');
  assert.deepEqual(plan.summary, {
    source: 'firebaseSyncState',
    spaces: 1,
    folders: 2,
    tabs: 4,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(plan.spaces, [
    {
      id: 'arc-space-a',
      name: 'Work (Arc)',
      icon: '🛠',
      color: 'blue',
    },
  ]);
  assert.deepEqual(plan.spaceSnapshots['arc-space-a'], {
    version: 1,
    updatedAt: 1778930000000,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        collapsed: false,
        tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
      },
      {
        title: 'Docs / Deep',
        color: 'green',
        collapsed: false,
        tabs: [{ title: 'Architecture', url: 'https://example.com/arch' }],
      },
      {
        title: 'Ungrouped',
        color: 'grey',
        collapsed: false,
        restorable: true,
        tabs: [
          { title: 'Inbox', url: 'https://example.com/inbox' },
          { title: 'Later', url: 'https://example.com/later' },
        ],
      },
    ],
  });
  assert.deepEqual(plan.spacePreviews, [{
    spaceId: 'arc-space-a',
    sourceSpaceId: 'space-a',
    originalId: 'arc-space-a',
    resolvedId: 'arc-space-a',
    originalName: 'Work',
    resolvedName: 'Work (Arc)',
    folders: 2,
    tabs: 4,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
    conflicts: [{
      spaceId: 'arc-space-a',
      sourceSpaceId: 'space-a',
      field: 'name',
      original: 'Work',
      resolved: 'Work (Arc)',
      reason: 'existing-space',
    }],
  }]);
  assert.deepEqual(plan.conflicts, plan.spacePreviews[0].conflicts);
});

test('keeps imported top-level Arc pages restorable when the Space first opens', () => {
  const plan = createArcImportPlan({
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['top-level-space'] } },
      spaceModels: [{
        value: {
          id: 'top-level-space',
          title: 'Top Level',
          newContainerIDs: ['top-level-container'],
        },
      }],
      items: [
        {
          value: {
            id: 'top-level-container',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'top-level-space' } } } },
            childrenIds: ['top-level-page'],
          },
        },
        {
          value: {
            id: 'top-level-page',
            title: 'Arc Inbox',
            data: { tab: { savedURL: 'https://example.com/arc-inbox' } },
            childrenIds: [],
          },
        },
      ],
    },
  }, { now: 9 });
  const snapshot = plan.spaceSnapshots['arc-top-level-space'];
  const expectedGroup = {
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    restorable: true,
    tabs: [{ title: 'Arc Inbox', url: 'https://example.com/arc-inbox' }],
  };

  assert.deepEqual(snapshot.groups, [expectedGroup]);
  assert.deepEqual(dropTemporarySnapshotGroups(snapshot)?.groups, [expectedGroup]);
  assert.deepEqual(mergeOpenSpaceSnapshot([], snapshot)?.groups, [expectedGroup]);
});

test('skips Arc-only items and unsafe tab URLs', () => {
  const arcData = {
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['space-b'] } },
      spaceModels: [
        {
          value: {
            id: 'space-b',
            title: 'Research',
            newContainerIDs: [{ pinned: {} }, 'container-b'],
          },
        },
      ],
      items: [
        {
          value: {
            id: 'container-b',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'space-b' } } } },
            childrenIds: ['folder-empty', 'bad-tab', 'new-tab', 'arc-note', 'arc-split'],
          },
        },
        { value: { id: 'folder-empty', title: 'Empty', data: { list: {} }, childrenIds: [] } },
        { value: { id: 'bad-tab', data: { tab: { savedTitle: 'Arc URL', savedURL: 'arc://boosts' } } } },
        { value: { id: 'new-tab', data: { tab: { savedTitle: 'New Tab', savedURL: 'chrome://newtab' } } } },
        { value: { id: 'arc-note', data: { easel: { title: 'Board' } }, childrenIds: [] } },
        { value: { id: 'arc-split', data: { splitView: { focusItemID: 'bad-tab' } }, childrenIds: [] } },
      ],
    },
  };

  const plan = createArcImportPlan(JSON.stringify(arcData), { now: 1 });

  assert.deepEqual(plan.summary, {
    source: 'sidebarSyncState',
    spaces: 1,
    folders: 1,
    tabs: 0,
    skipped: {
      emptyFolders: 1,
      invalidTabs: 2,
      unsupportedItems: 0,
      easel: 1,
      splitView: 1,
    },
  });
  assert.deepEqual(plan.spaceSnapshots['arc-space-b'].groups, []);
  assert.deepEqual(sanitizeSpaceSnapshot(plan.spaceSnapshots['arc-space-b']).groups, []);
});

test('can parse Arc sidebar container exports with JSON string records', () => {
  const space = {
    id: 'space-c',
    title: 'Personal',
    customInfo: { iconType: { emoji_v2: '🧠' } },
    newContainerIDs: [{ pinned: {} }, 'container-c'],
  };
  const container = {
    id: 'container-c',
    data: { itemContainer: { containerType: { spaceItems: { _0: 'space-c' } } } },
    childrenIds: ['tab-c'],
  };
  const tab = {
    id: 'tab-c',
    title: null,
    data: { tab: { savedTitle: 'Home', savedURL: 'https://example.com/home' } },
    childrenIds: [],
  };
  const arcData = {
    sidebar: {
      containers: [
        {
          spaces: ['space-c', JSON.stringify(space)],
          items: ['container-c', JSON.stringify(container), 'tab-c', JSON.stringify(tab)],
        },
      ],
    },
  };

  const plan = createArcImportPlan(arcData, {
    existingSpaces: [{ id: 'personal', name: 'Personal' }],
    now: 2,
  });

  assert.equal(plan.summary.source, 'sidebar');
  assert.deepEqual(plan.spaces, [
    { id: 'arc-space-c', name: 'Personal (Arc)', icon: '🧠', color: 'blue' },
  ]);
  assert.deepEqual(plan.spaceSnapshots['arc-space-c'].groups, [
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      restorable: true,
      tabs: [{ title: 'Home', url: 'https://example.com/home' }],
    },
  ]);
});

test('ignores an items-only firebase segment when sidebarSync has importable Spaces', () => {
  const plan = createArcImportPlan(
    readArcFixture('arc-mixed-items-only-firebase.json'),
    { now: 7 },
  );

  assert.equal(plan.summary.source, 'sidebarSyncState');
  assert.deepEqual(plan.spaces.map(({ id, name }) => ({ id, name })), [
    { id: 'arc-sidebar-sync-space', name: 'Recovered Work' },
  ]);
  assert.deepEqual(plan.spaceSnapshots['arc-sidebar-sync-space'].groups, [{
    title: 'Ungrouped',
    color: 'grey',
    collapsed: false,
    restorable: true,
    tabs: [{ title: 'Recovered tab', url: 'https://example.com/recovered' }],
  }]);
});

test('chooses a complete sidebar source over an equally sized partial firebase source', () => {
  const plan = createArcImportPlan(
    readArcFixture('arc-mixed-partial-sources.json'),
    { now: 8 },
  );

  assert.equal(plan.summary.source, 'sidebar');
  assert.deepEqual(plan.summary, {
    source: 'sidebar',
    spaces: 1,
    folders: 1,
    tabs: 1,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(plan.spaces.map(({ id, name }) => ({ id, name })), [
    { id: 'arc-complete-space', name: 'Complete Personal' },
  ]);
});

test('appends imported Spaces without changing the active Space', () => {
  const state = {
    activeSpaceId: 'default',
    spaces: [{ id: 'default', name: 'Space', icon: 'S', color: 'blue' }],
    spaceSnapshots: {},
  };
  const plan = {
    spaces: [{ id: 'arc-work', name: 'Work', icon: 'W', color: 'green' }],
    spaceSnapshots: {
      'arc-work': {
        version: 1,
        updatedAt: 1,
        groups: [
          {
            title: 'Docs',
            color: 'blue',
            collapsed: false,
            tabs: [{ title: 'Spec', url: 'https://example.com/spec' }],
          },
        ],
      },
    },
    spacePreviews: [{ spaceId: 'arc-work', originalName: 'Work', resolvedName: 'Work' }],
    conflicts: [{ spaceId: 'arc-work', field: 'name' }],
  };

  const result = appendArcImportPlan(state, plan);

  assert.equal(result.importedSpaces, 1);
  assert.equal(result.importedTabs, 1);
  assert.deepEqual(result.importedSpaceIds, [plan.spaces[0].id]);
  assert.equal(state.activeSpaceId, 'default');
  assert.deepEqual(state.spaces.map((space) => space.id), ['default', 'arc-work']);
  assert.deepEqual(state.spaces[1], { id: 'arc-work', name: 'Work', icon: 'W', color: 'green' });
  assert.equal(state.spaceSnapshots['arc-work'].groups[0].tabs[0].title, 'Spec');
  assert.equal('spacePreviews' in state, false);
  assert.equal('conflicts' in state, false);
});

test('rejects a stale import plan before it can overwrite an existing Space snapshot', () => {
  const state = {
    activeSpaceId: 'default',
    spaces: [
      { id: 'default', name: 'Default', icon: 'D', color: 'blue' },
      { id: 'arc-work', name: 'Existing Work', icon: 'E', color: 'purple' },
    ],
    spaceSnapshots: {
      'arc-work': {
        version: 1,
        updatedAt: 1,
        groups: [{
          title: 'Existing',
          tabs: [{ title: 'Keep', url: 'https://example.com/keep' }],
        }],
      },
    },
  };
  const plan = {
    spaces: [{ id: 'arc-work', name: 'Imported Work', icon: 'I', color: 'green' }],
    spaceSnapshots: {
      'arc-work': {
        version: 1,
        updatedAt: 2,
        groups: [{
          title: 'Imported',
          tabs: [{ title: 'Replace', url: 'https://example.com/replace' }],
        }],
      },
    },
  };
  const before = structuredClone(state);

  assert.throws(
    () => appendArcImportPlan(state, plan),
    /id "arc-work" is no longer available.*Preview the file again/,
  );
  assert.deepEqual(state, before);
});

test('deduplicates Arc container references and generated Space ids', () => {
  const arcData = {
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['space-a', 'space-b'] } },
      spaceModels: [
        {
          value: {
            id: 'space-a',
            title: 'Work',
            newContainerIDs: ['container-a', 'container-a'],
          },
        },
        {
          value: {
            id: 'space-b',
            title: 'Work',
            containerIDs: ['container-b'],
          },
        },
      ],
      items: [
        {
          value: {
            id: 'container-a',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'space-a' } } } },
            childrenIds: ['tab-a'],
          },
        },
        {
          value: {
            id: 'tab-a',
            title: 'Spec',
            data: { tab: { savedURL: 'https://example.com/spec' } },
            childrenIds: [],
          },
        },
        {
          value: {
            id: 'container-b',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'space-b' } } } },
            childrenIds: ['tab-b'],
          },
        },
        {
          value: {
            id: 'tab-b',
            title: 'Plan',
            data: { tab: { savedURL: 'file:///Users/test/plan.html' } },
            childrenIds: [],
          },
        },
      ],
    },
  };

  const plan = createArcImportPlan(arcData, {
    existingSpaces: [
      { id: 'arc-space-a', name: 'Work' },
      { id: 'arc-space-a-2', name: 'Work (Arc)' },
    ],
    now: 3,
  });

  assert.deepEqual(plan.spaces.map((space) => space.id), ['arc-space-a-3', 'arc-space-b']);
  assert.deepEqual(plan.spaces.map((space) => space.name), ['Work (Arc 2)', 'Work (Arc 3)']);
  assert.deepEqual(plan.summary, {
    source: 'sidebarSyncState',
    spaces: 2,
    folders: 0,
    tabs: 2,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(plan.spaceSnapshots['arc-space-a-3'].groups[0].tabs, [
    { title: 'Spec', url: 'https://example.com/spec' },
  ]);
  assert.deepEqual(plan.spaceSnapshots['arc-space-b'].groups[0].tabs, [
    { title: 'Plan', url: 'file:///Users/test/plan.html' },
  ]);
});

test('handles missing Arc data as a no-op plan and rejects empty files', () => {
  assert.throws(() => createArcImportPlan(''), /Arc import file is empty/);
  const plan = createArcImportPlan({}, { now: 4 });

  assert.deepEqual(plan, {
    spaces: [],
    spaceSnapshots: {},
    summary: {
      source: 'unknown',
      spaces: 0,
      folders: 0,
      tabs: 0,
      skipped: {
        emptyFolders: 0,
        invalidTabs: 0,
        unsupportedItems: 0,
        easel: 0,
        splitView: 0,
      },
    },
    spacePreviews: [],
    conflicts: [],
  });
});

test('previews conflicts per Space and recomputes selected import metadata', () => {
  const arcData = {
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['space-a', 'space-b'] } },
      spaceModels: [
        {
          value: {
            id: 'space-a',
            title: 'Work',
            newContainerIDs: ['container-a'],
          },
        },
        {
          value: {
            id: 'space-b',
            title: 'Personal',
            newContainerIDs: ['container-b'],
          },
        },
      ],
      items: [
        {
          value: {
            id: 'container-a',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'space-a' } } } },
            childrenIds: ['folder-a', 'invalid-a'],
          },
        },
        {
          value: {
            id: 'folder-a',
            title: 'Docs',
            data: { list: {} },
            childrenIds: ['tab-a'],
          },
        },
        {
          value: {
            id: 'tab-a',
            title: 'Spec',
            data: { tab: { savedURL: 'https://example.com/spec' } },
            childrenIds: [],
          },
        },
        {
          value: {
            id: 'invalid-a',
            title: 'Unsafe',
            data: { tab: { savedURL: 'arc://settings' } },
            childrenIds: [],
          },
        },
        {
          value: {
            id: 'container-b',
            data: { itemContainer: { containerType: { spaceItems: { _0: 'space-b' } } } },
            childrenIds: ['tab-b'],
          },
        },
        {
          value: {
            id: 'tab-b',
            title: 'Home',
            data: { tab: { savedURL: 'https://example.com/home' } },
            childrenIds: [],
          },
        },
      ],
    },
  };
  const plan = createArcImportPlan(arcData, {
    existingSpaces: [{ id: 'arc-space-a', name: 'Work' }],
    now: 5,
  });

  assert.deepEqual(plan.spaces.map(({ id, name }) => ({ id, name })), [
    { id: 'arc-space-a-2', name: 'Work (Arc)' },
    { id: 'arc-space-b', name: 'Personal' },
  ]);
  assert.deepEqual(plan.spacePreviews.map((preview) => ({
    spaceId: preview.spaceId,
    folders: preview.folders,
    tabs: preview.tabs,
    invalidTabs: preview.skipped.invalidTabs,
  })), [
    { spaceId: 'arc-space-a-2', folders: 1, tabs: 1, invalidTabs: 1 },
    { spaceId: 'arc-space-b', folders: 0, tabs: 1, invalidTabs: 0 },
  ]);
  assert.deepEqual(plan.conflicts, [
    {
      spaceId: 'arc-space-a-2',
      sourceSpaceId: 'space-a',
      field: 'id',
      original: 'arc-space-a',
      resolved: 'arc-space-a-2',
      reason: 'existing-space',
    },
    {
      spaceId: 'arc-space-a-2',
      sourceSpaceId: 'space-a',
      field: 'name',
      original: 'Work',
      resolved: 'Work (Arc)',
      reason: 'existing-space',
    },
  ]);

  const selected = selectArcImportPlan(plan, new Set(['arc-space-a-2']));

  assert.deepEqual(selected.spaces.map((space) => space.id), ['arc-space-a-2']);
  assert.deepEqual(Object.keys(selected.spaceSnapshots), ['arc-space-a-2']);
  assert.deepEqual(selected.summary, {
    source: 'sidebarSyncState',
    spaces: 1,
    folders: 1,
    tabs: 1,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 1,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(selected.spacePreviews.map((preview) => preview.spaceId), ['arc-space-a-2']);
  assert.deepEqual(selected.conflicts, plan.conflicts);
  assert.equal(plan.summary.spaces, 2);
  assert.equal(plan.summary.tabs, 2);

  const personalOnly = selectArcImportPlan(plan, ['arc-space-b', 'missing']);
  assert.deepEqual(personalOnly.summary, {
    source: 'sidebarSyncState',
    spaces: 1,
    folders: 0,
    tabs: 1,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 0,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(personalOnly.conflicts, []);

  const empty = selectArcImportPlan(plan, []);
  assert.deepEqual(empty, {
    spaces: [],
    spaceSnapshots: {},
    summary: {
      source: 'sidebarSyncState',
      spaces: 0,
      folders: 0,
      tabs: 0,
      skipped: {
        emptyFolders: 0,
        invalidTabs: 0,
        unsupportedItems: 0,
        easel: 0,
        splitView: 0,
      },
    },
    spacePreviews: [],
    conflicts: [],
  });

  assert.throws(
    () => selectArcImportPlan({
      ...plan,
      spacePreviews: [plan.spacePreviews[0]],
    }, ['arc-space-b']),
    /preview metadata is incomplete/,
  );
  assert.throws(
    () => selectArcImportPlan({
      spaces: plan.spaces,
      spaceSnapshots: plan.spaceSnapshots,
      summary: plan.summary,
    }, ['arc-space-b']),
    /cannot recalculate a partial selection/,
  );
});

test('distinguishes batch, existing, and mixed generated id conflicts', () => {
  const plan = createArcImportPlan({
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['foo bar', 'foo-bar'] } },
      spaceModels: [
        { value: { id: 'foo bar', title: 'Alpha' } },
        { value: { id: 'foo-bar', title: 'Beta' } },
      ],
      items: [],
    },
  }, {
    existingSpaces: [{ id: 'arc-foo-bar-2', name: 'Existing' }],
    now: 6,
  });

  assert.deepEqual(plan.spaces.map((space) => space.id), ['arc-foo-bar', 'arc-foo-bar-3']);
  assert.deepEqual(plan.conflicts, [{
    spaceId: 'arc-foo-bar-3',
    sourceSpaceId: 'foo-bar',
    field: 'id',
    original: 'arc-foo-bar',
    resolved: 'arc-foo-bar-3',
    reason: 'mixed',
  }]);
});

test('normalizes malformed Arc records, follows cyclic trees once, and applies safe defaults', () => {
  const before = Date.now();
  const plan = createArcImportPlan({
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['main', '   ', 'missing', 'main'] } },
      spaceModels: [
        null,
        '{broken json',
        { value: { id: 'main', newContainerIDs: ['container'] } },
        { value: { id: '   ', title: 'Symbols !', newContainerIDs: [] } },
        { value: { id: 'later', title: 'Later' } },
      ],
      items: [
        null,
        '{not-json',
        {
          value: {
            id: 'container',
            data: { itemContainer: {} },
            childrenIds: ['folder', 'folder', 'missing-child', 'unsupported', 'url-title'],
          },
        },
        {
          value: {
            id: 'folder',
            title: '   ',
            data: { list: {} },
            childrenIds: ['folder-tab', 'container'],
          },
        },
        {
          value: {
            id: 'folder-tab',
            data: { tab: { savedURL: 'https://example.com/folder' } },
          },
        },
        { value: { id: 'unsupported' } },
        {
          value: {
            id: 'url-title',
            title: '',
            data: { tab: { savedTitle: '', savedURL: 'https://example.com/title-fallback' } },
          },
        },
      ],
    },
  }, {
    existingSpaces: [null, { id: '', title: 'Symbols !' }, { name: '' }],
  });
  const after = Date.now();

  assert.deepEqual(plan.spaces.map(({ id, name, icon }) => ({ id, name, icon })), [
    { id: 'arc-main', name: 'Arc Space', icon: 'A' },
    { id: 'arc-symbols', name: 'Symbols ! (Arc)', icon: 'S' },
    { id: 'arc-later', name: 'Later', icon: 'L' },
  ]);
  assert.ok(plan.spaceSnapshots['arc-main'].updatedAt >= before);
  assert.ok(plan.spaceSnapshots['arc-main'].updatedAt <= after);
  assert.deepEqual(plan.spaceSnapshots['arc-main'].groups, [
    {
      title: 'Folder',
      color: 'blue',
      collapsed: false,
      tabs: [{ title: 'https://example.com/folder', url: 'https://example.com/folder' }],
    },
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      restorable: true,
      tabs: [{
        title: 'https://example.com/title-fallback',
        url: 'https://example.com/title-fallback',
      }],
    },
  ]);
  assert.equal(plan.summary.tabs, 2, 'duplicate and cyclic references must not duplicate imported pages');
  assert.equal(plan.summary.skipped.unsupportedItems, 1);
  assert.equal(createArcImportPlan(null, { now: 1 }).summary.source, 'unknown');
});

test('keeps the first source when complete Arc exports tie exactly', () => {
  const space = { id: 'tie', title: 'Tie', newContainerIDs: ['tie-container'] };
  const container = {
    id: 'tie-container',
    data: { itemContainer: {} },
    childrenIds: ['tie-tab'],
  };
  const tab = {
    id: 'tie-tab',
    data: { tab: { savedURL: 'https://example.com/tie' } },
  };
  const plan = createArcImportPlan({
    firebaseSyncState: {
      syncData: {
        orderedSpaceIDs: { value: ['tie'] },
        spaceModels: [{ value: space }],
        items: [{ value: container }, { value: tab }],
      },
    },
    sidebarSyncState: {
      container: { value: { orderedSpaceIDs: ['tie'] } },
      spaceModels: [{ value: space }],
      items: [{ value: container }, { value: tab }],
    },
  }, { now: 12 });

  assert.equal(plan.summary.source, 'firebaseSyncState');
  assert.equal(plan.summary.tabs, 1);
});

test('selects legacy plans safely when preview metadata is absent or partially malformed', () => {
  const legacyPlan = {
    spaces: [{ id: 'legacy', name: 'Legacy' }],
    spaceSnapshots: { legacy: { groups: [] } },
    summary: {
      source: 'legacy-export',
      folders: 3,
      tabs: 4,
      skipped: { invalidTabs: 2 },
    },
    conflicts: [
      { spaceId: 'legacy', field: 'name' },
      { spaceId: 'other', field: 'id' },
      { field: 'id' },
    ],
  };
  const selected = selectArcImportPlan(legacyPlan, ['legacy']);

  assert.deepEqual(selected.spaces, [{ id: 'legacy', name: 'Legacy' }]);
  assert.deepEqual(selected.summary, {
    source: 'legacy-export',
    spaces: 1,
    folders: 3,
    tabs: 4,
    skipped: {
      emptyFolders: 0,
      invalidTabs: 2,
      unsupportedItems: 0,
      easel: 0,
      splitView: 0,
    },
  });
  assert.deepEqual(selected.conflicts, [{ spaceId: 'legacy', field: 'name' }]);
  assert.deepEqual(selectArcImportPlan({ spaces: [null, { name: 'No id' }] }, ['legacy']).spaces, []);

  const defaults = selectArcImportPlan({
    spaces: [{ id: 'only' }],
    spaceSnapshots: {},
  }, ['only']);
  assert.equal(defaults.summary.source, 'unknown');
  assert.equal(defaults.summary.tabs, 0);
  assert.deepEqual(selectArcImportPlan(legacyPlan, null).spaces, []);

  const withMalformedPreview = selectArcImportPlan({
    spaces: [{ id: 'legacy', name: 'Legacy' }],
    spaceSnapshots: {},
    summary: { source: 'preview' },
    spacePreviews: [null, { spaceId: 'legacy', folders: 0, tabs: 0 }],
  }, ['legacy']);
  assert.deepEqual(withMalformedPreview.spacePreviews[0].skipped, {
    emptyFolders: 0,
    invalidTabs: 0,
    unsupportedItems: 0,
    easel: 0,
    splitView: 0,
  });

  assert.throws(
    () => selectArcImportPlan({
      spaces: [{ id: 'nameless' }],
      spacePreviews: [{ spaceId: '' }],
    }, ['nameless']),
    /Space "nameless"/,
  );
});

test('append initializes empty state, rejects invalid ids, and cannot overwrite from orphan snapshots', () => {
  const emptyState = {};
  assert.deepEqual(appendArcImportPlan(emptyState, null), {
    importedSpaces: 0,
    importedSpaceIds: [],
    importedTabs: 0,
  });
  assert.deepEqual(emptyState, { spaces: [], spaceSnapshots: {} });

  const state = {
    spaces: [{ id: 'keep', name: 'Keep' }],
    spaceSnapshots: {
      keep: { groups: [{ tabs: [{ url: 'https://example.com/keep' }] }] },
    },
  };
  const result = appendArcImportPlan(state, {
    spaces: [{ id: 'fresh', name: 'Fresh' }, { id: 'without-snapshot', name: 'No snapshot' }],
    spaceSnapshots: {
      fresh: { groups: [{ tabs: [{ url: 'https://example.com/fresh' }] }] },
      keep: { groups: [{ tabs: [{ url: 'https://example.com/overwrite' }] }] },
      orphan: { groups: [{ tabs: [{ url: 'https://example.com/orphan' }] }] },
    },
  });

  assert.equal(result.importedTabs, 1);
  assert.equal(state.spaceSnapshots.keep.groups[0].tabs[0].url, 'https://example.com/keep');
  assert.deepEqual(Object.keys(state.spaceSnapshots).sort(), ['fresh', 'keep']);

  for (const spaces of [
    [{ name: 'Missing id' }],
    [{ id: '__proto__' }],
    [{ id: 'duplicate' }, { id: 'duplicate' }],
  ]) {
    const target = { spaces: [], spaceSnapshots: {} };
    assert.throws(
      () => appendArcImportPlan(target, { spaces, spaceSnapshots: [] }),
      /valid id|no longer available/,
    );
    assert.deepEqual(target, { spaces: [], spaceSnapshots: {} });
  }

  assert.throws(
    () => appendArcImportPlan({ spaces: [], spaceSnapshots: { reserved: {} } }, {
      spaces: [{ id: 'reserved' }],
    }),
    /no longer available/,
  );
});
