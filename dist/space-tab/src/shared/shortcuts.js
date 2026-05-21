export const SHORTCUT_ACTIONS = [
  { id: 'togglePanel', label: 'Toggle panel', defaultShortcut: 'Meta+S' },
  { id: 'askSubmit', label: 'Submit Ask', defaultShortcut: 'Meta+Enter' },
  { id: 'askAbort', label: 'Stop Ask', defaultShortcut: 'Control+C' },
  { id: 'openAsk', label: 'Open Ask Page', defaultShortcut: 'Alt+A' },
  { id: 'tidyNames', label: 'Tidy names', defaultShortcut: 'Control+Alt+T' },
  { id: 'autoGroup', label: 'Auto group', defaultShortcut: 'Control+Alt+G' },
  { id: 'addSpace', label: 'Add Space', defaultShortcut: 'Control+Alt+N' },
  { id: 'previousSpace', label: 'Previous Space', defaultShortcut: 'Control+Alt+ArrowLeft' },
  { id: 'nextSpace', label: 'Next Space', defaultShortcut: 'Control+Alt+ArrowRight' },
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.defaultShortcut])
);

const MODIFIER_ALIASES = new Map([
  ['cmd', 'Meta'],
  ['command', 'Meta'],
  ['meta', 'Meta'],
  ['⌘', 'Meta'],
  ['ctrl', 'Control'],
  ['control', 'Control'],
  ['⌃', 'Control'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['opt', 'Alt'],
  ['⌥', 'Alt'],
  ['shift', 'Shift'],
  ['⇧', 'Shift'],
]);

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta'];

const KEY_ALIASES = new Map([
  ['return', 'Enter'],
  ['esc', 'Escape'],
  ['space', 'Space'],
  ['spacebar', 'Space'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
]);

export function mergeShortcuts(stored = {}, defaults = DEFAULT_SHORTCUTS) {
  const next = {};
  for (const action of SHORTCUT_ACTIONS) {
    next[action.id] = normalizeShortcut(stored[action.id] || defaults[action.id] || action.defaultShortcut);
  }
  return next;
}

export function normalizeShortcut(value) {
  const rawParts = String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!rawParts.length) return '';

  const modifiers = new Set();
  let key = '';
  for (const part of rawParts) {
    const lowered = part.toLowerCase();
    const modifier = MODIFIER_ALIASES.get(lowered);
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    key = normalizeKey(part);
  }

  if (!key && rawParts.length === 1) key = normalizeKey(rawParts[0]);
  if (!key) return '';

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join('+');
}

export function shortcutFromEvent(event) {
  const key = normalizeEventKey(event);
  if (!key) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && shouldKeepShift(event, key)) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

export function shortcutMatchesEvent(shortcut, event) {
  return normalizeShortcut(shortcut) === shortcutFromEvent(event);
}

export function shortcutActionFromEvent(event, shortcuts, options = {}) {
  const excluded = new Set(options.exclude || []);
  for (const action of SHORTCUT_ACTIONS) {
    if (excluded.has(action.id)) continue;
    if (shortcutMatchesEvent(shortcuts?.[action.id], event)) return action.id;
  }
  return '';
}

export function shouldIgnoreShortcutInEditable(event) {
  return !event.ctrlKey && !event.altKey && !event.metaKey;
}

export function findShortcutConflict(shortcuts, actionId, candidate) {
  const normalized = normalizeShortcut(candidate);
  if (!normalized) return '';
  for (const [id, shortcut] of Object.entries(shortcuts || {})) {
    if (id !== actionId && normalizeShortcut(shortcut) === normalized) return id;
  }
  return '';
}

export function formatShortcut(shortcut) {
  return normalizeShortcut(shortcut)
    .split('+')
    .filter(Boolean)
    .map((part) => {
      if (part === 'Meta') return 'Cmd';
      if (part === 'Control') return 'Ctrl';
      if (part === 'ArrowLeft') return 'Left';
      if (part === 'ArrowRight') return 'Right';
      if (part === 'ArrowUp') return 'Up';
      if (part === 'ArrowDown') return 'Down';
      return part;
    })
    .join('+');
}

function normalizeKey(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  const alias = KEY_ALIASES.get(lowered);
  if (alias) return alias;
  if (lowered.startsWith('arrow')) {
    return `Arrow${lowered.slice(5, 6).toUpperCase()}${lowered.slice(6)}`;
  }
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return `${trimmed.slice(0, 1).toUpperCase()}${trimmed.slice(1)}`;
}

function normalizeEventKey(event) {
  if (event.key === ' ') return 'Space';
  if (event.key === '+') return '+';
  if (event.key?.startsWith('Arrow')) return event.key;
  const physicalKey = keyFromEventCode(event.code);
  if ((event.ctrlKey || event.altKey || event.metaKey) && physicalKey) return physicalKey;
  if (event.key && event.key.length === 1) return event.key.toUpperCase();
  return normalizeKey(event.key || event.code || '');
}

function shouldKeepShift(event, normalizedKey) {
  if (!event.shiftKey) return false;
  return normalizedKey.length > 1;
}

function keyFromEventCode(code = '') {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Arrow')) return code;
  return '';
}
