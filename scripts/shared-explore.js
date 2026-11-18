#!/usr/bin/env node
/**
 * src/common/explore is shared by fg-gas-backend and fg-cw-backend and must be
 * the same in both, as must every file of src/common/buckets it imports,
 * directly or through another. SHARED.sha256 pins a sha256 of each of those
 * files, by its path in src/common, the folder's tests included;
 * fg-cw-backend keeps no copy of the folder's tests, which run in
 * fg-gas-backend.
 *
 * Usage: npm run explore:hash, after changing a shared file in
 * fg-gas-backend; then copy the changed files and SHARED.sha256 to
 * fg-cw-backend.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMON_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/common",
);
export const SHARED_DIR = join(COMMON_DIR, "explore");
const BUCKETS_DIR = join(COMMON_DIR, "buckets");
export const HASH_FILE = "SHARED.sha256";

export const isTestFile = (path) => {
  const name = basename(path);

  return name.endsWith(".test.js") || name.startsWith("test-");
};

const RELATIVE_IMPORT = /\bfrom\s+"(\.{1,2}\/[^"]+)"/g;

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)].map(([, path]) =>
    resolve(dirname(file), path),
  );

const isBucketsFile = (file) => dirname(file) === BUCKETS_DIR;

// The buckets files the folder's code imports, and those they import in turn.
const bucketsFilesOf = (files) => {
  const found = new Set();
  const toRead = [...files];

  while (toRead.length) {
    const reached = importsOf(toRead.pop()).filter(
      (file) => isBucketsFile(file) && !found.has(file),
    );

    reached.forEach((file) => found.add(file));
    toRead.push(...reached);
  }

  return [...found];
};

const sharedFiles = () => {
  const own = readdirSync(SHARED_DIR)
    .filter((name) => name !== HASH_FILE)
    .map((name) => join(SHARED_DIR, name));
  const code = own.filter((file) => !isTestFile(file));

  return [...own, ...bucketsFilesOf(code)];
};

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export const presentHashes = () =>
  new Map(
    sharedFiles().map((file) => [relative(COMMON_DIR, file), sha256(file)]),
  );

export const pinnedHashes = () =>
  new Map(
    readFileSync(join(SHARED_DIR, HASH_FILE), "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("  ").reverse()),
  );

const hashLines = (hashes) =>
  [...hashes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join("");

const regenerate = () => {
  const present = presentHashes();
  const hasTests = [...present.keys()].some(isTestFile);
  const keptTests = hasTests
    ? []
    : [...pinnedHashes()].filter(([path]) => isTestFile(path));

  writeFileSync(
    join(SHARED_DIR, HASH_FILE),
    hashLines(new Map([...present, ...keptTests])),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  regenerate();
}
