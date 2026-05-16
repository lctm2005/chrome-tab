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
