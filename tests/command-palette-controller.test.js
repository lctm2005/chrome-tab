import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommandPaletteController } from '../src/shared/command-palette-controller.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.type = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parent = null;
    this.textContent = '';
    this.value = '';
    this.focusCount = 0;
    this.scrollCalls = [];
    this.queryEnabled = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  closest(selector) {
    if (selector === '[data-command-index]' && this.dataset.commandIndex !== undefined) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }

  querySelector(selector) {
    if (!this.queryEnabled) return null;
    const match = selector.match(/data-command-index="(\d+)"/);
    return this.children.find((child) => child.dataset.commandIndex === match?.[1]) || null;
  }

  scrollIntoView(options) {
    this.scrollCalls.push(options);
  }

  focus() {
    this.focusCount += 1;
  }
}

class FakeDialog extends FakeElement {
  constructor() {
    super('dialog');
    this.open = false;
    this.showCount = 0;
    this.closeCount = 0;
  }

  showModal() {
    this.open = true;
    this.showCount += 1;
  }

  close() {
    this.open = false;
    this.closeCount += 1;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function createFixture(overrides = {}) {
  const dialog = new FakeDialog();
  const input = new FakeElement('input');
  const results = new FakeElement('div');
  const document = new FakeDocument();
  const selections = [];
  const focusQueue = [];
  const items = [
    { id: 'space:one', kind: 'space', title: 'One', icon: '1', meta: 'Switch Space' },
    { id: 'command:ask', kind: 'command', action: 'ask', title: 'Ask' },
  ];
  const controller = createCommandPaletteController({
    dialog,
    input,
    results,
    document,
    getData: () => ({ marker: 'current-data' }),
    itemBuilder: ({ query, marker }) => {
      assert.equal(marker, 'current-data');
      return query === 'missing' ? [] : items;
    },
    prepareSelection: (item) => ({ item, preparedDuringGesture: true }),
    onSelect: (prepared, item) => selections.push({ prepared, item }),
    scheduleFocus: (callback) => focusQueue.push(callback),
    ...overrides,
  });
  return { controller, dialog, input, results, selections, focusQueue, items };
}

function keyboardEvent(key, target) {
  return {
    key,
    target,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test('requires the four DOM dependencies needed to render the palette', () => {
  assert.throws(
    () => createCommandPaletteController(),
    /requires: dialog, input, results, document/,
  );
});

test('opens only when allowed, renders accessible options, and focuses after presentation', () => {
  let allowed = false;
  let beforeOpenCount = 0;
  const fixture = createFixture({
    canOpen: () => allowed,
    beforeOpen: () => { beforeOpenCount += 1; },
  });
  fixture.input.value = 'old query';

  assert.equal(fixture.controller.open(), false);
  assert.equal(fixture.input.value, 'old query');
  assert.equal(fixture.dialog.showCount, 0);
  assert.equal(beforeOpenCount, 0);

  allowed = true;
  assert.equal(fixture.controller.open(), true);
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.dialog.showCount, 1);
  assert.equal(beforeOpenCount, 1);
  assert.equal(fixture.results.children.length, 2);
  const [spaceButton, askButton] = fixture.results.children;
  assert.equal(spaceButton.type, 'button');
  assert.equal(spaceButton.className, 'command-palette-item');
  assert.equal(spaceButton.classList.contains('active'), true);
  assert.equal(spaceButton.dataset.commandId, 'space:one');
  assert.equal(spaceButton.dataset.commandKind, 'space');
  assert.equal(askButton.dataset.commandId, 'command:ask');
  assert.equal(askButton.dataset.commandKind, 'command');
  assert.deepEqual(spaceButton.attributes, { role: 'option', 'aria-selected': 'true' });
  assert.deepEqual(spaceButton.children.map((child) => child.textContent), ['1', 'One', 'Switch Space']);
  assert.deepEqual(askButton.children.map((child) => child.textContent), ['•', 'Ask', '']);

  fixture.focusQueue.shift()();
  assert.equal(fixture.input.focusCount, 1);
  assert.equal(fixture.controller.open(), true);
  assert.equal(fixture.dialog.showCount, 1);
  fixture.dialog.open = false;
  fixture.focusQueue.shift()();
  assert.equal(fixture.input.focusCount, 1);
});

test('render exposes empty semantic metadata for legacy candidates without stable fields', () => {
  const fixture = createFixture({
    itemBuilder: () => [{ title: 'Legacy candidate' }],
  });

  fixture.controller.open();

  assert.equal(fixture.results.children.length, 1);
  assert.equal(fixture.results.children[0].dataset.commandId, '');
  assert.equal(fixture.results.children[0].dataset.commandKind, '');
});

test('input and arrow keys render current data, wrap selection, and expose an honest empty state', () => {
  const fixture = createFixture();
  fixture.controller.open();

  const down = keyboardEvent('ArrowDown', fixture.input);
  assert.equal(fixture.controller.handleKeydown(down), true);
  assert.equal(down.prevented, true);
  assert.equal(fixture.controller.getState().selectedIndex, 1);
  assert.deepEqual(fixture.results.children[1].scrollCalls, [{ block: 'nearest' }]);

  const wrapDown = keyboardEvent('ArrowDown', fixture.input);
  fixture.controller.handleKeydown(wrapDown);
  assert.equal(fixture.controller.getState().selectedIndex, 0);

  fixture.results.queryEnabled = false;
  const wrapUp = keyboardEvent('ArrowUp', fixture.input);
  fixture.controller.handleKeydown(wrapUp);
  assert.equal(fixture.controller.getState().selectedIndex, 1);

  fixture.input.value = 'missing';
  assert.equal(fixture.controller.handleInput(), undefined);
  assert.deepEqual(fixture.controller.getState(), { items: [], selectedIndex: 0 });
  assert.equal(fixture.results.children.length, 1);
  assert.equal(fixture.results.children[0].className, 'empty');
  assert.equal(fixture.results.children[0].textContent, 'No matching Spaces, tabs, or commands.');

  const emptyDown = keyboardEvent('ArrowDown', fixture.input);
  assert.equal(fixture.controller.handleKeydown(emptyDown), true);
  assert.equal(emptyDown.prevented, true);
  const emptyEnter = keyboardEvent('Enter', fixture.input);
  assert.equal(fixture.controller.handleKeydown(emptyEnter), false);
  assert.equal(emptyEnter.prevented, true);
});

test('Enter executes only from the search input and closes before invoking the action callback', () => {
  const callbackDialogStates = [];
  const fixture = createFixture({
    onSelect: (prepared, item) => {
      callbackDialogStates.push(fixture.dialog.open);
      fixture.selections.push({ prepared, item });
    },
  });
  fixture.controller.open();

  const unrelated = keyboardEvent('Tab', fixture.input);
  assert.equal(fixture.controller.handleKeydown(unrelated), false);
  assert.equal(unrelated.prevented, false);
  const wrongTarget = keyboardEvent('Enter', fixture.results);
  assert.equal(fixture.controller.handleKeydown(wrongTarget), false);
  assert.equal(wrongTarget.prevented, false);

  const enter = keyboardEvent('Enter', fixture.input);
  assert.equal(fixture.controller.handleKeydown(enter), true);
  assert.equal(enter.prevented, true);
  assert.equal(fixture.dialog.closeCount, 1);
  assert.deepEqual(callbackDialogStates, [false]);
  assert.equal(fixture.selections[0].prepared.preparedDuringGesture, true);
  assert.equal(fixture.selections[0].item.id, 'space:one');

  fixture.controller.render();
  const closedEnter = keyboardEvent('Enter', fixture.input);
  assert.equal(fixture.controller.handleKeydown(closedEnter), true);
  assert.equal(fixture.dialog.closeCount, 1);
});

test('Escape always closes the palette explicitly instead of relying on native dialog defaults', () => {
  const fixture = createFixture();
  fixture.controller.open();

  const escape = keyboardEvent('Escape', fixture.input);
  assert.equal(fixture.controller.handleKeydown(escape), true);

  assert.equal(escape.prevented, true);
  assert.equal(fixture.dialog.open, false);
  assert.equal(fixture.dialog.closeCount, 1);
});

test('clicking nested option content selects that exact item and ignores the result background', () => {
  const fixture = createFixture();
  fixture.controller.open();
  const askTitle = fixture.results.children[1].children[1];

  assert.equal(fixture.controller.handleClick({ target: askTitle }), true);
  assert.equal(fixture.dialog.closeCount, 1);
  assert.equal(fixture.selections[0].item.id, 'command:ask');
  assert.equal(fixture.controller.getState().selectedIndex, 1);

  assert.equal(fixture.controller.handleClick({ target: fixture.results }), false);
  assert.equal(fixture.selections.length, 1);
});

test('close clears private selection state so reopening always starts from the first result', () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.controller.handleKeydown(keyboardEvent('ArrowUp', fixture.input));
  assert.equal(fixture.controller.getState().selectedIndex, 1);

  assert.equal(fixture.controller.handleClose(), undefined);
  assert.deepEqual(fixture.controller.getState(), { items: [], selectedIndex: 0 });
  fixture.dialog.open = false;
  fixture.controller.open();
  assert.equal(fixture.controller.getState().selectedIndex, 0);
});

test('sensible defaults build the pure command candidates and run without host callbacks', () => {
  const dialog = new FakeDialog();
  const input = new FakeElement('input');
  const results = new FakeElement('div');
  const controller = createCommandPaletteController({
    dialog,
    input,
    results,
    document: new FakeDocument(),
  });

  assert.equal(controller.open(), true);
  assert.equal(input.focusCount, 1);
  assert.equal(controller.getState().items.length, 4);
  assert.equal(controller.handleKeydown(keyboardEvent('Enter', input)), true);
  assert.equal(dialog.closeCount, 1);
});
