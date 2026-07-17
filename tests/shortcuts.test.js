import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHORTCUTS,
  findReservedShortcutConflict,
  findShortcutConflict,
  formatShortcut,
  mergeShortcuts,
  normalizeShortcut,
  RESERVED_SHORTCUTS,
  shortcutActionFromEvent,
  shortcutFromEvent,
  shortcutMatchesEvent,
  shouldIgnoreShortcutInEditable,
  shouldPreserveNativeCopy,
} from '../src/shared/shortcuts.js';

function keyEvent(overrides) {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    ...overrides,
  };
}

test('normalizes shortcut strings into a stable modifier order', () => {
  assert.equal(normalizeShortcut('cmd + enter'), 'Meta+Enter');
  assert.equal(normalizeShortcut('option+ctrl+g'), 'Control+Alt+G');
  assert.equal(normalizeShortcut('shift+alt+arrowright'), 'Alt+Shift+ArrowRight');
  assert.equal(normalizeShortcut('return'), 'Enter');
});

test('creates shortcuts from keyboard events and matches configured actions', () => {
  const event = keyEvent({ key: 'Enter', metaKey: true });

  assert.equal(shortcutFromEvent(event), 'Meta+Enter');
  assert.equal(shortcutMatchesEvent('Meta+Enter', event), true);
  assert.equal(shortcutMatchesEvent('Control+Enter', event), false);
});

test('uses Escape to stop Ask and preserves native copy when text is selected', () => {
  assert.equal(DEFAULT_SHORTCUTS.askAbort, 'Escape');
  const ctrlCopy = keyEvent({
    key: 'c',
    code: 'KeyC',
    ctrlKey: true,
    target: { selectionStart: 2, selectionEnd: 5 },
  });
  const metaCopy = keyEvent({ key: 'c', code: 'KeyC', metaKey: true });

  assert.equal(shouldPreserveNativeCopy(ctrlCopy), true);
  assert.equal(shouldPreserveNativeCopy({ ...ctrlCopy, target: { selectionStart: 2, selectionEnd: 2 } }), false);
  assert.equal(shouldPreserveNativeCopy(metaCopy, { isCollapsed: false, toString: () => 'answer' }), true);
  assert.equal(shouldPreserveNativeCopy(metaCopy, { isCollapsed: true, toString: () => '' }), false);
  assert.equal(shouldPreserveNativeCopy(keyEvent({ key: 'x', code: 'KeyX', ctrlKey: true })), false);
});

test('the primary modifier submits Ask with either Ctrl or Cmd without double-modifier matches', () => {
  const controlEnter = keyEvent({ key: 'Enter', ctrlKey: true });
  const metaEnter = keyEvent({ key: 'Enter', metaKey: true });
  const bothEnter = keyEvent({ key: 'Enter', ctrlKey: true, metaKey: true });

  assert.equal(DEFAULT_SHORTCUTS.askSubmit, 'Primary+Enter');
  assert.equal(normalizeShortcut('mod + enter'), 'Primary+Enter');
  assert.equal(normalizeShortcut('Control+Primary+Meta+Enter'), 'Primary+Enter');
  assert.equal(shortcutMatchesEvent('Primary+Enter', controlEnter), true);
  assert.equal(shortcutMatchesEvent('Primary+Enter', metaEnter), true);
  assert.equal(shortcutMatchesEvent('Primary+Enter', bothEnter), false);
  assert.equal(shortcutActionFromEvent(controlEnter, mergeShortcuts()), 'askSubmit');
  assert.equal(shortcutActionFromEvent(metaEnter, mergeShortcuts()), 'askSubmit');
});

test('finds configured shortcut actions and supports exclusions', () => {
  const shortcuts = mergeShortcuts();
  const event = keyEvent({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true });

  assert.equal(shortcutActionFromEvent(event, shortcuts), 'nextSpace');
  assert.equal(shortcutActionFromEvent(event, shortcuts, { exclude: ['nextSpace'] }), '');
});

test('uses physical key codes for modified letter shortcuts on macOS', () => {
  assert.equal(shortcutFromEvent(keyEvent({ key: 'å', code: 'KeyA', altKey: true })), 'Alt+A');
  assert.equal(shortcutFromEvent(keyEvent({ key: '†', code: 'KeyT', ctrlKey: true, altKey: true })), 'Control+Alt+T');
});

