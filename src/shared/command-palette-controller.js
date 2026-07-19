import { buildCommandPaletteItems } from './command-palette.js';

const EMPTY_RESULT_TEXT = 'No matching Spaces, tabs, or commands.';

export function createCommandPaletteController(options = {}) {
  const {
    dialog,
    input,
    results,
    document: documentObject,
  } = options;
  const missing = Object.entries({ dialog, input, results, document: documentObject })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new TypeError(`Command Palette controller requires: ${missing.join(', ')}`);
  }

  const getData = options.getData || (() => ({}));
  const itemBuilder = options.itemBuilder || buildCommandPaletteItems;
  const canOpen = options.canOpen || (() => true);
  const beforeOpen = options.beforeOpen || (() => undefined);
  const prepareSelection = options.prepareSelection || ((item) => item);
  const onSelect = options.onSelect || (() => undefined);
  const scheduleFocus = options.scheduleFocus || ((callback) => callback());
  let items = [];
  let selectedIndex = 0;

  function stateSnapshot() {
    return {
      items: [...items],
      selectedIndex,
    };
  }

  function render() {
    items = itemBuilder({
      ...getData(),
      query: input.value,
    });
    selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
    const nodes = items.map((item, index) => {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'command-palette-item';
      button.classList.toggle('active', index === selectedIndex);
      button.dataset.commandIndex = String(index);
      button.dataset.commandId = String(item.id || '');
      button.dataset.commandKind = String(item.kind || '');
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === selectedIndex));
      const icon = documentObject.createElement('span');
      icon.textContent = item.icon || '•';
      const title = documentObject.createElement('strong');
      title.textContent = item.title;
      const meta = documentObject.createElement('small');
      meta.textContent = item.meta || '';
      button.append(icon, title, meta);
      return button;
    });
    if (nodes.length === 0) {
      const empty = documentObject.createElement('p');
      empty.className = 'empty';
      empty.textContent = EMPTY_RESULT_TEXT;
      nodes.push(empty);
    }
    results.replaceChildren(...nodes);
    return stateSnapshot();
  }

  function open() {
    if (!canOpen()) return false;
    beforeOpen();
    input.value = '';
    selectedIndex = 0;
    render();
    if (!dialog.open) dialog.showModal();
    scheduleFocus(() => {
      if (dialog.open) input.focus();
    });
    return true;
  }

  function activateSelection() {
    const item = items[selectedIndex];
    if (!item) return false;
    const prepared = prepareSelection(item);
    if (dialog.open) dialog.close();
    onSelect(prepared, item);
    return true;
  }

  function handleInput() {
    render();
  }

  function handleClick(event) {
    const button = event.target.closest('[data-command-index]');
    if (!button) return false;
    selectedIndex = Number(button.dataset.commandIndex);
    return activateSelection();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return true;
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      selectedIndex = (selectedIndex + offset + items.length) % items.length;
      render();
      const active = results.querySelector(`[data-command-index="${selectedIndex}"]`);
      if (active) active.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      return activateSelection();
    }
    return false;
  }

  function handleClose() {
    items = [];
    selectedIndex = 0;
  }

  return {
    open,
    render,
    handleInput,
    handleClick,
    handleKeydown,
    handleClose,
    getState: stateSnapshot,
  };
}
