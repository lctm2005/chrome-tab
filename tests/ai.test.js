import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatCompletionRequest,
  createPrompt,
  extractAssistantText,
  extractFinishReason,
  formatAIError,
  getOriginPattern,
  getZaiFallbackBaseUrl,
  languageInstruction,
  normalizeBaseUrl,
  outputTokenBudgetForPurpose,
  parseTidyGroups,
  parseTidyNames,
  parseChatStreamEvent,
} from '../src/shared/ai.js';

test('parses OpenAI-compatible streaming content events', () => {
  assert.deepEqual(parseChatStreamEvent('data: {"choices":[{"delta":{"content":"Hi"}}]}'), {
    done: false,
    text: 'Hi',
    usage: null,
    finishReason: null,
  });
  assert.equal(parseChatStreamEvent('event: ping'), null);
});

test('preserves finish reasons from OpenAI-compatible streaming events', () => {
  assert.deepEqual(parseChatStreamEvent(
    'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":1024}}'
  ), {
    done: false,
    text: '',
    usage: { completion_tokens: 1024 },
    finishReason: 'length',
  });
});

test('treats SSE DONE lines as terminal with valid protocol whitespace', () => {
  for (const line of ['data: [DONE]', 'data:[DONE]', '  data: [DONE]\r']) {
    assert.deepEqual(parseChatStreamEvent(line), {
      done: true,
      text: '',
      usage: null,
      finishReason: null,
    });
  }
});

test('normalizes OpenAI-compatible base URLs without duplicating chat/completions', () => {
  assert.equal(
    normalizeBaseUrl('https://api.z.ai/api/paas/v4/'),
    'https://api.z.ai/api/paas/v4'
  );
  assert.equal(
    normalizeBaseUrl('https://api.z.ai/api/paas/v4/chat/completions'),
    'https://api.z.ai/api/paas/v4'
  );
});

test('derives the permission origin pattern for BYOK endpoints', () => {
  assert.equal(getOriginPattern('https://api.z.ai/api/paas/v4/'), 'https://api.z.ai/*');
  assert.equal(getOriginPattern('http://localhost:11434/v1'), 'http://localhost/*');
  assert.equal(getOriginPattern('http://127.0.0.1:4545/v1'), 'http://127.0.0.1/*');
  assert.throws(() => getOriginPattern('file:///tmp/provider'), /must use http or https/i);
  assert.throws(() => getOriginPattern('ftp://example.com/v1'), /must use http or https/i);
});

test('falls back from general Z.AI endpoint to coding endpoint for coding-plan keys', () => {
  assert.equal(
    getZaiFallbackBaseUrl('https://api.z.ai/api/paas/v4/'),
    'https://api.z.ai/api/coding/paas/v4'
  );
  assert.equal(getZaiFallbackBaseUrl('https://api.z.ai/api/coding/paas/v4'), '');
});

test('builds a GLM-5.2 request with a purpose budget instead of stored max tokens', () => {
  const request = buildChatCompletionRequest({
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    model: 'glm-5.2',
    apiKey: 'secret',
    thinking: 'disabled',
    temperature: 0.4,
    maxTokens: 1,
  }, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Summarize this page.' },
  ], 'tidy-names', 42);

  assert.equal(request.url, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer secret');
  assert.equal(request.body.model, 'glm-5.2');
  assert.equal(request.body.thinking.type, 'disabled');
  assert.equal(request.body.max_tokens, 8_192);
  assert.equal(request.body.stream, false);
});

test('selects bounded output budgets from the purpose and item count whitelist', () => {
  assert.equal(outputTokenBudgetForPurpose('tidy-names', 0), 8_192);
  assert.equal(outputTokenBudgetForPurpose('tidy-names', 80), 8_192);
  assert.equal(outputTokenBudgetForPurpose('tidy-names', 81), 16_384);
  assert.equal(outputTokenBudgetForPurpose('tidy-names', 200), 16_384);
  assert.equal(outputTokenBudgetForPurpose('tidy-names', 201), 32_768);

  assert.equal(outputTokenBudgetForPurpose('auto-group', 80), 16_384);
  assert.equal(outputTokenBudgetForPurpose('auto-group', 81), 32_768);
  assert.equal(outputTokenBudgetForPurpose('auto-group', 200), 32_768);
  assert.equal(outputTokenBudgetForPurpose('auto-group', 201), 65_536);

  assert.equal(outputTokenBudgetForPurpose('ask-page'), 32_768);
  assert.equal(outputTokenBudgetForPurpose('test-ai'), 1_024);
  assert.throws(
    () => outputTokenBudgetForPurpose('tidy-names'),
    /require a non-negative integer itemCount/i,
  );
  assert.throws(
    () => outputTokenBudgetForPurpose('unknown', 1),
    /Unsupported AI purpose: unknown/i,
  );
  assert.throws(
    () => outputTokenBudgetForPurpose('ask-space'),
    /Unsupported AI purpose: ask-space/i,
  );
});

test('request construction rejects unknown purposes', () => {
  assert.throws(() => buildChatCompletionRequest({
    baseUrl: 'https://example.com/v1',
    model: 'example',
    maxTokens: 131_072,
  }, [], 'custom', 1), /Unsupported AI purpose: custom/i);
});

