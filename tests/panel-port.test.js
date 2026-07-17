import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPanelPortController,
  panelPortReconnectDelay,
} from '../src/shared/panel-port.js';

function eventChannel() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    emit(value) {
      for (const listener of [...listeners]) listener(value);
    },
  };
}

function eventSurface(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener({ type });
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

function fakeWindow() {
  const surface = eventSurface();
  let nextTimerId = 0;
  const timers = new Map();
  const delays = [];
  const cleared = [];
  return {
    ...surface,
    delays,
    cleared,
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    },
    runNextTimer() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'expected a reconnect timer');
      const [id, callback] = entry;
      timers.delete(id);
      callback();
    },
  };
}

function fakePort({ throwOnPost = false } = {}) {
  const onMessage = eventChannel();
  const onDisconnect = eventChannel();
  const posted = [];
  return {
    onMessage,
    onDisconnect,
    posted,
    postMessage(message) {
      if (throwOnPost) throw new Error('The message port closed.');
      posted.push(message);
    },
  };
}

test('panel reconnect delay uses bounded exponential backoff', () => {
  assert.equal(panelPortReconnectDelay(undefined), 250);
  assert.equal(panelPortReconnectDelay(0), 250);
  assert.equal(panelPortReconnectDelay(1), 500);
  assert.equal(panelPortReconnectDelay(8), 4000);
  assert.equal(panelPortReconnectDelay(2.5), 250);
  assert.equal(panelPortReconnectDelay(3, { baseDelay: 10, maxDelay: 35 }), 35);
  assert.equal(panelPortReconnectDelay(2, { baseDelay: -4, maxDelay: -10 }), 0);
});

test('panel Port reports visibility, routes shortcuts and close, and binds lifecycle listeners once', () => {
  const documentTarget = eventSurface({ visibilityState: 'visible' });
  const windowTarget = fakeWindow();
  const port = fakePort();
  const connectCalls = [];
  const shortcuts = [];
  let closed = 0;
  const controller = createPanelPortController({
    runtime: {
      connect(options) {
        connectCalls.push(options);
        return port;
      },
    },
    documentTarget,
    windowTarget,
    getWindowId: () => 42,
    onClose: () => { closed += 1; },
    onShortcut: (action) => shortcuts.push(action),
  });

  assert.equal(controller.connect(), port);
  assert.equal(controller.connect(), port, 'a visible panel keeps one Port');
  assert.deepEqual(connectCalls, [{ name: 'sidepanel' }]);
  assert.deepEqual(port.posted, [{ type: 'panel:visibility', visible: true, windowId: 42 }]);
  assert.deepEqual(controller.status(), {
    connected: true,
    reconnectAttempt: 0,
    reconnectScheduled: false,
    visibilityEventsBound: true,
  });
  for (const type of ['visibilitychange', 'focus', 'pageshow', 'pagehide']) {
    const target = type === 'visibilitychange' ? documentTarget : windowTarget;
    assert.equal(target.listenerCount(type), 1, `${type} is bound once`);
  }

  port.onMessage.emit({ type: 'shortcut:action', action: 'nextSpace' });
  port.onMessage.emit({ type: 'ignored' });
  port.onMessage.emit(null);
  assert.deepEqual(shortcuts, ['nextSpace']);

  documentTarget.visibilityState = 'hidden';
  documentTarget.emit('visibilitychange');
  windowTarget.emit('pagehide');
  documentTarget.visibilityState = 'visible';
  documentTarget.emit('visibilitychange');
  windowTarget.emit('focus');
  windowTarget.emit('pageshow');
  controller.notifyVisibility(0);
  assert.deepEqual(port.posted.slice(1).map((entry) => entry.visible), [false, false, true, true, true, false]);

  port.onMessage.emit({ type: 'panel:close' });
  assert.equal(closed, 1);
  assert.deepEqual(port.posted.at(-1), { type: 'panel:visibility', visible: false, windowId: 42 });

  controller.dispose();
  assert.deepEqual(controller.status(), {
    connected: false,
    reconnectAttempt: 0,
    reconnectScheduled: false,
    visibilityEventsBound: false,
  });
  documentTarget.emit('visibilitychange');
  windowTarget.emit('focus');
  assert.equal(connectCalls.length, 1, 'disposed listeners cannot reconnect a dead page');
});

