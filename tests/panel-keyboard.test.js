import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureShortcutInput,
  createPanelKeyboardController,
  isEditableTarget,
} from '../src/shared/panel-keyboard.js';
import { mergeShortcuts } from '../src/shared/shortcuts.js';

test('controller validates every injected boundary instead of silently dropping keyboard actions', () => {
  assert.throws(
    () => createPanelKeyboardController(),
    /requires: getShortcuts, hasBlockingDialogOpen,[\s\S]*dispatchShortcutAction/,
  );
  assert.doesNotThrow(() => createKeyboardHarness().controller);
});

test('blocking dialogs never queue panel actions and leave Escape to native dialog cancellation', () => {
  const harness = createKeyboardHarness({ blocking: true });

  for (const event of [
    keyEvent({ key: 'k', code: 'KeyK', ctrlKey: true }),
    keyEvent({ key: 'a', code: 'KeyA', altKey: true }),
    keyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true }),
  ]) {
    assert.equal(harness.controller.handleKeydown(event), 'blocked');
    assert.equal(event.prevented, 0);
    assert.equal(event.stopped, 0);
  }
  assert.deepEqual(harness.calls.palette, []);
  assert.deepEqual(harness.calls.submit, []);
  assert.deepEqual(harness.calls.dispatch, []);

  const escape = keyEvent({ key: 'Escape', code: 'Escape' });
  assert.equal(harness.controller.handleKeydown(escape), 'blocked');
  assert.equal(escape.prevented, 0);
  assert.equal(escape.stopped, 0);
  assert.deepEqual(harness.calls.hideMenu.at(-1), undefined);
  assert.equal(harness.calls.hidePreview.length, 1);

  harness.state.activeAIRequestId = 'request-1';
  harness.state.shortcuts = mergeShortcuts({ askAbort: 'Control+.' });
  const abort = keyEvent({ key: '.', code: 'Period', ctrlKey: true });
  assert.equal(harness.controller.handleKeydown(abort), 'ask-aborted');
  assert.equal(abort.prevented, 1);
  assert.equal(abort.stopped, 1);
  assert.equal(harness.calls.abort.length, 1);
  assert.deepEqual(harness.calls.dispatch, []);

  harness.state.shortcuts = mergeShortcuts({ askAbort: 'Primary+C' });
  harness.state.selection = documentSelection('selected answer');
  const copy = keyEvent({ key: 'c', code: 'KeyC', ctrlKey: true });
  assert.equal(harness.controller.handleKeydown(copy), 'blocked');
  assert.equal(copy.prevented, 0);
  assert.equal(harness.calls.abort.length, 1);
});

test('Escape closes an open context menu first and otherwise dismisses transient previews', () => {
  const harness = createKeyboardHarness({ contextMenuOpen: true });
  const menuEscape = keyEvent({ key: 'Escape', code: 'Escape' });

  assert.equal(harness.controller.handleKeydown(menuEscape), 'context-menu-closed');
  assert.equal(menuEscape.prevented, 1);
  assert.equal(menuEscape.stopped, 1);
  assert.deepEqual(harness.calls.hideMenu, [{ restoreFocus: true }]);
  assert.deepEqual(harness.calls.hidePreview, []);

  harness.state.contextMenuOpen = false;
  const idleEscape = keyEvent({ key: 'Escape', code: 'Escape' });
  assert.equal(harness.controller.handleKeydown(idleEscape), 'ignored');
  assert.equal(idleEscape.prevented, 0);
  assert.equal(idleEscape.stopped, 0);
  assert.equal(harness.calls.hideMenu.length, 2);
  assert.equal(harness.calls.hidePreview.length, 1);

  harness.state.activeAIRequestId = 'request-2';
  const abortEscape = keyEvent({ key: 'Escape', code: 'Escape' });
  assert.equal(harness.controller.handleKeydown(abortEscape), 'ask-aborted');
  assert.equal(abortEscape.prevented, 1);
  assert.equal(abortEscape.stopped, 1);
  assert.equal(harness.calls.abort.length, 1);
});

