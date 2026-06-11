import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadContentScript(initial = {}) {
  const initialState = initial.shortcuts
    ? initial
    : { version: 4, shortcuts: initial };
  const listeners = new Map();
  const storageListeners = [];
  const messages = [];
  const windowListeners = new Map();
  const code = await readFile(new URL('../content-script.js', import.meta.url), 'utf8');
  const context = {
    window: {
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
      },
    },
    document: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      querySelectorAll() {
        return [];
      },
      title: '',
    },
    location: { href: 'https://example.com/' },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message) {
          messages.push(message);
          return Promise.resolve();
        },
        onMessage: {
          addListener(listener) {
            listeners.set('runtimeMessage', listener);
          },
        },
      },
      storage: {
        local: {
          get(_key, callback) {
            callback({ spaceTabsState: initialState });
          },
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
  };
  vm.runInNewContext(code, context);
  return { listeners, storageListeners, windowListeners, messages };
}

function keyEvent(overrides) {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefaultCalled: false,
    stopImmediatePropagationCalled: false,
    preventDefault() {
      this.preventDefaultCalled = true;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCalled = true;
    },
    ...overrides,
  };
}

test('content script forwards Space shortcuts when focus is on a web page', async () => {
  const { listeners, messages, windowListeners } = await loadContentScript();
  const event = keyEvent({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true });

  windowListeners.get('keydown')(event);
  listeners.get('keydown')(event);

  assert.deepEqual(asPlainMessages(messages), [{ type: 'shortcut:action', action: 'nextSpace' }]);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.stopImmediatePropagationCalled, true);
});

test('content script honors customized Space shortcuts', async () => {
  const { listeners, messages } = await loadContentScript({ nextSpace: 'Control+Alt+J' });

  listeners.get('keydown')(keyEvent({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true }));
  listeners.get('keydown')(keyEvent({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true }));

  assert.deepEqual(asPlainMessages(messages), [{ type: 'shortcut:action', action: 'nextSpace' }]);
});

test('content script migrates legacy Cmd+S toggle shortcut to Alt+S', async () => {
  const { listeners, messages } = await loadContentScript({
    version: 3,
    shortcuts: { togglePanel: 'Meta+S' },
  });

  listeners.get('keydown')(keyEvent({ key: 's', code: 'KeyS', metaKey: true }));
  listeners.get('keydown')(keyEvent({ key: 's', code: 'KeyS', altKey: true }));

  assert.deepEqual(asPlainMessages(messages), [{ type: 'panel:toggle' }]);
});

test('content script preserves current customized Cmd+S toggle shortcut', async () => {
  const { listeners, messages } = await loadContentScript({ togglePanel: 'Meta+S' });

  listeners.get('keydown')(keyEvent({ key: 's', code: 'KeyS', altKey: true }));
  assert.deepEqual(asPlainMessages(messages), []);

  listeners.get('keydown')(keyEvent({ key: 's', code: 'KeyS', metaKey: true }));

  assert.deepEqual(asPlainMessages(messages), [{ type: 'panel:toggle' }]);
});

test('content script does not steal plain web page typing shortcuts', async () => {
  const { listeners, messages } = await loadContentScript();
  const event = keyEvent({ key: '/', code: 'Slash' });

  listeners.get('keydown')(event);

  assert.deepEqual(messages, []);
  assert.equal(event.preventDefaultCalled, false);
});

function asPlainMessages(messages) {
  return JSON.parse(JSON.stringify(messages));
}
