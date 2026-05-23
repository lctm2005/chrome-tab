import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceSnapshot,
  dropTemporarySnapshotGroups,
  mergeSpaceSnapshot,
  removeSnapshotTab,
  sanitizeSpaceSnapshot,
  shouldAutoCloseTab,
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
