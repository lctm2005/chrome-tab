import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASK_SESSION_LIMITS,
  PORTABLE_ASK_SESSION_PREFIX,
  adoptPortableAskSession,
  askSessionKeyAfterTabReplacement,
  askSessionTabFromKey,
  appendAskSessionMessage,
  clampAskSessionMessages,
  createAskSession,
  createSpaceAskSession,
  materializeAskSessionForTurn,
  normalizeSessionUrl,
  projectAskSessionForTab,
  pruneAskSessions,
  rebindAskSessionsForTabReplacement,
  replayAskSessionTabReplacements,
  sessionKeyForTab,
  sessionKeyForSpace,
  tabIdFromSessionKey,
  updateAskSessionMessage,
} from '../src/shared/ask-session.js';
import { appendAskSourceLink } from '../src/shared/ask-sources.js';

test('normalizes Ask session URLs without collapsing hash-routed pages', () => {
  assert.equal(
    normalizeSessionUrl('https://example.com/page?x=1#section'),
    'https://example.com/page?x=1#section'
  );
});

test('binds Ask sessions to both tab id and normalized URL', () => {
  const first = sessionKeyForTab({ id: 7, url: 'https://example.com/page#one' });
  const samePage = sessionKeyForTab({ id: 7, url: 'https://example.com/page#two' });
  const otherUrl = sessionKeyForTab({ id: 7, url: 'https://example.com/other' });
  const otherTab = sessionKeyForTab({ id: 8, url: 'https://example.com/page#one' });

  assert.notEqual(first, samePage);
  assert.notEqual(first, otherUrl);
  assert.notEqual(first, otherTab);
});

test('projects numeric Ask session keys onto the exact open tab id and normalized URL', () => {
  const openTabs = [
    { id: 8, displayTitle: 'Wrong id', url: 'https://example.com/page' },
    { id: 7, displayTitle: 'Wrong URL', url: 'https://example.com/other' },
    { id: 7, displayTitle: 'Panel title', title: 'Chrome title', url: ' https://example.com/page ' },
  ];

  assert.deepEqual(
    askSessionTabFromKey('tab:7:https://example.com/page', openTabs),
    { id: 7, title: 'Panel title', url: 'https://example.com/page' },
  );
  assert.deepEqual(
    askSessionTabFromKey('tab:8:https://example.com/other', openTabs),
    { id: 8, title: 'Current page', url: 'https://example.com/other' },
  );
});

test('projects unknown Ask keys by normalized URL and deterministically chooses the first duplicate', () => {
  const openTabs = [
    { id: 3, title: 'First matching tab', url: 'https://example.com' },
    { id: 4, displayTitle: 'Second matching tab', url: 'https://example.com/' },
  ];

  assert.deepEqual(
    askSessionTabFromKey('tab:unknown:https://example.com', openTabs),
    { id: null, title: 'First matching tab', url: 'https://example.com' },
  );
});

test('Ask key projection preserves hash-sensitive URL matching and title fallbacks', () => {
  const openTabs = [
    { id: 1, displayTitle: '', title: 'Chrome title', url: 'https://example.com/page#one' },
    { id: 2, displayTitle: '', title: '', url: 'https://example.com/page#two' },
  ];

  assert.deepEqual(
    askSessionTabFromKey('tab:1:https://example.com/page#one', openTabs),
    { id: 1, title: 'Chrome title', url: 'https://example.com/page#one' },
  );
  assert.deepEqual(
    askSessionTabFromKey('tab:2:https://example.com/page#two', openTabs),
    { id: 2, title: 'Current page', url: 'https://example.com/page#two' },
  );
  assert.deepEqual(
    askSessionTabFromKey('tab:1:https://example.com/page#two', openTabs),
    { id: 1, title: 'Current page', url: 'https://example.com/page#two' },
  );
});

test('Ask key projection supports tab zero, leading zeros, and numeric string tab ids', () => {
  const openTabs = [
    { id: '', title: 'Malformed zero', url: 'https://example.com/zero' },
    { id: '0', title: 'Zero', url: 'https://example.com/zero' },
    { id: '7', title: 'Seven', url: 'https://example.com/seven' },
  ];

  assert.deepEqual(
    askSessionTabFromKey('tab:0:https://example.com/zero', openTabs),
    { id: 0, title: 'Zero', url: 'https://example.com/zero' },
  );
  assert.deepEqual(
    askSessionTabFromKey('tab:007:https://example.com/seven', openTabs),
    { id: 7, title: 'Seven', url: 'https://example.com/seven' },
  );
});

test('Ask key projection handles empty, malformed, and unsafe optional inputs without throwing', () => {
  assert.deepEqual(askSessionTabFromKey(), {
    id: null,
    title: 'Current page',
    url: 'about:blank',
  });
  assert.deepEqual(askSessionTabFromKey('tab:unknown:'), {
    id: null,
    title: 'Current page',
    url: 'about:blank',
  });
  assert.deepEqual(askSessionTabFromKey('not-a-session-key', null), {
    id: null,
    title: 'Current page',
    url: 'not-a-session-key',
  });
  assert.deepEqual(askSessionTabFromKey('tab:9:https://example.com/', [
    null,
    { id: Symbol('unsafe'), title: 'Unsafe id', url: 'https://example.com/' },
  ]), {
    id: 9,
    title: 'Current page',
    url: 'https://example.com/',
  });
  assert.deepEqual(askSessionTabFromKey(Symbol('unsafe-key'), 'not-an-array'), {
    id: null,
    title: 'Current page',
    url: 'Symbol(unsafe-key)',
  });
});

