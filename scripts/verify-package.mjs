#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_CONFIG_CONTENT,
  GENERATED_CONFIG_PATH,
  RELEASE_FILES,
  assertArchiveHasNoSymlinks,
  assertSafeReleaseEntries,
  findSecret,
} from './release-files.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRootDir = path.resolve(path.dirname(scriptPath), '..');
const TEXT_FILE_PATTERN = /\.(?:css|html|js|json)$/i;

export async function verifyReleaseArchive(zipPath, options = {}) {
  const rootDir = path.resolve(options.rootDir || defaultRootDir);
  const archivePath = path.resolve(zipPath);
  const entries = zipCommand(['-Z', '-1', archivePath])
    .split(/\r?\n/)
    .filter(Boolean);
  assertSafeReleaseEntries(entries);

  const verboseListing = zipCommand(['-Z', '-l', archivePath]);
  assertArchiveHasNoSymlinks(verboseListing);

  const rootManifestText = await readFile(path.join(rootDir, 'manifest.json'), 'utf8');
  const packagedManifestText = readZipEntry(archivePath, 'manifest.json').toString('utf8');
  assert.deepEqual(
    JSON.parse(packagedManifestText),
    JSON.parse(rootManifestText),
    'Packaged manifest.json does not match the repository manifest.',
  );

  const config = readZipEntry(archivePath, GENERATED_CONFIG_PATH).toString('utf8');
  assert.equal(config, GENERATED_CONFIG_CONTENT, 'Packaged config.local.js is not the generated safe config.');

  for (const entry of RELEASE_FILES.filter((name) => TEXT_FILE_PATTERN.test(name))) {
    const finding = findSecret(readZipEntry(archivePath, entry).toString('utf8'));
    if (finding) throw new Error(`Possible ${finding} found in ${entry}.`);
  }

  console.log(`Verified ${path.relative(rootDir, archivePath) || path.basename(archivePath)} (${entries.length} allowlisted files).`);
  return { entries };
}

function zipCommand(args) {
  const result = spawnSync('unzip', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Unable to inspect release archive.');
  }
  return result.stdout;
}

function readZipEntry(zipPath, entry) {
  const result = spawnSync('unzip', ['-p', zipPath, entry], {
    encoding: null,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `Unable to read ${entry} from release archive.`));
  }
  return result.stdout;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const rootManifest = JSON.parse(await readFile(path.join(defaultRootDir, 'manifest.json'), 'utf8'));
  const slug = slugify(rootManifest.short_name || rootManifest.name || 'extension');
  const version = String(rootManifest.version || '0.0.0');
  const requestedPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(defaultRootDir, 'dist', `${slug}-${version}.zip`);
  await verifyReleaseArchive(requestedPath, { rootDir: defaultRootDir });
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'extension';
}
