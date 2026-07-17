import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_PROVIDER_ID,
  normalizeAIProviderSettings,
  providerRequiresApiKey,
  providerById,
  providerForBaseUrl,
  providerSupportsThinking,
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
  assert.equal(providerById('z-ai').baseUrl, 'https://api.z.ai/api/paas/v4');
  assert.deepEqual(providerById('z-ai').models[0], {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    documentationUrl: 'https://docs.z.ai/guides/llm/glm-5.2',
  });
  assert.equal(providerById('openai').baseUrl, 'https://api.openai.com/v1');
  assert.ok(providerById('openai').models.some((model) => model.id === 'gpt-5.4-mini'));
  assert.equal(providerById('gemini').baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.ok(providerById('gemini').models.some((model) => model.id === 'gemini-3.5-flash'));
  assert.ok(providerById('gemini').models.some((model) => model.id === 'gemini-3.1-flash-lite'));
  assert.ok(!providerById('gemini').models.some((model) => (
    ['gemini-3.1-flash-lite-preview'].includes(model.id)
  )), 'shut-down model ids must not return to the built-in catalog');
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
  const provider = providerForBaseUrl('https://api.z.ai/api/paas/v4/');

  assert.equal(provider.id, 'z-ai');
});

test('detects built-in providers from user-pasted request endpoints and URL casing', () => {
  assert.equal(
    providerForBaseUrl(' HTTPS://API.OPENAI.COM/v1/chat/completions/ ').id,
    'openai',
  );
  assert.equal(
    providerForBaseUrl(new URL('https://api.z.ai/api/paas/v4/')).id,
    'z-ai',
  );
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
  assert.equal(settings.baseUrl, 'https://api.z.ai/api/paas/v4');
  assert.equal(settings.model, 'unknown-model');
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

test('falls back safely for unknown, empty, and damaged provider settings', () => {
  assert.equal(providerById('missing').id, CUSTOM_AI_PROVIDER_ID);
  assert.equal(providerById().id, CUSTOM_AI_PROVIDER_ID);
  assert.equal(providerForBaseUrl(''), null);
  assert.equal(providerForBaseUrl('https://unknown.example/v1'), null);
  assert.equal(providerForBaseUrl('not a valid URL'), null);
  assert.equal(providerRequiresApiKey({ provider: 'missing' }), true);
  assert.equal(providerRequiresApiKey({ baseUrl: 'https://unknown.example/v1' }), true);
  assert.equal(providerRequiresApiKey(null), true);

  assert.deepEqual(normalizeAIProviderSettings(null), {
    provider: CUSTOM_AI_PROVIDER_ID,
    baseUrl: '',
    model: '',
  });
  assert.deepEqual(normalizeAIProviderSettings(), {
    provider: CUSTOM_AI_PROVIDER_ID,
    baseUrl: '',
    model: '',
  });
});

test('preserves valid provider models and normalizes custom request endpoints', () => {
  const builtIn = normalizeAIProviderSettings({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    baseUrl: 'https://ignored.example/v1',
  });
  assert.equal(builtIn.model, 'gpt-5.4-mini');
  assert.equal(builtIn.baseUrl, 'https://api.openai.com/v1');

  const ollama = normalizeAIProviderSettings({
    provider: 'ollama',
    model: '  llama3.2  ',
  });
  assert.equal(ollama.model, 'llama3.2');

  const custom = normalizeAIProviderSettings({
    provider: CUSTOM_AI_PROVIDER_ID,
    baseUrl: ' HTTPS://LLM.EXAMPLE.COM/v1/chat/completions/ ',
    model: '  custom-model  ',
  });
  assert.equal(custom.baseUrl, 'https://llm.example.com/v1');
  assert.equal(custom.model, 'custom-model');

  assert.equal(normalizeAIProviderSettings({
    provider: 'z-ai',
    model: 'glm-5.1',
  }).model, 'glm-5.2', 'the retired catalog id must migrate to the current model');
});

test('keeps Coding Plan explicit and exposes Thinking only for compatible models', () => {
  assert.equal(providerForBaseUrl('https://api.z.ai/api/coding/paas/v4'), null);
  const coding = normalizeAIProviderSettings({
    provider: CUSTOM_AI_PROVIDER_ID,
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.2',
  });
  assert.equal(coding.provider, CUSTOM_AI_PROVIDER_ID);
  assert.equal(coding.baseUrl, 'https://api.z.ai/api/coding/paas/v4');

  assert.equal(providerSupportsThinking({ provider: 'z-ai', model: 'glm-5.2' }), true);
  assert.equal(providerSupportsThinking({ provider: 'z-ai', model: 'glm-4.5-air' }), true);
  assert.equal(providerSupportsThinking({ provider: 'z-ai', model: 'glm-4.4' }), false);
  assert.equal(providerSupportsThinking({ provider: 'deepseek', model: 'deepseek-v4-flash' }), true);
  assert.equal(providerSupportsThinking({ provider: 'deepseek', model: 'deepseek-v3' }), false);
  assert.equal(providerSupportsThinking({ provider: 'openai', model: 'deepseek-v4-pro' }), false);
  assert.equal(providerSupportsThinking({ provider: 'gemini', model: 'gemini-3.5-flash' }), false);
  assert.equal(providerSupportsThinking({ provider: 'ollama', model: 'glm-5.2' }), false);
  assert.equal(providerSupportsThinking({
    provider: CUSTOM_AI_PROVIDER_ID,
    model: 'deepseek-v4-pro',
  }), true);
  assert.equal(providerSupportsThinking({
    provider: CUSTOM_AI_PROVIDER_ID,
    model: 'unknown-model',
  }), false);
  assert.equal(providerSupportsThinking(null), false);
});
