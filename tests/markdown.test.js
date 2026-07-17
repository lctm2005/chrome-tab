import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown } from '../src/shared/markdown.js';

test('renders common markdown into safe HTML for chat messages', () => {
  const html = renderMarkdown('## Summary\n\n- **One** item\n- `code`\n\n<script>alert(1)</script>');

  assert.match(html, /<h2>Summary<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>One<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('renders paragraph, list, heading, and fenced-code boundaries in order', () => {
  const html = renderMarkdown([
    'Intro line',
    'continues here',
    '- one',
    '* *two*',
    '1. first',
    '2. second',
    '```html',
    '<tag>&',
    '```',
    '### End',
  ].join('\r\n'));

  assert.equal(
    html,
    '<p>Intro line continues here</p>' +
      '<ul><li>one</li><li><em>two</em></li></ul>' +
      '<ol><li>first</li><li>second</li></ol>' +
      '<pre><code>&lt;tag&gt;&amp;</code></pre>' +
      '<h3>End</h3>',
  );
});

test('starts a new block when a paragraph reaches any block marker', () => {
  const cases = [
    ['paragraph\n# Heading', '<p>paragraph</p><h1>Heading</h1>'],
    ['paragraph\n```\ncode\n```', '<p>paragraph</p><pre><code>code</code></pre>'],
    ['paragraph\n- item', '<p>paragraph</p><ul><li>item</li></ul>'],
    ['paragraph\n1. item', '<p>paragraph</p><ol><li>item</li></ol>'],
    ['paragraph\n\nnext', '<p>paragraph</p><p>next</p>'],
  ];

  for (const [markdown, expected] of cases) {
    assert.equal(renderMarkdown(markdown), expected);
  }
});

test('escapes HTML everywhere and keeps code literal', () => {
  assert.equal(
    renderMarkdown('<img src=x onerror="boom"> & \'quoted\''),
    '<p>&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; &#039;quoted&#039;</p>',
  );
  assert.equal(
    renderMarkdown('`<b>**not bold**</b>` and ``'),
    '<p><code>&lt;b&gt;**not bold**&lt;/b&gt;</code> and ``</p>',
  );
  assert.equal(
    renderMarkdown('```\n<script>\nno closing fence'),
    '<pre><code>&lt;script&gt;\nno closing fence</code></pre>',
  );
});

test('links only safe HTTP protocols and supports citation variants', () => {
  const html = renderMarkdown([
    '[secure](HTTPS://example.com/path?x=1&y=2)',
    '[plain](http://example.com)',
    '[unsafe](javascript:alert(1))',
    '[data](data:text/html,payload)',
    '[[1]](https://example.com/one)',
    '[[2] Reference](https://example.com/two)',
  ].join(' '));

  assert.match(html, /<a href="HTTPS:\/\/example\.com\/path\?x=1&amp;y=2"[^>]*>secure<\/a>/);
  assert.match(html, /<a href="http:\/\/example\.com"[^>]*>plain<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/one"[^>]*>\[1\]<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/two"[^>]*>\[2\] Reference<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /href="data:/i);
  assert.match(html, /\[unsafe\]\(javascript:alert\(1\)\)/);
  assert.match(html, /\[data\]\(data:text\/html,payload\)/);
});

test('returns no blocks for empty or blank input', () => {
  assert.equal(renderMarkdown(), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(' \n\r\n\t'), '');
});
