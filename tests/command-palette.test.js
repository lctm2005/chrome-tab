import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCommandPaletteItems } from '../src/shared/command-palette.js';

test('command palette exposes Space switching, tab search, and Ask', () => {
  const items = buildCommandPaletteItems({
    spaces: [{ id: 'research', name: 'Research', icon: 'R' }],
    spaceView: [{
      title: 'Sources',
      tabs: [
        { id: 7, title: 'Launch plan', displayTitle: 'Launch plan', url: 'https://example.com/plan', domain: 'example.com' },
        {
          id: 'saved:0',
          snapshotTabId: 'stable-archive-row',
          title: 'Archive',
          url: 'https://archive.example/',
          dormant: true,
        },
      ],
    }],
  });

  assert.ok(items.some((item) => item.action === 'ask'));
  assert.equal(items.find((item) => item.action === 'tidy')?.icon, '🧹');
  assert.ok(items.some((item) => item.kind === 'space' && item.spaceId === 'research'));
  assert.ok(items.some((item) => item.kind === 'tab' && item.tab.id === 7));
  assert.ok(items.some((item) => item.kind === 'tab' && item.tab.dormant));
  assert.equal(items.find((item) => item.tab?.dormant)?.id, 'tab:stable-archive-row');
});

test('command palette ranks title matches and can find tabs by URL', () => {
  const input = {
    spaces: [{ id: 'research', name: 'Research', icon: 'R' }],
    spaceView: [{
      title: 'Sources',
      tabs: [
        { id: 7, title: 'Launch plan', url: 'https://example.com/plan', domain: 'example.com' },
        { id: 8, title: 'Notes', url: 'https://docs.example.com/research', domain: 'docs.example.com' },
      ],
    }],
  };

  assert.equal(buildCommandPaletteItems({ ...input, query: 'research' })[0].kind, 'space');
  assert.equal(buildCommandPaletteItems({ ...input, query: 'docs.example' })[0].tab.id, 8);
});

test('renamed tabs remain searchable by both the panel name and original page title', () => {
  const input = {
    spaceView: [{
      title: 'Reports',
      tabs: [{
        id: 17,
        title: 'Quarterly Planning Report',
        displayTitle: 'Q3 hub',
        panelTitle: 'Q3 hub',
        url: 'https://example.com/report',
      }],
    }],
  };

  for (const query of [
    'Q3 hub',
    'Quarterly Planning Report',
    'Quarterly Plan',
    'Planning Report',
    'Quarterly Report',
  ]) {
    const [result] = buildCommandPaletteItems({ ...input, query });
    assert.equal(result?.tab?.id, 17, query);
    assert.equal(result?.title, 'Q3 hub', query);
  }
});

test('command palette matches natural ordered title words without requiring filler words', () => {
  const askMatches = buildCommandPaletteItems({ query: 'Ask Page' });
  const missingMatches = buildCommandPaletteItems({ query: 'Ask Missing' });

  assert.equal(askMatches.length, 1);
  assert.equal(askMatches[0].action, 'ask');
  assert.deepEqual(missingMatches, []);
  assert.deepEqual(buildCommandPaletteItems({ query: 'Page Ask' }), []);
});

test('command palette prefers an already-open tab over same-title saved history', () => {
  const results = buildCommandPaletteItems({
    query: 'Ask Source Alpha',
    spaceView: [
      {
        title: 'Saved',
        tabs: [{
          id: 'saved:alpha',
          title: 'Ask Source Alpha',
          url: 'https://example.com/alpha',
          dormant: true,
        }],
      },
      {
        title: 'Open',
        tabs: [{
          id: 9,
          title: 'Ask Source Alpha',
          url: 'https://example.com/alpha',
          dormant: false,
        }],
      },
    ],
  });

  assert.equal(results[0].tab.id, 9);
  assert.equal(results[1].tab.id, 'saved:alpha');
});

