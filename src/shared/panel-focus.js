const DEFAULT_FOCUS_DELAYS = [0, 80, 240, 600, 1200, 1800];

/**
 * Issues one-shot focus restoration tokens for controls replaced by an async
 * render. Any later user intent invalidates every older token, so completion
 * cannot pull focus away from the user's newer destination.
 */
export function createDisclosureFocusGuard() {
  let generation = 0;

  function invalidate() {
    generation += 1;
    return generation;
  }

  function capture(eligible = true) {
    return eligible === true ? { generation } : null;
  }

  function restore(token, focus) {
    if (!token || token.generation !== generation || typeof focus !== 'function') return false;
    // Consume before invoking focus: a synchronous focusin event may invalidate
    // again, and a second completion path must never reuse this token.
    generation += 1;
    try {
      focus();
      return true;
    } catch {
      return false;
    }
  }

  return {
    capture,
    invalidate,
    restore,
    generation: () => generation,
  };
}

/**
 * Briefly retries focus while a newly-opened panel is becoming interactive.
 * Any later user intent cancels the retries so the panel cannot steal focus
 * back after the user has already moved elsewhere.
 */
export function createPanelFocusController(options = {}) {
  const windowTarget = options.windowTarget || null;
  const documentTarget = options.documentTarget || null;
  const getTarget = typeof options.getTarget === 'function'
    ? options.getTarget
    : () => null;
  const requestBackgroundFocus = typeof options.requestBackgroundFocus === 'function'
    ? options.requestBackgroundFocus
    : () => null;
  const schedule = typeof options.schedule === 'function'
    ? options.schedule
    : (callback, delay) => globalThis.setTimeout(callback, delay);
  const cancelSchedule = typeof options.cancelSchedule === 'function'
    ? options.cancelSchedule
    : (timerId) => globalThis.clearTimeout(timerId);
  const delays = normalizeFocusDelays(options.delays);

  let generation = 0;
  let requestedTarget = null;
  let active = false;
  let lastReason = 'idle';
  const pendingTimers = new Set();

  function clearPendingTimers() {
    for (const timerId of pendingTimers) {
      try {
        cancelSchedule(timerId);
      } catch {
        // A page can disappear between a lifecycle event and timer cleanup.
      }
    }
    pendingTimers.clear();
  }

  function cancel(reason = 'cancelled') {
    const wasActive = active || pendingTimers.size > 0;
    generation += 1;
    active = false;
    requestedTarget = null;
    lastReason = reason;
    clearPendingTimers();
    return wasActive;
  }

  function request() {
    cancel('replaced');
    const target = getTarget();
    if (!isFocusableTarget(target)) {
      lastReason = 'target-unavailable';
      return { scheduled: false, reason: lastReason };
    }

    requestedTarget = target;
    active = true;
    lastReason = 'pending';
    const requestGeneration = generation;

    try {
      Promise.resolve(requestBackgroundFocus()).catch(() => null);
    } catch {
      // Local focus retries can still work if the background worker is asleep.
    }

    for (const delay of delays) {
      const entry = { timerId: null };
      try {
        entry.timerId = schedule(() => {
          if (entry.timerId !== null) pendingTimers.delete(entry.timerId);
          attemptFocus(requestGeneration, target);
        }, delay);
        pendingTimers.add(entry.timerId);
      } catch {
        // Keep any successfully scheduled attempts when one scheduler call fails.
      }
    }

    if (pendingTimers.size === 0) {
      active = false;
      requestedTarget = null;
      lastReason = 'schedule-failed';
      return { scheduled: false, reason: lastReason };
    }
    return { scheduled: true, reason: lastReason };
  }

  function attemptFocus(requestGeneration, target) {
    if (!active || requestGeneration !== generation || requestedTarget !== target) return false;
    if (
      documentTarget?.visibilityState === 'hidden' ||
      getTarget() !== target ||
      !isFocusableTarget(target)
    ) {
      cancel('target-changed');
      return false;
    }

    try {
      windowTarget?.focus?.();
    } catch {
      // The target focus below can still succeed in an already-focused panel.
    }
    // window.focus() can synchronously restore focus to a different control.
    // Its focusin listener cancels this request; honor that cancellation before
    // this same callback can move focus again.
    if (!active || requestGeneration !== generation || requestedTarget !== target) return false;
    try {
      target.focus({ preventScroll: true });
    } catch {
      return finishIfExhausted();
    }

    if (documentOwnsTargetFocus(documentTarget, target)) {
      cancel('focused');
      return true;
    }
    return finishIfExhausted();
  }

  function finishIfExhausted() {
    if (pendingTimers.size > 0) return false;
    active = false;
    requestedTarget = null;
    lastReason = 'exhausted';
    return false;
  }

  function handleFocusIn(event) {
    if (active && event?.target !== requestedTarget) cancel('focus-moved');
  }

  function handleUserIntent() {
    if (active) cancel('user-intent');
  }

  function handleVisibilityChange() {
    if (active && documentTarget?.visibilityState === 'hidden') cancel('page-hidden');
  }

  function handleWindowBlur() {
    if (active) cancel('window-blurred');
  }

  function status() {
    return {
      active,
      pendingAttempts: pendingTimers.size,
      reason: lastReason,
    };
  }

  return {
    request,
    cancel,
    dispose: () => cancel('disposed'),
    handleFocusIn,
    handleUserIntent,
    handleVisibilityChange,
    handleWindowBlur,
    status,
  };
}

function normalizeFocusDelays(values) {
  const source = Array.isArray(values) ? values : DEFAULT_FOCUS_DELAYS;
  const normalized = [...new Set(source
    .map(Number)
    .filter((delay) => Number.isFinite(delay) && delay >= 0))]
    .sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : [0];
}

function isFocusableTarget(target) {
  return Boolean(
    target &&
    target.hidden !== true &&
    target.isConnected !== false &&
    typeof target.focus === 'function'
  );
}

function documentOwnsTargetFocus(documentTarget, target) {
  if (documentTarget?.activeElement !== target) return false;
  if (typeof documentTarget?.hasFocus !== 'function') return true;
  try {
    return documentTarget.hasFocus() === true;
  } catch {
    return false;
  }
}
