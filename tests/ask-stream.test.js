import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_STREAM_STATUS,
  askSessionRevision,
  checkpointAskStream,
  claimAskStream,
  finalizeAskStream,
  formatAskStreamOutcome,
  interruptOrphanedAskStreams,
  markAskStreamPending,
  normalizeAskStreamBinding,
} from '../src/shared/ask-stream.js';

function fixture() {
  const session = {
    key: 'tab:7:https://example.test/page',
    title: 'Example [page]',
    url: 'https://example.test/page',
    updatedAt: 1,
    messages: [{ id: 'answer', role: 'assistant', text: 'Thinking...' }],
  };
  return { session, sessions: { [session.key]: session } };
}

test('Ask prepared-turn revisions compare the exact semantic transcript and normalize malformed messages', () => {
  const session = {
    messages: [
      { id: 'u1', role: 'user', text: 'Question' },
      { id: 'a1', role: 'assistant', text: 'Answer', updatedAt: 99 },
      null,
    ],
  };
  const revision = askSessionRevision(session);
  assert.equal(revision, JSON.stringify([
    ['u1', 'user', 'Question'],
    ['a1', 'assistant', 'Answer'],
    ['', 'assistant', ''],
  ]));
  assert.equal(askSessionRevision({ ...session, updatedAt: 500 }), revision);
  assert.notEqual(
    askSessionRevision({ messages: [...session.messages, { id: 'u2', role: 'user', text: 'New' }] }),
    revision,
  );
  assert.equal(askSessionRevision(null), '[]');
  assert.equal(askSessionRevision(), '[]');
});

test('Ask stream bindings and pending markers reject unsafe or incomplete identities', () => {
  const valid = {
    sessionKey: 'tab:7:https://example.test/page',
    messageId: 'answer',
    requestId: 'request-1',
  };
  assert.deepEqual(normalizeAskStreamBinding(valid), valid);
  const longUrlBinding = {
    ...valid,
    sessionKey: `tab:7:https://example.test/${'route/'.repeat(400)}`,
  };
  assert.deepEqual(normalizeAskStreamBinding(longUrlBinding), longUrlBinding);
  assert.equal(normalizeAskStreamBinding(), null);
  assert.equal(normalizeAskStreamBinding(null), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, sessionKey: 0 }), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, sessionKey: 'x'.repeat((16 * 1024) + 1) }), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, messageId: 0 }), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, requestId: '' }), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, messageId: 'x'.repeat(513) }), null);
  assert.equal(normalizeAskStreamBinding({ ...valid, requestId: 'x'.repeat(513) }), null);
  assert.equal(markAskStreamPending(null, 'request-1'), null);
  assert.equal(markAskStreamPending({}, ''), null);
  assert.equal(markAskStreamPending({}, 'x'.repeat(513)), null);

  const message = {};
  assert.deepEqual(markAskStreamPending(message, ' request-1 ', 'bad-time'), {
    requestId: 'request-1',
    status: ASK_STREAM_STATUS.pending,
    ownerId: '',
    startedAt: 0,
    updatedAt: 0,
  });
  assert.equal(markAskStreamPending({}, 'default-time').status, ASK_STREAM_STATUS.pending);
});

test('claims, checkpoints, and finalizes a stream after a tab replacement rekeys its session', () => {
  const { session, sessions } = fixture();
  markAskStreamPending(session.messages[0], 'request-1', 10);
  const binding = { sessionKey: session.key, messageId: 'answer', requestId: 'request-1' };
  assert.equal(claimAskStream(sessions, binding, '', 11), null);
  assert.equal(claimAskStream({}, binding, 'worker-1', 11), null);
  assert.equal(claimAskStream(sessions, { ...binding, requestId: '' }, 'worker-1', 11), null);

  const claimed = claimAskStream(sessions, binding, 'worker-1', 11);
  assert.equal(claimed.message.askStream.status, ASK_STREAM_STATUS.streaming);
  assert.equal(claimed.message.askStream.ownerId, 'worker-1');
  assert.equal(claimed.message.askStream.updatedAt, 11);
  assert.equal(claimAskStream(sessions, binding, 'worker-1').message, claimed.message);

  delete sessions[session.key];
  session.key = 'tab:70:https://example.test/page';
  sessions[session.key] = session;
  assert.equal(checkpointAskStream(null, binding, 'partial', 12), null);
  assert.equal(checkpointAskStream(sessions, { ...binding, requestId: '' }, 'partial', 12), null);
  const checkpoint = checkpointAskStream(sessions, binding, 'partial', 12);
  assert.equal(checkpoint.sessionKey, session.key);
  assert.equal(checkpoint.message.text, 'partial');
  assert.equal(checkpoint.session.updatedAt, 12);
  checkpointAskStream(sessions, binding, '', 'bad-time');
  assert.equal(checkpoint.message.text, 'partial');
  assert.equal(checkpoint.message.updatedAt, 0);
  assert.equal(checkpointAskStream(sessions, binding).message.text, 'partial');

  assert.equal(finalizeAskStream(null, binding, {}, 13), null);
  assert.equal(finalizeAskStream(sessions, { ...binding, messageId: '' }, {}, 13), null);
  const completed = finalizeAskStream(sessions, binding, {
    text: 'Answer [1]',
    finishReason: 'length',
  }, 13);
  assert.equal(completed.message.askStream, undefined);
  assert.match(completed.message.text, /answer may be incomplete/);
  assert.match(completed.message.text, /\[\[1\]\]\(https:\/\/example\.test\/page\)/);
  assert.equal(completed.session.updatedAt, 13);

  const second = { id: 'second', role: 'assistant', text: 'Thinking...' };
  session.messages.push(second);
  markAskStreamPending(second, 'request-2', 20);
  const secondBinding = { sessionKey: session.key, messageId: second.id, requestId: 'request-2' };
  claimAskStream(sessions, secondBinding, 'worker-1', 21);
  assert.match(finalizeAskStream(sessions, secondBinding).message.text, /^No AI text returned\./);
});

