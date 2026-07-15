import { isPageShortcutCapableUrl } from './tab-utils.js';

export function appendAskSourceLink(answer, page = {}) {
  let text = String(answer || '').trim();
  if (!isPageShortcutCapableUrl(page?.url)) return text;

  const title = String(page.title || page.url || 'Source')
    .replace(/[\[\]]/g, '')
    .trim();
  const url = String(page.url || '').replace(/\)/g, '%29');
  text = linkInlineCitation(text, 1, url);
  return `${text}\n\n### Sources\n- [[1] ${title}](${url})`.trim();
}

function linkInlineCitation(text, number, url) {
  const marker = `[${number}]`;
  const link = `[[${number}]](${url})`;
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor);
    if (index < 0) return output + text.slice(cursor);
    const alreadyLinked = index > 0 && text[index - 1] === '[';
    output += text.slice(cursor, index) + (alreadyLinked ? marker : link);
    cursor = index + marker.length;
  }
  return output;
}
