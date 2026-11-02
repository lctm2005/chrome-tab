import test from 'node:test';
import assert from 'node:assert/strict';

import { formatAIError } from '../src/shared/ai.js';

test('keeps local API key persistence errors distinct from provider authentication failures', () => {
  const error = new Error('API key storage was interrupted.');
  error.code = 'AI_AUTH_STORAGE';
  assert.equal(formatAIError(error), error.message);
});

test('formats insufficient balance as an account state rather than a wiring failure', () => {
  assert.equal(
    formatAIError(new Error('insufficient balance')),
    'AI provider rejected the request: insufficient balance. Update the BYOK account or API key in Settings.'
  );
});
