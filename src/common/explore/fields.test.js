import { describe, expect, it } from "vitest";
import {
  pathsOfQuery,
  projectionOf,
  readPathsOf,
  readersFor,
  usedReaders,
} from "./fields.js";

const source = {
  name: "events",
  added: { service: (_, { service }) => [service] },
};

const query = (overrides = {}) => ({
  columns: [{ path: "eventType" }],
  where: null,
  unwind: [],
  groupBy: null,
  orderBy: null,
  ...overrides,
});

describe("readersFor", () => {
  it("reads a path from the record, by its segments", () => {
    expect(readersFor(source).readerOf({ path: "event.data.sbi" })).toEqual({
      path: "event.data.sbi",
      names: ["event", "data", "sbi"],
      readable: expect.any(Function),
      charge: undefined,
    });
  });

  it("reads what the source adds to each record from the box", () => {
    const reader = readersFor(source).readerOf({ path: "service" });

    expect(reader.names).toBeUndefined();
    expect(reader.read({}, { service: "CW" })).toEqual(["CW"]);
  });

  it("reads every path from the record for a source that adds nothing", () => {
    expect(readersFor({ name: "x" }).readerOf({ path: "service" })).toEqual({
      path: "service",
      names: ["service"],
      readable: expect.any(Function),
      charge: undefined,
    });
  });
});

describe("pathsOfQuery", () => {
  it("lists the paths of the filter, unwinds, columns, group and sort, never *", () => {
    expect(
      pathsOfQuery(
        query({
          where: {
            all: [
              { path: "status", op: "eq", values: ["A"] },
              { not: { path: "refs", op: "filled", values: [] } },
            ],
          },
          unwind: [{ path: "event.data.items", preserve: false }],
          columns: [{ path: "eventType" }, { fn: "count", path: "*", as: "n" }],
          groupBy: { path: "eventType" },
          orderBy: { path: "publicationDate", fn: null, desc: false },
        }),
      ),
    ).toEqual([
      "status",
      "refs",
      "event.data.items",
      "eventType",
      "eventType",
      "publicationDate",
    ]);
  });
});

describe("usedReaders and projectionOf", () => {
  it("projects only the paths read, nothing the box adds, and no path below another", () => {
    const readers = readersFor(source);
    const used = usedReaders(
      query({
        where: { path: "event.data", op: "filled", values: [] },
        columns: [{ path: "event.data.sbi" }, { path: "service" }],
      }),
      readers,
    );

    expect(projectionOf([...readPathsOf(used), "publicationDate"])).toEqual({
      "event.data": 1,
      publicationDate: 1,
    });
  });

  it("projects a path down to its first position, which Mongo reads as a key", () => {
    const used = usedReaders(
      query({ columns: [{ path: "phases.0.code" }, { path: "a.b.2" }] }),
      readersFor({ name: "x" }),
    );

    expect(projectionOf(readPathsOf(used))).toEqual({ phases: 1, "a.b": 1 });
  });
});
