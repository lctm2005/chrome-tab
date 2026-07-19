export const ASK_SESSION_LIMITS = {
  maxSessions: 12,
  maxMessagesPerSession: 40,
  maxMessageChars: 65_536,
  maxSessionChars: 96_000,
};

export const PORTABLE_ASK_SESSION_PREFIX = 'page:';

export function normalizeSessionUrl(value) {
  const raw = String(value || 'about:blank').trim() || 'about:blank';
  try {
    return new URL(raw).toString();
  } catch {
    return raw.startsWith('#') ? 'about:blank' : raw;
  }
}

export function sessionKeyForTab(tab = {}) {
  const tabId = normalizeAskTabId(tab.id);
  return `tab:${tabId === null ? 'unknown' : tabId}:${normalizeSessionUrl(tab.url)}`;
}

export function sessionKeyForSpace(spaceId) {
  return `space:${String(spaceId || 'default')}`;
}

export function createAskSession(tab = {}, now = Date.now()) {
  const key = sessionKeyForTab(tab);
  return {
    key,
    tabId: normalizeAskTabId(tab.id),
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
  const maxMessages = Number(limits.maxMessagesPerSession || ASK_SESSION_LIMITS.maxMessagesPerSession);
  const message = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    role: role === 'user' ? 'user' : 'assistant',
    text: clampMessageText(text, limits.maxMessageChars),
    createdAt: now,
  };
  session.messages = clampAskSessionMessages(
    [...(session.messages || []), message].slice(-maxMessages),
    limits,
  );
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
  session.messages = clampAskSessionMessages(session.messages, limits);
  if (updated) session.updatedAt = now;
  return updated;
}

export function pruneAskSessions(sessions = {}, options = {}) {
  const maxSessions = Math.max(0, Number(options.maxSessions ?? ASK_SESSION_LIMITS.maxSessions));
  const openTabIds = new Set((options.openTabIds || []).map(Number).filter(Number.isFinite));
  const hasOpenSessionKeys = Array.isArray(options.openSessionKeys);
  const openSessionKeys = new Set((hasOpenSessionKeys ? options.openSessionKeys : [])
    .map(String)
    .filter(Boolean));
  const hasOpenSessionInventory = hasOpenSessionKeys || openTabIds.size > 0;
  const spaceIds = new Set((options.spaceIds || []).map(String).filter(Boolean));
  const inFlightKeys = new Set((options.inFlightKeys || []).map(String).filter(Boolean));
  const usedKeys = new Set(Object.keys(sessions));
  const entries = [];
  for (const [key, session] of Object.entries(sessions)) {
    const protectedSession = key === options.activeKey || inFlightKeys.has(key);
    // Portable sessions restored from a backup, or retained after a tab was
    // closed, are deliberately not tied to a Chrome tab id. Keep them until
    // the matching page is opened and the conversation can be adopted.
    if (key.startsWith(PORTABLE_ASK_SESSION_PREFIX)) {
      entries.push([key, session, protectedSession]);
      continue;
    }
    if (key.startsWith('space:')) {
      const spaceId = String(session?.spaceId || key.slice('space:'.length));
      if (spaceIds.size === 0 || spaceIds.has(spaceId) || protectedSession) {
        entries.push([key, session, protectedSession]);
      }
      continue;
    }

    const tabId = Number(session?.tabId ?? tabIdFromSessionKey(key));
    // A tab id can stay open after navigating to a different URL. Callers
    // with a current tab inventory should pass exact tab-and-URL keys so old
    // routes do not remain permanently protected from the session cap.
    const openSession = hasOpenSessionKeys
      ? openSessionKeys.has(key)
      : openTabIds.has(tabId);
    if (!hasOpenSessionInventory || openSession || protectedSession) {
      entries.push([key, session, protectedSession || openSession]);
      continue;
    }

    // A closed page should not erase a conversation the user may want to
    // revisit or export. Empty sessions are disposable; real HTTP(S) history
    // is demoted to a portable page session with no stale Chrome tab id.
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const url = normalizeSessionUrl(session?.url);
    if (messages.length === 0 || !isPortableAskUrl(url)) continue;
    const portableKey = nextPortableAskSessionKey(usedKeys, url);
    const portableSession = { ...session, key: portableKey, url };
    delete portableSession.tabId;
    delete portableSession.spaceId;
    entries.push([portableKey, portableSession, false]);
  }

  entries.sort(([keyA, a], [keyB, b]) => {
    if (keyA === options.activeKey) return -1;
    if (keyB === options.activeKey) return 1;
    return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
  });

  const protectedCount = entries.filter(([, , protectedSession]) => protectedSession).length;
  let remainingUnprotected = Math.max(0, maxSessions - protectedCount);
  const retained = entries.filter(([, , protectedSession]) => {
    if (protectedSession) return true;
    if (remainingUnprotected === 0) return false;
    remainingUnprotected -= 1;
    return true;
  });

  return Object.fromEntries(retained.map(([key, session]) => [key, session]));
}