test('Chrome tab replacement rekeys every tab-scoped Ask session without losing history', () => {
  const first = createAskSession({ id: 7, title: 'First', url: 'https://example.com/one' }, 1);
  first.messages = [{ id: 'm1', role: 'user', text: 'Keep me', createdAt: 1 }];
  const second = createAskSession({ id: 7, title: 'Second', url: 'https://example.com/two' }, 2);
  const portable = { key: 'page:portable:1', url: 'https://example.com/portable', messages: [] };
  const sessions = { [first.key]: first, [second.key]: second, [portable.key]: portable };

  const rebound = rebindAskSessionsForTabReplacement(sessions, 7, 70);
  const firstKey = sessionKeyForTab({ id: 70, url: first.url });
  const secondKey = sessionKeyForTab({ id: 70, url: second.url });
  assert.deepEqual(rebound.keyMap, { [first.key]: firstKey, [second.key]: secondKey });
  assert.equal(rebound.sessions[first.key], undefined);
  assert.equal(rebound.sessions[firstKey].tabId, 70);
  assert.deepEqual(rebound.sessions[firstKey].messages, first.messages);
  assert.equal(rebound.sessions[secondKey].title, 'Second');
  assert.strictEqual(rebound.sessions[portable.key], portable);
  assert.deepEqual(sessions, { [first.key]: first, [second.key]: second, [portable.key]: portable });
});

test('Ask replacement merges a concurrently updated new-id session without losing partial text', () => {
  const oldSession = createAskSession({ id: 7, url: 'https://example.com/stream' }, 10);
  oldSession.updatedAt = 20;
  oldSession.messages = [
    { id: 'question', role: 'user', text: 'Explain', createdAt: 10 },
    { id: 'answer', role: 'assistant', text: 'Thinking...', createdAt: 11 },
  ];
  const newSession = createAskSession({ id: 70, url: 'https://example.com/stream' }, 12);
  newSession.updatedAt = 30;
  newSession.messages = [
    { id: 'answer', role: 'assistant', text: 'Latest partial answer', createdAt: 11, updatedAt: 30 },
    { id: 'new-only', role: 'user', text: 'Keep this too', createdAt: 12 },
  ];
  const sessions = { [oldSession.key]: oldSession, [newSession.key]: newSession };

  const rebound = rebindAskSessionsForTabReplacement(sessions, 7, 70).sessions[newSession.key];
  assert.equal(rebound.createdAt, 10);
  assert.equal(rebound.updatedAt, 30);
  assert.deepEqual(rebound.messages.map(({ id, text }) => ({ id, text })), [
    { id: 'question', text: 'Explain' },
    { id: 'answer', text: 'Latest partial answer' },
    { id: 'new-only', text: 'Keep this too' },
  ]);

  const sparseExisting = rebindAskSessionsForTabReplacement({
    [oldSession.key]: { ...oldSession, messages: null, createdAt: null, updatedAt: null },
    [newSession.key]: { ...newSession, messages: null, createdAt: null, updatedAt: null },
  }, 7, 70).sessions[newSession.key];
  assert.deepEqual(sparseExisting.messages, []);
  assert.equal(sparseExisting.createdAt, 0);
  assert.equal(sparseExisting.updatedAt, 0);

  const existingDateFallback = rebindAskSessionsForTabReplacement({
    [oldSession.key]: { ...oldSession, messages: null, createdAt: null, updatedAt: null },
    [newSession.key]: {
      ...newSession,
      messages: [null, { role: 'assistant', text: 'Legacy message without an id' }],
      createdAt: 12,
      updatedAt: 30,
    },
  }, 7, 70).sessions[newSession.key];
  assert.equal(existingDateFallback.createdAt, 12);
  assert.equal(existingDateFallback.messages.length, 2);

  const reboundDateFallback = rebindAskSessionsForTabReplacement({
    [oldSession.key]: oldSession,
    [newSession.key]: { ...newSession, messages: [], createdAt: null },
  }, 7, 70).sessions[newSession.key];
  assert.equal(reboundDateFallback.createdAt, 10);

  for (const invalidExisting of ['legacy', []]) {
    const invalidCollision = rebindAskSessionsForTabReplacement({
      [oldSession.key]: oldSession,
      [newSession.key]: invalidExisting,
    }, 7, 70).sessions[newSession.key];
    assert.deepEqual(invalidCollision.messages, oldSession.messages);
  }
});

test('Ask replacement helpers normalize sparse state and ignore invalid or unrelated ids', () => {
  const legacy = { legacy: { tabId: 7, title: 'Legacy', url: 'https://example.com/legacy' } };
  const rebound = rebindAskSessionsForTabReplacement(legacy, '7', '70');
  const nextKey = sessionKeyForTab({ id: 70, url: legacy.legacy.url });
  assert.equal(rebound.sessions.legacy, undefined);
  assert.equal(rebound.sessions[nextKey].key, nextKey);

  assert.equal(
    askSessionKeyAfterTabReplacement('tab:7:https://example.com/', 7, 70),
    'tab:70:https://example.com/',
  );
  for (const args of [
    ['', 7, 70],
    ['space:work', 7, 70],
    ['tab:8:https://example.com/', 7, 70],
    ['tab:7:https://example.com/', 'bad', 70],
    ['tab:7:https://example.com/', 7, 'bad'],
    ['tab:7:https://example.com/', 7, 7],
  ]) {
    assert.equal(askSessionKeyAfterTabReplacement(...args), args[0]);
  }
  assert.deepEqual(rebindAskSessionsForTabReplacement(null, 7, 70), { sessions: {}, keyMap: {} });
  assert.deepEqual(rebindAskSessionsForTabReplacement([], 7, 70), { sessions: {}, keyMap: {} });
  assert.deepEqual(rebindAskSessionsForTabReplacement(legacy, 'bad', 70), {
    sessions: legacy,
    keyMap: {},
  });
  assert.deepEqual(rebindAskSessionsForTabReplacement(legacy, 7, 'bad'), {
    sessions: legacy,
    keyMap: {},
  });
  assert.deepEqual(rebindAskSessionsForTabReplacement(legacy, 7, 7), {
    sessions: legacy,
    keyMap: {},
  });
  const malformed = rebindAskSessionsForTabReplacement({
    'tab:7:about:blank': null,
  }, 7, 70);
  assert.deepEqual(malformed.sessions['tab:70:about:blank'], {
    key: 'tab:70:about:blank',
    tabId: 70,
    url: 'about:blank',
  });
});

