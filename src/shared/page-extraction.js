export function extractCurrentPage(textLimit, runtime = globalThis) {
  const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const numericLimit = Number(textLimit);
  const limit = Number.isFinite(numericLimit) ? Math.max(0, Math.floor(numericLimit)) : 0;
  const documentRef = runtime?.document;
  const documentSelection = normalizeWhitespace(runtime?.getSelection?.()?.toString?.() || '');
  const activeElement = documentRef?.activeElement;
  const tagName = String(activeElement?.tagName || '').trim().toLowerCase();
  const inputType = String(activeElement?.type || 'text').trim().toLowerCase();
  const textInputTypes = ['text', 'search', 'email', 'tel', 'url'];
  const isTextControl = tagName === 'textarea' || (
    tagName === 'input' && textInputTypes.includes(inputType)
  );
  const selectionStart = Number(activeElement?.selectionStart);
  const selectionEnd = Number(activeElement?.selectionEnd);
  const controlSelection = !documentSelection &&
    isTextControl &&
    Number.isInteger(selectionStart) &&
    selectionStart >= 0 &&
    Number.isInteger(selectionEnd) &&
    selectionEnd > selectionStart
    ? normalizeWhitespace(String(activeElement?.value || '').slice(selectionStart, selectionEnd))
    : '';
  const rawSelectedText = documentSelection || controlSelection;

  if (rawSelectedText) {
    const selectedText = rawSelectedText.slice(0, limit);
    return {
      title: String(documentRef?.title || ''),
      url: String(runtime?.location?.href || ''),
      contentMode: 'selection',
      selectedText,
      selection: selectedText,
      text: '',
      charCount: selectedText.length,
      originalCharCount: rawSelectedText.length,
      truncated: rawSelectedText.length > selectedText.length,
    };
  }

  const article = normalizeWhitespace(documentRef?.querySelector?.('article')?.innerText || '');
  const rawText = article || normalizeWhitespace(documentRef?.body?.innerText || '');
  const text = rawText.slice(0, limit);

  return {
    title: String(documentRef?.title || ''),
    url: String(runtime?.location?.href || ''),
    contentMode: 'page',
    selectedText: '',
    selection: '',
    text,
    charCount: text.length,
    originalCharCount: rawText.length,
    truncated: rawText.length > text.length,
  };
}
