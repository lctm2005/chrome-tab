export const CHROME_GROUP_TITLE_MAX_LENGTH = 32;

const HASH_SEPARATOR = '~';
const HASH_LENGTH = 8;
const PREFIX_LENGTH = CHROME_GROUP_TITLE_MAX_LENGTH - HASH_SEPARATOR.length - HASH_LENGTH;

export function normalizeGroupTitle(title, fallback = 'Tabs') {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return String(fallback || 'Tabs').replace(/\s+/g, ' ').trim() || 'Tabs';
}

export function groupTitleKey(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Converts an unrestricted logical title into the title persisted by Chrome.
 * Long titles keep a readable prefix and gain a stable suffix so two titles
 * that only differ after Chrome's limit do not become the same group.
 */
export function chromeGroupTitle(title, fallback = 'Tabs') {
  const logicalTitle = wellFormedGroupTitle(normalizeGroupTitle(title, fallback));
  if (logicalTitle.length <= CHROME_GROUP_TITLE_MAX_LENGTH) return logicalTitle;
  const prefix = safeUtf16Prefix(logicalTitle, PREFIX_LENGTH);
  return `${prefix}${HASH_SEPARATOR}${fnv1a32(groupTitleKey(logicalTitle))}`;
}

export function chromeGroupTitleKey(title, fallback = '') {
  if (!groupTitleKey(title) && !groupTitleKey(fallback)) return '';
  return groupTitleKey(chromeGroupTitle(title, fallback || 'Tabs'));
}

export function legacyChromeGroupTitleKey(title) {
  if (!groupTitleKey(title)) return '';
  return groupTitleKey(
    normalizeGroupTitle(title).slice(0, CHROME_GROUP_TITLE_MAX_LENGTH),
  );
}

/**
 * Matches a logical saved title to a Chrome group without relying on a shared
 * 32-character prefix. A group created by the old truncation strategy is only
 * returned when the prefix is unambiguous among the supplied logical titles;
 * callers can then rename it to expectedTitle as a one-time migration.
 */
export function resolveChromeGroupTitleMatch(
  chromeGroups = [],
  logicalTitle = '',
  logicalTitles = [],
) {
  if (!groupTitleKey(logicalTitle)) return null;
  const normalizedTitle = normalizeGroupTitle(logicalTitle);
  const expectedTitle = chromeGroupTitle(normalizedTitle);
  const expectedKey = groupTitleKey(expectedTitle);
  const knownTitles = [normalizedTitle, ...(logicalTitles || [])]
    .map((title) => normalizeGroupTitle(title));
  const canonicalOwners = new Set(
    knownTitles
      .filter((title) => chromeGroupTitleKey(title) === expectedKey)
      .map(groupTitleKey),
  );
  if (canonicalOwners.size > 1) return null;
  const canonicalMatches = (chromeGroups || []).filter((group) => (
    groupTitleKey(group?.title) === expectedKey
  ));
  if (canonicalMatches.length > 0) {
    return { group: canonicalMatches[0], expectedTitle, needsRename: false };
  }

  if (normalizedTitle.length <= CHROME_GROUP_TITLE_MAX_LENGTH) return null;
  const legacyKey = legacyChromeGroupTitleKey(normalizedTitle);
  const competingTitles = new Set(
    knownTitles
      .filter((title) => (
        chromeGroupTitleKey(title) === legacyKey ||
        (
          title.length > CHROME_GROUP_TITLE_MAX_LENGTH &&
          legacyChromeGroupTitleKey(title) === legacyKey
        )
      ))
      .map(groupTitleKey),
  );
  if (competingTitles.size !== 1) return null;

  const legacyMatches = (chromeGroups || []).filter((group) => (
    groupTitleKey(group?.title) === legacyKey
  ));
  if (legacyMatches.length !== 1) return null;
  return { group: legacyMatches[0], expectedTitle, needsRename: true };
}

function safeUtf16Prefix(value, maxLength) {
  let result = '';
  for (const character of String(value)) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result;
}

function wellFormedGroupTitle(value) {
  return String(value).replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  );
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(HASH_LENGTH, '0');
}
