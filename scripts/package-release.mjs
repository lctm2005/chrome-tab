#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_CONFIG_CONTENT,
  GENERATED_CONFIG_PATH,
  RELEASE_FILES,
  RUNTIME_FILES,
  assertSafeReleaseEntries,
} from './release-files.mjs';
import { verifyReleaseArchive } from './verify-package.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const distDir = path.join(rootDir, 'dist');
const manifestPath = path.join(rootDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const slug = slugify(manifest.short_name || manifest.name || 'extension');
const version = String(manifest.version || '0.0.0');
const stageDir = path.join(distDir, `${slug}-${version}`);
const zipPath = path.join(distDir, `${slug}-${version}.zip`);

await assertZipAvailable();
assertSafeReleaseEntries(RELEASE_FILES);
await rm(stageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(stageDir, { recursive: true });

for (const entry of RUNTIME_FILES) {
  await copyEntry(entry);
}

await writeFile(path.join(stageDir, GENERATED_CONFIG_PATH), GENERATED_CONFIG_CONTENT);

const result = spawnSync('zip', ['-q', '-X', zipPath, ...RELEASE_FILES], {
  cwd: stageDir,
  encoding: 'utf8',
});
if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || 'zip failed');
}

await verifyReleaseArchive(zipPath, { rootDir });

console.log(`Packaged ${manifest.name} ${version}`);
console.log(`Zip: ${path.relative(rootDir, zipPath)}`);
console.log(`Stage: ${path.relative(rootDir, stageDir)}`);

async function copyEntry(entry) {
  const from = path.join(rootDir, entry);
  let metadata;
  try {
    metadata = await lstat(from);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing release entry: ${entry}`);
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Release entries cannot be symlinks: ${entry}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Release entries must be regular files: ${entry}`);
  }
  const to = path.join(stageDir, entry);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function assertZipAvailable() {
  const result = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('The release packager requires the system `zip` command.');
  }
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'extension';
}