test('Ask final persistence replays a consecutive replacement chain before updating the original message', () => {
  const original = createAskSession({ id: 7, url: 'https://example.com/final' }, 10);
  original.messages = [
    { id: 'question', role: 'user', text: 'Explain', createdAt: 10 },
    { id: 'answer', role: 'assistant', text: 'Thinking...', createdAt: 11 },
  ];
  const finalKey = sessionKeyForTab({ id: 700, url: original.url });
  const replayed = replayAskSessionTabReplacements({ [original.key]: original }, original.key, [
    { removedTabId: 7, addedTabId: 70 },
    { removedTabId: 70, addedTabId: 700 },
  ]);

  const finalSession = replayed.sessions[finalKey];
  const finalText = 'Final answer\n\n### Sources\n- [Page](https://example.com/final)';
  const updated = updateAskSessionMessage(finalSession, 'answer', finalText);
  assert.equal(replayed.activeKey, finalKey);
  assert.equal(updated.text, finalText);
  assert.deepEqual(finalSession.messages.map((message) => message.id), ['question', 'answer']);
  assert.equal(Object.keys(replayed.sessions).length, 1);

  const unrelated = replayAskSessionTabReplacements(
    replayed.sessions,
    'space:work',
    [{ removedTabId: 'bad', addedTabId: 900 }],
  );
  assert.strictEqual(unrelated.sessions, replayed.sessions);
  assert.equal(unrelated.activeKey, 'space:work');
  assert.deepEqual(replayAskSessionTabReplacements(null, null, null), {
    sessions: null,
    activeKey: '',
  });
});

test('creates an empty Ask session for a page', () => {
  const session = createAskSession({
    id: 2,
    title: 'Example',
    url: 'https://example.com/a#intro',
  });

  assert.equal(session.key, 'tab:2:https://example.com/a#intro');
  assert.equal(session.title, 'Example');
  assert.equal(session.url, 'https://example.com/a#intro');
  assert.deepEqual(session.messages, []);
});

test('creates one Ask session for an entire Space', () => {
  const session = createSpaceAskSession({ id: 'launch', name: 'Launch' }, 100);

  assert.equal(sessionKeyForSpace('launch'), 'space:launch');
  assert.equal(session.key, 'space:launch');
  assert.equal(session.spaceId, 'launch');
  assert.equal(session.title, 'Launch');
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
  assert.equal(session.messages[0].text, 'abc...');
  assert.equal(session.messages[1].text, 'last');
});

test('keeps the Sources appendix when a long assistant answer is truncated', () => {
  const session = createSpaceAskSession({ id: 'research', name: 'Research' });
  const message = appendAskSessionMessage(session, 'assistant', 'Thinking...');
  const answer = appendAskSourceLink(
    `Finding [1]. ${'Supporting detail. '.repeat(80)}`,
    { title: 'Primary research', url: 'https://example.com/research' },
  );

  const updated = updateAskSessionMessage(session, message.id, answer, {
    maxMessageChars: 260,
  });

  assert.ok(updated.text.length < answer.length, 'the fixture must exercise truncation');
  assert.match(updated.text, /Finding/);
  assert.match(updated.text, /### Sources/);
  assert.match(updated.text, /https:\/\/example\.com\/research/);
});

test('never caps Ask sessions whose tabs are still open', () => {
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
    'tab:2:https://example.com/b',
    'tab:3:https://example.com/c',
  ]);
  assert.equal(ASK_SESSION_LIMITS.maxMessageChars, 65_536);
  assert.equal(ASK_SESSION_LIMITS.maxSessionChars, 96_000);
  assert.equal(ASK_SESSION_LIMITS.maxSessions, 12);
});

test('caps stale URL histories when one open tab navigates across many pages', () => {
  const tabId = 7;
  const sessions = {};
  const urls = Array.from({ length: 20 }, (_, index) => `https://example.com/page/${index + 1}`);
  for (const [index, url] of urls.entries()) {
    const session = createAskSession({ id: tabId, title: `Page ${index + 1}`, url }, index + 1);
    session.updatedAt = index + 1;
    session.messages = [{
      id: `message-${index + 1}`,
      role: 'user',
      text: `Question ${index + 1}`,
      createdAt: index + 1,
    }];
    sessions[session.key] = session;
  }

  const currentKey = sessionKeyForTab({ id: tabId, url: urls.at(-1) });
  const pruned = pruneAskSessions(sessions, {
    // Keep the legacy inventory alongside the exact inventory to prove an
    // open tab id no longer protects sessions for its previous URLs.
    openTabIds: [tabId],
    openSessionKeys: [currentKey],
    maxSessions: ASK_SESSION_LIMITS.maxSessions,
  });

  assert.equal(Object.keys(pruned).length, ASK_SESSION_LIMITS.maxSessions);
  assert.equal(pruned[currentKey], sessions[currentKey]);
  assert.equal(Object.keys(pruned).filter((key) => key.startsWith('tab:')).length, 1);
  assert.equal(
    Object.keys(pruned).filter((key) => key.startsWith(PORTABLE_ASK_SESSION_PREFIX)).length,
    ASK_SESSION_LIMITS.maxSessions - 1,
  );
  assert.equal(Object.values(pruned).some((session) => session.url === urls[0]), false);
  assert.ok(Object.values(pruned).some((session) => session.url === urls.at(-2)));
  for (const session of Object.values(pruned).filter((item) => item !== sessions[currentKey])) {
    assert.equal(session.tabId, undefined);
  }
});

