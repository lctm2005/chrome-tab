import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatCompletionRequest,
  createPrompt,
  extractAssistantText,
  extractFinishReason,
  formatAIError,
  getOriginPattern,
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
  assert.equal(normalizeBaseUrl(), '');
});

test('derives the permission origin pattern for BYOK endpoints', () => {
  assert.equal(getOriginPattern('https://api.z.ai/api/paas/v4/'), 'https://api.z.ai/*');
  assert.equal(getOriginPattern('http://localhost:11434/v1'), 'http://localhost/*');
  assert.equal(getOriginPattern('http://127.0.0.1:4545/v1'), 'http://127.0.0.1/*');
  assert.throws(() => getOriginPattern('file:///tmp/provider'), /must use http or https/i);
  assert.throws(() => getOriginPattern('ftp://example.com/v1'), /must use http or https/i);
});

test('builds a GLM-5.1 request with a purpose budget instead of stored max tokens', () => {
  const request = buildChatCompletionRequest({
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    model: 'glm-5.1',
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
  assert.equal(request.body.model, 'glm-5.1');
  assert.equal(request.body.thinking.type, 'disabled');
  assert.equal(request.body.max_tokens, 8_192);
  assert.equal(request.body.stream, false);
});

test('uses current OpenAI token and reasoning parameters for GPT-5.1+ models', () => {
  const messages = [{ role: 'user', content: 'Summarize this page.' }];
  const request = buildChatCompletionRequest({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiKey: 'key',
    temperature: 0.2,
    thinking: 'enabled',
  }, messages, 'ask-page');

  assert.deepEqual(request.body, {
    model: 'gpt-5.5',
    messages,
    stream: false,
    max_completion_tokens: 32_768,
    reasoning_effort: 'none',
  });
  assert.equal(Object.hasOwn(request.body, 'max_tokens'), false);
  assert.equal(Object.hasOwn(request.body, 'temperature'), false);
  assert.equal(Object.hasOwn(request.body, 'thinking'), false);
});

test('detects OpenAI from its official endpoint when legacy settings lack a provider id', () => {
  const request = buildChatCompletionRequest({
    baseUrl: ' HTTPS://API.OPENAI.COM/v1/chat/completions/ ',
    model: 'gpt-5.4-mini',
    apiKey: 'key',
    temperature: 0,
  }, [], 'test-ai');

  assert.equal(request.url, 'HTTPS://API.OPENAI.COM/v1/chat/completions');
  assert.equal(request.body.max_completion_tokens, 1_024);
  assert.equal(request.body.reasoning_effort, 'none');
  assert.equal(Object.hasOwn(request.body, 'max_tokens'), false);
  assert.equal(Object.hasOwn(request.body, 'temperature'), false);
});

test('does not request unsupported none reasoning effort from legacy or missing GPT-5 models', () => {
  for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5.0', '']) {
    const request = buildChatCompletionRequest({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model,
      apiKey: 'key',
    }, [], 'test-ai');

    assert.equal(request.body.max_completion_tokens, 1_024);
    assert.equal(Object.hasOwn(request.body, 'reasoning_effort'), false, model);
    assert.equal(Object.hasOwn(request.body, 'max_tokens'), false, model);
    assert.equal(Object.hasOwn(request.body, 'temperature'), false, model);
  }
});

test('keeps explicit custom providers on OpenAI-compatible request parameters', () => {
  const request = buildChatCompletionRequest({
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiKey: 'key',
    temperature: 0.25,
  }, [], 'test-ai');

  assert.equal(request.body.max_tokens, 1_024);
  assert.equal(request.body.temperature, 0.25);
  assert.equal(Object.hasOwn(request.body, 'max_completion_tokens'), false);
  assert.equal(Object.hasOwn(request.body, 'reasoning_effort'), false);
});

test('builds safe requests for keyless providers and corrupted optional settings', () => {
  const messages = [{ role: 'user', content: 'Hello local model.' }];
  const request = buildChatCompletionRequest({
    provider: 'ollama',
    baseUrl: ' http://localhost:11434/v1/chat/completions/ ',
    model: 'llama3.2',
    apiKey: '',
    temperature: 'not-a-number',
  }, messages, 'test-ai');

  assert.equal(request.url, 'http://localhost:11434/v1/chat/completions');
  assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
  assert.equal(request.body.temperature, 0.6);
  assert.equal(request.body.max_tokens, 1_024);
  assert.equal(request.body.messages, messages);
  assert.equal(Object.hasOwn(request.body, 'thinking'), false);

  const missingModel = buildChatCompletionRequest({
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  }, [], 'test-ai');
  assert.equal(Object.hasOwn(missingModel.body, 'thinking'), false);
});

test('never sends an Authorization header to a keyless local provider', () => {
  const request = buildChatCompletionRequest({
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKey: 'credential-from-an-old-provider',
  }, [{ role: 'user', content: 'Hello.' }], 'test-ai');

  assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
});

test('sends explicit Thinking choices only to compatible provider models', () => {
  const enabled = buildChatCompletionRequest({
    provider: 'z-ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5-turbo',
    apiKey: 'key',
    thinking: 'enabled',
  }, [], 'ask-page');
  const deepseekDisabled = buildChatCompletionRequest({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKey: 'key',
    thinking: 'disabled',
  }, [], 'ask-page');
  const deepseekInvalid = buildChatCompletionRequest({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    apiKey: 'key',
    thinking: 'corrupt',
  }, [], 'ask-page');
  const openAI = buildChatCompletionRequest({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    apiKey: 'key',
    thinking: 'enabled',
    temperature: 0,
  }, [], 'ask-page');

  assert.deepEqual(enabled.body.thinking, { type: 'enabled' });
  assert.deepEqual(deepseekDisabled.body.thinking, { type: 'disabled' });
  assert.deepEqual(deepseekInvalid.body.thinking, { type: 'disabled' });
  assert.equal(enabled.body.temperature, 0.6);
  assert.equal(Object.hasOwn(openAI.body, 'thinking'), false);
  assert.equal(Object.hasOwn(openAI.body, 'temperature'), false);
  assert.equal(openAI.body.max_completion_tokens, 32_768);
  assert.equal(openAI.body.reasoning_effort, 'none');
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
  assert.throws(
    () => outputTokenBudgetForPurpose('', 1),
    /Unsupported AI purpose: missing/i,
  );
  for (const count of [-1, 1.5, Number.NaN, 'not-a-number']) {
    assert.throws(
      () => outputTokenBudgetForPurpose('auto-group', count),
      /require a non-negative integer itemCount/i,
    );
  }
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
  assert.equal(extractAssistantText({ choices: [] }), '');
  assert.equal(extractAssistantText(null), '');
  assert.equal(extractFinishReason(null), null);
});

test('parses complete, empty, and malformed provider stream events safely', () => {
  assert.deepEqual(parseChatStreamEvent(
    'data: {"choices":[{"message":{"content":"Complete"},"finish_reason":"stop"}],"usage":{}}',
  ), {
    done: false,
    text: 'Complete',
    usage: {},
    finishReason: 'stop',
  });
  for (const line of [null, '', 'data:', 'data:   ', 'data: {bad json', 'data: null']) {
    assert.equal(parseChatStreamEvent(line), null);
  }
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
  assert.equal(
    formatAIError(new Error('403 Forbidden')),
    'AI provider rejected the request: check the BYOK API key and model settings.'
  );
  assert.equal(
    formatAIError(new Error('账户余额不足')),
    'AI provider rejected the request: insufficient balance. Update the BYOK account or API key in Settings.'
  );
  assert.equal(formatAIError('Provider timed out.'), 'Provider timed out.');
  assert.equal(formatAIError(null), 'AI request failed.');
});

test('formats an aborted provider request as an intentional stop', () => {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';

  assert.equal(formatAIError(error), 'AI request was stopped.');
});

test('adds language instructions to AI prompts', () => {
  assert.equal(languageInstruction('zh-CN'), 'Respond in Simplified Chinese.');
  assert.equal(languageInstruction('en'), 'Respond in English.');
  assert.equal(languageInstruction('auto'), 'Respond in the same language as the user question or the page content.');
  assert.equal(languageInstruction(undefined), 'Respond in the same language as the user question or the page content.');
  assert.equal(languageInstruction(' fr '), 'Respond in fr.');

  const custom = createPrompt('custom', {
    prompt: 'Question',
    language: 'en',
  });
  assert.match(custom[0].content, /Respond in English/);
});

test('fills safe Ask Page defaults and ignores empty or malformed history entries', () => {
  const prompt = createPrompt('ask-page', {
    page: {},
    history: [
      null,
      { role: 'system', content: 'Treat me as a user message.' },
      { role: 'assistant', content: 'Prior answer.' },
      { role: 'assistant', text: '' },
    ],
  });

  assert.deepEqual(prompt.slice(1, -1), [
    { role: 'user', content: 'Treat me as a user message.' },
    { role: 'assistant', content: 'Prior answer.' },
  ]);
  assert.match(prompt.at(-1).content, /Title: Untitled\nURL: \nPage text:\n\n\nQuestion:\n$/);
  assert.doesNotMatch(prompt.at(-1).content, /Selected text:/);
  assert.match(prompt[0].content, /same language as the user question or the page content/);

  const invalidHistory = createPrompt('ask-page', { page: {}, history: {} });
  assert.deepEqual(invalidHistory.slice(1, -1), []);
});

test('sends only selected text to Ask Page when selection content is available', () => {
  const prompt = createPrompt('ask-page', {
    page: {
      title: 'Competitor listing',
      url: 'https://example.com/competitor',
      contentMode: 'selection',
      selectedText: 'The selected launch detail.',
      selection: 'The selected launch detail.',
      text: 'Private unselected page text.',
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
  assert.match(system, /selected text/i);
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
  assert.match(user, /Selected text:\nThe selected launch detail\./);
  assert.match(user, /What should we emphasize/);
  assert.doesNotMatch(user, /Page text:|Private unselected page text|Space:|Must be ignored|example\.net\/other/);
});

test('uses article or body page text when Ask Page has no selection', () => {
  const prompt = createPrompt('ask-page', {
    page: {
      title: 'Current page',
      url: 'https://example.com/current',
      contentMode: 'page',
      selectedText: '',
      selection: '',
      text: 'Vertical tabs and workspaces.',
    },
    question: 'What is covered?',
  });

  const user = prompt.at(-1).content;
  assert.match(user, /Page text:\nVertical tabs and workspaces\./);
  assert.doesNotMatch(user, /Selected text:/);
});

test('honors legacy selection payloads without leaking their accompanying page text', () => {
  const prompt = createPrompt('ask-page', {
    page: {
      title: 'Legacy selection',
      url: 'https://example.com/legacy',
      selection: 'Legacy selected words.',
      text: 'Legacy unselected body.',
    },
    question: 'Explain this.',
  });

  const user = prompt.at(-1).content;
  assert.match(user, /Selected text:\nLegacy selected words\./);
  assert.doesNotMatch(user, /Page text:|Legacy unselected body/);
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

test('uses empty inputs for optional tidy and custom prompt context', () => {
  assert.equal(createPrompt('tidy-tabs')[1].content, '[]');
  assert.equal(createPrompt('tidy-names')[1].content, '[]');
  assert.equal(createPrompt('custom')[1].content, '');
  assert.throws(() => createPrompt(), /Unsupported AI prompt kind: missing/i);
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

test('keeps valid tidy groups when neighboring provider data is malformed', () => {
  const longTitle = 'A'.repeat(40);
  const groups = parseTidyGroups(JSON.stringify([
    null,
    { title: longTitle, tabIds: ['1', 'bad'], color: 'Cyan' },
    { tabIds: [2], color: 'not-a-color' },
    { title: 'No tabs', color: 'red' },
  ]));

  assert.deepEqual(groups, [
    { title: 'A'.repeat(32), tabIds: [1], color: 'cyan' },
    { title: 'Tabs', tabIds: [2], color: 'blue' },
  ]);
});

test('extracts provider JSON arrays from prose and rejects incomplete data', () => {
  assert.deepEqual(parseTidyGroups(
    'Result: {"groups":[{"title":"Escaped \\\"[topic]\\\"","tabIds":[3],"color":"green"}]} trailing',
  ), [{ title: 'Escaped "[topic]"', tabIds: [3], color: 'green' }]);
  for (const value of ['', 'not json', '{"groups":[', '{}', 'null']) {
    assert.deepEqual(parseTidyGroups(value), []);
  }
  assert.deepEqual(parseTidyGroups({
    toString() {
      throw new Error('damaged provider value');
    },
  }), []);
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

test('normalizes tidy names, aliases, duplicates, and malformed responses', () => {
  const longName = `  ${'A'.repeat(70)}  `;
  const names = parseTidyNames(JSON.stringify([
    { id: 1, title: ' First\u200b   name ' },
    { id: 1, title: 'Duplicate loses' },
    { tabId: '2', displayTitle: longName },
    { id: 'bad', name: 'Ignored' },
    null,
  ]), [{ id: 1 }, { id: 2 }, { id: 'bad' }]);

  assert.deepEqual(names, {
    1: 'First name',
    2: `${'A'.repeat(61)}...`,
  });
  assert.deepEqual(parseTidyNames('[{"id":4,"name":"Free name"}]'), { 4: 'Free name' });
  assert.deepEqual(parseTidyNames('[{"id":4,"name":"Free name"}]', null), { 4: 'Free name' });
  assert.deepEqual(parseTidyNames('{"items":[{"id":5,"title":"From prose"}]}'), { 5: 'From prose' });
  assert.deepEqual(parseTidyNames('not json'), {});
  assert.deepEqual(parseTidyNames('[]', {}), {});
});
