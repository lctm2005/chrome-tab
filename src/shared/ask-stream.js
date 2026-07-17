import { appendAskSourceLink } from './ask-sources.js';
import { clampAskSessionMessages } from './ask-session.js';

export const ASK_STREAM_STATUS = Object.freeze({
  pending: 'pending',
  streaming: 'streaming',
});

const MAX_ASK_SESSION_KEY_LENGTH = 16 * 1024;
const MAX_ASK_STREAM_ID_LENGTH = 512;

export function askSessionRevision(session = {}) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return JSON.stringify(messages.map((message) => {
    const item = isRecord(message) ? message : {};
    return [
      String(item.id ?? ''),
      item.role === 'user' ? 'user' : 'assistant',
      String(item.text ?? ''),
    ];
  }));
}

export function normalizeAskStreamBinding(value = {}) {
  if (!isRecord(value)) return null;
  const binding = {
    sessionKey: String(value.sessionKey || '').trim(),
    messageId: String(value.messageId || '').trim(),
    requestId: String(value.requestId || '').trim(),
  };
  if (
    !binding.sessionKey || binding.sessionKey.length > MAX_ASK_SESSION_KEY_LENGTH ||
    !binding.messageId || binding.messageId.length > MAX_ASK_STREAM_ID_LENGTH ||
    !binding.requestId || binding.requestId.length > MAX_ASK_STREAM_ID_LENGTH
  ) {
    return null;
  }
  return binding;
}

export function markAskStreamPending(message, requestId, now = Date.now()) {
  if (!isRecord(message)) return null;
  const safeRequestId = String(requestId || '').trim();
  if (!safeRequestId || safeRequestId.length > MAX_ASK_STREAM_ID_LENGTH) return null;
  const timestamp = normalizeTimestamp(now);
  message.askStream = {
    requestId: safeRequestId,
    status: ASK_STREAM_STATUS.pending,
    ownerId: '',
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  return message.askStream;
}

export function claimAskStream(sessions, value, ownerId, now = Date.now()) {
  const binding = normalizeAskStreamBinding(value);
  const safeOwnerId = String(ownerId || '').trim();
  if (!binding || !safeOwnerId) return null;
  const target = findAskStreamTarget(sessions, binding);
  if (!target) return null;
  target.message.askStream = {
    ...target.message.askStream,
    status: ASK_STREAM_STATUS.streaming,
    ownerId: safeOwnerId,
    updatedAt: normalizeTimestamp(now),
  };
  return target;
}

export function checkpointAskStream(sessions, value, text, now = Date.now()) {
  const binding = normalizeAskStreamBinding(value);
  if (!binding) return null;
  const target = findAskStreamTarget(sessions, binding);
  if (!target) return null;
  const partial = String(text || '');
  if (partial) target.message.text = partial;
  const timestamp = normalizeTimestamp(now);
  target.message.updatedAt = timestamp;
  target.message.askStream.updatedAt = timestamp;
  target.session.updatedAt = timestamp;
  target.session.messages = clampAskSessionMessages(target.session.messages);
  target.message = target.session.messages.find((message) => message?.id === binding.messageId);
  return target;
}

export function finalizeAskStream(sessions, value, outcome = {}, now = Date.now()) {
  const binding = normalizeAskStreamBinding(value);
  if (!binding) return null;
  const target = findAskStreamTarget(sessions, binding);
  if (!target) return null;
  const timestamp = normalizeTimestamp(now);
  target.message.text = formatAskStreamOutcome(outcome, target.session);
  target.message.updatedAt = timestamp;
  delete target.message.askStream;
  target.session.updatedAt = timestamp;
  target.session.messages = clampAskSessionMessages(target.session.messages);
  target.message = target.session.messages.find((message) => message?.id === binding.messageId);
  return target;
}

export function interruptOrphanedAskStreams(sessions, options = {}) {
  if (!isRecord(sessions)) return [];
  const currentOwnerId = String(options.ownerId || '');
  const requestedId = String(options.requestId || '');
  const now = normalizeTimestamp(options.now ?? Date.now());
  const pendingBefore = options.pendingBefore === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(Number(options.pendingBefore))
      ? Number(options.pendingBefore)
      : Number.NEGATIVE_INFINITY;
  const interrupted = [];

  for (const [sessionKey, session] of Object.entries(sessions)) {
    if (!isRecord(session) || !Array.isArray(session.messages)) continue;
    for (const message of session.messages) {
      const stream = isRecord(message?.askStream) ? message.askStream : null;
      if (!stream || (requestedId && stream.requestId !== requestedId)) continue;
      const isForeignStream = stream.status === ASK_STREAM_STATUS.streaming &&
        stream.ownerId !== currentOwnerId;
      const isExpiredPending = stream.status === ASK_STREAM_STATUS.pending &&
        Number(stream.startedAt || 0) <= pendingBefore;
      if (!isForeignStream && !isExpiredPending) continue;

      const binding = {
        sessionKey,
        messageId: String(message.id || ''),
        requestId: String(stream.requestId || ''),
      };
      const partial = message.text === 'Thinking...' ? '' : String(message.text || '');
      const target = finalizeAskStream(sessions, binding, {
        status: 'interrupted',
        text: partial,
      }, now);
      if (target) interrupted.push(binding.requestId);
    }
  }
  return interrupted;
}

export function formatAskStreamOutcome(outcome = {}, source = {}) {
  const status = String(outcome.status || 'complete');
  const partial = String(outcome.text || '').trim();
  const error = String(outcome.error || '').trim();
  let answer;
  if (status === 'stopped') {
    answer = partial
      ? `${partial}\n\n_Request stopped before completion._`
      : 'Request stopped before completion.';
  } else if (status === 'interrupted') {
    answer = partial
      ? `${partial}\n\n_Request interrupted before completion. Please try again._`
      : 'Request interrupted before completion. Please try again.';
  } else if (status === 'failed') {
    const failure = error || 'The provider request failed.';
    answer = partial
      ? `${partial}\n\n_Request failed before completion: ${failure}_`
      : failure;
  } else {
    answer = partial || 'No AI text returned.';
    if (outcome.finishReason === 'length') {
      answer += '\n\n_The provider stopped at the Ask Page output limit; the answer may be incomplete._';
    }
  }
  return appendAskSourceLink(answer, source);
}

function findAskStreamTarget(sessions, binding) {
  if (!isRecord(sessions)) return null;
  const direct = askStreamTargetInSession(binding.sessionKey, sessions[binding.sessionKey], binding);
  if (direct) return direct;
  for (const [sessionKey, session] of Object.entries(sessions)) {
    if (sessionKey === binding.sessionKey) continue;
    const target = askStreamTargetInSession(sessionKey, session, binding);
    if (target) return target;
  }
  return null;
}

function askStreamTargetInSession(sessionKey, session, binding) {
  if (!isRecord(session) || !Array.isArray(session.messages)) return null;
  const message = session.messages.find((candidate) => (
    isRecord(candidate) &&
    String(candidate.id || '') === binding.messageId &&
    candidate.askStream?.requestId === binding.requestId
  ));
  return message ? { sessionKey, session, message } : null;
}

function normalizeTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