test('command palette shortcuts consume one event and support an injected reservation', () => {
  const defaults = createKeyboardHarness();
  for (const event of [
    keyEvent({ key: 'k', code: 'KeyK', ctrlKey: true }),
    keyEvent({ key: 'k', code: 'KeyK', metaKey: true }),
  ]) {
    assert.equal(defaults.controller.handleKeydown(event), 'command-palette-opened');
    assert.equal(event.prevented, 1);
    assert.equal(event.stopped, 1);
  }
  assert.equal(defaults.calls.palette.length, 2);
  assert.deepEqual(defaults.calls.dispatch, []);

  const custom = createKeyboardHarness({ commandPaletteShortcut: 'Alt+P' });
  const event = keyEvent({ key: 'p', code: 'KeyP', altKey: true });
  assert.equal(custom.controller.handleKeydown(event), 'command-palette-opened');
  assert.equal(custom.calls.palette.length, 1);
});

test('already-consumed, composing, and repeated events cannot dispatch duplicate actions', () => {
  const harness = createKeyboardHarness();
  const actionEvent = keyEvent({ key: 'a', code: 'KeyA', altKey: true });
  assert.equal(harness.controller.handleKeydown(actionEvent), 'shortcut-dispatched');
  assert.equal(harness.controller.handleKeydown(actionEvent), 'already-handled');
  assert.deepEqual(harness.calls.dispatch, ['openAsk']);

  const composing = keyEvent({
    key: 'a',
    code: 'KeyA',
    altKey: true,
    isComposing: true,
  });
  assert.equal(harness.controller.handleKeydown(composing), 'composing');

  const repeated = keyEvent({
    key: 'a',
    code: 'KeyA',
    altKey: true,
    repeat: true,
  });
  assert.equal(harness.controller.handleKeydown(repeated), 'ignored');
  assert.deepEqual(harness.calls.dispatch, ['openAsk']);
  assert.equal(repeated.prevented, 0);
});

test('native copy with a real selection wins over Ask Abort and ordinary configured actions', () => {
  const textInput = { selectionStart: 0, selectionEnd: 4 };
  const askHarness = createKeyboardHarness({
    activeAIRequestId: 'request-copy',
    shortcuts: { askAbort: 'Primary+C' },
  });
  const inputCopy = keyEvent({
    key: 'c',
    code: 'KeyC',
    ctrlKey: true,
    target: Object.assign(plainTarget({ editableNode: textInput }), textInput),
  });
  assert.equal(askHarness.controller.handleKeydown(inputCopy), 'native-copy');
  assert.deepEqual(askHarness.calls.abort, []);
  assert.equal(inputCopy.prevented, 0);

  const actionHarness = createKeyboardHarness({
    shortcuts: { nextSpace: 'Primary+C' },
    selection: documentSelection('selected document text'),
  });
  const documentCopy = keyEvent({ key: 'c', code: 'KeyC', metaKey: true });
  assert.equal(actionHarness.controller.handleKeydown(documentCopy), 'native-copy');
  assert.deepEqual(actionHarness.calls.dispatch, []);

  actionHarness.state.selection = documentSelection('');
  const noSelection = keyEvent({ key: 'c', code: 'KeyC', metaKey: true });
  assert.equal(actionHarness.controller.handleKeydown(noSelection), 'shortcut-dispatched');
  assert.deepEqual(actionHarness.calls.dispatch, ['nextSpace']);
});