test('preserves Shift for configurable modified letter shortcuts', () => {
  const controlShiftS = keyEvent({
    key: 'S',
    code: 'KeyS',
    ctrlKey: true,
    shiftKey: true,
  });
  const metaShiftK = keyEvent({
    key: 'K',
    code: 'KeyK',
    shiftKey: true,
    metaKey: true,
  });

  assert.equal(normalizeShortcut('control + shift + s'), 'Control+Shift+S');
  assert.equal(normalizeShortcut('meta + shift + k'), 'Shift+Meta+K');
  assert.equal(shortcutFromEvent(controlShiftS), 'Control+Shift+S');
  assert.equal(shortcutFromEvent(metaShiftK), 'Shift+Meta+K');
  assert.equal(shortcutMatchesEvent('Control+Shift+S', controlShiftS), true);
  assert.equal(shortcutMatchesEvent('Meta+Shift+K', metaShiftK), true);

  const controlSWithoutShift = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true });
  const metaKWithoutShift = keyEvent({ key: 'k', code: 'KeyK', metaKey: true });
  assert.equal(shortcutFromEvent(controlSWithoutShift), 'Control+S');
  assert.equal(shortcutFromEvent(metaKWithoutShift), 'Meta+K');
  assert.equal(shortcutMatchesEvent('Control+S', controlSWithoutShift), true);
  assert.equal(shortcutMatchesEvent('Meta+K', metaKWithoutShift), true);
  assert.equal(shortcutMatchesEvent('Control+Shift+S', controlSWithoutShift), false);
  assert.equal(shortcutMatchesEvent('Meta+Shift+K', metaKWithoutShift), false);
  assert.equal(shortcutMatchesEvent('Control+S', controlShiftS), false);
  assert.equal(shortcutMatchesEvent('Meta+K', metaShiftK), false);

  assert.equal(shortcutFromEvent(keyEvent({ key: '?', code: 'Slash', shiftKey: true })), '?');
});

test('merges stored shortcut overrides with defaults and drops unknown actions', () => {
  const shortcuts = mergeShortcuts({
    askSubmit: 'Control+Enter',
    unknownAction: 'Control+Alt+X',
  });

  assert.equal(shortcuts.askSubmit, 'Control+Enter');
  assert.equal(shortcuts.askAbort, DEFAULT_SHORTCUTS.askAbort);
  assert.equal(shortcuts.unknownAction, undefined);
});

test('preserves empty stored shortcuts as disabled actions', () => {
  const shortcuts = mergeShortcuts({
    openAsk: '',
    nextSpace: 'Control+Alt+J',
  });

  assert.equal(shortcuts.openAsk, '');
  assert.equal(shortcuts.nextSpace, 'Control+Alt+J');
  assert.equal(shortcuts.askAbort, DEFAULT_SHORTCUTS.askAbort);
});

test('detects duplicate shortcut assignments in settings', () => {
  const shortcuts = mergeShortcuts({ askSubmit: 'Meta+Enter' });

  assert.equal(findShortcutConflict(shortcuts, 'askAbort', 'Meta+Enter'), 'askSubmit');
  assert.equal(findShortcutConflict(shortcuts, 'askSubmit', 'Meta+Enter'), '');
});

test('detects concrete Ctrl or Cmd conflicts with a cross-platform primary shortcut', () => {
  const shortcuts = mergeShortcuts();

  assert.equal(findShortcutConflict(shortcuts, 'openAsk', 'Control+Enter'), 'askSubmit');
  assert.equal(findShortcutConflict(shortcuts, 'openAsk', 'Meta+Enter'), 'askSubmit');
  assert.equal(findShortcutConflict({ first: 'Control+Enter' }, 'second', 'Primary+Enter'), 'first');
  assert.equal(findShortcutConflict({ first: 'Alt+Enter' }, 'second', 'Primary+Enter'), '');
});

test('reserves only the exact Ctrl/Cmd+K command-palette shortcut', () => {
  assert.deepEqual(RESERVED_SHORTCUTS, [
    { id: 'commandPalette', label: 'Command palette', shortcut: 'Primary+K' },
  ]);
  assert.equal(findReservedShortcutConflict('Control+K'), 'commandPalette');
  assert.equal(findReservedShortcutConflict('Meta+K'), 'commandPalette');
  assert.equal(findReservedShortcutConflict('Primary+K'), 'commandPalette');
  assert.equal(findReservedShortcutConflict('Control+Shift+K'), '');
  assert.equal(findReservedShortcutConflict('Meta+Shift+K'), '');
  assert.equal(findReservedShortcutConflict('Alt+K'), '');
  assert.equal(findReservedShortcutConflict(''), '');
});

