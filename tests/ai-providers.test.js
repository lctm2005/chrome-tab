import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_PROVIDER_ID,
  normalizeAIProviderSettings,
  providerRequiresApiKey,
  providerById,
  providerForBaseUrl,
} from '../src/shared/ai-providers.js';

test('catalog exposes built-in providers and custom OpenAI-compatible settings', () => {
  assert.deepEqual(AI_PROVIDER_CATALOG.map((provider) => provider.id), [
    'z-ai',
    'openai',
    'gemini',
    'deepseek',
    'ollama',
    CUSTOM_AI_PROVIDER_ID,
  ]);
  assert.equal(providerById('z-ai').baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(providerById('z-ai').models[0].id, 'glm-5.2');
  assert.equal(providerById('openai').baseUrl, 'https://api.openai.com/v1');
  assert.ok(providerById('openai').models.some((model) => model.id === 'gpt-5.4-mini'));
  assert.equal(providerById('gemini').baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.ok(providerById('gemini').models.some((model) => model.id === 'gemini-3.5-flash'));
  assert.equal(providerById('deepseek').baseUrl, 'https://api.deepseek.com');
  assert.ok(providerById('deepseek').models.some((model) => model.id === 'deepseek-v4-pro'));
  assert.equal(providerById('ollama').baseUrl, 'http://localhost:11434/v1');
  assert.deepEqual(providerById('ollama').models, []);
  assert.equal(providerRequiresApiKey({ provider: 'ollama' }), false);
  assert.equal(providerRequiresApiKey({ provider: 'deepseek' }), true);
  assert.equal(providerRequiresApiKey({ baseUrl: 'http://localhost:11434/v1' }), false);
  assert.equal(providerById(CUSTOM_AI_PROVIDER_ID).editableBaseUrl, true);
});

test('detects a built-in provider from an existing base URL', () => {
  const provider = providerForBaseUrl('https://api.z.ai/api/coding/paas/v4/');

  assert.equal(provider.id, 'z-ai');
});

test('detects the added built-in providers from their base URLs', () => {
  assert.equal(
    providerForBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/').id,
    'gemini',
  );
  assert.equal(providerForBaseUrl('https://api.deepseek.com/').id, 'deepseek');
  assert.equal(providerForBaseUrl('http://localhost:11434/v1/').id, 'ollama');
});

test('normalizes built-in provider settings with provider-owned URL and model', () => {
  const settings = normalizeAIProviderSettings({
    provider: 'z-ai',
    baseUrl: 'https://example.com/custom',
    model: 'unknown-model',
    apiKey: 'secret',
  });

  assert.equal(settings.provider, 'z-ai');
  assert.equal(settings.baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(settings.model, 'glm-5.2');
  assert.equal(settings.apiKey, 'secret');
});

test('keeps unknown endpoints as custom OpenAI-compatible settings', () => {
  const settings = normalizeAIProviderSettings({
    baseUrl: 'https://llm.example.com/v1/',
    model: 'my-model',
  });

  assert.equal(settings.provider, CUSTOM_AI_PROVIDER_ID);
  assert.equal(settings.baseUrl, 'https://llm.example.com/v1');
  assert.equal(settings.model, 'my-model');
});
