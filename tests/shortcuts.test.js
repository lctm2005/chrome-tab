import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHORTCUTS,
  findShortcutConflict,
  formatShortcut,
  mergeShortcuts,
  normalizeShortcut,
  shortcutFromEvent,
  shortcutMatchesEvent,
  shouldIgnoreShortcutInEditable,
} from '../src/shared/shortcuts.js';

function keyEvent(overrides) {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
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

test('uses physical key codes for modified letter shortcuts on macOS', () => {
  assert.equal(shortcutFromEvent(keyEvent({ key: 'å', code: 'KeyA', altKey: true })), 'Alt+A');
  assert.equal(shortcutFromEvent(keyEvent({ key: '†', code: 'KeyT', ctrlKey: true, altKey: true })), 'Control+Alt+T');
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

test('detects duplicate shortcut assignments in settings', () => {
  const shortcuts = mergeShortcuts({ askSubmit: 'Meta+Enter' });

  assert.equal(findShortcutConflict(shortcuts, 'askAbort', 'Meta+Enter'), 'askSubmit');
  assert.equal(findShortcutConflict(shortcuts, 'askSubmit', 'Meta+Enter'), '');
});

test('formats shortcuts for display without platform symbols', () => {
  assert.equal(formatShortcut('Meta+Enter'), 'Cmd+Enter');
  assert.equal(formatShortcut('Control+Alt+ArrowLeft'), 'Ctrl+Alt+Left');
});

test('only ignores plain text shortcuts while editing text', () => {
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: '/' })), true);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 'a', altKey: true })), false);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 't', ctrlKey: true, altKey: true })), false);
  assert.equal(shouldIgnoreShortcutInEditable(keyEvent({ key: 'Enter', metaKey: true })), false);
});
