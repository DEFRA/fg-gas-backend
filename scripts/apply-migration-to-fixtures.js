#!/usr/bin/env node
/**
 * Applies a migration's grant "full replace" operations (deleteOne + insertOne
 * on the "grants" collection, keyed by code) to the corresponding grant
 * definition fixture in test/fixtures/, so migrations and the checked-in
 * fixtures used by api.http/tests stay in sync.
 *
 * Usage: node scripts/apply-migration-to-fixtures.js <path-to-migration>
 *
 * Only the deleteOne+insertOne full-replace pattern is supported - the one
 * every "woodland" grant migration uses. Migrations that patch a grant with
 * updateOne/updateMany ($set/$unset) are reported as skipped rather than
 * applied: most of those target frps-private-beta, which has no fixture at
 * all, and dot-path patching isn't implemented here.
 *
 * Grant codes with no entry in GRANT_CODE_TO_FIXTURE are skipped with a
 * warning, not an error - this is the expected/common case (e.g. every
 * frps-private-beta migration).
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../test/fixtures",
);

const GRANT_CODE_TO_FIXTURE = {
  "pigs-might-fly": "pmf-grant-definition.json",
  woodland: "wmp/woodland.json",
};

const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error(
    "Usage: node scripts/apply-migration-to-fixtures.js <migration-file>",
  );
  process.exit(1);
}

const captured = [];

const collectionMock = (name) => ({
  deleteOne: (filter) => {
    captured.push({ collection: name, op: "deleteOne", filter });
    return Promise.resolve({ acknowledged: true, deletedCount: 1 });
  },
  insertOne: (doc) => {
    captured.push({ collection: name, op: "insertOne", doc });
    return Promise.resolve({ acknowledged: true, insertedId: doc._id ?? null });
  },
  insertMany: (docs) => {
    captured.push({ collection: name, op: "insertMany", docs });
    return Promise.resolve({ acknowledged: true });
  },
  updateOne: (filter, update) => {
    captured.push({ collection: name, op: "updateOne", filter, update });
    return Promise.resolve({ acknowledged: true });
  },
  updateMany: (filter, update) => {
    captured.push({ collection: name, op: "updateMany", filter, update });
    return Promise.resolve({ acknowledged: true });
  },
  find: () => ({ toArray: () => Promise.resolve([]) }),
  createIndex: () => Promise.resolve(),
  drop: () => Promise.resolve(),
});

const mockDb = { collection: collectionMock };

const { up } = await import(resolve(process.cwd(), migrationPath));
await up(mockDb);

const applyInsert = (doc) => {
  const code = doc.code;
  const fixtureName = GRANT_CODE_TO_FIXTURE[code];

  if (!fixtureName) {
    console.warn(
      `No fixture mapped for grant code "${code}" - skipping (expected for grants with no checked-in fixture, e.g. frps-private-beta)`,
    );
    return false;
  }

  const fixturePath = resolve(fixturesDir, fixtureName);
  writeFileSync(fixturePath, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Updated ${fixturePath}`);
  return true;
};

const warnUnsupportedPatch = ({ op, filter }) => {
  console.warn(
    `Skipping ${op} on "grants" (filter: ${JSON.stringify(filter)}) - this script only supports full-replace (deleteOne+insertOne) migrations. Update the fixture by hand if it targets a grant with a fixture.`,
  );
};

let updated = 0;

for (const entry of captured) {
  if (entry.collection !== "grants") {
    continue;
  }

  if (entry.op === "insertOne" && applyInsert(entry.doc)) {
    updated++;
  }

  if (entry.op === "updateOne" || entry.op === "updateMany") {
    warnUnsupportedPatch(entry);
  }
}

console.log(`\nDone - ${updated} fixture(s) updated.`);
