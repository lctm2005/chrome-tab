import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpaceSnapshot,
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
  ]);
});

test('only auto closes normal unpinned web tabs', () => {
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'http://example.com', pinned: false }), true);
  assert.equal(shouldAutoCloseTab({ url: 'chrome://extensions', pinned: false }), false);
  assert.equal(shouldAutoCloseTab({ url: 'chrome-extension://abc/page.html', pinned: false }), false);
  assert.equal(shouldAutoCloseTab({ url: 'https://example.com', pinned: true }), false);
});
