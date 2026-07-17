import test from 'node:test';
import assert from 'node:assert/strict';

import { extractCurrentPage } from '../src/shared/page-extraction.js';

function pageRuntime({
  activeElement = null,
  articleText,
  bodyText = '',
  selection = '',
  title = 'Fixture title',
  url = 'https://example.com/fixture',
} = {}) {
  return {
    document: {
      activeElement,
      title,
      body: { innerText: bodyText },
      querySelector(selector) {
        if (selector !== 'article' || articleText === undefined) return null;
        return { innerText: articleText };
      },
    },
    location: { href: url },
    getSelection() {
      return { toString: () => selection };
    },
  };
}

test('sends only selected text when the page has a real document selection', () => {
  const result = extractCurrentPage(100, pageRuntime({
    articleText: '  Article\ncontent  ',
    bodyText: 'Body content',
    selection: ' selected\twords ',
  }));

  assert.deepEqual(result, {
    title: 'Fixture title',
    url: 'https://example.com/fixture',
    contentMode: 'selection',
    selectedText: 'selected words',
    selection: 'selected words',
    text: '',
    charCount: 14,
    originalCharCount: 14,
    truncated: false,
  });
});

test('falls back to normalized body text when the page has no article', () => {
  const result = extractCurrentPage(100, pageRuntime({
    bodyText: '  Body\n\ncontent\tcontinues  ',
  }));

  assert.equal(result.contentMode, 'page');
  assert.equal(result.selectedText, '');
  assert.equal(result.selection, '');
  assert.equal(result.text, 'Body content continues');
  assert.equal(result.charCount, 22);
  assert.equal(result.originalCharCount, 22);
  assert.equal(result.truncated, false);
});

test('falls back to body text when the article is empty after whitespace normalization', () => {
  const result = extractCurrentPage(100, pageRuntime({
    articleText: ' \n\t ',
    bodyText: 'Useful body text',
  }));

  assert.equal(result.text, 'Useful body text');
});

test('keeps selected text useful even when the document body has no readable text', () => {
  const result = extractCurrentPage(100, pageRuntime({
    articleText: ' \n ',
    bodyText: '\t ',
    selection: ' selected only ',
    title: '',
    url: 'https://example.com/empty',
  }));

  assert.deepEqual(result, {
    title: '',
    url: 'https://example.com/empty',
    contentMode: 'selection',
    selectedText: 'selected only',
    selection: 'selected only',
    text: '',
    charCount: 13,
    originalCharCount: 13,
    truncated: false,
  });
});

test('normalizes before applying the limit and reports accurate truncation counts', () => {
  const result = extractCurrentPage(10, pageRuntime({
    articleText: ' Alpha \n beta\t gamma ',
    selection: ' one \n two three ',
  }));

  assert.deepEqual(result, {
    title: 'Fixture title',
    url: 'https://example.com/fixture',
    contentMode: 'selection',
    selectedText: 'one two th',
    selection: 'one two th',
    text: '',
    charCount: 10,
    originalCharCount: 13,
    truncated: true,
  });
});

test('floors fractional limits and treats non-positive limits as an empty excerpt', () => {
  const runtime = pageRuntime({ articleText: 'abcdef', selection: 'uvwxyz' });

  assert.deepEqual(extractCurrentPage(3.9, runtime), {
    title: 'Fixture title',
    url: 'https://example.com/fixture',
    contentMode: 'selection',
    selectedText: 'uvw',
    selection: 'uvw',
    text: '',
    charCount: 3,
    originalCharCount: 6,
    truncated: true,
  });
  assert.deepEqual(extractCurrentPage(0, runtime), {
    title: 'Fixture title',
    url: 'https://example.com/fixture',
    contentMode: 'selection',
    selectedText: '',
    selection: '',
    text: '',
    charCount: 0,
    originalCharCount: 6,
    truncated: true,
  });
  assert.equal(extractCurrentPage(-3, runtime).text, '');
});