test('caps only inactive Ask sessions while retaining every open and in-flight session', () => {
  const active = createAskSession({ id: 11, title: 'Active', url: 'https://example.com/active' }, 1);
  const foreignOpen = createAskSession({ id: 12, title: 'Foreign', url: 'https://example.com/foreign' }, 2);
  const inFlight = createAskSession({ id: 13, title: 'Streaming', url: 'https://example.com/stream' }, 3);
  const older = {
    key: 'page:older:1',
    url: 'https://example.com/older',
    updatedAt: 4,
    messages: [{ id: 'old', role: 'user', text: 'Old', createdAt: 4 }],
  };
  const newer = {
    key: 'page:newer:1',
    url: 'https://example.com/newer',
    updatedAt: 5,
    messages: [{ id: 'new', role: 'user', text: 'New', createdAt: 5 }],
  };
  const sessions = Object.fromEntries([active, foreignOpen, inFlight, older, newer]
    .map((session) => [session.key, session]));

  const pruned = pruneAskSessions(sessions, {
    activeKey: active.key,
    inFlightKeys: ['', inFlight.key],
    openTabIds: [active.tabId, foreignOpen.tabId],
    maxSessions: 4,
  });

  assert.deepEqual(new Set(Object.keys(pruned)), new Set([
    active.key,
    foreignOpen.key,
    inFlight.key,
    newer.key,
  ]));
  assert.equal(pruned[older.key], undefined);

  const protectedWithNoInactiveCapacity = pruneAskSessions(sessions, {
    inFlightKeys: [inFlight.key],
    openTabIds: [active.tabId, foreignOpen.tabId],
    maxSessions: 0,
  });
  assert.deepEqual(new Set(Object.keys(protectedWithNoInactiveCapacity)), new Set([
    active.key,
    foreignOpen.key,
    inFlight.key,
  ]));
});

test('drops complete old Ask turns when a session reaches its character budget', () => {
  const session = createSpaceAskSession({ id: 'large', name: 'Large' });
  const limits = {
    maxMessagesPerSession: 10,
    maxMessageChars: 100,
    maxSessionChars: 12,
  };
  appendAskSessionMessage(session, 'user', 'first', limits);
  appendAskSessionMessage(session, 'assistant', 'second', limits);
  appendAskSessionMessage(session, 'user', 'latest', limits);

  assert.deepEqual(session.messages.map((message) => message.text), ['latest']);
});

test('keeps Ask sessions for existing Spaces and removes deleted Spaces', () => {
  const sessions = {
    'space:launch': createSpaceAskSession({ id: 'launch', name: 'Launch' }, 1),
    'space:deleted': createSpaceAskSession({ id: 'deleted', name: 'Deleted' }, 2),
  };

  const pruned = pruneAskSessions(sessions, {
    spaceIds: ['launch'],
    activeKey: 'space:launch',
  });

  assert.deepEqual(Object.keys(pruned), ['space:launch']);
});

test('keeps restored page conversations until the matching page is opened', () => {
  const sessions = {
    'page:a1b2c3d4:1': {
      key: 'page:a1b2c3d4:1',
      title: 'Launch brief',
      url: 'https://example.com/brief',
      createdAt: 10,
      updatedAt: 20,
      messages: [{ id: 'm1', role: 'user', text: 'What changed?', createdAt: 10 }],
    },
    [sessionKeyForTab({ id: 8, url: 'https://example.com/open' })]: createAskSession({
      id: 8,
      title: 'Open page',
      url: 'https://example.com/open',
    }),
  };

  const pruned = pruneAskSessions(sessions, { openTabIds: [8] });

  assert.ok(pruned['page:a1b2c3d4:1'], 'a restored conversation must survive before its page is reopened');
});

test('closing a page keeps its real conversation available for revisit and backup', () => {
  const closedKey = sessionKeyForTab({ id: 7, url: 'https://example.com/brief#old' });
  const closed = createAskSession({ id: 7, title: 'Launch brief', url: 'https://example.com/brief#old' }, 10);
  closed.updatedAt = 20;
  closed.messages = [{ id: 'm1', role: 'user', text: 'What changed?', createdAt: 10 }];
  const emptyKey = sessionKeyForTab({ id: 9, url: 'https://example.com/empty' });
  const sessions = {
    [closedKey]: closed,
    [emptyKey]: createAskSession({ id: 9, title: 'Empty', url: 'https://example.com/empty' }, 10),
  };

  const retained = pruneAskSessions(sessions, { openTabIds: [100] });
  const [[portableKey, portableSession]] = Object.entries(retained);

  assert.match(portableKey, /^page:[0-9a-f]{8}:1$/);
  assert.equal(portableSession.tabId, undefined);
  assert.equal(portableSession.url, 'https://example.com/brief#old');
  assert.deepEqual(portableSession.messages, closed.messages);
  assert.equal(Object.values(retained).some((session) => session.url.includes('/empty')), false);

  const reopened = adoptPortableAskSession(retained, {
    id: 101,
    title: 'Launch brief revisited',
    url: 'https://example.com/brief#old',
  });
  assert.equal(reopened.tabId, 101);
  assert.deepEqual(reopened.messages, closed.messages);
});

test('restored page conversations follow the page instead of stale Chrome tab ids', () => {
  const sessions = {
    'page:a1b2c3d4:1': {
      key: 'page:a1b2c3d4:1',
      title: 'Old title',
      url: 'https://example.com/brief#old-section',
      createdAt: 10,
      updatedAt: 20,
      messages: [
        { id: 'm1', role: 'user', text: 'What changed?', createdAt: 10 },
        { id: 'm2', role: 'assistant', text: 'The launch moved to Tuesday.', createdAt: 20 },
      ],
    },
  };
  const reopenedTab = { id: 91, title: 'Updated launch brief', url: 'https://example.com/brief#old-section' };

  const adopted = adoptPortableAskSession(sessions, reopenedTab);

  const liveKey = sessionKeyForTab(reopenedTab);
  assert.equal(adopted, sessions[liveKey]);
  assert.equal(sessions['page:a1b2c3d4:1'], undefined);
  assert.equal(adopted.key, liveKey);
  assert.equal(adopted.tabId, 91);
  assert.equal(adopted.title, 'Updated launch brief');
  assert.equal(adopted.url, 'https://example.com/brief#old-section');
  assert.deepEqual(adopted.messages.map((message) => message.text), [
    'What changed?',
    'The launch moved to Tuesday.',
  ]);
});

