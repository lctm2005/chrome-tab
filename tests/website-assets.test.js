import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenshotNames = [
  '01-spaces-overview.png',
  '02-nested-folders-dormant-tabs.png',
  '03-tab-context-menu.png',
  '04-settings-arc-import-shortcuts.png',
  '05-ask-page-byok-ai.png',
];

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('website product screenshots stay byte-identical to the current store screenshots', async () => {
  for (const name of screenshotNames) {
    const storePath = new URL(`../docs/store-assets/screenshots/${name}`, import.meta.url);
    const websitePath = new URL(`../website/public/screenshots/${name}`, import.meta.url);
    assert.equal(await sha256(websitePath), await sha256(storePath), `${name} drifted from the current product image`);
  }
});

test('website social image uses the current Space Tabs product screenshot', async () => {
  const storePath = new URL('../docs/store-assets/screenshots/01-spaces-overview.png', import.meta.url);
  const socialPath = new URL('../website/public/og.png', import.meta.url);
  assert.equal(await sha256(socialPath), await sha256(storePath));
});
