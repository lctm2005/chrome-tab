document.addEventListener('keydown', (event) => {
  if (!isToggleShortcut(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  chrome.runtime.sendMessage({ type: 'panel:toggle' }).catch(() => null);
}, true);

function isToggleShortcut(event) {
  return (
    event.key?.toLowerCase() === 's' &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}
