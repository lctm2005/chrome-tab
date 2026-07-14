const TIDY_TARGET_FINGERPRINT_VERSION = 1;

/**
 * Identifies the exact live rows a Tidy Names preview was based on.
 *
 * Chrome tab ids alone are not sufficient: a tab can navigate, finish loading
 * with a different title, or receive a manual panel name while the preview is
 * open. Sorting by id makes the fingerprint independent from incidental view
 * ordering while retaining the user-visible inputs that shaped the proposal.
 */
export function fingerprintTidyNameTargets(tabs = [], renamedTabs = {}) {
  const targets = (Array.isArray(tabs) ? tabs : [])
    .map((tab) => {
      const id = Number(tab?.id);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      return {
        id,
        url: String(tab?.url || ''),
        title: cleanText(tab?.title),
        currentName: cleanText(Object.hasOwn(renamedTabs || {}, id)
          ? renamedTabs[id]
          : tab?.panelTitle),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id - right.id);

  const hash = fnv1a(JSON.stringify(targets));
  return `tidy-target-v${TIDY_TARGET_FINGERPRINT_VERSION}-${hash}-${targets.length}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
