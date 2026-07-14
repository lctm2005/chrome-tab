import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendAskSourceLinks,
  DEFAULT_ASK_SOURCE_LIMIT,
  MAX_ASK_SOURCE_LIMIT,
  selectAskSpaceSources,
} from '../src/shared/ask-sources.js';
import { renderMarkdown } from '../src/shared/markdown.js';

test('renders both inline citations and the Sources list as clickable links', () => {
  const answer = appendAskSourceLinks('Compare [1] and [2].', [
    { title: 'First [draft]', url: 'https://example.com/first' },
    { title: 'Second', url: 'https://example.com/second' },
  ]);
  const html = renderMarkdown(answer);
  const [answerHtml, sourcesHtml = ''] = html.split('<h3>Sources</h3>');

  assert.match(answerHtml, /href="https:\/\/example\.com\/first"/);
  assert.match(answerHtml, /href="https:\/\/example\.com\/second"/);
  assert.match(sourcesHtml, /<a href="https:\/\/example\.com\/first"[^>]*>[^<]*First draft[^<]*<\/a>/);
  assert.match(sourcesHtml, /<a href="https:\/\/example\.com\/second"[^>]*>[^<]*Second[^<]*<\/a>/);
  assert.doesNotMatch(html, /\]\(https:\/\/example\.com\//);
});

test('uses only explicitly selected live web tabs as Ask Space sources', () => {
  const first = { id: 1, title: 'First', url: 'https://example.com/first' };
  const view = [
    {
      key: 'group:1',
      tabs: [
        first,
        { id: 2, title: 'Second', url: 'http://example.test/second' },
        { id: 3, title: 'Saved', url: 'https://example.com/saved', dormant: true },
      ],
    },
    {
      key: 'ungrouped',
      tabs: [
        first,
        { id: 4, title: 'Extension', url: 'chrome-extension://space/workbench.html' },
        { id: 5, title: 'Local file', url: 'file:///tmp/notes.html' },
      ],
    },
  ];

  const result = selectAskSpaceSources(view, [3, 4, 1, 999, '1']);

  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tabIds, [1]);
  assert.equal(result.count, 1);
  assert.equal(result.untouchedCount, 4);
  assert.deepEqual(result.counts, {
    total: 5,
    eligible: 2,
    selected: 4,
    requested: 1,
    included: 1,
    untouched: 4,
    excluded: 3,
    limited: 0,
  });
});

test('uses every live web tab in merged Space order when nothing is selected', () => {
  const view = [
    {
      key: 'group:docs',
      tabs: [
        { id: 8, title: 'HTTPS', url: 'https://docs.example/a' },
        { id: 9, title: 'Saved', url: 'https://docs.example/saved', dormant: true },
      ],
    },
    {
      key: 'ungrouped',
      tabs: [
        { id: 10, title: 'HTTP', url: 'http://plain.example/b' },
        { id: 11, title: 'New tab', url: 'chrome://newtab' },
      ],
    },
  ];

  const result = selectAskSpaceSources(view, new Set());

  assert.equal(result.mode, 'all');
  assert.deepEqual(result.tabIds, [8, 10]);
  assert.equal(result.count, 2);
  assert.equal(result.untouchedCount, 2);
  assert.equal(result.counts.eligible, 2);
  assert.equal(result.counts.excluded, 2);
});

test('does not fall back to all Space tabs when an explicit selection has no eligible source', () => {
  const view = [{
    key: 'ungrouped',
    tabs: [
      { id: 1, title: 'Web', url: 'https://example.com' },
      { id: 2, title: 'Saved', url: 'https://example.com/saved', dormant: true },
    ],
  }];

  const result = selectAskSpaceSources(view, [2]);

  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tabs, []);
  assert.equal(result.count, 0);
  assert.equal(result.untouchedCount, 2);
});

test('treats even an invalid explicit selection as selected mode instead of widening disclosure', () => {
  const view = [{
    key: 'ungrouped',
    tabs: [{ id: 1, title: 'Web', url: 'https://example.com' }],
  }];

  const result = selectAskSpaceSources(view, ['saved:ungrouped:0']);

  assert.equal(result.mode, 'selected');
  assert.deepEqual(result.tabs, []);
  assert.equal(result.untouchedCount, 1);
});

test('deduplicates merged tab entries and prefers the live copy', () => {
  const view = [
    {
      key: 'saved',
      tabs: [{ id: 7, title: 'Saved copy', url: 'https://example.com/old', dormant: true }],
    },
    {
      key: 'live',
      tabs: [{ id: 7, title: 'Live copy', url: 'https://example.com/live' }],
    },
  ];

  const result = selectAskSpaceSources(view);

  assert.deepEqual(result.tabIds, [7]);
  assert.equal(result.tabs[0].title, 'Live copy');
  assert.equal(result.counts.total, 1);
});

test('caps all-Space sources and reports tabs left untouched by the limit', () => {
  const tabs = Array.from({ length: DEFAULT_ASK_SOURCE_LIMIT + 3 }, (_, index) => ({
    id: index + 1,
    title: `Page ${index + 1}`,
    url: `https://example.com/${index + 1}`,
  }));

  const result = selectAskSpaceSources([{ key: 'all', tabs }]);

  assert.equal(result.tabs.length, DEFAULT_ASK_SOURCE_LIMIT);
  assert.equal(result.truncated, true);
  assert.equal(result.counts.limited, 3);
  assert.equal(result.untouchedCount, 3);
  assert.equal(MAX_ASK_SOURCE_LIMIT >= DEFAULT_ASK_SOURCE_LIMIT, true);
});

test('caps an explicit selection without silently widening or losing its counts', () => {
  const tabs = Array.from({ length: DEFAULT_ASK_SOURCE_LIMIT + 2 }, (_, index) => ({
    id: index + 1,
    title: `Selected page ${index + 1}`,
    url: `https://selected.example/${index + 1}`,
  }));

  const result = selectAskSpaceSources(
    [{ key: 'selected', tabs }],
    tabs.map((tab) => tab.id),
  );

  assert.equal(result.mode, 'selected');
  assert.equal(result.count, DEFAULT_ASK_SOURCE_LIMIT);
  assert.equal(result.counts.selected, DEFAULT_ASK_SOURCE_LIMIT + 2);
  assert.equal(result.counts.requested, DEFAULT_ASK_SOURCE_LIMIT + 2);
  assert.equal(result.counts.limited, 2);
  assert.equal(result.untouchedCount, 2);
  assert.equal(result.truncated, true);
});