test('normalizes fallback URLs, ids, and default session labels safely', () => {
  assert.equal(normalizeSessionUrl('not a url#section'), 'not a url#section');
  assert.equal(normalizeSessionUrl('#section'), 'about:blank');
  assert.equal(normalizeSessionUrl(''), 'about:blank');
  assert.equal(normalizeSessionUrl('   '), 'about:blank');
  assert.equal(sessionKeyForTab(), 'tab:unknown:about:blank');
  assert.equal(sessionKeyForTab({ id: null }), 'tab:unknown:about:blank');
  assert.equal(sessionKeyForTab({ id: '' }), 'tab:unknown:about:blank');
  assert.equal(sessionKeyForTab({ id: -1 }), 'tab:unknown:about:blank');
  assert.equal(sessionKeyForTab({ id: 1.5 }), 'tab:unknown:about:blank');
  assert.equal(sessionKeyForSpace(), 'space:default');
  assert.equal(tabIdFromSessionKey('tab:42:https://example.com/'), 42);
  assert.equal(tabIdFromSessionKey('page:deadbeef:1'), null);
  assert.equal(tabIdFromSessionKey(), null);

  assert.deepEqual(createAskSession({}, 10), {
    key: 'tab:unknown:about:blank',
    tabId: null,
    title: 'Current page',
    url: 'about:blank',
    createdAt: 10,
    updatedAt: 10,
    messages: [],
  });
  assert.deepEqual(createSpaceAskSession({}, 20), {
    key: 'space:default',
    spaceId: 'default',
    title: 'Space',
    url: '',
    createdAt: 20,
    updatedAt: 20,
    messages: [],
  });
});

test('updates only the requested message and handles missing message state', () => {
  assert.equal(updateAskSessionMessage(null, 'missing', 'text'), null);
  assert.equal(updateAskSessionMessage({}, 'missing', 'text'), null);

  const session = createAskSession({ id: 2, url: 'https://example.com/update' }, 10);
  const original = appendAskSessionMessage(session, 'user', 'original');
  const beforeUpdatedAt = session.updatedAt;

  assert.equal(updateAskSessionMessage(session, 'missing', 'ignored'), null);
  assert.equal(session.messages[0], original);
  assert.equal(session.updatedAt, beforeUpdatedAt);

  const updated = updateAskSessionMessage(session, original.id, 'revised');
  assert.equal(updated.text, 'revised');
  assert.equal(session.messages[0], updated);
});

test('keeps the newest message while enforcing count and character budgets', () => {
  const session = {};
  const emptyAssistant = appendAskSessionMessage(session, 'system', undefined, {
    maxMessagesPerSession: 2,
    maxMessageChars: 10,
    maxSessionChars: 3,
  });
  assert.equal(emptyAssistant.role, 'assistant');
  assert.equal(emptyAssistant.text, '');

  appendAskSessionMessage(session, 'user', 'older', {
    maxMessagesPerSession: 2,
    maxMessageChars: 10,
    maxSessionChars: 3,
  });
  const latest = appendAskSessionMessage(session, 'user', 'latest', {
    maxMessagesPerSession: 2,
    maxMessageChars: 10,
    maxSessionChars: 3,
  });

  assert.deepEqual(session.messages.map(({ id, role, text }) => ({ id, role, text })), [{
    id: latest.id,
    role: 'user',
    text: 'lat',
  }]);
});

test('uses the default message-count budget when callers override only other limits', () => {
  const session = createAskSession({ id: 4, url: 'https://example.com/count-budget' }, 1);
  session.messages = Array.from({ length: ASK_SESSION_LIMITS.maxMessagesPerSession }, (_, index) => ({
    id: `old-${index}`,
    role: 'user',
    text: `message-${index}`,
    createdAt: index,
  }));

  const latest = appendAskSessionMessage(session, 'user', 'latest', {
    maxSessionChars: 10_000,
  });

  assert.equal(session.messages.length, ASK_SESSION_LIMITS.maxMessagesPerSession);
  assert.equal(session.messages[0].id, 'old-1');
  assert.equal(session.messages.at(-1), latest);
});

