import { describe, expect, it, vi } from "vitest";
import { readStoredValues } from "../buckets/engine.js";
import { describeSource, knownValuesOf } from "./describe.js";
import { testSource } from "./test-source.js";

vi.mock("../buckets/engine.js", () => ({
  readStoredValues: vi.fn(),
  readTimeoutMs: () => 1000,
}));

describe("describeSource", () => {
  const entry = (path, overrides = {}) => ({
    path,
    type: "text",
    index: null,
    closed: false,
    within: null,
    ...overrides,
  });

  it("says what the source reads and how each known path is read, never its functions", () => {
    const described = describeSource(testSource());

    expect(described).toMatchObject({
      name: "events",
      service: "Test",
      size: "big",
      noun: { one: "event", many: "events" },
      time: "publicationDate",
      star: ["publicationDate", "box", "eventType", "status"],
      answersAt: "payload.answers",
    });
    expect(described.roots).toEqual([...testSource().roots, "box"]);
    expect(described.paths).toEqual([
      entry("ref", { index: "ref", scans: 1 }),
      entry("refs", { index: "refs", scans: 1 }),
      entry("msg", { index: "ref", scans: 1 }),
      entry("status", { index: "fact", closed: true }),
      entry("eventType", { index: "fact", closed: true }),
      entry("code", { index: "fact" }),
      entry("version", { index: "fact", within: "code" }),
      entry("grantCode"),
      entry("publicationDate", {
        type: "date",
        index: "time",
        stored: "date",
      }),
      entry("box", { index: "box" }),
      entry("attempts", { type: "number" }),
    ]);
    expect(JSON.stringify(described)).not.toContain("open");
  });

  it("drops an index its bucket doesn't declare, a time on another path too", () => {
    const source = {
      ...testSource(),
      paths: [
        { path: "createdAt", index: { time: true } },
        { path: "other", index: { ref: "nope" } },
        { path: "x", index: { fact: "nope" } },
      ],
    };

    expect(describeSource(source).paths.map(({ index }) => index)).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("knownValuesOf", () => {
  it("gives each closed path its declared or stored values, open paths none", async () => {
    readStoredValues.mockResolvedValue(["g1", 2]);

    const values = await knownValuesOf(testSource());

    expect(values.get("status")[0]).toEqual({
      value: expect.any(String),
      label: expect.any(String),
    });
    expect(values.get("code")).toEqual([
      { value: "g1", label: "g1" },
      { value: "2", label: "2" },
    ]);
    expect(values.has("ref")).toBe(false);
    expect(values.has("attempts")).toBe(false);
    expect(readStoredValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test.outbox" }),
      "code",
      1000,
    );
  });

  it("keeps stored values in the order the index holds them", async () => {
    readStoredValues.mockResolvedValue(["g2", "g1", "g3"]);

    const values = await knownValuesOf(testSource());

    expect(values.get("code").map(({ value }) => value)).toEqual([
      "g2",
      "g1",
      "g3",
    ]);
  });

  it("gives a stored field with too many values to list none", async () => {
    readStoredValues.mockResolvedValue(null);

    expect((await knownValuesOf(testSource())).has("code")).toBe(false);
  });
});