test('command palette finds tabs across Spaces and identifies the Space in each result', () => {
  const results = buildCommandPaletteItems({
    spaces: [
      { id: 'work', name: 'Work' },
      { id: 'archive', name: 'Archive' },
    ],
    query: 'Quarterly evidence',
    spaceView: [
      {
        spaceId: 'work',
        title: 'Current',
        tabs: [{ id: 7, spaceId: 'work', title: 'Unrelated', url: 'https://work.example/' }],
      },
      {
        spaceId: 'archive',
        title: 'Sources',
        tabs: [{
          id: 'saved:evidence',
          snapshotTabId: 'evidence-row',
          spaceId: 'archive',
          title: 'Quarterly evidence',
          url: 'https://archive.example/evidence',
          dormant: true,
        }],
      },
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'tab');
  assert.equal(results[0].spaceId, 'archive');
  assert.equal(results[0].tab.snapshotTabId, 'evidence-row');
  assert.equal(results[0].meta, 'Archive · Sources · Saved');
});

test('same stable saved identity in different Spaces does not hide either user-visible row', () => {
  const items = buildCommandPaletteItems({
    spaces: [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ],
    spaceView: [
      {
        spaceId: 'alpha',
        title: 'Saved',
        tabs: [{ snapshotTabId: 'shared-row', title: 'Alpha copy', dormant: true }],
      },
      {
        spaceId: 'beta',
        title: 'Saved',
        tabs: [{ snapshotTabId: 'shared-row', title: 'Beta copy', dormant: true }],
      },
    ],
  });
  const tabs = items.filter((item) => item.kind === 'tab');

  assert.deepEqual(tabs.map((item) => item.spaceId), ['alpha', 'beta']);
  assert.deepEqual(tabs.map((item) => item.id), ['tab:shared-row', 'tab:shared-row:beta']);
  assert.deepEqual(tabs.map((item) => item.meta), [
    'Alpha · Saved · Saved',
    'Beta · Saved · Saved',
  ]);
});

test('dormant command identity follows the stable snapshot row instead of its render index', () => {
  const dormant = {
    id: 'snapshot:group-a:0',
    snapshotTabId: 'stable-tab-a',
    title: 'Saved page',
    url: 'https://example.com/saved',
    dormant: true,
  };
  const first = buildCommandPaletteItems({
    spaceView: [{ title: 'Saved', tabs: [dormant] }],
  }).find((item) => item.kind === 'tab');
  const rerendered = buildCommandPaletteItems({
    spaceView: [{ title: 'Saved', tabs: [{ ...dormant, id: 'snapshot:group-b:9' }] }],
  }).find((item) => item.kind === 'tab');

  assert.equal(first.id, 'tab:stable-tab-a');
  assert.equal(rerendered.id, first.id);
});

test('command palette normalizes missing labels and ignores duplicate or invalid tab rows', () => {
  const items = buildCommandPaletteItems({
    spaces: [
      { id: 'named', name: '  named space  ' },
      { id: 'fallback', name: '', icon: '' },
    ],
    spaceView: [
      null,
      {},
      {
        title: '  Saved   pages ',
        tabs: [
          { id: '', url: 'https://example.com/saved', title: '', dormant: true },
          { id: 'duplicate', url: 'https://example.com/saved', dormant: true },
          { id: 'duplicate', url: 'https://example.com/ignored', dormant: true },
          { id: 'invalid-live', title: 'Invalid live row' },
          { id: 12, url: '', title: '', displayTitle: '', domain: '' },
        ],
      },
    ],
  });

  assert.deepEqual(
    items.filter((item) => item.kind === 'space').map((item) => [item.icon, item.title]),
    [['N', 'named space'], ['S', 'Space']],
  );
  assert.equal(items.filter((item) => item.kind === 'tab').length, 3);
  assert.ok(items.some((item) => item.id === 'tab:https://example.com/saved'));
  assert.equal(items.filter((item) => item.id === 'tab:duplicate').length, 1);
  assert.equal(items.find((item) => item.id === 'tab:12')?.title, 'Untitled');
  assert.equal(items.find((item) => item.id === 'tab:12')?.meta, 'Saved pages');
});

test('command palette exercises each ranking tier and enforces its visible result limit', () => {
  const spaces = [
    { id: 'exact', name: 'Needle' },
    { id: 'prefix', name: 'Needle start' },
    { id: 'contains', name: 'Before needle after' },
  ];
  const spaceView = [
    {
      title: 'Needle metadata',
      tabs: [{ id: 1, title: 'Unrelated', url: 'https://example.com/other', domain: 'meta.example' }],
    },
    {
      title: 'Other group',
      tabs: [
      { id: 2, title: 'URL only', url: 'https://needle.example/path', domain: 'elsewhere.example' },
      { id: 3, title: 'No match', url: 'https://example.net/', domain: 'example.net' },
      ],
    },
  ];
  const ranked = buildCommandPaletteItems({ spaces, spaceView, query: '  NEEDLE  ' });

  assert.deepEqual(ranked.slice(0, 3).map((item) => item.spaceId), ['exact', 'prefix', 'contains']);
  assert.equal(ranked.find((item) => item.tab?.id === 1)?.meta, 'Needle metadata · meta.example');
  assert.ok(ranked.some((item) => item.tab?.id === 2));
  assert.ok(!ranked.some((item) => item.tab?.id === 3));

  const manySpaces = Array.from({ length: 50 }, (_, index) => ({
    id: `space-${index}`,
    name: `Space ${index}`,
  }));
  assert.equal(buildCommandPaletteItems({ spaces: manySpaces }).length, 40);
  assert.equal(buildCommandPaletteItems({ spaces: manySpaces, query: 'space' }).length, 40);
  assert.equal(buildCommandPaletteItems().length, 4);
  assert.equal(buildCommandPaletteItems({ spaces: null, spaceView: null, query: null }).length, 4);
});
