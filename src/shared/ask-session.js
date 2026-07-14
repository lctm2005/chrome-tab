export const ASK_SESSION_LIMITS = {
  maxSessions: 24,
  maxMessagesPerSession: 40,
  maxMessageChars: 8000,
};

export function normalizeSessionUrl(value) {
  const raw = String(value || 'about:blank').trim() || 'about:blank';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw.split('#')[0] || 'about:blank';
  }
}

export function sessionKeyForTab(tab = {}) {
  const tabId = Number.isFinite(Number(tab.id)) ? Number(tab.id) : 'unknown';
  return `tab:${tabId}:${normalizeSessionUrl(tab.url)}`;
}

export function sessionKeyForSpace(spaceId) {
  return `space:${String(spaceId || 'default')}`;
}

export function createAskSession(tab = {}, now = Date.now()) {
  const key = sessionKeyForTab(tab);
  return {
    key,
    tabId: Number.isFinite(Number(tab.id)) ? Number(tab.id) : null,
    title: tab.title || 'Current page',
    url: normalizeSessionUrl(tab.url),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function createSpaceAskSession(space = {}, now = Date.now()) {
  const spaceId = String(space.id || 'default');
  return {
    key: sessionKeyForSpace(spaceId),
    spaceId,
    title: space.name || 'Space',
    url: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function appendAskSessionMessage(session, role, text, limits = ASK_SESSION_LIMITS) {
  const now = Date.now();
  const message = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    role: role === 'user' ? 'user' : 'assistant',
    text: clampMessageText(text, limits.maxMessageChars),
    createdAt: now,
  };
  session.messages = [...(session.messages || []), message].slice(-limits.maxMessagesPerSession);
  session.updatedAt = now;
  return message;
}

export function updateAskSessionMessage(session, messageId, text, limits = ASK_SESSION_LIMITS) {
  if (!session?.messages) return null;
  const now = Date.now();
  let updated = null;
  session.messages = session.messages.map((message) => {
    if (message.id !== messageId) return message;
    updated = {
      ...message,
      text: clampMessageText(text, limits.maxMessageChars),
      updatedAt: now,
    };
    return updated;
  });
  if (updated) session.updatedAt = now;
  return updated;
}

export function pruneAskSessions(sessions = {}, options = {}) {
  const maxSessions = Number(options.maxSessions || ASK_SESSION_LIMITS.maxSessions);
  const openTabIds = new Set((options.openTabIds || []).map(Number).filter(Number.isFinite));
  const spaceIds = new Set((options.spaceIds || []).map(String).filter(Boolean));
  const entries = Object.entries(sessions)
    .filter(([key, session]) => {
      if (key.startsWith('space:')) {
        const spaceId = String(session?.spaceId || key.slice('space:'.length));
        return spaceIds.size === 0 || spaceIds.has(spaceId) || key === options.activeKey;
      }
      const tabId = Number(session?.tabId ?? tabIdFromSessionKey(key));
      return openTabIds.size === 0 || openTabIds.has(tabId) || key === options.activeKey;
    })
    .sort(([keyA, a], [keyB, b]) => {
      if (keyA === options.activeKey) return -1;
      if (keyB === options.activeKey) return 1;
      return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
    })
    .slice(0, maxSessions);

  return Object.fromEntries(entries);
}

export function tabIdFromSessionKey(key) {
  const match = String(key || '').match(/^tab:(\d+):/);
  return match ? Number(match[1]) : null;
}

function clampMessageText(text, maxChars) {
  const value = String(text || '');
  const limit = Number(maxChars || ASK_SESSION_LIMITS.maxMessageChars);
  if (value.length <= limit) return value;
  const sourcesMarker = '\n\n### Sources\n';
  const sourcesIndex = value.lastIndexOf(sourcesMarker);
  const suffix = sourcesIndex >= 0 ? value.slice(sourcesIndex) : '';
  const truncationNotice = '\n\n_Response truncated in saved history._';
  if (suffix && suffix.length + truncationNotice.length < limit) {
    const headLength = Math.max(0, limit - suffix.length - truncationNotice.length);
    return `${value.slice(0, headLength)}${truncationNotice}${suffix}`;
  }
  return `${value.slice(0, limit)}...`;
}
