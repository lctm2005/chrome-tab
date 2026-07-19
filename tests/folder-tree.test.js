import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFolderTree,
  folderTitleParts,
  movedGroupTitleForFolderDrop,
  renamedFolderGroupTitle,
} from '../src/shared/folder-tree.js';

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

test('renders deeply nested slash paths without an undocumented depth cutoff', () => {
  const deep = group('Company / Product / Research / Drafts', ['https://example.com/deep']);
  const tree = createFolderTree([deep], { activeSpaceId: 'space-a' });

  assert.equal(tree[0].title, 'Company');
  assert.equal(tree[0].children[0].title, 'Product');
  assert.equal(tree[0].children[0].children[0].title, 'Research');
  assert.equal(tree[0].children[0].children[0].children[0].group.displayTitle, 'Drafts');
});

test('retitles folder descendants when dragging a subfolder out to root', () => {
  assert.equal(
    movedGroupTitleForFolderDrop(
      '归档 / 强类型存储 / 历史文档 / 设计',
      { type: 'folder', path: ['归档', '强类型存储', '历史文档'] },
      []
    ),
    '历史文档 / 设计'
  );

  assert.equal(
    movedGroupTitleForFolderDrop(
      '归档 / 强类型存储 / 历史文档',
      { type: 'folder', path: ['归档', '强类型存储'] },
      []
    ),
    '强类型存储 / 历史文档'
  );
});

test('retitles a dragged group beside root folders without keeping its old parent path', () => {
  assert.equal(
    movedGroupTitleForFolderDrop(
      '归档 / POC',
      { type: 'group', path: ['归档', 'POC'] },
      []
    ),
    'POC'
  );
});

test('retitles groups when renaming a folder without duplicate adjacent path parts', () => {
  assert.equal(
    renamedFolderGroupTitle(
      { title: 'Research / Drafts / Spec' },
      ['Research', 'Drafts'],
      'Research'
    ),
    'Research / Spec'
  );

  assert.equal(
    renamedFolderGroupTitle(
      { title: 'Work / Drafts / Spec' },
      ['Work', 'Drafts'],
      'Archive'
    ),
    'Work / Archive / Spec'
  );
});

test('folder parsing removes empty path segments and handles empty inputs as root groups', () => {
  assert.deepEqual(folderTitleParts(' / Research // Drafts / '), ['Research', 'Drafts']);
  assert.deepEqual(folderTitleParts(), []);

  const emptyTitle = group('', ['https://example.com/empty']);
  assert.deepEqual(createFolderTree([emptyTitle]), [{ type: 'group', group: emptyTitle }]);
  assert.deepEqual(createFolderTree(), []);
});

test('folder moves provide stable fallback names and remove adjacent duplicate path parts', () => {
  assert.equal(
    movedGroupTitleForFolderDrop('', { type: 'folder', path: [] }, ['Archive', 'Archive']),
    'Archive / Group',
  );
  assert.equal(
    movedGroupTitleForFolderDrop('Parent / Leaf', { type: 'group', path: null }, ['Target']),
    'Target / Leaf',
  );
  assert.equal(movedGroupTitleForFolderDrop(), 'Group');
});

test('folder rename falls back safely when paths no longer match or names are missing', () => {
  assert.equal(
    renamedFolderGroupTitle(
      { displayTitle: 'Visible Leaf' },
      ['Missing', 'Folder'],
      'Archive',
    ),
    'Missing / Archive / Visible Leaf',
  );
  assert.equal(
    renamedFolderGroupTitle({ title: 'Only' }, ['Longer', 'Source'], 'Next'),
    'Longer / Next / Only',
  );
  assert.equal(renamedFolderGroupTitle(), 'Group');
  assert.equal(renamedFolderGroupTitle({ title: 'A / B' }, null, ''), 'B');
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
