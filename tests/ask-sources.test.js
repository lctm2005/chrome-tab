import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendAskSourceLink,
  askHistoryMessageText,
} from '../src/shared/ask-sources.js';
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

test('keeps an existing citation link intact and escapes parentheses in the page URL', () => {
  const answer = appendAskSourceLink(
    'Read [[1]](https://example.com/doc%29) for details.',
    { title: 'Document', url: 'https://example.com/doc)' },
  );

  assert.equal((answer.match(/\[\[1\]\]\(https:\/\/example\.com\/doc%29\)/g) || []).length, 1);
  assert.equal((answer.match(/https:\/\/example\.com\/doc%29/g) || []).length, 2);
  assert.match(answer, /- \[\[1\] Document\]\(https:\/\/example\.com\/doc%29\)/);

  const balanced = appendAskSourceLink('Balanced [1].', {
    title: 'Balanced',
    url: 'https://example.com/a_(b)',
  });
  assert.equal((balanced.match(/https:\/\/example\.com\/a_%28b%29/g) || []).length, 2);
  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: balanced }),
    'Balanced [1].',
  );
});

test('links citations at every position and still appends a source when the answer is empty', () => {
  const page = { title: 'Reference', url: 'HTTPS://example.com/reference' };

  assert.equal(
    appendAskSourceLink('[1]', page),
    '[[1]](HTTPS://example.com/reference)\n\n### Sources\n- [[1] Reference](HTTPS://example.com/reference)',
  );
  assert.equal(
    appendAskSourceLink('First [1], then [1].', page).match(/\[\[1\]\]/g)?.length,
    2,
  );
  assert.equal(
    appendAskSourceLink('', page),
    '### Sources\n- [[1] Reference](HTTPS://example.com/reference)',
  );
});

test('uses the page URL when a supplied title sanitizes to an empty label', () => {
  assert.equal(
    appendAskSourceLink('Answer without an inline citation.', {
      title: ' [ ] ',
      url: 'https://example.com/fallback-title',
    }),
    'Answer without an inline citation.\n\n### Sources\n' +
      '- [[1] https://example.com/fallback-title](https://example.com/fallback-title)',
  );
  assert.match(
    appendAskSourceLink('Answer.', { url: 'https://example.com/no-title' }),
    /\[\[1\] https:\/\/example\.com\/no-title\]/,
  );
  assert.equal(appendAskSourceLink(), '');
});

test('removes generated assistant Sources and restores every generated inline citation marker', () => {
  const stored = [
    'First claim [[1]](https://example.com/one).',
    'Nested URL [[23]](https://example.com/docs/(draft)/item_(2)) and escaped URL ' +
      '[[4]](https://example.com/a\\(b\\)).',
    'Legacy generated URL [[6]](https://example.com/archive_(draft%29).',
    '',
    '### Sources',
    '- [[1] First source](https://example.com/one)',
    '- [[23] Draft source](https://example.com/docs/(draft)/item_(2))',
    '- [[6] Legacy source](https://example.com/archive_(draft%29)',
  ].join('\n');

  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: stored }),
    'First claim [1].\nNested URL [23] and escaped URL [4].\nLegacy generated URL [6].',
  );
});

test('keeps user history byte-for-byte even when it resembles generated citation markup', () => {
  const userText = '  My [[7]](https://example.com/user_(copy)) link.\r\n\r\n' +
    '### Sources\r\n- [[7] User note](https://example.com/user_(copy))  ';

  assert.equal(
    askHistoryMessageText({ role: 'user', text: userText }),
    userText,
  );
  assert.equal(
    askHistoryMessageText({ role: 'system', text: userText }),
    userText,
  );
});

test('leaves ordinary assistant Markdown links and non-generated Sources sections intact', () => {
  const ordinary = [
    'Read [the guide](https://example.com/guide), [1](https://example.com/manual), and ' +
      '[[topic]](https://example.com/wiki).',
    '',
    '### Sources',
    '- [Guide](https://example.com/guide)',
  ].join('\n');

  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: ordinary }),
    ordinary,
  );
});

test('restores generated inline citations without requiring a Sources appendix', () => {
  assert.equal(
    askHistoryMessageText({
      role: 'assistant',
      text: 'Use [[1]](https://example.com/a_(b)) then [[2]](HTTPS://example.com/two).',
    }),
    'Use [1] then [2].',
  );
  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: 'No generated decoration here.' }),
    'No generated decoration here.',
  );
});

test('preserves incomplete, empty, restricted, or multiline generated-looking markers', () => {
  const malformed = [
    'Incomplete [[1]](https://example.com/open',
    'Marker only [[2]] and empty [[3]]().',
    'Restricted [[4]](chrome://settings) and multiline [[5]](https://example.com/',
    'next).',
  ].join('\n');

  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: malformed }),
    malformed,
  );
  assert.equal(askHistoryMessageText(), '');
});

test('removes only a complete generated appendix at the end of assistant history', () => {
  const earlierHeading = [
    'A normal section follows.',
    '',
    '### Sources',
    'This prose is part of the answer.',
    '',
    'Final claim [[8]](https://example.com/final).',
    '',
    '### Sources',
    '- [[8] Final](https://example.com/final)',
    '',
  ].join('\r\n');
  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: earlierHeading }),
    'A normal section follows.\r\n\r\n### Sources\r\nThis prose is part of the answer.\r\n\r\n' +
      'Final claim [8].',
  );

  const appendixOnly = '### Sources\n- [[1] Only source](https://example.com/only)';
  assert.equal(askHistoryMessageText({ role: 'assistant', text: appendixOnly }), '');

  const incompleteAppendix = 'Answer.\n\n### Sources\n- [[1] Missing close](https://example.com/open';
  assert.equal(
    askHistoryMessageText({ role: 'assistant', text: incompleteAppendix }),
    incompleteAppendix,
  );
});