function nextPortableAskSessionKey(usedKeys, url) {
  const hash = hashAskSessionUrl(url);
  let ordinal = 1;
  let key = `${PORTABLE_ASK_SESSION_PREFIX}${hash}:${ordinal}`;
  while (usedKeys.has(key)) {
    ordinal += 1;
    key = `${PORTABLE_ASK_SESSION_PREFIX}${hash}:${ordinal}`;
  }
  usedKeys.add(key);
  return key;
}

function hashAskSessionUrl(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isPortableAskUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

/**
 * Moves the newest restored conversation for a page onto the current Chrome
 * tab. Backup files cannot safely persist ephemeral Chrome tab ids, so restored
 * conversations temporarily use `page:*` keys and follow their normalized URL.
 */
export function adoptPortableAskSession(sessions = {}, tab = {}) {
  if (!sessions || typeof sessions !== 'object') return null;
  const liveKey = sessionKeyForTab(tab);
  if (sessions[liveKey]) return sessions[liveKey];

  const pageUrl = normalizeSessionUrl(tab.url);
  const candidates = Object.entries(sessions)
    .filter(([key, session]) => (
      key.startsWith(PORTABLE_ASK_SESSION_PREFIX) &&
      normalizeSessionUrl(session?.url) === pageUrl
    ))
    .sort(([, left], [, right]) => (
      Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
    ));
  if (candidates.length === 0) return null;

  const [portableKey, portableSession] = candidates[0];
  const adopted = {
    ...portableSession,
    key: liveKey,
    tabId: normalizeAskTabId(tab.id),
    title: tab.displayTitle || tab.title || portableSession.title || 'Current page',
    url: pageUrl,
  };
  delete adopted.spaceId;
  delete sessions[portableKey];
  sessions[liveKey] = adopted;
  return adopted;
}

/**
 * Materializes the conversation frozen while an Ask turn is prepared into durable state.
 * A portable session is adopted when it is still available. If another panel
 * already adopted that portable session after preparation began, the prepared
 * projection is cloned into this tab's live key instead of silently dropping
 * history that belongs to the turn being sent.
 */
export function materializeAskSessionForTurn(sessions = {}, tab = {}, projectedSession = null) {
  const liveKey = sessionKeyForTab(tab);
  const pageUrl = normalizeSessionUrl(tab.url);
  const store = isAskSessionRecord(sessions) ? sessions : null;
  if (!store) return createAskSession(tab);

  let durable = adoptPortableAskSession(store, tab);
  if (!isAskSessionRecord(durable) && Object.hasOwn(store, liveKey)) {
    // A malformed live value must not block a valid portable conversation or
    // make the following append operate on a primitive.
    delete store[liveKey];
    durable = adoptPortableAskSession(store, tab);
  }
  if (isAskSessionRecord(durable)) {
    durable.key = liveKey;
    durable.tabId = normalizeAskTabId(tab.id);
    durable.title = tab.displayTitle || tab.title || durable.title || 'Current page';
    durable.url = pageUrl;
    durable.messages = Array.isArray(durable.messages) ? durable.messages : [];
    delete durable.spaceId;
    return durable;
  }

  const prepared = isAskSessionRecord(projectedSession) &&
      String(projectedSession.key || '') === liveKey &&
      normalizeSessionUrl(projectedSession.url) === pageUrl
    ? cloneAskSession(projectedSession)
    : createAskSession(tab);
  prepared.key = liveKey;
  prepared.tabId = normalizeAskTabId(tab.id);
  prepared.title = tab.displayTitle || tab.title || prepared.title || 'Current page';
  prepared.url = pageUrl;
  delete prepared.spaceId;
  store[liveKey] = prepared;
  return prepared;
}

/**
 * Returns the conversation a tab would receive without mutating durable
 * session state. Passive renders and turn preparation can use restored history,
 * while the actual adoption remains an explicit save-time operation.
 */
export function projectAskSessionForTab(sessions = {}, tab = {}) {
  const source = sessions && typeof sessions === 'object' ? sessions : {};
  const liveKey = sessionKeyForTab(tab);
  if (source[liveKey]) return cloneAskSession(source[liveKey]);

  const pageUrl = normalizeSessionUrl(tab.url);
  let newestPortable = null;
  for (const [key, session] of Object.entries(source)) {
    if (!key.startsWith(PORTABLE_ASK_SESSION_PREFIX) ||
        normalizeSessionUrl(session?.url) !== pageUrl) continue;
    if (!newestPortable ||
        Number(session?.updatedAt || 0) > Number(newestPortable[1]?.updatedAt || 0)) {
      newestPortable = [key, session];
    }
  }
  if (!newestPortable) return createAskSession(tab);

  const [portableKey, portableSession] = newestPortable;
  const projected = { [portableKey]: cloneAskSession(portableSession) };
  return adoptPortableAskSession(projected, tab);
}

function isAskSessionRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneAskSession(session) {
  return {
    ...(isAskSessionRecord(session) ? session : {}),
    messages: Array.isArray(session?.messages)
      ? session.messages.map((message) => ({
        ...(isAskSessionRecord(message) ? message : {}),
      }))
      : [],
  };
}

export function tabIdFromSessionKey(key) {
  const match = String(key || '').match(/^tab:(\d+):/);
  return match ? Number(match[1]) : null;
}

export function askSessionTabFromKey(key, openTabs = []) {
  const value = String(key || '');
  const tabId = tabIdFromSessionKey(value);
  const url = value.replace(/^tab:(?:\d+|unknown):/, '') || 'about:blank';
  const normalizedUrl = normalizeSessionUrl(url);
  const tabs = Array.isArray(openTabs) ? openTabs : [];
  const openTab = tabs.find((tab) => (
    (tabId === null || safeNumericTabId(tab?.id) === tabId) &&
    normalizeSessionUrl(tab?.url) === normalizedUrl
  ));
  return {
    id: tabId,
    title: openTab?.displayTitle || openTab?.title || 'Current page',
    url,
  };
}

function safeNumericTabId(value) {
  try {
    return normalizeAskTabId(value);
  } catch {
    return null;
  }
}

export function askSessionKeyAfterTabReplacement(key, removedTabId, addedTabId) {
  const value = String(key || '');
  const removed = normalizeAskTabId(removedTabId);
  const added = normalizeAskTabId(addedTabId);
  if (removed === null || added === null || removed === added || tabIdFromSessionKey(value) !== removed) {
    return value;
  }
  return value.replace(/^tab:\d+:/, `tab:${added}:`);
}

export function rebindAskSessionsForTabReplacement(
  sessions = {},
  removedTabId,
  addedTabId,
) {
  const source = sessions && typeof sessions === 'object' && !Array.isArray(sessions)
    ? sessions
    : {};
  const removed = normalizeAskTabId(removedTabId);
  const added = normalizeAskTabId(addedTabId);
  if (removed === null || added === null || removed === added) {
    return { sessions: source, keyMap: {} };
  }

  const rebound = { ...source };
  const keyMap = {};
  for (const [key, session] of Object.entries(source)) {
    const sessionTabId = normalizeAskTabId(session?.tabId);
    if (tabIdFromSessionKey(key) !== removed && sessionTabId !== removed) continue;
    const nextKey = tabIdFromSessionKey(key) === removed
      ? askSessionKeyAfterTabReplacement(key, removed, added)
      : sessionKeyForTab({ id: added, url: session?.url });
    const nextSession = {
      ...(session && typeof session === 'object' && !Array.isArray(session) ? session : {}),
      key: nextKey,
      tabId: added,
      url: normalizeSessionUrl(session?.url),
    };
    const existing = rebound[nextKey];
    delete rebound[key];
    rebound[nextKey] = mergeReplacementAskSessions(nextSession, existing);
    keyMap[key] = nextKey;
  }
  return { sessions: rebound, keyMap };
}

export function replayAskSessionTabReplacements(
  sessions = {},
  activeKey = '',
  replacements = [],
) {
  let currentSessions = sessions;
  let currentActiveKey = String(activeKey || '');
  const chain = Array.isArray(replacements) ? replacements : [];
  for (const replacement of chain) {
    const removedTabId = replacement?.removedTabId;
    const addedTabId = replacement?.addedTabId;
    const rebound = rebindAskSessionsForTabReplacement(
      currentSessions,
      removedTabId,
      addedTabId,
    );
    currentSessions = rebound.sessions;
    currentActiveKey = rebound.keyMap[currentActiveKey] || askSessionKeyAfterTabReplacement(
      currentActiveKey,
      removedTabId,
      addedTabId,
    );
  }
  return { sessions: currentSessions, activeKey: currentActiveKey };
}

function mergeReplacementAskSessions(rebound, existing) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return rebound;
  const messages = [];
  const indexes = new Map();
  for (const message of [
    ...(Array.isArray(rebound.messages) ? rebound.messages : []),
    ...(Array.isArray(existing.messages) ? existing.messages : []),
  ]) {
    const id = String(message?.id || '');
    if (id && indexes.has(id)) {
      messages[indexes.get(id)] = message;
      continue;
    }
    if (id) indexes.set(id, messages.length);
    messages.push(message);
  }
  return {
    ...rebound,
    ...existing,
    key: rebound.key,
    tabId: rebound.tabId,
    url: rebound.url,
    createdAt: Math.min(
      Number(rebound.createdAt) || Number(existing.createdAt) || 0,
      Number(existing.createdAt) || Number(rebound.createdAt) || 0,
    ),
    updatedAt: Math.max(Number(rebound.updatedAt) || 0, Number(existing.updatedAt) || 0),
    messages,
  };
}