test('falls back to head truncation when a Sources appendix cannot fit', () => {
  const session = createAskSession({ id: 3, url: 'https://example.com/source-budget' }, 1);
  const message = appendAskSessionMessage(session, 'assistant', 'draft');
  const answer = `${'A'.repeat(100)}\n\n### Sources\n- ${'source'.repeat(30)}`;

  const updated = updateAskSessionMessage(session, message.id, answer, { maxMessageChars: 40 });

  assert.equal(updated.text, `${'A'.repeat(37)}...`);
  assert.equal(updated.text.length, 40);
  assert.doesNotMatch(updated.text, /### Sources/);
});

test('demotes multiple closed conversations for the same URL without overwriting either', () => {
  const first = createAskSession({ id: 11, title: 'First', url: 'https://example.com/same#same' }, 1);
  first.updatedAt = 10;
  first.messages = [{ id: 'first', role: 'user', text: 'First conversation', createdAt: 1 }];
  const second = createAskSession({ id: 12, title: 'Second', url: 'https://example.com/same#same' }, 2);
  second.updatedAt = 20;
  second.messages = [{ id: 'second', role: 'user', text: 'Second conversation', createdAt: 2 }];

  const retained = pruneAskSessions({ [first.key]: first, [second.key]: second }, { openTabIds: [99] });
  const portableKeys = Object.keys(retained).sort();

  assert.equal(portableKeys.length, 2);
  assert.match(portableKeys[0], /^page:[0-9a-f]{8}:1$/);
  assert.match(portableKeys[1], /^page:[0-9a-f]{8}:2$/);
  assert.deepEqual(
    portableKeys.map((key) => retained[key].messages[0].text).sort(),
    ['First conversation', 'Second conversation'],
  );

  const adopted = adoptPortableAskSession(retained, {
    id: 13,
    displayTitle: 'Current display title',
    title: 'Browser title',
    url: 'https://example.com/same#same',
  });
  assert.equal(adopted.messages[0].text, 'Second conversation');
  assert.equal(adopted.title, 'Current display title');
  assert.equal(Object.keys(retained).some((key) => key.endsWith(':1')), true);
});

test('keeps SPA hash routes in separate live and portable conversations', () => {
  const routeOne = createAskSession({
    id: 7,
    title: 'Customer one',
    url: 'https://app.example/#/customer/1',
  }, 1);
  routeOne.updatedAt = 10;
  routeOne.messages = [{ id: 'one', role: 'user', text: 'Question for customer one', createdAt: 1 }];
  const routeTwo = createAskSession({
    id: 7,
    title: 'Customer two',
    url: 'https://app.example/#/customer/2',
  }, 2);
  routeTwo.updatedAt = 20;
  routeTwo.messages = [{ id: 'two', role: 'user', text: 'Question for customer two', createdAt: 2 }];

  assert.notEqual(routeOne.key, routeTwo.key);
  const retained = pruneAskSessions({
    [routeOne.key]: routeOne,
    [routeTwo.key]: routeTwo,
  }, { openTabIds: [99] });
  const adoptedOne = adoptPortableAskSession(retained, {
    id: 8,
    title: 'Customer one reopened',
    url: 'https://app.example/#/customer/1',
  });

  assert.equal(adoptedOne.messages[0].text, 'Question for customer one');
  assert.ok(Object.values(retained).some((session) => (
    session.url === 'https://app.example/#/customer/2' &&
    session.messages[0].text === 'Question for customer two'
  )));
});

test('retains the latest user and assistant together within strict text budgets', () => {
  const session = createAskSession({ id: 4, url: 'https://example.com/large-turn' }, 1);
  const user = appendAskSessionMessage(session, 'user', 'u'.repeat(ASK_SESSION_LIMITS.maxMessageChars));
  const assistant = appendAskSessionMessage(session, 'assistant', 'Thinking...');
  updateAskSessionMessage(session, assistant.id, 'a'.repeat(ASK_SESSION_LIMITS.maxMessageChars));

  assert.deepEqual(session.messages.map((message) => message.role), ['user', 'assistant']);
  assert.equal(session.messages[0].id, user.id);
  assert.equal(session.messages[1].id, assistant.id);
  assert.ok(session.messages.every((message) => message.text.length <= ASK_SESSION_LIMITS.maxMessageChars));
  assert.ok(
    session.messages.reduce((total, message) => total + message.text.length, 0)
      <= ASK_SESSION_LIMITS.maxSessionChars,
  );
});

test('enforces zero, fractional, and invalid Ask session budgets safely', () => {
  const messages = [
    { id: 'user', role: 'user', text: null },
    { id: 'assistant', role: 'assistant', text: 'abcdef' },
  ];

  assert.deepEqual(clampAskSessionMessages(messages, { maxSessionChars: 0 }), [
    { id: 'user', role: 'user', text: '' },
    { id: 'assistant', role: 'assistant', text: '' },
  ]);
  assert.deepEqual(
    clampAskSessionMessages(messages, { maxSessionChars: 3.9 }).map(({ id, text }) => ({ id, text })),
    [
      { id: 'user', text: '' },
      { id: 'assistant', text: 'abc' },
    ],
  );

  const invalidBudget = clampAskSessionMessages([
    { id: 'assistant', role: 'assistant', text: 'x'.repeat(ASK_SESSION_LIMITS.maxSessionChars + 10) },
  ], { maxSessionChars: Number.NaN });
  assert.equal(invalidBudget[0].text.length, ASK_SESSION_LIMITS.maxSessionChars);
});

test('uses the default per-message budget when a caller supplies a non-finite limit', () => {
  const session = createAskSession({ id: 5, url: 'https://example.com/non-finite-budget' }, 1);
  const message = appendAskSessionMessage(
    session,
    'assistant',
    'x'.repeat(ASK_SESSION_LIMITS.maxMessageChars + 10),
    { maxMessageChars: Number.NaN },
  );

  assert.equal(message.text.length, ASK_SESSION_LIMITS.maxMessageChars);
  assert.equal(message.text.endsWith('...'), true);
});

test('pruning distinguishes open, active, restricted, invalid, and Space sessions', () => {
  const openWithoutStoredId = {
    key: 'tab:5:https://example.com/open',
    title: 'Open',
    url: 'https://example.com/open',
    messages: [],
  };
  const activeClosed = createAskSession({ id: 6, url: 'https://example.com/active' }, 6);
  const restricted = createAskSession({ id: 7, url: 'chrome://settings' }, 7);
  restricted.messages = [{ id: 'restricted', role: 'user', text: 'Keep?', createdAt: 7 }];
  const invalid = createAskSession({ id: 8, url: 'not a url' }, 8);
  invalid.messages = [{ id: 'invalid', role: 'user', text: 'Keep?', createdAt: 8 }];
  const malformed = createAskSession({ id: 9, url: 'https://example.com/malformed' }, 9);
  malformed.messages = 'not-an-array';
  const keyedSpace = { key: 'space:key-only', title: 'Key only', messages: [] };
  const activeSpace = createSpaceAskSession({ id: 'active-space' }, 9);
  const sessions = {
    [openWithoutStoredId.key]: openWithoutStoredId,
    [activeClosed.key]: activeClosed,
    [restricted.key]: restricted,
    [invalid.key]: invalid,
    [malformed.key]: malformed,
    'space:key-only': keyedSpace,
    [activeSpace.key]: activeSpace,
  };

  const pruned = pruneAskSessions(sessions, {
    openTabIds: [5],
    spaceIds: ['missing'],
    activeKey: activeClosed.key,
  });
  assert.deepEqual(Object.keys(pruned).sort(), [activeClosed.key, openWithoutStoredId.key].sort());

  const allSpaces = pruneAskSessions({ 'space:key-only': keyedSpace });
  assert.deepEqual(Object.keys(allSpaces), ['space:key-only']);

  const keptActiveSpace = pruneAskSessions({ [activeSpace.key]: activeSpace }, {
    spaceIds: ['missing'],
    activeKey: activeSpace.key,
  });
  assert.deepEqual(Object.keys(keptActiveSpace), [activeSpace.key]);
});

test('pruning sorts sessions with and without timestamps consistently', () => {
  const undated = { key: 'page:undated:1', url: 'https://example.com/undated', messages: [] };
  const dated = { key: 'page:dated:1', url: 'https://example.com/dated', updatedAt: 10, messages: [] };

  assert.deepEqual(Object.keys(pruneAskSessions({ [undated.key]: undated, [dated.key]: dated })), [
    dated.key,
    undated.key,
  ]);
  assert.deepEqual(Object.keys(pruneAskSessions({ [dated.key]: dated, [undated.key]: undated })), [
    dated.key,
    undated.key,
  ]);
});

test('adoption handles existing, missing, invalid, and untitled portable sessions', () => {
  assert.equal(adoptPortableAskSession(null, {}), null);
  assert.equal(adoptPortableAskSession('invalid', {}), null);

  const tab = { id: 21, title: 'Live', url: 'https://example.com/live' };
  const live = createAskSession(tab, 1);
  const liveSessions = { [live.key]: live };
  assert.equal(adoptPortableAskSession(liveSessions, tab), live);

  assert.equal(adoptPortableAskSession({
    'page:other:1': { key: 'page:other:1', url: 'https://example.com/other', messages: [] },
    'tab:99:https://example.com/live': { key: 'tab:99:https://example.com/live', url: tab.url },
  }, tab), null);

  const portable = {
    'page:untitled:1': {
      key: 'page:untitled:1',
      url: 'https://example.com/untitled',
      messages: [{ id: 'm', role: 'user', text: 'Hello', createdAt: 1 }],
    },
  };
  const adopted = adoptPortableAskSession(portable, { url: 'https://example.com/untitled' });
  assert.equal(adopted.tabId, null);
  assert.equal(adopted.title, 'Current page');
  assert.equal(adopted.key, 'tab:unknown:https://example.com/untitled');
});

test('portable Ask history can be projected for render without mutating durable sessions', () => {
  const tab = { id: 41, title: 'Live title', url: 'https://example.com/restored' };
  const portableKey = 'page:restored:1';
  const sessions = {
    [portableKey]: {
      key: portableKey,
      title: 'Backup title',
      url: tab.url,
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: 'old', role: 'user', text: 'Restored history', createdAt: 1 }],
    },
  };
  const before = structuredClone(sessions);

  const projected = projectAskSessionForTab(sessions, tab);

  assert.equal(projected.key, sessionKeyForTab(tab));
  assert.equal(projected.tabId, tab.id);
  assert.equal(projected.title, tab.title);
  assert.equal(projected.messages[0].text, 'Restored history');
  assert.deepEqual(sessions, before);
  assert.notStrictEqual(projected.messages, sessions[portableKey].messages);
  assert.deepEqual(projectAskSessionForTab(null, {}).messages, []);
  const malformed = { broken: null };
  assert.deepEqual(
    projectAskSessionForTab(malformed, { id: 42, url: 'https://example.com/new' }).messages,
    [],
  );
  assert.deepEqual(malformed, { broken: null });
});

