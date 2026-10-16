import { beforeEach, describe, expect, it } from "vitest";
import {
  clearBuckets,
  findBucket,
  listBuckets,
  registerBucket,
} from "./registry.js";

describe("registry", () => {
  beforeEach(() => {
    clearBuckets();
  });

  it("finds a registered bucket by id", () => {
    const bucket = { id: "test.one", order: 10 };

    registerBucket(bucket);

    expect(findBucket("test.one")).toBe(bucket);
  });

  it("answers undefined for an id it does not hold", () => {
    expect(findBucket("test.none")).toBeUndefined();
  });

  it("refuses a second bucket with the same id", () => {
    registerBucket({ id: "test.one", order: 10 });

    expect(() => registerBucket({ id: "test.one", order: 20 })).toThrow(
      'Bucket "test.one" is already registered',
    );
  });

  it("lists buckets sorted by order", () => {
    registerBucket({ id: "test.two", order: 20 });
    registerBucket({ id: "test.one", order: 10 });

    expect(listBuckets().map(({ id }) => id)).toEqual(["test.one", "test.two"]);
  });

  it("holds nothing once cleared", () => {
    registerBucket({ id: "test.one", order: 10 });

    clearBuckets();

    expect(listBuckets()).toEqual([]);
  });
});
