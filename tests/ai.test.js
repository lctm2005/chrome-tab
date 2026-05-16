import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatCompletionRequest,
  createPrompt,
  extractAssistantText,
  getOriginPattern,
  getZaiFallbackBaseUrl,
  languageInstruction,
  normalizeBaseUrl,
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

test('builds a GLM-5.1 OpenAI-compatible chat request', () => {
  const request = buildChatCompletionRequest({
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    model: 'glm-5.1',
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
  assert.equal(request.body.model, 'glm-5.1');
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