test('formats shortcuts for display without platform symbols', () => {
  assert.equal(formatShortcut('Meta+Enter'), 'Cmd+Enter');
  assert.equal(formatShortcut('Control+Alt+ArrowLeft'), 'Ctrl+Alt+Left');
  assert.equal(formatShortcut('Primary+Enter'), 'Ctrl/Cmd+Enter');
});

test('only ignores plain text shortcuts while editing text', () => {
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: '/' })), true);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 'a', altKey: true })), false);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 't', ctrlKey: true, altKey: true })), false);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 'Enter', metaKey: true })), false);
});

test('normalizes cross-platform aliases and rejects modifier-only input', () => {
  assert.equal(normalizeShortcut('⌘ + option + shift + p'), 'Alt+Shift+Meta+P');
  assert.equal(normalizeShortcut('⌃ + opt + ⇧ + P'), 'Control+Alt+Shift+P');
  assert.equal(normalizeShortcut('ctrl + control + command + cmd + k'), 'Control+Meta+K');
  assert.equal(normalizeShortcut('escape'), 'Escape');
  assert.equal(normalizeShortcut('spacebar'), 'Space');
  assert.equal(normalizeShortcut('left'), 'ArrowLeft');
  assert.equal(normalizeShortcut('up'), 'ArrowUp');
  assert.equal(normalizeShortcut('down'), 'ArrowDown');
  assert.equal(normalizeShortcut('f12'), 'F12');
  assert.equal(normalizeShortcut(''), '');
  assert.equal(normalizeShortcut('  +  '), '');
  assert.equal(normalizeShortcut('Control'), '');
  assert.equal(normalizeShortcut('Control+Alt+Shift+Meta'), '');
});

test('creates shortcuts for Space, arrows, digits, and ordinary keys', () => {
  assert.equal(shortcutFromEvent(keyEvent({ key: ' ' })), 'Space');
  assert.equal(shortcutFromEvent(keyEvent({ key: '+' })), '+');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true })), 'Shift+ArrowLeft');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'Left', code: 'ArrowLeft', ctrlKey: true })), 'Control+ArrowLeft');
  assert.equal(shortcutFromEvent(keyEvent({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })), 'Control+1');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'x' })), 'X');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'Escape', code: 'Escape' })), 'Escape');
  assert.equal(shortcutFromEvent(keyEvent({ key: '', code: '' })), '');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true })), '');
  assert.equal(shortcutFromEvent(keyEvent({ key: 'Meta', code: 'MetaLeft', metaKey: true })), '');
});

test('does not trigger configured actions for repeated keydown events', () => {
  const shortcuts = mergeShortcuts({ addSpace: 'Control+Alt+N' });
  const repeated = keyEvent({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, repeat: true });

  assert.equal(shortcutMatchesEvent('Control+Alt+N', repeated), false);
  assert.equal(shortcutActionFromEvent(repeated, shortcuts), '');
});

test('merges fallback defaults and detects only real normalized conflicts', () => {
  const fallbacks = mergeShortcuts(null, {});
  assert.equal(fallbacks.addSpace, DEFAULT_SHORTCUTS.addSpace);

  const shortcuts = {
    first: 'cmd + enter',
    second: 'Control+Enter',
    disabled: '',
  };
  assert.equal(findShortcutConflict(shortcuts, 'candidate', 'Meta+Enter'), 'first');
  assert.equal(findShortcutConflict(shortcuts, 'first', 'Meta+Enter'), '');
  assert.equal(findShortcutConflict(shortcuts, 'candidate', 'Alt+Enter'), '');
  assert.equal(findShortcutConflict(shortcuts, 'candidate', ''), '');
  assert.equal(findShortcutConflict(null, 'candidate', 'Meta+Enter'), '');
});

test('formats every directional key and empty shortcuts for settings', () => {
  assert.equal(formatShortcut('Control+ArrowRight'), 'Ctrl+Right');
  assert.equal(formatShortcut('Shift+ArrowUp'), 'Shift+Up');
  assert.equal(formatShortcut('Alt+ArrowDown'), 'Alt+Down');
  assert.equal(formatShortcut(''), '');
});
