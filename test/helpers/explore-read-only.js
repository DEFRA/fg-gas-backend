import { Collection } from "mongodb";
import { expect, vi } from "vitest";
import {
  READS,
  READ_OPTIONS,
  writeStageIn,
} from "../../src/common/explore/read-only.js";

const methodsOf = (prototype) =>
  Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      name !== "constructor" &&
      typeof Object.getOwnPropertyDescriptor(prototype, name).value ===
        "function",
  );

// The driver's collection methods that only read. Any other it has, or
// gains, is taken to write.
const DRIVER_READS = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "distinct",
  "estimatedDocumentCount",
  "count",
  "options",
  "isCapped",
  "listIndexes",
  "indexExists",
  "indexInformation",
  "indexes",
  "listSearchIndexes",
  "watch",
];

export const COLLECTION_METHODS = methodsOf(Collection.prototype);

export const WRITES = COLLECTION_METHODS.filter(
  (name) => !DRIVER_READS.includes(name),
);

export const OUTSIDE_VIEW = COLLECTION_METHODS.filter(
  (name) => !READS.includes(name),
);

const OPTIONS_AT = {
  find: 1,
  aggregate: 1,
  countDocuments: 1,
  distinct: 2,
  estimatedDocumentCount: 0,
};

const ALLOWED = new Set(Object.values(READ_OPTIONS).flat());

// Every collection method spied on: each of the view's reads recorded with
// the stack it was made from.
export const spyCollections = () => {
  const reads = [];
  const others = OUTSIDE_VIEW.map((name) =>
    vi.spyOn(Collection.prototype, name),
  );

  READS.forEach((name) => {
    const read = Collection.prototype[name];

    vi.spyOn(Collection.prototype, name).mockImplementation(function (...args) {
      reads.push({ name, args, stack: new Error().stack });

      return read.apply(this, args);
    });
  });

  return { reads, others };
};

// Every read came through the view, with a read's options and a pipeline
// that writes nothing, and no other collection method was called.
export const expectReadsOnly = ({ reads, others }) => {
  expect(reads.length).toBeGreaterThan(0);
  reads.forEach(({ name, args, stack }) => {
    expect(stack).toContain("read-only.js");
    expect(
      Object.keys(args[OPTIONS_AT[name]] ?? {}).filter(
        (key) => !ALLOWED.has(key),
      ),
    ).toEqual([]);

    if (name === "aggregate") {
      expect(writeStageIn(args[0])).toBe(null);
    }
  });
  others.forEach((spy) => expect(spy).not.toHaveBeenCalled());
};
