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
        { id: 'saved:0', title: 'Archive', url: 'https://archive.example/', dormant: true },
      ],
    }],
  });

  assert.ok(items.some((item) => item.action === 'ask'));
  assert.ok(items.some((item) => item.kind === 'space' && item.spaceId === 'research'));
  assert.ok(items.some((item) => item.kind === 'tab' && item.tab.id === 7));
  assert.ok(items.some((item) => item.kind === 'tab' && item.tab.dormant));
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
