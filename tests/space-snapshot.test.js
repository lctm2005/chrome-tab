import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceSnapshot,
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isRestorableSnapshotTab,
  mergeOpenSpaceSnapshot,
  mergeSpaceSnapshot,
  removeSnapshotTabs,
  removeSnapshotTab,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
  snapshotHasPersistentContent,
  snapshotTabCount,
  updateSnapshotTab,
} from '../src/shared/space-snapshot.js';

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
    {
      title: 'Ungrouped',
      color: 'grey',
      collapsed: false,
      restorable: true,
      tabs: [
        { title: 'Chrome', url: 'chrome://extensions' },
      ],
    },
  ]);
});

test('snapshots panel-only tab names as restorable metadata', () => {
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
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.groups[0].tabs, [
    {
      title: '3X-UI',
      panelTitle: '3X-UI',
      url: 'https://67.216.201.49:44374/secret/panel/inbounds',
    },
  ]);
});

test('auto closes any unpinned tab owned by a Space', () => {
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'http://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'chrome://extensions', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'chrome-extension://abc/page.html', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: true }), false);
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
      { title: 'Item 2 live', url: 'https://app.test/item?id=2' },
      { title: 'Item 1 saved', url: 'https://app.test/item?id=1' },
      { title: 'Third section saved', url: 'https://app.test/item#third' },
    ],
  }]);
  assert.equal(snapshotTabCount(snapshot), 3);
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
        title: 'Ungrouped',
        color: 'grey',
        tabs: [{ title: ' https://example.com/a ', url: 'https://example.com/a' }],
      },
    ],
  });
  assert.equal(snapshotTabCount(snapshot), 1);
  assert.equal(isRestorableSnapshotTab({ url: 'chrome://newtab' }), false);
  assert.equal(isRestorableSnapshotTab({ url: 'chrome-extension://abc/sidepanel.html?layout=workbench' }), false);
  assert.equal(isRestorableSnapshotTab({ url: ' file:///tmp/demo.html ' }), true);
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
        { title: 'Item 2', url: 'https://app.test/item?id=2' },
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
  });

  assert.deepEqual(result.groups[0].tabs, [
    { title: 'Item 1', url: 'https://app.test/item?id=1' },
    { title: 'Item 2 updated', url: 'https://app.test/item?id=2&view=full' },
    { title: 'Third section', url: 'https://app.test/item#third' },
  ]);
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
  }), {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Plan', url: 'https://example.com/plan' },
          { title: 'Better Spec', url: 'https://example.com/better' },
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
