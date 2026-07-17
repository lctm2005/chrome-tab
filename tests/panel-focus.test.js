import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDisclosureFocusGuard,
  createPanelFocusController,
} from '../src/shared/panel-focus.js';

function fakeScheduler({ throwAt = -1 } = {}) {
  let nextId = 0;
  let scheduleCount = 0;
  const timers = new Map();
  const delays = [];
  const cancelled = [];
  return {
    timers,
    delays,
    cancelled,
    schedule(callback, delay) {
      scheduleCount += 1;
      if (scheduleCount === throwAt) throw new Error('timer unavailable');
      const id = ++nextId;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    cancel(id) {
      cancelled.push(id);
      timers.delete(id);
    },
    run(id = timers.keys().next().value) {
      const callback = timers.get(id);
      assert.ok(callback, `expected timer ${id}`);
      timers.delete(id);
      callback();
    },
  };
}

function fixture(options = {}) {
  const scheduler = options.scheduler || fakeScheduler();
  const documentTarget = {
    visibilityState: 'visible',
    activeElement: null,
    focused: options.documentFocused ?? true,
    hasFocus() {
      if (options.throwHasFocus) throw new Error('document closed');
      return this.focused;
    },
  };
  const focusOptions = [];
  const target = {
    hidden: false,
    isConnected: true,
    focus(value) {
      focusOptions.push(value);
      if (options.throwTargetFocus) throw new Error('cannot focus yet');
      documentTarget.activeElement = this;
    },
  };
  const windowFocuses = [];
  const backgroundFocuses = [];
  let currentTarget = target;
  const controller = createPanelFocusController({
    documentTarget,
    windowTarget: {
      focus() {
        windowFocuses.push(true);
        if (options.throwWindowFocus) throw new Error('window unavailable');
      },
    },
    getTarget: () => currentTarget,
    requestBackgroundFocus() {
      backgroundFocuses.push(true);
      if (options.throwBackgroundFocus) throw new Error('worker asleep');
      if (options.rejectBackgroundFocus) return Promise.reject(new Error('worker asleep'));
      return null;
    },
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    delays: options.delays ?? [0, 80, 240],
  });
  return {
    controller,
    scheduler,
    documentTarget,
    target,
    focusOptions,
    windowFocuses,
    backgroundFocuses,
    setTarget(value) {
      currentTarget = value;
    },
  };
}

test('disclosure focus tokens are one-shot and invalidated by later user intent', () => {
  const guard = createDisclosureFocusGuard();
  const first = guard.capture();
  const focuses = [];

  assert.deepEqual(first, { generation: 0 });
  assert.equal(guard.invalidate(), 1);
  assert.equal(guard.restore(first, () => focuses.push('stale')), false);

  const second = guard.capture(true);
  assert.equal(guard.restore(second, () => focuses.push('restored')), true);
  assert.deepEqual(focuses, ['restored']);
  assert.equal(guard.restore(second, () => focuses.push('reused')), false);
  assert.equal(guard.generation(), 2);
});

test('disclosure focus guard rejects ineligible and invalid callbacks safely', () => {
  const guard = createDisclosureFocusGuard();

  assert.equal(guard.capture(false), null);
  assert.equal(guard.capture('yes'), null);
  assert.equal(guard.restore(null, () => {}), false);
  assert.equal(guard.restore(guard.capture(), null), false);

  const throwingToken = guard.capture();
  assert.equal(guard.restore(throwingToken, () => {
    throw new Error('detached control');
  }), false);
  assert.equal(guard.generation(), 1, 'a failed focus callback still consumes its token');
});

test('focuses once and cancels every later retry after the panel owns focus', () => {
  const view = fixture();

  assert.deepEqual(view.controller.request(), { scheduled: true, reason: 'pending' });
  assert.deepEqual(view.scheduler.delays, [0, 80, 240]);
  assert.equal(view.backgroundFocuses.length, 1);
  view.scheduler.run();

  assert.deepEqual(view.focusOptions, [{ preventScroll: true }]);
  assert.equal(view.windowFocuses.length, 1);
  assert.deepEqual(view.controller.status(), {
    active: false,
    pendingAttempts: 0,
    reason: 'focused',
  });
  assert.deepEqual(view.scheduler.cancelled, [2, 3]);
});

test('keeps retrying while Chrome has not given the document focus, then stops on success', () => {
  const view = fixture({ documentFocused: false });

  view.controller.request();
  view.scheduler.run();
  assert.deepEqual(view.controller.status(), {
    active: true,
    pendingAttempts: 2,
    reason: 'pending',
  });
  view.documentTarget.focused = true;
  view.scheduler.run();

  assert.equal(view.focusOptions.length, 2);
  assert.deepEqual(view.controller.status(), {
    active: false,
    pendingAttempts: 0,
    reason: 'focused',
  });
});

test('user focus, pointer or keyboard intent cancels pending focus theft', () => {
  for (const cancelByUser of [
    (view) => view.controller.handleFocusIn({ target: {} }),
    (view) => view.controller.handleUserIntent({ type: 'pointerdown' }),
    (view) => view.controller.handleUserIntent({ type: 'keydown' }),
  ]) {
    const view = fixture({ documentFocused: false });
    view.controller.request();
    cancelByUser(view);
    assert.equal(view.scheduler.timers.size, 0);
    assert.equal(view.controller.status().active, false);
  }

  const targetFocus = fixture({ documentFocused: false });
  targetFocus.controller.request();
  targetFocus.controller.handleFocusIn({ target: targetFocus.target });
  assert.equal(targetFocus.controller.status().active, true, 'its own focus event is not user diversion');
});

test('hidden pages and blurred windows cancel retries immediately', () => {
  const hidden = fixture({ documentFocused: false });
  hidden.controller.request();
  hidden.documentTarget.visibilityState = 'hidden';
  hidden.controller.handleVisibilityChange();
  assert.equal(hidden.controller.status().reason, 'page-hidden');
  assert.equal(hidden.scheduler.timers.size, 0);

  const visible = fixture({ documentFocused: false });
  visible.controller.request();
  visible.controller.handleVisibilityChange();
  assert.equal(visible.controller.status().active, true);
  visible.controller.handleWindowBlur();
  assert.equal(visible.controller.status().reason, 'window-blurred');
});

test('a synchronous focus diversion during window restoration cancels the same attempt', () => {
  const scheduler = fakeScheduler();
  const documentTarget = {
    visibilityState: 'visible',
    activeElement: null,
    hasFocus: () => false,
  };
  let targetFocuses = 0;
  const target = {
    focus() {
      targetFocuses += 1;
    },
  };
  let controller;
  controller = createPanelFocusController({
    documentTarget,
    windowTarget: {
      focus() {
        controller.handleFocusIn({ target: { id: 'other-control' } });
      },
    },
    getTarget: () => target,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    delays: [0],
  });

  controller.request();
  scheduler.run();

  assert.equal(targetFocuses, 0);
  assert.deepEqual(controller.status(), {
    active: false,
    pendingAttempts: 0,
    reason: 'focus-moved',
  });
});

test('a newer request replaces older timers and only the new target may be focused', () => {
  const view = fixture({ documentFocused: false, delays: [0, 10] });
  const firstTarget = view.target;
  const secondFocuses = [];
  const secondTarget = {
    hidden: false,
    isConnected: true,
    focus(value) {
      secondFocuses.push(value);
      view.documentTarget.activeElement = this;
    },
  };

  view.controller.request();
  const obsoleteIds = [...view.scheduler.timers.keys()];
  view.setTarget(secondTarget);
  view.controller.request();
  assert.ok(obsoleteIds.every((id) => view.scheduler.cancelled.includes(id)));
  view.documentTarget.focused = true;
  view.scheduler.run();

  assert.equal(view.focusOptions.length, 0);
  assert.deepEqual(secondFocuses, [{ preventScroll: true }]);
  assert.equal(view.controller.status().reason, 'focused');
  assert.notEqual(firstTarget, secondTarget);
});

test('view changes, hidden targets and detached targets abort before stealing focus', () => {
  for (const replacement of [
    { hidden: false, isConnected: true, focus() {} },
    { hidden: true, isConnected: true, focus() {} },
    { hidden: false, isConnected: false, focus() {} },
  ]) {
    const view = fixture({ documentFocused: false });
    view.controller.request();
    if (replacement.hidden || replacement.isConnected === false) {
      Object.assign(view.target, replacement);
    } else {
      view.setTarget(replacement);
    }
    view.scheduler.run();
    assert.equal(view.controller.status().reason, 'target-changed');
    assert.equal(view.focusOptions.length, 0);
  }
});

test('unavailable targets and total scheduler failure do not send a misleading retry', () => {
  for (const target of [null, {}, { hidden: true, focus() {} }, { isConnected: false, focus() {} }]) {
    const view = fixture();
    view.setTarget(target);
    assert.deepEqual(view.controller.request(), {
      scheduled: false,
      reason: 'target-unavailable',
    });
    assert.equal(view.backgroundFocuses.length, 0);
  }

  const scheduler = fakeScheduler({ throwAt: 1 });
  const failed = fixture({ scheduler, delays: [0] });
  assert.deepEqual(failed.controller.request(), {
    scheduled: false,
    reason: 'schedule-failed',
  });
});

test('partial timer failure, focus exceptions and an exhausted retry remain safe', async () => {
  const scheduler = fakeScheduler({ throwAt: 2 });
  const view = fixture({
    scheduler,
    documentFocused: false,
    throwBackgroundFocus: true,
    throwWindowFocus: true,
    throwTargetFocus: true,
  });

  assert.equal(view.controller.request().scheduled, true);
  assert.deepEqual(view.scheduler.delays, [0, 240]);
  view.scheduler.run();
  assert.equal(view.controller.status().active, true);
  view.scheduler.run();
  assert.deepEqual(view.controller.status(), {
    active: false,
    pendingAttempts: 0,
    reason: 'exhausted',
  });
  assert.equal(view.windowFocuses.length, 2);
  assert.equal(view.focusOptions.length, 2);

  const rejected = fixture({ rejectBackgroundFocus: true, delays: [0] });
  assert.doesNotThrow(() => rejected.controller.request());
  await Promise.resolve();
});

test('hasFocus failures keep retrying and the default focus test tolerates missing APIs', () => {
  const throwing = fixture({ throwHasFocus: true, delays: [0] });
  throwing.controller.request();
  throwing.scheduler.run();
  assert.equal(throwing.controller.status().reason, 'exhausted');

  const scheduler = fakeScheduler();
  const target = {
    focus() {
      documentTarget.activeElement = target;
    },
  };
  const documentTarget = { visibilityState: 'visible', activeElement: null };
  const controller = createPanelFocusController({
    documentTarget,
    getTarget: () => target,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    delays: [Number.NaN, -1, 'bad'],
  });
  controller.request();
  assert.deepEqual(scheduler.delays, [0]);
  scheduler.run();
  assert.equal(controller.status().reason, 'focused');
});

test('cancel and dispose are idempotent even when timer cleanup throws', () => {
  const scheduler = fakeScheduler();
  const view = fixture({ scheduler, documentFocused: false });
  const throwingCancel = createPanelFocusController({
    getTarget: () => view.target,
    schedule: scheduler.schedule,
    cancelSchedule() {
      throw new Error('page closed');
    },
    delays: [0],
  });

  assert.equal(throwingCancel.cancel(), false);
  throwingCancel.request();
  assert.equal(throwingCancel.dispose(), true);
  assert.equal(throwingCancel.dispose(), false);
  assert.equal(throwingCancel.status().reason, 'disposed');
});

test('default dependencies schedule and clear the standard retries safely', () => {
  const unavailable = createPanelFocusController();
  assert.deepEqual(unavailable.request(), {
    scheduled: false,
    reason: 'target-unavailable',
  });

  const documentTarget = { visibilityState: 'visible', activeElement: null };
  const target = { focus() {} };
  const controller = createPanelFocusController({
    documentTarget,
    getTarget: () => target,
  });
  assert.equal(controller.request().scheduled, true);
  assert.equal(controller.status().pendingAttempts, 6);
  assert.equal(controller.cancel('test-cleanup'), true);
  assert.deepEqual(controller.status(), {
    active: false,
    pendingAttempts: 0,
    reason: 'test-cleanup',
  });
});

test('obsolete callbacks and an active-element mismatch cannot focus or report success', () => {
  let obsoleteCallback;
  const target = { focus() { throw new Error('obsolete callback ran'); } };
  const controller = createPanelFocusController({
    getTarget: () => target,
    schedule(callback) {
      obsoleteCallback = callback;
      return 1;
    },
    cancelSchedule() {},
    delays: [0],
  });
  controller.request();
  controller.cancel();
  assert.equal(obsoleteCallback(), undefined);

  const scheduler = fakeScheduler();
  const documentTarget = {
    visibilityState: 'visible',
    activeElement: {},
    hasFocus: () => true,
  };
  let focusCalls = 0;
  const unfocusedTarget = { focus() { focusCalls += 1; } };
  const mismatch = createPanelFocusController({
    documentTarget,
    getTarget: () => unfocusedTarget,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    delays: [0],
  });
  mismatch.request();
  scheduler.run();
  assert.equal(focusCalls, 1);
  assert.equal(mismatch.status().reason, 'exhausted');
});
