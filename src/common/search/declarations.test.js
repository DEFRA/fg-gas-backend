import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_DECLARATION,
  createDeclarationCache,
  declarationOf,
  isBuiltLater,
} from "./declarations.js";
import { sig, stampOf } from "./signature.js";

const search = {
  fields: [
    { key: "businessName", label: "Business name", path: "$.answers.name" },
  ],
};

describe("declarationOf", () => {
  it("is the fields with their signature, stamped with its count of config changes", () => {
    const fields = [{ ...search.fields[0], match: "exact" }];

    expect(declarationOf(search, 4)).toEqual({
      fields,
      sig: sig(fields),
      stamp: stampOf(4),
    });
  });

  it("is no fields for no declaration, older than any known one", () => {
    expect(NO_DECLARATION).toEqual({
      fields: [],
      sig: sig([]),
      stamp: stampOf(0),
    });
  });
});

describe("isBuiltLater", () => {
  const declaration = declarationOf(search, 4);

  it("is a stored document built from a later declaration", () => {
    expect(isBuiltLater({ stamp: stampOf(5) }, declaration)).toBe(true);
  });

  it("is not one built from the same or an earlier one, nor none at all", () => {
    expect(isBuiltLater({ stamp: declaration.stamp }, declaration)).toBe(false);
    expect(isBuiltLater({ stamp: stampOf(0) }, declaration)).toBe(false);
    expect(isBuiltLater({}, declaration)).toBe(false);
    expect(isBuiltLater(null, declaration)).toBe(false);
  });
});

describe("createDeclarationCache", () => {
  let list;

  beforeEach(() => {
    vi.useFakeTimers();
    list = vi.fn().mockResolvedValue([
      { value: "grant-a", search, change: 4 },
      { value: "grant-b", search: null, change: 2 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers each value's declaration, and none for a value it does not list", async () => {
    const cache = createDeclarationCache(list);

    expect(await cache.forValue("grant-a")).toEqual(declarationOf(search, 4));
    expect(await cache.forValue("grant-b")).toEqual(declarationOf(null, 2));
    expect(await cache.forValue("grant-c")).toEqual(NO_DECLARATION);
    expect([...(await cache.current()).keys()]).toEqual(["grant-a", "grant-b"]);
  });

  it("lists once within 30 seconds, and again after", async () => {
    const cache = createDeclarationCache(list);

    await Promise.all([cache.forValue("grant-a"), cache.forValue("grant-b")]);
    vi.advanceTimersByTime(29_999);
    await cache.forValue("grant-a");

    expect(list).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await cache.forValue("grant-a");

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("lists again when asked for a fresh answer, and keeps it for the others", async () => {
    const cache = createDeclarationCache(list);

    await cache.forValue("grant-a");
    await cache.forValue("grant-a", { fresh: true });
    await cache.current();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shares one fresh list among the callers asking while it runs", async () => {
    const cache = createDeclarationCache(list);

    await cache.forValue("grant-a");
    await Promise.all([
      cache.forValue("grant-a", { fresh: true }),
      cache.forValue("grant-b", { fresh: true }),
      cache.current({ fresh: true }),
    ]);

    expect(list).toHaveBeenCalledTimes(2);

    await cache.current({ fresh: true });

    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not keep a failed list", async () => {
    list.mockRejectedValueOnce(new Error("no primary"));
    const cache = createDeclarationCache(list);

    await expect(cache.forValue("grant-a")).rejects.toThrow("no primary");
    expect((await cache.forValue("grant-a")).fields).toEqual(
      declarationOf(search).fields,
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});
