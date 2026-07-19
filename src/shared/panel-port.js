export function panelPortReconnectDelay(attempt, options = {}) {
  const baseDelay = Number.isFinite(options.baseDelay) ? Math.max(0, options.baseDelay) : 250;
  const maxDelay = Number.isFinite(options.maxDelay) ? Math.max(baseDelay, options.maxDelay) : 4000;
  const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(baseDelay * (2 ** safeAttempt), maxDelay);
}

export function createPanelPortController(options = {}) {
  const runtime = options.runtime || null;
  const documentTarget = options.documentTarget || null;
  const windowTarget = options.windowTarget || null;
  const enabled = options.enabled !== false;
  const getWindowId = typeof options.getWindowId === 'function'
    ? options.getWindowId
    : () => null;
  const onClose = typeof options.onClose === 'function' ? options.onClose : () => {};
  const onShortcut = typeof options.onShortcut === 'function' ? options.onShortcut : () => {};

  let port = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let visibilityEventsBound = false;
  const eventBindings = [];

  function notifyVisibility(visible) {
    try {
      port?.postMessage({
        type: 'panel:visibility',
        visible: Boolean(visible),
        windowId: getWindowId(),
      });
    } catch {
      // Chrome can disconnect a side-panel Port between a visibility event and postMessage.
    }
  }

  function bindEvent(target, type, listener) {
    target?.addEventListener?.(type, listener);
    eventBindings.push([target, type, listener]);
  }

  function bindVisibilityEvents() {
    if (visibilityEventsBound || !enabled) return;
    visibilityEventsBound = true;
    bindEvent(documentTarget, 'visibilitychange', () => {
      const visible = documentTarget?.visibilityState !== 'hidden';
      if (visible) connect();
      notifyVisibility(visible);
    });
    bindEvent(windowTarget, 'focus', () => {
      connect();
      notifyVisibility(true);
    });
    bindEvent(windowTarget, 'pageshow', () => {
      connect();
      notifyVisibility(true);
    });
    bindEvent(windowTarget, 'pagehide', () => notifyVisibility(false));
  }

  function scheduleReconnect() {
    if (
      !enabled || port || reconnectTimer !== null ||
      documentTarget?.visibilityState === 'hidden' ||
      typeof windowTarget?.setTimeout !== 'function'
    ) return false;
    const delay = panelPortReconnectDelay(reconnectAttempt, options);
    reconnectAttempt += 1;
    reconnectTimer = windowTarget.setTimeout(() => {
      reconnectTimer = null;
      if (documentTarget?.visibilityState === 'hidden') return;
      connect();
      if (!port) scheduleReconnect();
    }, delay);
    return true;
  }

  function connect() {
    if (!enabled) return null;
    bindVisibilityEvents();
    if (
      port || documentTarget?.visibilityState === 'hidden' ||
      typeof runtime?.connect !== 'function'
    ) return port;

    let nextPort;
    try {
      nextPort = runtime.connect({ name: 'sidepanel' });
    } catch {
      scheduleReconnect();
      return null;
    }
    if (!nextPort?.onMessage?.addListener || !nextPort?.onDisconnect?.addListener) {
      scheduleReconnect();
      return null;
    }

    port = nextPort;
    reconnectAttempt = 0;
    nextPort.onMessage.addListener((message) => {
      if (message?.type === 'panel:close') {
        notifyVisibility(false);
        onClose();
      }
      if (message?.type === 'shortcut:action') onShortcut(message.action);
    });
    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) return;
      port = null;
      scheduleReconnect();
    });
    notifyVisibility(true);
    return port;
  }

  function dispose() {
    if (reconnectTimer !== null && typeof windowTarget?.clearTimeout === 'function') {
      windowTarget.clearTimeout(reconnectTimer);
    }
    reconnectTimer = null;
    for (const [target, type, listener] of eventBindings.splice(0)) {
      target?.removeEventListener?.(type, listener);
    }
    visibilityEventsBound = false;
    port = null;
  }

  return {
    connect,
    dispose,
    notifyVisibility,
    scheduleReconnect,
    status() {
      return {
        connected: Boolean(port),
        reconnectAttempt,
        reconnectScheduled: reconnectTimer !== null,
        visibilityEventsBound,
      };
    },
  };
}