test('editable targets keep text input while explicit modified shortcuts still work', () => {
  const harness = createKeyboardHarness({ shortcuts: {
    addSpace: 'Space',
    openAsk: 'Alt+A',
  } });
  const inputNode = {};
  const plainSpace = keyEvent({
    key: ' ',
    code: 'Space',
    target: plainTarget({ editableNode: inputNode }),
  });
  assert.equal(harness.controller.handleKeydown(plainSpace), 'editable');
  assert.equal(plainSpace.prevented, 0);
  assert.deepEqual(harness.calls.dispatch, []);

  const modified = keyEvent({
    key: 'a',
    code: 'KeyA',
    altKey: true,
    target: plainTarget({ editableNode: inputNode }),
  });
  assert.equal(harness.controller.handleKeydown(modified), 'shortcut-dispatched');
  assert.deepEqual(harness.calls.dispatch, ['openAsk']);

  const nonEditable = keyEvent({
    key: ' ',
    code: 'Space',
    target: plainTarget({ editableNode: contentEditableNode('false') }),
  });
  assert.equal(harness.controller.handleKeydown(nonEditable), 'shortcut-dispatched');
  assert.deepEqual(harness.calls.dispatch, ['openAsk', 'addSpace']);
});

test('Ask submit toggles between starting and stopping only in the Ask view', () => {
  const harness = createKeyboardHarness({ activeView: 'ask' });
  const submit = keyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(harness.controller.handleKeydown(submit), 'ask-submitted');
  assert.equal(harness.calls.submit.length, 1);
  assert.deepEqual(harness.calls.abort, []);
  assert.equal(submit.prevented, 1);

  harness.state.activeAIRequestId = 'request-submit';
  const stop = keyEvent({ key: 'Enter', code: 'Enter', metaKey: true });
  assert.equal(harness.controller.handleKeydown(stop), 'ask-submitted');
  assert.equal(harness.calls.submit.length, 1);
  assert.equal(harness.calls.abort.length, 1);

  harness.state.activeView = 'space';
  harness.state.activeAIRequestId = '';
  const outsideAsk = keyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(harness.controller.handleKeydown(outsideAsk), 'ignored');
  assert.equal(harness.calls.submit.length, 1);

  harness.state.activeView = 'ask';
  const unrelated = keyEvent({ key: 'x', code: 'KeyX' });
  assert.equal(harness.controller.handleKeydown(unrelated), 'ignored');
});

test('Space and Shift+Space remain distinct configurable actions', () => {
  const harness = createKeyboardHarness({ shortcuts: {
    nextSpace: 'Space',
    previousSpace: 'Shift+Space',
  } });
  const space = keyEvent({ key: ' ', code: 'Space' });
  const shiftedSpace = keyEvent({ key: ' ', code: 'Space', shiftKey: true });

  assert.equal(harness.controller.handleKeydown(space), 'shortcut-dispatched');
  assert.equal(harness.controller.handleKeydown(shiftedSpace), 'shortcut-dispatched');
  assert.deepEqual(harness.calls.dispatch, ['nextSpace', 'previousSpace']);
  assert.equal(space.prevented, 1);
  assert.equal(shiftedSpace.prevented, 1);
});

