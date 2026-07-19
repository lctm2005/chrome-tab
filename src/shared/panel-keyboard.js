import {
  RESERVED_SHORTCUTS,
  formatShortcut,
  shortcutActionFromEvent,
  shortcutFromEvent,
  shortcutMatchesEvent,
  shouldIgnoreShortcutInEditable,
  shouldPreserveNativeCopy,
} from './shortcuts.js';

const REQUIRED_CONTROLLER_OPTIONS = [
  'getShortcuts',
  'hasBlockingDialogOpen',
  'isContextMenuOpen',
  'hideContextMenu',
  'hideGroupPreview',
  'getActiveAIRequestId',
  'getActiveView',
  'getSelection',
  'openCommandPalette',
  'abortActiveAIRequest',
  'submitAsk',
  'dispatchShortcutAction',
];

/**
 * Owns panel-level keyboard policy while leaving every business action behind
 * injected callbacks. This keeps modal, native-editing, and event-consumption
 * decisions consistent across all shortcuts.
 */
export function createPanelKeyboardController(options = {}) {
  const missing = REQUIRED_CONTROLLER_OPTIONS.filter((name) => typeof options[name] !== 'function');
  if (missing.length > 0) {
    throw new TypeError(`Panel keyboard controller requires: ${missing.join(', ')}`);
  }

  const commandPaletteShortcut = options.commandPaletteShortcut ||
    RESERVED_SHORTCUTS[0].shortcut;

  function handleKeydown(event) {
    if (event.defaultPrevented) return 'already-handled';
    if (event.isComposing) return 'composing';

    const shortcutInput = event.target?.closest?.('.shortcut-input');
    if (shortcutInput) return captureShortcutInput(event, shortcutInput);

    if (event.key === 'Escape') {
      if (options.isContextMenuOpen()) {
        consumeEvent(event);
        options.hideContextMenu({ restoreFocus: true });
        return 'context-menu-closed';
      }
      options.hideContextMenu();
      options.hideGroupPreview();
      // Let the topmost native dialog receive Escape and run its normal cancel
      // behavior. Never enqueue a panel action behind that modal interaction.
      if (options.hasBlockingDialogOpen()) return 'blocked';
    }

    const shortcuts = options.getShortcuts();
    if (options.hasBlockingDialogOpen()) {
      if (shouldAbortAsk(event, shortcuts, options)) {
        consumeEvent(event);
        options.abortActiveAIRequest();
        return 'ask-aborted';
      }
      return 'blocked';
    }

    if (shortcutMatchesEvent(commandPaletteShortcut, event)) {
      consumeEvent(event);
      options.openCommandPalette();
      return 'command-palette-opened';
    }

    if (shouldPreserveNativeCopy(event, options.getSelection())) return 'native-copy';

    if (shouldAbortAsk(event, shortcuts, options)) {
      consumeEvent(event);
      options.abortActiveAIRequest();
      return 'ask-aborted';
    }

    if (options.getActiveView() === 'ask' && shortcutMatchesEvent(shortcuts.askSubmit, event)) {
      consumeEvent(event);
      if (options.getActiveAIRequestId()) options.abortActiveAIRequest();
      else options.submitAsk();
      return 'ask-submitted';
    }

    if (isEditableTarget(event.target) && shouldIgnoreShortcutInEditable(event)) {
      return 'editable';
    }

    const action = shortcutActionFromEvent(event, shortcuts, {
      exclude: ['togglePanel', 'askSubmit', 'askAbort'],
    });
    if (!action) return 'ignored';
    consumeEvent(event);
    options.dispatchShortcutAction(action);
    return 'shortcut-dispatched';
  }

  return { handleKeydown };
}

export function captureShortcutInput(event, input) {
  if (event.key === 'Tab') return 'shortcut-tab';
  consumeEvent(event);
  if (event.key === 'Backspace' || event.key === 'Delete') {
    input.value = '';
    input.dataset.shortcut = '';
    return 'shortcut-cleared';
  }
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) return 'shortcut-modifier';
  input.value = formatShortcut(shortcut);
  input.dataset.shortcut = shortcut;
  return 'shortcut-captured';
}

export function isEditableTarget(target) {
  const node = target?.closest?.('input, textarea, select, [contenteditable]');
  if (!node) return false;
  const contentEditable = node.getAttribute?.('contenteditable');
  return contentEditable === undefined || contentEditable === null ||
    String(contentEditable).toLowerCase() !== 'false';
}

function shouldAbortAsk(event, shortcuts, options) {
  return Boolean(
    options.getActiveAIRequestId() &&
    shortcutMatchesEvent(shortcuts.askAbort, event) &&
    !shouldPreserveNativeCopy(event, options.getSelection()),
  );
}

function consumeEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}