test('extracts assistant text from OpenAI-compatible responses', () => {
  assert.equal(
    extractAssistantText({ choices: [{ message: { content: 'Hello' } }] }),
    'Hello'
  );
  assert.equal(
    extractAssistantText({ choices: [{ delta: { content: 'Hi' } }] }),
    'Hi'
  );
  assert.equal(
    extractFinishReason({ choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }] }),
    'stop'
  );
  assert.equal(extractFinishReason({ choices: [] }), null);
});

test('keeps missing API key errors distinct from provider rejection', () => {
  assert.equal(
    formatAIError(new Error('AI API key is missing. Add it in Settings.')),
    'AI API key is missing. Add it in Settings.'
  );
  assert.equal(
    formatAIError(new Error('401 invalid api key')),
    'AI provider rejected the request: check the BYOK API key and model settings.'
  );
});

test('adds language instructions to AI prompts', () => {
  assert.equal(languageInstruction('zh-CN'), 'Respond in Simplified Chinese.');
  assert.equal(languageInstruction('en'), 'Respond in English.');

  const custom = createPrompt('custom', {
    prompt: 'Question',
    language: 'en',
  });
  assert.match(custom[0].content, /Respond in English/);
});

test('grounds Ask Page in exactly one page and preserves conversation history', () => {
  const prompt = createPrompt('ask-page', {
    page: {
      title: 'Competitor listing',
      url: 'https://example.com/competitor',
      text: 'Vertical tabs and workspaces.',
    },
    pages: [{
      title: 'Must be ignored',
      url: 'https://example.net/other',
      text: 'This is not the active page.',
    }],
    history: [
      { role: 'user', text: 'What does this page cover?' },
      { role: 'assistant', text: 'It covers browser workflows [1].' },
    ],
    question: 'What should we emphasize?',
    language: 'en',
  });

  const system = prompt[0].content;
  const user = prompt.at(-1).content;
  assert.match(system, /one browser page/);
  assert.match(system, /reference data/);
  assert.match(system, /Cite every factual claim[\s\S]*\[1\]/);
  assert.match(system, /Use only citation \[1\]/);
  assert.doesNotMatch(system, /focused work Space|\[2\]/);
  assert.deepEqual(prompt.slice(1, -1), [
    { role: 'user', content: 'What does this page cover?' },
    { role: 'assistant', content: 'It covers browser workflows [1].' },
  ]);
  assert.match(user, /Source \[1\]:\nTitle: Competitor listing/);
  assert.match(user, /URL: https:\/\/example\.com\/competitor/);
  assert.match(user, /What should we emphasize/);
  assert.doesNotMatch(user, /Space:|Must be ignored|example\.net\/other/);
});

test('rejects Ask Page prompts without one explicit page and the legacy Ask Space kind', () => {
  assert.throws(
    () => createPrompt('ask-page', { question: 'What is here?' }),
    /Ask Page prompts require one page/i,
  );
  assert.throws(
    () => createPrompt('ask-page', { page: [], question: 'What is here?' }),
    /Ask Page prompts require one page/i,
  );
  assert.throws(
    () => createPrompt('ask-space', {
      page: { title: 'Old scope', url: 'https://example.com', text: 'Legacy' },
    }),
    /Unsupported AI prompt kind: ask-space/i,
  );
});

test('asks tidy-tabs AI to cluster by topic instead of domain', () => {
  const prompt = createPrompt('tidy-tabs', {
    tabs: [
      { id: 1, title: 'AI browser tab grouping research', url: 'https://example.com/a' },
      { id: 2, title: 'Chrome extension AI tab organizer', url: 'https://another.example/b' },
    ],
  });

  assert.match(prompt[0].content, /page titles first/);
  assert.match(prompt[0].content, /Do not group merely because tabs share a domain/);
  assert.match(prompt[0].content, /mix different domains/);
});

test('asks tidy-names AI to rename only the supplied tabs', () => {
  const prompt = createPrompt('tidy-names', {
    tabs: [
      { id: 1, title: '67.216.201.49 - 入站', url: 'https://67.216.201.49:44374/secret/panel/inbounds' },
      { id: 2, title: 'GitHub - openai/codex/pull/123', url: 'https://github.com/openai/codex/pull/123' },
    ],
    language: 'zh-CN',
  });

  assert.match(prompt[0].content, /Rename browser tabs/);
  assert.match(prompt[0].content, /only the tabs supplied/);
  assert.match(prompt[0].content, /Return only JSON/);
  assert.match(prompt[0].content, /Respond in Simplified Chinese/);
});

test('parses tidy-tabs JSON even when the model wraps it in markdown', () => {
  const groups = parseTidyGroups([
    'Here is the grouping:',
    '```json',
    '[{"title":"AI Tab Organizers","tabIds":[1,2],"color":"cyan"}]',
    '```',
  ].join('\n'));

  assert.deepEqual(groups, [{
    title: 'AI Tab Organizers',
    tabIds: [1, 2],
    color: 'cyan',
  }]);
});

test('parses tidy-names JSON and ignores unknown or empty entries', () => {
  const names = parseTidyNames([
    '```json',
    '[',
    '{"id":1,"title":"3X-UI 入站"},',
    '{"tabId":2,"name":"Codex PR"},',
    '{"id":3,"title":""},',
    '{"id":99,"title":"Outside input"}',
    ']',
    '```',
  ].join('\n'), [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ]);

  assert.deepEqual(names, {
    1: '3X-UI 入站',
    2: 'Codex PR',
  });
});