test('Ask projection clones only the matching newest conversation and tolerates malformed messages', () => {
  const tab = { id: 43, title: 'Live', url: 'https://example.com/project-target' };
  const unrelated = {
    key: 'page:unrelated:1',
    url: 'https://example.com/unrelated',
    get messages() {
      throw new Error('unrelated history must not be cloned during a render');
    },
  };
  const sessions = {
    [unrelated.key]: unrelated,
    'page:older:1': {
      key: 'page:older:1',
      url: tab.url,
      updatedAt: 1,
      messages: [{ id: 'older', text: 'Older' }],
    },
    'page:newer:1': {
      key: 'page:newer:1',
      url: tab.url,
      updatedAt: 2,
      messages: 'malformed legacy value',
    },
  };

  const portableProjection = projectAskSessionForTab(sessions, tab);
  assert.equal(portableProjection.key, sessionKeyForTab(tab));
  assert.deepEqual(portableProjection.messages, []);
  assert.equal(sessions['page:newer:1'].messages, 'malformed legacy value');

  const live = createAskSession(tab, 3);
  live.messages = [{ id: 'live', role: 'user', text: 'Current history', createdAt: 3 }];
  const liveProjection = projectAskSessionForTab({ ...sessions, [live.key]: live }, tab);
  assert.deepEqual(liveProjection.messages, live.messages);
  assert.notStrictEqual(liveProjection.messages, live.messages);
  assert.notStrictEqual(liveProjection.messages[0], live.messages[0]);

  const malformedLiveProjection = projectAskSessionForTab({
    [live.key]: 'malformed live session',
  }, tab);
  assert.deepEqual(malformedLiveProjection.messages, []);
});

test('two Ask actors keep the reviewed portable history when the first actor adopts it', () => {
  const url = 'https://example.com/shared-review';
  const firstTab = { id: 51, title: 'First window', url };
  const secondTab = { id: 52, title: 'Second window', url };
  const portableKey = 'page:shared-review:1';
  const sessions = {
    [portableKey]: {
      key: portableKey,
      title: 'Restored conversation',
      url,
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: 'restored', role: 'user', text: 'Reviewed history', createdAt: 1 }],
    },
  };

  // Both actors open Review before either actor acquires the storage lock.
  const firstProjection = projectAskSessionForTab(sessions, firstTab);
  const secondProjection = projectAskSessionForTab(sessions, secondTab);
  const frozenSecondProjection = structuredClone(secondProjection);

  const first = materializeAskSessionForTurn(sessions, firstTab, firstProjection);
  assert.equal(sessions[portableKey], undefined);
  assert.strictEqual(sessions[sessionKeyForTab(firstTab)], first);

  // The second actor syncs after the portable record was moved to the first
  // tab. Its reviewed snapshot must become an independent live conversation.
  const second = materializeAskSessionForTurn(sessions, secondTab, secondProjection);
  assert.strictEqual(sessions[sessionKeyForTab(secondTab)], second);
  assert.deepEqual(second.messages, frozenSecondProjection.messages);
  assert.deepEqual(secondProjection, frozenSecondProjection);
  assert.notStrictEqual(second.messages, secondProjection.messages);
  assert.notStrictEqual(second.messages[0], secondProjection.messages[0]);

  appendAskSessionMessage(second, 'user', 'Second-window question');
  assert.deepEqual(first.messages.map((message) => message.text), ['Reviewed history']);
  assert.deepEqual(second.messages.map((message) => message.text), [
    'Reviewed history',
    'Second-window question',
  ]);
});

