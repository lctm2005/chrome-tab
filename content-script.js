const STORAGE_KEY = 'spaceTabsState';
const PAGE_SHORTCUT_ACTIONS = [
  'togglePanel',
  'openAsk',
  'tidyNames',
  'autoGroup',
  'addSpace',
  'previousSpace',
  'nextSpace',
];
const DEFAULT_SHORTCUTS = {
  togglePanel: 'Alt+S',
  openAsk: 'Alt+A',
  tidyNames: 'Control+Alt+T',
  autoGroup: 'Control+Alt+G',
  addSpace: 'Control+Alt+N',
  previousSpace: 'Control+Alt+ArrowLeft',
  nextSpace: 'Control+Alt+ArrowRight',
};
const LEGACY_TOGGLE_PANEL_SHORTCUT = 'Meta+S';

let activeShortcuts = mergeContentShortcuts();

refreshContentShortcuts();
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
  const nextState = changes[STORAGE_KEY].newValue || {};
  activeShortcuts = mergeContentShortcuts(nextState.shortcuts || {}, nextState.version);
});

document.addEventListener('keydown', (event) => {
  handlePageShortcutKeydown(event);
}, true);

window.addEventListener('keydown', (event) => {
  handlePageShortcutKeydown(event);
}, true);

function handlePageShortcutKeydown(event) {
  if (event.spaceTabsShortcutHandled) return;
  const action = pageShortcutActionFromEvent(event);
  if (!action) return;
  event.spaceTabsShortcutHandled = true;
  event.preventDefault();
  event.stopImmediatePropagation();
  sendRuntimeMessage(action === 'togglePanel'
    ? { type: 'panel:toggle' }
    : { type: 'shortcut:action', action });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'page:outline') return false;
  sendResponse(extractPageOutline());
  return false;
});

function refreshContentShortcuts() {
  try {
    chrome.storage?.local?.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) return;
      const storedState = result?.[STORAGE_KEY] || {};
      activeShortcuts = mergeContentShortcuts(storedState.shortcuts || {}, storedState.version);
    });
  } catch {
    activeShortcuts = mergeContentShortcuts();
  }
}

function sendRuntimeMessage(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result?.catch) result.catch(() => null);
  } catch {
    // The extension context can disappear during reloads.
  }
}

function pageShortcutActionFromEvent(event) {
  for (const action of PAGE_SHORTCUT_ACTIONS) {
    if (contentShortcutMatchesEvent(activeShortcuts[action], event)) return action;
  }
  return '';
}

function mergeContentShortcuts(stored = {}, storedVersion = 4) {
  const next = {};
  for (const action of PAGE_SHORTCUT_ACTIONS) {
    const hasStoredShortcut = Object.prototype.hasOwnProperty.call(stored || {}, action);
    const storedShortcut = hasStoredShortcut ? normalizeContentShortcut(stored[action] || '') : '';
    next[action] = (
      action === 'togglePanel' &&
      Number(storedVersion) < 4 &&
      storedShortcut === LEGACY_TOGGLE_PANEL_SHORTCUT
    )
      ? DEFAULT_SHORTCUTS[action]
      : hasStoredShortcut
        ? storedShortcut
        : normalizeContentShortcut(DEFAULT_SHORTCUTS[action]);
  }
  return next;
}

function contentShortcutMatchesEvent(shortcut, event) {
  return normalizeContentShortcut(shortcut) === contentShortcutFromEvent(event);
}

function normalizeContentShortcut(value) {
  const rawParts = String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!rawParts.length) return '';

  const modifiers = new Set();
  let key = '';
  for (const part of rawParts) {
    const lowered = part.toLowerCase();
    const modifier = contentModifierAlias(lowered);
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    key = normalizeContentKey(part);
  }
  if (!key && rawParts.length === 1) key = normalizeContentKey(rawParts[0]);
  if (!key) return '';

  return ['Control', 'Alt', 'Shift', 'Meta']
    .filter((modifier) => modifiers.has(modifier))
    .concat(key)
    .join('+');
}

function contentShortcutFromEvent(event) {
  const key = normalizeContentEventKey(event);
  if (!key) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && key.length > 1) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

function contentModifierAlias(value) {
  if (['cmd', 'command', 'meta'].includes(value)) return 'Meta';
  if (['ctrl', 'control'].includes(value)) return 'Control';
  if (['alt', 'option', 'opt'].includes(value)) return 'Alt';
  if (value === 'shift') return 'Shift';
  return '';
}

function normalizeContentEventKey(event) {
  if (event.key === ' ') return 'Space';
  if (event.key?.startsWith('Arrow')) return event.key;
  const physicalKey = keyFromContentCode(event.code);
  if ((event.ctrlKey || event.altKey || event.metaKey) && physicalKey) return physicalKey;
  if (event.key && event.key.length === 1) return event.key.toUpperCase();
  return normalizeContentKey(event.key || event.code || '');
}

function normalizeContentKey(value) {
  const trimmed = String(value || '').trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed) return '';
  if (lowered === 'return') return 'Enter';
  if (lowered === 'esc') return 'Escape';
  if (lowered === 'left') return 'ArrowLeft';
  if (lowered === 'right') return 'ArrowRight';
  if (lowered === 'up') return 'ArrowUp';
  if (lowered === 'down') return 'ArrowDown';
  if (lowered.startsWith('arrow')) {
    return `Arrow${lowered.slice(5, 6).toUpperCase()}${lowered.slice(6)}`;
  }
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
}

function keyFromContentCode(code = '') {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Arrow')) return code;
  return '';
}

function extractPageOutline() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '')
    .filter(Boolean)
    .filter((text, index, values) => values.indexOf(text) === index)
    .slice(0, 10);

  return {
    title: document.title || '',
    url: location.href,
    headings,
  };
}