test('disconnect retries only while visible, backs off through transient failures, and ignores stale ports', () => {
  const documentTarget = eventSurface({ visibilityState: 'visible' });
  const windowTarget = fakeWindow();
  const first = fakePort();
  const second = fakePort();
  const recovered = fakePort();
  const outcomes = [
    first,
    second,
    new Error('worker starting'),
    new Error('worker starting'),
    { onMessage: eventChannel() },
    { onMessage: eventChannel(), onDisconnect: {} },
    new Error('worker starting'),
    recovered,
  ];
  let calls = 0;
  const controller = createPanelPortController({
    runtime: {
      connect() {
        calls += 1;
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
    documentTarget,
    windowTarget,
  });

  assert.equal(controller.connect(), first);
  first.onDisconnect.emit();
  assert.equal(controller.scheduleReconnect(), false, 'duplicate reconnect timers are rejected');
  assert.deepEqual(windowTarget.delays, [250]);
  documentTarget.visibilityState = 'hidden';
  windowTarget.runNextTimer();
  assert.equal(calls, 1, 'a timer that fires after the panel hides does not reconnect');
  assert.equal(controller.status().reconnectScheduled, false);

  documentTarget.visibilityState = 'visible';
  documentTarget.emit('visibilitychange');
  assert.equal(controller.status().connected, true);
  assert.equal(calls, 2);
  first.onDisconnect.emit();
  assert.equal(controller.status().connected, true, 'an obsolete Port cannot disconnect its replacement');

  second.onDisconnect.emit();
  assert.deepEqual(windowTarget.delays, [250, 250]);
  while (!controller.status().connected) windowTarget.runNextTimer();
  assert.deepEqual(windowTarget.delays, [250, 250, 500, 1000, 2000, 4000, 4000]);
  assert.equal(calls, 8);
  assert.equal(controller.status().reconnectAttempt, 0);
  assert.deepEqual(recovered.posted, [{ type: 'panel:visibility', visible: true, windowId: null }]);

  recovered.onDisconnect.emit();
  assert.equal(controller.status().reconnectScheduled, true);
  controller.dispose();
  assert.equal(controller.status().reconnectScheduled, false);
  assert.equal(windowTarget.cleared.length, 1);
});

test('disabled and unavailable controllers are safe, including closed Port races and missing DOM APIs', () => {
  const disabled = createPanelPortController({ enabled: false });
  assert.equal(disabled.connect(), null);
  assert.equal(disabled.scheduleReconnect(), false);
  disabled.notifyVisibility(true);
  disabled.dispose();

  const unavailable = createPanelPortController();
  assert.equal(unavailable.connect(), null);
  assert.equal(unavailable.scheduleReconnect(), false);
  unavailable.notifyVisibility(false);
  unavailable.dispose();

  const documentTarget = eventSurface({ visibilityState: 'hidden' });
  const noTimerController = createPanelPortController({
    runtime: { connect() { throw new Error('unavailable'); } },
    documentTarget,
    windowTarget: eventSurface(),
  });
  assert.equal(noTimerController.connect(), null);
  assert.equal(noTimerController.scheduleReconnect(), false);
  documentTarget.visibilityState = 'visible';
  documentTarget.emit('visibilitychange');
  assert.equal(noTimerController.scheduleReconnect(), false);
  noTimerController.dispose();

  const throwingPort = fakePort({ throwOnPost: true });
  const defaults = createPanelPortController({
    runtime: { connect: () => throwingPort },
    documentTarget: eventSurface({ visibilityState: 'visible' }),
    windowTarget: fakeWindow(),
  });
  assert.doesNotThrow(() => defaults.connect());
  assert.doesNotThrow(() => defaults.notifyVisibility(true));
  assert.doesNotThrow(() => throwingPort.onMessage.emit({ type: 'shortcut:action', action: 'askPage' }));
  assert.doesNotThrow(() => throwingPort.onMessage.emit({ type: 'panel:close' }));
  defaults.dispose();
});

test('dispose tolerates a scheduled retry when clearTimeout is unavailable', () => {
  const documentTarget = eventSurface({ visibilityState: 'visible' });
  const windowTarget = eventSurface({
    setTimeout() {
      return 9;
    },
  });
  const controller = createPanelPortController({
    runtime: { connect() { throw new Error('worker stopped'); } },
    documentTarget,
    windowTarget,
  });
  assert.equal(controller.connect(), null);
  assert.equal(controller.status().reconnectScheduled, true);
  controller.dispose();
  assert.equal(controller.status().reconnectScheduled, false);
});
