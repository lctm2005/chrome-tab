import test from 'node:test';
import assert from 'node:assert/strict';

import { createFolderTree } from '../src/shared/folder-tree.js';

test('keeps a standalone group as a group node', () => {
  const tree = createFolderTree([
    group('Inbox', ['https://example.com/inbox']),
  ], { activeSpaceId: 'space-a' });

  assert.deepEqual(tree, [
    {
      type: 'group',
      group: group('Inbox', ['https://example.com/inbox']),
    },
  ]);
});

test('folds direct tabs into a folder when nested groups share the same path', () => {
  const direct = group('Cross-DC', ['https://example.com/root']);
  const childA = group('Cross-DC / 5月6日 跨机房调度问题', ['https://example.com/a']);
  const childB = group('Cross-DC / ringhash mw 未触发', ['https://example.com/b']);

  const tree = createFolderTree([childA, childB, direct], { activeSpaceId: 'space-a' });

  assert.equal(tree.length, 1);
  assert.equal(tree[0].type, 'folder');
  assert.equal(tree[0].key, 'folder:space-a:Cross-DC');
  assert.deepEqual(tree[0].children, [
    {
      type: 'group',
      group: {
        ...childA,
        displayTitle: '5月6日 跨机房调度问题',
      },
    },
    {
      type: 'group',
      group: {
        ...childB,
        displayTitle: 'ringhash mw 未触发',
      },
    },
    {
      type: 'folder-tabs',
      group: direct,
    },
  ]);
});

test('folds direct tabs into nested folders too', () => {
  const direct = group('Research / Specs', ['https://example.com/specs']);
  const child = group('Research / Specs / Drafts', ['https://example.com/drafts']);

  const tree = createFolderTree([direct, child], { activeSpaceId: 'space-a' });

  assert.equal(tree[0].type, 'folder');
  assert.equal(tree[0].title, 'Research');
  assert.equal(tree[0].children[0].type, 'folder');
  assert.equal(tree[0].children[0].title, 'Specs');
  assert.deepEqual(tree[0].children[0].children.map((node) => node.type), ['folder-tabs', 'group']);
});

function group(title, urls) {
  return {
    id: title,
    key: `snapshot:${title}`,
    title,
    color: 'blue',
    collapsed: false,
    dormant: true,
    tabs: urls.map((url, index) => ({ id: `${title}:${index}`, title: url, url })),
  };
}