test('treats invalid limits and missing page APIs as an empty readable page', () => {
  const expected = {
    title: '',
    url: '',
    contentMode: 'page',
    selectedText: '',
    selection: '',
    text: '',
    charCount: 0,
    originalCharCount: 0,
    truncated: false,
  };

  assert.deepEqual(extractCurrentPage(Number.NaN, {}), expected);
  assert.deepEqual(extractCurrentPage(Number.POSITIVE_INFINITY, {
    document: {
      body: null,
      querySelector: () => ({}),
    },
    location: null,
    getSelection: () => null,
  }), expected);
});

test('remains self-contained when Chrome serializes it for executeScript', () => {
  const serializedFunction = Function(`return (${extractCurrentPage.toString()});`)();
  const result = serializedFunction(100, pageRuntime({
    articleText: 'Serialized article',
    bodyText: 'Serialized body',
    selection: 'Serialized selection',
  }));

  assert.equal(result.contentMode, 'selection');
  assert.equal(result.text, '');
  assert.equal(result.selectedText, 'Serialized selection');
  assert.equal(result.selection, 'Serialized selection');
});

test('reads the selected range from the active textarea when document selection is empty', () => {
  const result = extractCurrentPage(100, pageRuntime({
    activeElement: {
      tagName: 'TEXTAREA',
      value: 'prefix selected\twords suffix',
      selectionStart: 7,
      selectionEnd: 21,
    },
    articleText: 'Private unselected article',
  }));

  assert.deepEqual(result, {
    title: 'Fixture title',
    url: 'https://example.com/fixture',
    contentMode: 'selection',
    selectedText: 'selected words',
    selection: 'selected words',
    text: '',
    charCount: 14,
    originalCharCount: 14,
    truncated: false,
  });
});

test('reads supported active text inputs but never reads password selections', () => {
  for (const type of ['', 'text', 'search', 'email', 'tel', 'url']) {
    const result = extractCurrentPage(100, pageRuntime({
      activeElement: {
        tagName: 'INPUT',
        type,
        value: 'before chosen after',
        selectionStart: 7,
        selectionEnd: 13,
      },
      bodyText: 'Visible page body',
    }));

    assert.equal(result.contentMode, 'selection', type || '(default)');
    assert.equal(result.selectedText, 'chosen', type || '(default)');
    assert.equal(result.text, '', type || '(default)');
  }

  const password = extractCurrentPage(100, pageRuntime({
    activeElement: {
      tagName: 'INPUT',
      type: 'password',
      get value() {
        throw new Error('Password value must never be read.');
      },
      selectionStart: 0,
      selectionEnd: 19,
    },
    bodyText: 'Visible page body',
  }));

  assert.equal(password.contentMode, 'page');
  assert.equal(password.selectedText, '');
  assert.equal(password.text, 'Visible page body');
});

test('ignores collapsed and non-text control selections', () => {
  for (const activeElement of [
    {
      tagName: 'TEXTAREA',
      value: 'not selected',
      selectionStart: 4,
      selectionEnd: 4,
    },
    {
      tagName: 'INPUT',
      type: 'checkbox',
      value: 'must not be read',
      selectionStart: 0,
      selectionEnd: 16,
    },
    {
      tagName: 'TEXTAREA',
      value: '',
      selectionStart: 0,
      selectionEnd: 1,
    },
  ]) {
    const result = extractCurrentPage(100, pageRuntime({
      activeElement,
      articleText: 'Readable article',
    }));

    assert.equal(result.contentMode, 'page');
    assert.equal(result.selectedText, '');
    assert.equal(result.text, 'Readable article');
  }
});

test('selection mode neither reads unselected DOM text nor requires location metadata', () => {
  let pageTextRead = false;
  const result = extractCurrentPage(100, {
    document: {
      title: 'Selection-only fixture',
      get body() {
        pageTextRead = true;
        throw new Error('Unselected body must not be read.');
      },
      querySelector() {
        pageTextRead = true;
        throw new Error('Unselected article must not be read.');
      },
    },
    getSelection() {
      return { toString: () => 'safe selection' };
    },
  });

  assert.equal(pageTextRead, false);
  assert.equal(result.url, '');
  assert.equal(result.selectedText, 'safe selection');
  assert.equal(result.text, '');
});
