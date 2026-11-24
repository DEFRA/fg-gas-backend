import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { READS, WRITE_STAGES } from "../../common/explore/read-only.js";
import { WRITES } from "../../../test/helpers/explore-read-only.js";
import { ACCUMULATORS, METHODS, STAGES } from "./language/allowlist.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXPLORE_DIRS = [
  "common/explore",
  "common/explore-sources",
  "grant-admin/explore",
  "grants/explore",
  "events/explore",
  "agreements/explore",
  "payments/explore",
];

const EXPLORE_FILES = [
  "grant-admin/repositories/cw-explore.repository.js",
  "grant-admin/routes/explore-query.route.js",
  "grant-admin/routes/explore-vocabulary.route.js",
  "grant-admin/schemas/explore.schema.js",
  "grant-admin/use-cases/explore-query.use-case.js",
  "grant-admin/use-cases/explore-vocabulary.use-case.js",
  "grant-admin/use-cases/load-explore-vocabulary.js",
];

const VIEW = "common/explore/read-only.js";

// Tests seed and spy on collections, so only what runs is scanned.
const isScanned = (path) => !path.endsWith(".test.js");

const filesIn = (dir) =>
  readdirSync(join(SRC, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)));

const scanned = () =>
  [...EXPLORE_DIRS.flatMap(filesIn), ...EXPLORE_FILES].filter(isScanned);

const textOf = (path) => readFileSync(join(SRC, path), "utf8");

const WRITE_CALL = new RegExp(
  String.raw`(\.\s*|\[\s*["'\x60])(${WRITES.join("|")})\b`,
);

const WRITE_STAGE = /\$(out|merge)\b/;

// The view names the write stages only to refuse them.
const STAGE_ALLOWANCE = new Map([
  [VIEW, 'export const WRITE_STAGES = Object.freeze(["$out", "$merge"]);'],
]);

const linesMatching = (path, pattern) =>
  textOf(path)
    .split("\n")
    .filter((line) => pattern.test(line));

const READ_STAGES = new Set([
  "$match",
  "$unwind",
  "$group",
  "$project",
  "$sort",
  "$limit",
  "$skip",
  "$count",
  "$facet",
  "$lookup",
  "$unionWith",
]);

describe("Explore reads only", () => {
  it("scans every Explore file", () => {
    expect(scanned()).toEqual(expect.arrayContaining([VIEW, ...EXPLORE_FILES]));
    expect(scanned().length).toBeGreaterThan(40);
  });

  it("calls no write method", () => {
    const writing = scanned().flatMap((path) =>
      linesMatching(path, WRITE_CALL).map((line) => `${path}: ${line}`),
    );

    expect(writing).toEqual([]);
  });

  it("names no write stage, but where the view refuses them", () => {
    const writing = scanned().flatMap((path) =>
      linesMatching(path, WRITE_STAGE)
        .filter((line) => line.trim() !== STAGE_ALLOWANCE.get(path))
        .map((line) => `${path}: ${line}`),
    );

    expect(writing).toEqual([]);
  });

  it("takes collections in only through the read-only view", () => {
    const opening = scanned()
      .filter((path) => path !== VIEW)
      .flatMap((path) =>
        linesMatching(
          path,
          /mongo-client|\bdb\s*\.\s*collection\b|\bcollectionOf\b.*buckets|\bcollectionOf,/,
        ).map((line) => `${path}: ${line}`),
      );

    expect(opening).toEqual([]);
  });

  it("exposes only reads, and the language allows only reads", () => {
    expect(READS.some((name) => WRITES.includes(name))).toBe(false);
    expect([...METHODS.keys()].some((name) => WRITES.includes(name))).toBe(
      false,
    );
    expect([...STAGES.keys()].every((stage) => READ_STAGES.has(stage))).toBe(
      true,
    );
    expect(
      [...STAGES.keys(), ...ACCUMULATORS.keys()].some((name) =>
        WRITE_STAGES.includes(name),
      ),
    ).toBe(false);
  });
});
