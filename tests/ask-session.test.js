import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASK_SESSION_LIMITS,
  appendAskSessionMessage,
  createAskSession,
  normalizeSessionUrl,
  pruneAskSessions,
  sessionKeyForTab,
} from '../src/shared/ask-session.js';

test('normalizes Ask session URLs without fragment-only churn', () => {
  assert.equal(
    normalizeSessionUrl('https://example.com/page?x=1#section'),
    'https://example.com/page?x=1'
  );
});

test('binds Ask sessions to both tab id and normalized URL', () => {
  const first = sessionKeyForTab({ id: 7, url: 'https://example.com/page#one' });
  const samePage = sessionKeyForTab({ id: 7, url: 'https://example.com/page#two' });
  const otherUrl = sessionKeyForTab({ id: 7, url: 'https://example.com/other' });
  const otherTab = sessionKeyForTab({ id: 8, url: 'https://example.com/page#one' });

  assert.equal(first, samePage);
  assert.notEqual(first, otherUrl);
  assert.notEqual(first, otherTab);
});

test('creates an empty Ask session for a page', () => {
  const session = createAskSession({
    id: 2,
    title: 'Example',
    url: 'https://example.com/a#intro',
  });

  assert.equal(session.key, 'tab:2:https://example.com/a');
  assert.equal(session.title, 'Example');
  assert.equal(session.url, 'https://example.com/a');
  assert.deepEqual(session.messages, []);
});

test('caps stored Ask messages by count and text length', () => {
  const session = createAskSession({
    id: 2,
    title: 'Example',
    url: 'https://example.com/a',
  });

  appendAskSessionMessage(session, 'user', '1234567890', {
    maxMessagesPerSession: 2,
    maxMessageChars: 6,
  });
  appendAskSessionMessage(session, 'assistant', 'abcdefghi', {
    maxMessagesPerSession: 2,
    maxMessageChars: 6,
  });
  appendAskSessionMessage(session, 'user', 'last', {
    maxMessagesPerSession: 2,
    maxMessageChars: 6,
  });

  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].text, 'abcdef...');
  assert.equal(session.messages[1].text, 'last');
});

test('prunes Ask sessions for closed tabs and caps retained sessions', () => {
  const sessions = {
    [sessionKeyForTab({ id: 1, url: 'https://example.com/a' })]: createAskSession({ id: 1, title: 'A', url: 'https://example.com/a' }),
    [sessionKeyForTab({ id: 2, url: 'https://example.com/b' })]: createAskSession({ id: 2, title: 'B', url: 'https://example.com/b' }),
    [sessionKeyForTab({ id: 3, url: 'https://example.com/c' })]: createAskSession({ id: 3, title: 'C', url: 'https://example.com/c' }),
  };
  sessions['tab:1:https://example.com/a'].updatedAt = 1;
  sessions['tab:2:https://example.com/b'].updatedAt = 2;
  sessions['tab:3:https://example.com/c'].updatedAt = 3;

  const pruned = pruneAskSessions(sessions, {
    openTabIds: [1, 2, 3],
    activeKey: 'tab:1:https://example.com/a',
    maxSessions: 2,
  });

  assert.deepEqual(Object.keys(pruned).sort(), [
    'tab:1:https://example.com/a',
    'tab:3:https://example.com/c',
  ]);
  assert.equal(ASK_SESSION_LIMITS.maxMessageChars <= 6000, true);
});
