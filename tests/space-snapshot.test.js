import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceSnapshot,
  comparableSnapshotUrl,
  dropTemporarySnapshotGroups,
  isRestorableSnapshotTab,
  mergeSpaceSnapshot,
  removeSnapshotTabs,
  removeSnapshotTab,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
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
  assert.equal(isRestorableSnapshotTab({ url: ' file:///tmp/demo.html ' }), true);
});

test('deduplicates stored snapshot URL variants within a group', () => {
  const snapshot = sanitizeSpaceSnapshot({
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Argos',
        color: 'blue',
        tabs: [
          { title: 'Latest query', url: 'https://cloud-boe.bytedance.net/logs?keyword=new&page=2#result' },
          { title: 'Old query', url: 'https://cloud-boe.bytedance.net/logs?keyword=old' },
          { title: 'Release', url: 'https://lark-devops.bytedance.net/releases/42?tab=overview' },
        ],
      },
    ],
  });

  assert.deepEqual(snapshot.groups[0].tabs, [
    { title: 'Latest query', url: 'https://cloud-boe.bytedance.net/logs?keyword=new&page=2#result' },
    { title: 'Release', url: 'https://lark-devops.bytedance.net/releases/42?tab=overview' },
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

test('removes only the first matching dormant duplicate from a snapshot group', () => {
  const snapshot = {
    version: 1,
    updatedAt: 1,
    groups: [
      {
        title: 'Docs',
        color: 'blue',
        tabs: [
          { title: 'Spec A', url: 'https://example.com/spec' },
          { title: 'Spec B', url: 'https://example.com/spec' },
        ],
      },
    ],
  };

  const result = removeSnapshotTab(snapshot, {
    groupTitle: 'Docs',
    groupColor: 'blue',
    url: 'https://example.com/spec',
  });

  assert.deepEqual(result.groups[0].tabs, [
    { title: 'Spec B', url: 'https://example.com/spec' },
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

test('treats query and hash changes as the same snapshot page', () => {
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
