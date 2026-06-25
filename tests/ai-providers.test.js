import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_PROVIDER_ID,
  normalizeAIProviderSettings,
  providerById,
  providerForBaseUrl,
} from '../src/shared/ai-providers.js';

test('catalog exposes built-in Z.ai, OpenAI, and custom providers', () => {
  assert.deepEqual(AI_PROVIDER_CATALOG.map((provider) => provider.id), [
    'z-ai',
    'openai',
    CUSTOM_AI_PROVIDER_ID,
  ]);
  assert.equal(providerById('z-ai').baseUrl, 'https://api.z.ai/api/coding/paas/v4');
  assert.equal(providerById('z-ai').models[0].id, 'glm-5.2');
  assert.equal(providerById('openai').baseUrl, 'https://api.openai.com/v1');
  assert.ok(providerById('openai').models.some((model) => model.id === 'gpt-5.4-mini'));
  assert.equal(providerById(CUSTOM_AI_PROVIDER_ID).editableBaseUrl, true);
});

test('detects a built-in provider from an existing base URL', () => {
  const provider = providerForBaseUrl('https://api.z.ai/api/coding/paas/v4/');

  assert.equal(provider.id, 'z-ai');
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