test('shortcut input capture preserves Tab, clears with deletion keys, and records real modifiers', () => {
  const input = { value: 'Alt+A', dataset: { shortcut: 'Alt+A' } };

  const tab = keyEvent({ key: 'Tab', code: 'Tab' });
  assert.equal(captureShortcutInput(tab, input), 'shortcut-tab');
  assert.equal(tab.prevented, 0);
  assert.equal(tab.stopped, 0);
  assert.equal(input.dataset.shortcut, 'Alt+A');

  const backspace = keyEvent({ key: 'Backspace', code: 'Backspace', ctrlKey: true });
  assert.equal(captureShortcutInput(backspace, input), 'shortcut-cleared');
  assert.equal(input.value, '');
  assert.equal(input.dataset.shortcut, '');

  input.value = 'Meta+K';
  input.dataset.shortcut = 'Meta+K';
  const deletion = keyEvent({ key: 'Delete', code: 'Delete' });
  assert.equal(captureShortcutInput(deletion, input), 'shortcut-cleared');

  const localizedAltA = keyEvent({ key: 'å', code: 'KeyA', altKey: true });
  assert.equal(captureShortcutInput(localizedAltA, input), 'shortcut-captured');
  assert.equal(input.value, 'Alt+A');
  assert.equal(input.dataset.shortcut, 'Alt+A');

  const shiftedSpace = keyEvent({ key: ' ', code: 'Space', shiftKey: true });
  assert.equal(captureShortcutInput(shiftedSpace, input), 'shortcut-captured');
  assert.equal(input.value, 'Shift+Space');
  assert.equal(input.dataset.shortcut, 'Shift+Space');

  const control = keyEvent({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
  assert.equal(captureShortcutInput(control, input), 'shortcut-modifier');
  assert.equal(control.prevented, 1);
  assert.equal(control.stopped, 1);
  assert.equal(input.dataset.shortcut, 'Shift+Space');
});

test('controller routes shortcut recorder events without invoking panel actions', () => {
  const input = { value: '', dataset: { shortcut: '' } };
  const harness = createKeyboardHarness();
  const event = keyEvent({
    key: ' ',
    code: 'Space',
    target: plainTarget({ shortcutInput: input }),
  });

  assert.equal(harness.controller.handleKeydown(event), 'shortcut-captured');
  assert.equal(input.value, 'Space');
  assert.equal(input.dataset.shortcut, 'Space');
  assert.deepEqual(harness.calls.dispatch, []);
});

test('editable detection covers native controls and every valid contenteditable form', () => {
  for (const node of [
    {},
    contentEditableNode(null),
    contentEditableNode(''),
    contentEditableNode('plaintext-only'),
  ]) {
    assert.equal(isEditableTarget(plainTarget({ editableNode: node })), true);
  }
  assert.equal(
    isEditableTarget(plainTarget({ editableNode: contentEditableNode('FALSE') })),
    false,
  );
  assert.equal(isEditableTarget(plainTarget()), false);
  assert.equal(isEditableTarget({}), false);
  assert.equal(isEditableTarget(null), false);
});

function createKeyboardHarness(overrides = {}) {
  const state = {
    shortcuts: mergeShortcuts(overrides.shortcuts),
    blocking: Boolean(overrides.blocking),
    contextMenuOpen: Boolean(overrides.contextMenuOpen),
    activeAIRequestId: overrides.activeAIRequestId || '',
    activeView: overrides.activeView || 'space',
    selection: overrides.selection || null,
  };
  const calls = {
    hideMenu: [],
    hidePreview: [],
    palette: [],
    abort: [],
    submit: [],
    dispatch: [],
  };
  const controller = createPanelKeyboardController({
    getShortcuts: () => state.shortcuts,
    hasBlockingDialogOpen: () => state.blocking,
    isContextMenuOpen: () => state.contextMenuOpen,
    hideContextMenu: (options) => calls.hideMenu.push(options),
    hideGroupPreview: () => calls.hidePreview.push(true),
    getActiveAIRequestId: () => state.activeAIRequestId,
    getActiveView: () => state.activeView,
    getSelection: () => state.selection,
    openCommandPalette: () => calls.palette.push(true),
    abortActiveAIRequest: () => calls.abort.push(true),
    submitAsk: () => calls.submit.push(true),
    dispatchShortcutAction: (action) => calls.dispatch.push(action),
    ...(overrides.commandPaletteShortcut
      ? { commandPaletteShortcut: overrides.commandPaletteShortcut }
      : {}),
  });
  return { state, calls, controller };
}

function keyEvent(overrides = {}) {
  const event = {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    target: plainTarget(),
    prevented: 0,
    stopped: 0,
    ...overrides,
  };
  event.preventDefault = () => {
    event.defaultPrevented = true;
    event.prevented += 1;
  };
  event.stopPropagation = () => {
    event.stopped += 1;
  };
  return event;
}

function plainTarget({ shortcutInput = null, editableNode = null } = {}) {
  return {
    closest(selector) {
      if (selector === '.shortcut-input') return shortcutInput;
      if (selector === 'input, textarea, select, [contenteditable]') return editableNode;
      return null;
    },
  };
}

function contentEditableNode(value) {
  return { getAttribute: () => value };
}

function documentSelection(text) {
  return {
    isCollapsed: false,
    toString: () => text,
  };
}