test('Ask turn materialization rejects mismatched projections and sanitizes malformed state', () => {
  const tab = { id: 61, displayTitle: 'Safe page', url: 'https://example.com/safe' };
  const liveKey = sessionKeyForTab(tab);
  const mismatched = {
    key: sessionKeyForTab({ id: 62, url: tab.url }),
    url: tab.url,
    messages: [{ id: 'secret', role: 'user', text: 'Wrong-tab history' }],
  };
  const mismatchedStore = {};
  const fresh = materializeAskSessionForTurn(mismatchedStore, tab, mismatched);
  assert.equal(fresh.key, liveKey);
  assert.deepEqual(fresh.messages, []);
  assert.equal(JSON.stringify(mismatchedStore).includes('Wrong-tab history'), false);

  const malformedProjection = { key: liveKey, url: tab.url, messages: 'legacy string', spaceId: 'wrong' };
  const malformedStore = {};
  const sanitized = materializeAskSessionForTurn(malformedStore, tab, malformedProjection);
  assert.deepEqual(sanitized.messages, []);
  assert.equal(sanitized.spaceId, undefined);
  assert.equal(sanitized.title, tab.displayTitle);
  assert.equal(malformedProjection.messages, 'legacy string');

  const portableKey = 'page:safe:1';
  const portableStore = {
    [liveKey]: 'malformed live value',
    [portableKey]: {
      key: portableKey,
      url: tab.url,
      messages: [{ id: 'portable', role: 'user', text: 'Portable survives' }],
    },
  };
  const recovered = materializeAskSessionForTurn(portableStore, tab, null);
  assert.deepEqual(recovered.messages.map((message) => message.text), ['Portable survives']);
  assert.equal(portableStore[portableKey], undefined);
  assert.strictEqual(portableStore[liveKey], recovered);

  const detached = materializeAskSessionForTurn('invalid store', tab, mismatched);
  assert.equal(detached.key, liveKey);
  assert.deepEqual(detached.messages, []);
});

test('Ask turn materialization preserves useful titles while repairing every legacy fallback', () => {
  const storedTitleTab = { id: 71, url: 'https://example.com/stored-title' };
  const storedTitleKey = sessionKeyForTab(storedTitleTab);
  const storedTitleSessions = {
    [storedTitleKey]: {
      key: storedTitleKey,
      tabId: storedTitleTab.id,
      title: 'Restored page title',
      url: storedTitleTab.url,
      messages: 'legacy string',
    },
  };
  const repairedStoredTitle = materializeAskSessionForTurn(
    storedTitleSessions,
    storedTitleTab,
  );
  assert.equal(repairedStoredTitle.title, 'Restored page title');
  assert.deepEqual(repairedStoredTitle.messages, []);

  const untitledTab = { id: 72, url: 'https://example.com/untitled-turn' };
  const untitledKey = sessionKeyForTab(untitledTab);
  const untitledSessions = {
    [untitledKey]: {
      key: untitledKey,
      tabId: untitledTab.id,
      title: '',
      url: untitledTab.url,
      messages: [],
    },
  };
  assert.equal(
    materializeAskSessionForTurn(untitledSessions, untitledTab).title,
    'Current page',
  );

  const reviewedTab = { id: 73, url: 'https://example.com/reviewed-title' };
  const reviewedKey = sessionKeyForTab(reviewedTab);
  const reviewedSessions = {};
  const reviewed = materializeAskSessionForTurn(reviewedSessions, reviewedTab, {
    key: reviewedKey,
    title: 'Title shown during Review',
    url: reviewedTab.url,
    messages: [null, 'legacy message', { role: 'user', text: 'Safe history' }],
  });
  assert.equal(reviewed.title, 'Title shown during Review');
  assert.deepEqual(reviewed.messages, [{}, {}, { role: 'user', text: 'Safe history' }]);

  const blankReviewedTab = { id: 76, url: 'https://example.com/blank-reviewed-title' };
  const blankReviewed = materializeAskSessionForTurn({}, blankReviewedTab, {
    key: sessionKeyForTab(blankReviewedTab),
    title: '',
    url: blankReviewedTab.url,
    messages: [],
  });
  assert.equal(blankReviewed.title, 'Current page');

  const freshTab = { id: 74, url: 'https://example.com/fresh-title' };
  const fresh = materializeAskSessionForTurn({}, freshTab, {
    url: freshTab.url,
    messages: [{ role: 'user', text: 'Missing key must not be trusted' }],
  });
  assert.equal(fresh.title, 'Current page');
  assert.deepEqual(fresh.messages, []);
});

test('Ask projection deterministically keeps the first equally undated portable history', () => {
  const tab = { id: 75, url: 'https://example.com/equal-undated' };
  const sessions = {
    'page:first-undated:1': {
      key: 'page:first-undated:1',
      url: tab.url,
      messages: [{ role: 'user', text: 'First history' }],
    },
    'page:second-undated:1': {
      key: 'page:second-undated:1',
      url: tab.url,
      messages: [{ role: 'user', text: 'Second history' }],
    },
  };

  const projected = projectAskSessionForTab(sessions, tab);

  assert.deepEqual(projected.messages, [{ role: 'user', text: 'First history' }]);
  assert.deepEqual(Object.keys(sessions), ['page:first-undated:1', 'page:second-undated:1']);
});

test('adoption prefers a timestamped conversation over undated history in either input order', () => {
  const undated = {
    key: 'page:undated:1',
    url: 'https://example.com/adopt-order',
    messages: [{ id: 'old', role: 'user', text: 'Undated', createdAt: 1 }],
  };
  const dated = {
    key: 'page:dated:1',
    url: 'https://example.com/adopt-order',
    updatedAt: 10,
    messages: [{ id: 'new', role: 'user', text: 'Dated', createdAt: 2 }],
  };

  for (const sessions of [
    { [undated.key]: structuredClone(undated), [dated.key]: structuredClone(dated) },
    { [dated.key]: structuredClone(dated), [undated.key]: structuredClone(undated) },
  ]) {
    const adopted = adoptPortableAskSession(sessions, {
      id: 30,
      url: 'https://example.com/adopt-order',
    });
    assert.equal(adopted.messages[0].text, 'Dated');
  }
});
