import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatCompletionRequest,
  createPrompt,
  extractAssistantText,
  formatAIError,
  getOriginPattern,
  getZaiFallbackBaseUrl,
  languageInstruction,
  normalizeBaseUrl,
  parseTidyGroups,
  parseTidyNames,
} from '../src/shared/ai.js';

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
  assert.equal(getOriginPattern('http://localhost:11434/v1'), 'http://localhost:11434/*');
});

test('falls back from general Z.AI endpoint to coding endpoint for coding-plan keys', () => {
  assert.equal(
    getZaiFallbackBaseUrl('https://api.z.ai/api/paas/v4/'),
    'https://api.z.ai/api/coding/paas/v4'
  );
  assert.equal(getZaiFallbackBaseUrl('https://api.z.ai/api/coding/paas/v4'), '');
});

test('builds a GLM-5.2 OpenAI-compatible chat request', () => {
  const request = buildChatCompletionRequest({
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    model: 'glm-5.2',
    apiKey: 'secret',
    thinking: 'disabled',
    temperature: 0.4,
    maxTokens: 2048,
  }, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Summarize this page.' },
  ]);

  assert.equal(request.url, 'https://api.z.ai/api/paas/v4/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer secret');
  assert.equal(request.body.model, 'glm-5.2');
  assert.equal(request.body.thinking.type, 'disabled');
  assert.equal(request.body.max_tokens, 2048);
  assert.equal(request.body.stream, false);
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

test('adds language instructions to Ask and Summary prompts', () => {
  assert.equal(languageInstruction('zh-CN'), 'Respond in Simplified Chinese.');
  assert.equal(languageInstruction('en'), 'Respond in English.');

  const summary = createPrompt('summarize-page', {
    title: 'Title',
    text: 'Page text',
    language: 'zh-CN',
  });
  assert.match(summary[0].content, /Respond in Simplified Chinese/);

  const custom = createPrompt('custom', {
    prompt: 'Question',
    language: 'en',
  });
  assert.match(custom[0].content, /Respond in English/);
});

test('grounds Ask Space in local Context and the current page', () => {
  const prompt = createPrompt('ask-space', {
    spaceName: 'Store launch',
    spaceContext: '# Decision\nLead with Arc-like migration.',
    page: {
      title: 'Competitor listing',
      url: 'https://example.com/competitor',
      text: 'Vertical tabs and workspaces.',
    },
    question: 'What should we emphasize?',
    language: 'en',
  });

  assert.match(prompt[0].content, /focused work Space/);
  assert.match(prompt[0].content, /reference data/);
  assert.match(prompt[1].content, /Store launch/);
  assert.match(prompt[1].content, /Lead with Arc-like migration/);
  assert.match(prompt[1].content, /Competitor listing/);
  assert.match(prompt[1].content, /What should we emphasize/);
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
