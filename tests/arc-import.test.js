import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendArcImportPlan,
  createArcImportPlan,
} from '../src/shared/arc-import.js';

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
        tabs: [
          { title: 'Inbox', url: 'https://example.com/inbox' },
          { title: 'Later', url: 'https://example.com/later' },
        ],
      },
    ],
  });
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
            childrenIds: ['folder-empty', 'bad-tab', 'arc-note', 'arc-split'],
          },
        },
        { value: { id: 'folder-empty', title: 'Empty', data: { list: {} }, childrenIds: [] } },
        { value: { id: 'bad-tab', data: { tab: { savedTitle: 'Arc URL', savedURL: 'arc://boosts' } } } },
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
      invalidTabs: 1,
      unsupportedItems: 0,
      easel: 1,
      splitView: 1,
    },
  });
  assert.deepEqual(plan.spaceSnapshots['arc-space-b'].groups, []);
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
      tabs: [{ title: 'Home', url: 'https://example.com/home' }],
    },
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
  };

  const result = appendArcImportPlan(state, plan);

  assert.equal(result.importedSpaces, 1);
  assert.equal(result.importedTabs, 1);
  assert.equal(state.activeSpaceId, 'default');
  assert.deepEqual(state.spaces.map((space) => space.id), ['default', 'arc-work']);
  assert.equal(state.spaceSnapshots['arc-work'].groups[0].tabs[0].title, 'Spec');
});
