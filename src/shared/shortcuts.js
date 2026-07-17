export const SHORTCUT_ACTIONS = [
  { id: 'togglePanel', label: 'Toggle panel', defaultShortcut: 'Alt+S' },
  { id: 'askSubmit', label: 'Submit Ask', defaultShortcut: 'Primary+Enter' },
  { id: 'askAbort', label: 'Stop Ask', defaultShortcut: 'Escape' },
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

export const RESERVED_SHORTCUTS = [
  { id: 'commandPalette', label: 'Command palette', shortcut: 'Primary+K' },
];

const MODIFIER_ALIASES = new Map([
  ['cmd', 'Meta'],
  ['command', 'Meta'],
  ['meta', 'Meta'],
  ['⌘', 'Meta'],
  ['ctrl', 'Control'],
  ['control', 'Control'],
  ['⌃', 'Control'],
  ['mod', 'Primary'],
  ['primary', 'Primary'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['opt', 'Alt'],
  ['⌥', 'Alt'],
  ['shift', 'Shift'],
  ['⇧', 'Shift'],
]);

const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta', 'Primary'];

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
    const hasStoredShortcut = Object.prototype.hasOwnProperty.call(stored || {}, action.id);
    const shortcut = hasStoredShortcut
      ? stored[action.id]
      : defaults[action.id] || action.defaultShortcut;
    next[action.id] = normalizeShortcut(shortcut);
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

  if (!key) return '';

  if (modifiers.has('Primary')) {
    modifiers.delete('Control');
    modifiers.delete('Meta');
  }

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
  if (event.shiftKey && shouldKeepShift(key)) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

export function shortcutMatchesEvent(shortcut, event) {
  if (event.repeat) return false;
  const eventShortcut = shortcutFromEvent(event);
  return shortcutVariants(shortcut).includes(eventShortcut);
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

export function shouldPreserveNativeCopy(event, selection = null) {
  if (!shortcutMatchesEvent('Primary+C', event)) return false;
  const target = event?.target;
  const hasTextControlSelection = (
    Number.isFinite(target?.selectionStart) &&
    Number.isFinite(target?.selectionEnd) &&
    target.selectionEnd > target.selectionStart
  );
  const hasDocumentSelection = Boolean(
    selection && selection.isCollapsed === false && String(selection).length > 0
  );
  return hasTextControlSelection || hasDocumentSelection;
}

export function findShortcutConflict(shortcuts, actionId, candidate) {
  const normalized = normalizeShortcut(candidate);
  if (!normalized) return '';
  for (const [id, shortcut] of Object.entries(shortcuts || {})) {
    if (id !== actionId && shortcutsOverlap(shortcut, normalized)) return id;
  }
  return '';
}

export function findReservedShortcutConflict(candidate) {
  const normalized = normalizeShortcut(candidate);
  if (!normalized) return '';
  return RESERVED_SHORTCUTS.find((reserved) => (
    shortcutsOverlap(reserved.shortcut, normalized)
  ))?.id || '';
}

export function formatShortcut(shortcut) {
  return normalizeShortcut(shortcut)
    .split('+')
    .filter(Boolean)
    .map((part) => {
      if (part === 'Meta') return 'Cmd';
      if (part === 'Control') return 'Ctrl';
      if (part === 'Primary') return 'Ctrl/Cmd';
      if (part === 'ArrowLeft') return 'Left';
      if (part === 'ArrowRight') return 'Right';
      if (part === 'ArrowUp') return 'Up';
      if (part === 'ArrowDown') return 'Down';
      return part;
    })
    .join('+');
}

function shortcutsOverlap(left, right) {
  const rightVariants = new Set(shortcutVariants(right));
  return shortcutVariants(left).some((variant) => rightVariants.has(variant));
}

function shortcutVariants(shortcut) {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return [];
  if (!normalized.split('+').includes('Primary')) return [normalized];
  return [
    normalized.replace('Primary', 'Control'),
    normalized.replace('Primary', 'Meta'),
  ];
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
  if (MODIFIER_ALIASES.has(String(event.key || '').toLowerCase())) return '';
  if (event.key?.startsWith('Arrow')) return event.key;
  const physicalKey = keyFromEventCode(event.code);
  if ((event.ctrlKey || event.altKey || event.metaKey) && physicalKey) return physicalKey;
  if (event.key && event.key.length === 1) return event.key.toUpperCase();
  return normalizeKey(event.key || event.code || '');
}

function shouldKeepShift(normalizedKey) {
  return normalizedKey.length > 1 || /^[A-Z]$/.test(normalizedKey);
}

function keyFromEventCode(code = '') {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Arrow')) return code;
  return '';
}