function normalizeAskTabId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function clampMessageText(text, maxChars) {
  const value = String(text || '');
  const requestedLimit = maxChars === undefined || maxChars === null
    ? ASK_SESSION_LIMITS.maxMessageChars
    : Number(maxChars);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(0, Math.floor(requestedLimit))
    : ASK_SESSION_LIMITS.maxMessageChars;
  if (value.length <= limit) return value;
  const sourcesMarker = '\n\n### Sources\n';
  const sourcesIndex = value.lastIndexOf(sourcesMarker);
  const suffix = sourcesIndex >= 0 ? value.slice(sourcesIndex) : '';
  const truncationNotice = '\n\n_Response truncated in saved history._';
  if (suffix && suffix.length + truncationNotice.length < limit) {
    const headLength = Math.max(0, limit - suffix.length - truncationNotice.length);
    return `${value.slice(0, headLength)}${truncationNotice}${suffix}`;
  }
  const ellipsis = '...';
  if (limit <= ellipsis.length) return value.slice(0, limit);
  return `${value.slice(0, limit - ellipsis.length)}${ellipsis}`;
}

export function clampAskSessionMessages(messages, limits = ASK_SESSION_LIMITS) {
  const retained = [...messages];
  const requestedMaxChars = Number(
    limits.maxSessionChars ?? ASK_SESSION_LIMITS.maxSessionChars,
  );
  const maxChars = Number.isFinite(requestedMaxChars)
    ? Math.max(0, Math.floor(requestedMaxChars))
    : ASK_SESSION_LIMITS.maxSessionChars;
  let total = retained.reduce((sum, message) => sum + String(message?.text || '').length, 0);
  while (retained.length > 1 && total > maxChars) {
    const lastUserIndex = retained.findLastIndex((message) => message?.role === 'user');
    if (lastUserIndex === 0) break;
    let removeCount = 1;
    if (lastUserIndex > 0) {
      const nextUserIndex = retained.findIndex((message, index) => (
        index > 0 && message?.role === 'user'
      ));
      // lastUserIndex > 0 guarantees that findIndex finds at least that user.
      removeCount = nextUserIndex;
    }
    const removed = retained.splice(0, removeCount);
    total -= removed.reduce((sum, message) => sum + String(message?.text || '').length, 0);
  }
  if (total <= maxChars) return retained;

  let remaining = Math.max(0, maxChars);
  return retained.map((message, index) => {
    const text = String(message?.text || '');
    const remainingMessages = retained.length - index;
    const allocation = index === retained.length - 1
      ? remaining
      : Math.min(text.length, Math.floor(remaining / remainingMessages));
    remaining -= allocation;
    return { ...message, text: clampMessageText(text, allocation) };
  });
}