test('stream lookup ignores malformed candidates and falls back past the original key', () => {
  const binding = { sessionKey: 'original', messageId: 'answer', requestId: 'request-1' };
  const targetMessage = { id: 'answer', text: 'Thinking...' };
  markAskStreamPending(targetMessage, 'request-1', 1);
  const sessions = {
    original: { messages: [
      null,
      { id: '', askStream: { requestId: 'request-1' } },
      { id: 'wrong', askStream: { requestId: 'request-1' } },
    ] },
    primitive: 'legacy',
    sparse: { messages: null },
    replacement: {
      messages: [
        { id: 'answer', askStream: { requestId: 'other' } },
        targetMessage,
      ],
    },
  };
  assert.equal(claimAskStream(sessions, binding, 'worker').sessionKey, 'replacement');
  assert.equal(checkpointAskStream({ original: { messages: [] } }, binding, 'none'), null);
  assert.equal(finalizeAskStream({ original: { messages: [] } }, binding), null);
});

test('formats complete, failed, stopped, and interrupted outcomes without requiring a source', () => {
  assert.equal(formatAskStreamOutcome(), 'No AI text returned.');
  assert.equal(formatAskStreamOutcome({ status: 'complete', text: ' Done ' }), 'Done');
  assert.equal(
    formatAskStreamOutcome({ status: 'failed', error: 'Offline' }),
    'Offline',
  );
  assert.equal(
    formatAskStreamOutcome({ status: 'failed', text: 'Part', error: '' }),
    'Part\n\n_Request failed before completion: The provider request failed._',
  );
  assert.equal(
    formatAskStreamOutcome({ status: 'stopped' }),
    'Request stopped before completion.',
  );
  assert.equal(
    formatAskStreamOutcome({ status: 'stopped', text: 'Part' }),
    'Part\n\n_Request stopped before completion._',
  );
  assert.equal(
    formatAskStreamOutcome({ status: 'interrupted' }),
    'Request interrupted before completion. Please try again.',
  );
  assert.equal(
    formatAskStreamOutcome({ status: 'interrupted', text: 'Part' }),
    'Part\n\n_Request interrupted before completion. Please try again._',
  );
});

test('interrupts only foreign streams or expired pending markers and preserves unrelated state', () => {
  const { session, sessions } = fixture();
  const current = session.messages[0];
  markAskStreamPending(current, 'current', 90);
  claimAskStream(sessions, {
    sessionKey: session.key, messageId: current.id, requestId: 'current',
  }, 'worker-now', 91);
  const foreign = { id: 'foreign', role: 'assistant', text: 'Useful partial' };
  const recentPending = { id: 'recent', role: 'assistant', text: 'Thinking...' };
  const expiredPending = { id: 'expired', role: 'assistant', text: 'Thinking...' };
  const malformed = { id: 'malformed', askStream: 'legacy', text: 'Keep' };
  session.messages.push(foreign, recentPending, expiredPending, malformed);
  markAskStreamPending(foreign, 'foreign', 80);
  claimAskStream(sessions, {
    sessionKey: session.key, messageId: foreign.id, requestId: 'foreign',
  }, 'worker-old', 81);
  markAskStreamPending(recentPending, 'recent', 95);
  markAskStreamPending(expiredPending, 'expired', 20);
  sessions.invalid = null;
  sessions.sparse = { messages: null };

  assert.deepEqual(interruptOrphanedAskStreams(null), []);
  assert.deepEqual(interruptOrphanedAskStreams({}), []);
  assert.deepEqual(interruptOrphanedAskStreams({}, { pendingBefore: 'not-a-number' }), []);
  assert.deepEqual(interruptOrphanedAskStreams(sessions, {
    ownerId: 'worker-now', requestId: 'not-found', now: 100, pendingBefore: 50,
  }), []);
  assert.deepEqual(interruptOrphanedAskStreams(sessions, {
    ownerId: 'worker-now', now: 100, pendingBefore: 50,
  }), ['foreign', 'expired']);
  assert.equal(current.askStream.status, ASK_STREAM_STATUS.streaming);
  assert.equal(recentPending.askStream.status, ASK_STREAM_STATUS.pending);
  assert.equal(foreign.askStream, undefined);
  assert.match(foreign.text, /Useful partial/);
  assert.match(foreign.text, /Request interrupted/);
  assert.equal(expiredPending.askStream, undefined);
  assert.match(expiredPending.text, /^Request interrupted/);
  assert.equal(malformed.text, 'Keep');

  assert.deepEqual(interruptOrphanedAskStreams(sessions, {
    ownerId: 'different-worker', requestId: 'current', now: 'invalid', pendingBefore: 200,
  }), ['current']);

  const invalidTarget = { id: '', text: '', askStream: {
    requestId: '', status: ASK_STREAM_STATUS.pending, startedAt: 0,
  } };
  session.messages.push(invalidTarget);
  assert.deepEqual(interruptOrphanedAskStreams(sessions, {
    pendingBefore: 1,
  }), []);

  const alarmPending = { id: 'alarm-pending', text: 'Thinking...' };
  session.messages.push(alarmPending);
  markAskStreamPending(alarmPending, 'alarm-pending', Number.MAX_SAFE_INTEGER);
  assert.deepEqual(interruptOrphanedAskStreams(sessions, {
    requestId: 'alarm-pending',
    pendingBefore: Number.POSITIVE_INFINITY,
  }), ['alarm-pending'], 'an alarm explicitly recovers pending work of any age');
});
