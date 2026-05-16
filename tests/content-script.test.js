import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadContentScript(initialShortcuts = {}) {
  const listeners = new Map();
  const storageListeners = [];
  const messages = [];
  const code = await readFile(new URL('../content-script.js', import.meta.url), 'utf8');
  const context = {
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
            callback({ spaceTabsState: { shortcuts: initialShortcuts } });
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
  return { listeners, storageListeners, messages };
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
  const { listeners, messages } = await loadContentScript();
  const event = keyEvent({ key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, altKey: true });

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
