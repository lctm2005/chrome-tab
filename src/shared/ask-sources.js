import { isPageShortcutCapableUrl } from './tab-utils.js';

export function appendAskSourceLink(answer, page = {}) {
  let text = String(answer || '').trim();
  if (!isPageShortcutCapableUrl(page?.url)) return text;

  const sanitizedTitle = String(page.title || page.url)
    .replace(/[\[\]]/g, '')
    .trim();
  const title = sanitizedTitle || String(page.url);
  const url = String(page.url).replace(/\(/g, '%28').replace(/\)/g, '%29');
  text = linkInlineCitation(text, 1, url);
  return `${text}\n\n### Sources\n- [[1] ${title}](${url})`.trim();
}

export function askHistoryMessageText(message = {}) {
  const text = String(message?.text ?? '');
  if (message?.role !== 'assistant') return text;
  return restoreGeneratedInlineCitations(removeGeneratedSourcesAppendix(text));
}

function removeGeneratedSourcesAppendix(text) {
  const heading = /(^|\r?\n\r?\n)### Sources\r?\n/gi;
  let bodyEnd = -1;
  let match;
  while ((match = heading.exec(text))) {
    if (isGeneratedSourcesAppendix(text.slice(heading.lastIndex))) {
      bodyEnd = match.index;
    }
  }
  return bodyEnd < 0 ? text : text.slice(0, bodyEnd);
}

function isGeneratedSourcesAppendix(value) {
  const lines = String(value).trimEnd().split(/\r?\n/);
  return lines.every(isGeneratedSourceLine);
}

function isGeneratedSourceLine(line) {
  const label = /^- \[\[(\d+)\] ([^\]\r\n]+)\]\(/.exec(line);
  if (!label) return false;
  const destination = markdownDestinationAt(line, label[0].length - 1);
  return destination?.end === line.length - 1 &&
    isPageShortcutCapableUrl(destination.value.replace(/\\([\\()])/g, '$1'));
}

function restoreGeneratedInlineCitations(text) {
  const marker = /\[\[(\d+)\]\]\(/g;
  let output = '';
  let cursor = 0;
  let match;
  while ((match = marker.exec(text))) {
    const destination = markdownDestinationAt(text, marker.lastIndex - 1);
    if (!destination || !isPageShortcutCapableUrl(
      destination.value.replace(/\\([\\()])/g, '$1'),
    )) continue;
    output += `${text.slice(cursor, match.index)}[${match[1]}]`;
    cursor = destination.end + 1;
    marker.lastIndex = cursor;
  }
  return cursor ? output + text.slice(cursor) : text;
}

function markdownDestinationAt(text, openIndex) {
  let depth = 1;
  for (let index = openIndex + 1; index < text.length; index += 1) {
    if (text[index] === '\r' || text[index] === '\n') return null;
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === '(') depth += 1;
    if (text[index] !== ')') continue;
    depth -= 1;
    const value = text.slice(openIndex + 1, index);
    const legacyUnbalancedUrl = depth > 0 && /%29/i.test(value) &&
      isPageShortcutCapableUrl(value.replace(/\\([\\()])/g, '$1'));
    if (depth === 0 || legacyUnbalancedUrl) {
      return {
        value,
        end: index,
      };
    }
  }
  return null;
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
