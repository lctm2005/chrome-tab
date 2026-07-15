import test from 'node:test';
import assert from 'node:assert/strict';

import { appendAskSourceLink } from '../src/shared/ask-sources.js';
import { renderMarkdown } from '../src/shared/markdown.js';

test('renders the active page citation and its single Sources entry as links', () => {
  const answer = appendAskSourceLink('The active page confirms the launch date [1]. A stray [2] is unsupported.', {
    title: 'Launch [draft]',
    url: 'https://example.com/launch',
  });
  const html = renderMarkdown(answer);
  const [answerHtml, sourcesHtml = ''] = html.split('<h3>Sources</h3>');

  assert.match(answerHtml, /href="https:\/\/example\.com\/launch"[^>]*>\[1\]<\/a>/);
  assert.doesNotMatch(answerHtml, /href=[^>]+>\[2\]<\/a>/);
  assert.match(sourcesHtml, /<a href="https:\/\/example\.com\/launch"[^>]*>[^<]*Launch draft[^<]*<\/a>/);
  assert.equal((sourcesHtml.match(/<li>/g) || []).length, 1);
  assert.doesNotMatch(html, /\]\(https:\/\/example\.com\//);
});

test('does not append a source for a restricted or missing page URL', () => {
  assert.equal(
    appendAskSourceLink('No page was sent. [1]', { title: 'Settings', url: 'chrome://settings' }),
    'No page was sent. [1]',
  );
  assert.equal(appendAskSourceLink('No page was sent. [1]'), 'No page was sent. [1]');
});

test('keeps an existing citation link intact and escapes closing parentheses in the page URL', () => {
  const answer = appendAskSourceLink(
    'Read [[1]](https://example.com/doc%29) for details.',
    { title: 'Document', url: 'https://example.com/doc)' },
  );

  assert.equal((answer.match(/\[\[1\]\]\(https:\/\/example\.com\/doc%29\)/g) || []).length, 1);
  assert.equal((answer.match(/https:\/\/example\.com\/doc%29/g) || []).length, 2);
  assert.match(answer, /- \[\[1\] Document\]\(https:\/\/example\.com\/doc%29\)/);
});
