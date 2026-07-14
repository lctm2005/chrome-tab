import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENERATED_CONFIG_CONTENT,
  GENERATED_CONFIG_PATH,
  RELEASE_FILES,
  assertArchiveHasNoSymlinks,
  assertSafeReleaseEntries,
  assertSafeReleasePath,
  findSecret,
} from '../scripts/release-files.mjs';

test('release allowlist contains only explicit runtime files and the generated empty config', () => {
  assert.doesNotThrow(() => assertSafeReleaseEntries(RELEASE_FILES));
  assert.ok(RELEASE_FILES.includes('src/shared/space-transfer.js'));
  assert.equal(RELEASE_FILES.includes('src/shared/arc-file-access.js'), false);
  assert.ok(RELEASE_FILES.includes(GENERATED_CONFIG_PATH));
  assert.equal(GENERATED_CONFIG_CONTENT.includes('SPACE_TABS_CONFIG'), true);
  assert.equal(findSecret(GENERATED_CONFIG_CONTENT), '');
  assert.equal(RELEASE_FILES.includes('src'), false);
  assert.equal(RELEASE_FILES.includes('icons'), false);
});

test('release path policy rejects hidden, linked-target-like, test, map, and sensitive config paths', () => {
  for (const entry of [
    '.env',
    'src/.hidden.js',
    '../manifest.json',
    'src/shared/state.test.js',
    'src/shared/state.js.map',
    'config.production.js',
    'credentials.json',
  ]) {
    assert.throws(() => assertSafeReleasePath(entry), /release|Hidden|Source maps|Test files|Sensitive config/i);
  }
});

test('release entry verification rejects extras, missing files, and duplicate zip entries', () => {
  assert.throws(
    () => assertSafeReleaseEntries([...RELEASE_FILES, 'debug.log']),
    /does not match the runtime allowlist/,
  );
  assert.throws(
    () => assertSafeReleaseEntries(RELEASE_FILES.slice(1)),
    /missing: manifest.json/,
  );
  assert.throws(
    () => assertSafeReleaseEntries([...RELEASE_FILES, RELEASE_FILES[0]]),
    /Duplicate release entry/,
  );
});

test('release archive policy rejects symlink entries from zip metadata', () => {
  assert.doesNotThrow(() => assertArchiveHasNoSymlinks('-rw-r--r--  3.0 unx 1207 tx manifest.json'));
  assert.throws(
    () => assertArchiveHasNoSymlinks('lrwxr-xr-x  3.0 unx 12 bx manifest.json'),
    /symbolic link/,
  );
});

test('release secret scan recognizes common credential formats', () => {
  assert.equal(findSecret('const token = "sk-proj-abcdefghijklmnopqrstuv";'), 'OpenAI-style API key');
  assert.equal(findSecret('-----BEGIN PRIVATE KEY-----'), 'private key');
  assert.equal(findSecret('const client_secret = "really-sensitive-value";'), 'assigned credential');
  assert.equal(findSecret('const apiKey = runtimeConfig.apiKey || "";'), '');
});
