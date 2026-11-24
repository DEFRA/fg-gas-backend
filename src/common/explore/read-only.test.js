import { Collection, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import {
  READS,
  READ_OPTIONS,
  WRITE_STAGES,
  readOnly,
  writeStageIn,
} from "./read-only.js";
import {
  COLLECTION_METHODS,
  OUTSIDE_VIEW,
} from "../../../test/helpers/explore-read-only.js";

const fakeCursor = () => ({
  toArray: vi.fn(async () => [{ n: 1 }]),
  close: vi.fn(async () => {}),
  async *[Symbol.asyncIterator]() {
    yield { n: 1 };
  },
  addStage: vi.fn(),
  out: vi.fn(),
  merge: vi.fn(),
  client: {},
});

const fakeCollection = () =>
  Object.fromEntries(
    COLLECTION_METHODS.map((name) => [
      name,
      vi.fn(() => (["find", "aggregate"].includes(name) ? fakeCursor() : 1)),
    ]),
  );

describe("readOnly", () => {
  it("is frozen and exposes only reads, each a method a collection has", () => {
    const view = readOnly(fakeCollection());

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.keys(view)).toEqual(READS);
    expect(
      READS.every((name) => typeof Collection.prototype[name] === "function"),
    ).toBe(true);
    expect(Object.keys(READ_OPTIONS)).toEqual(READS);
  });

  it.each(OUTSIDE_VIEW)(
    "throws on %s and never reaches the collection",
    (name) => {
      const collection = fakeCollection();
      const view = readOnly(collection);

      expect(() => view[name]({})).toThrow(TypeError);
      expect(() => {
        view[name] = collection[name];
      }).toThrow(TypeError);
      expect(collection[name]).not.toHaveBeenCalled();
    },
  );

  it("passes reads on to the collection", async () => {
    const collection = fakeCollection();
    const view = readOnly(collection);

    await view.countDocuments({ a: 1 }, { limit: 2 });
    await view.distinct("a", {});
    await view.estimatedDocumentCount({});

    expect(collection.countDocuments).toHaveBeenCalledWith(
      { a: 1 },
      { limit: 2 },
    );
    expect(collection.distinct).toHaveBeenCalledWith("a", {}, {});
    expect(collection.estimatedDocumentCount).toHaveBeenCalledWith({});
  });

  it.each(["find", "aggregate"])(
    "gives %s's cursor only its reads, never its stages or client",
    async (name) => {
      const view = readOnly(fakeCollection());
      const cursor = view[name](name === "find" ? {} : [{ $match: {} }]);
      const seen = [];

      for await (const doc of cursor) {
        seen.push(doc);
      }

      expect(Object.isFrozen(cursor)).toBe(true);
      expect(Object.keys(cursor)).toEqual(["toArray", "close"]);
      expect(await cursor.toArray()).toEqual([{ n: 1 }]);
      expect(seen).toEqual([{ n: 1 }]);
      expect(cursor.addStage).toBeUndefined();
      expect(cursor.out).toBeUndefined();
      expect(cursor.merge).toBeUndefined();
      expect(cursor.client).toBeUndefined();
    },
  );

  const WRITING = [
    [[{ $out: "copy" }]],
    [[{ $match: {} }, { $merge: { into: "copy" } }]],
    [[{ $facet: { a: [{ $out: "copy" }] } }]],
    [[{ $lookup: { from: "x", as: "y", pipeline: [{ $merge: "copy" }] } }]],
    [[{ $unionWith: { coll: "x", pipeline: [{ $out: "copy" }] } }]],
    [
      [
        {
          $facet: {
            a: [
              {
                $lookup: {
                  pipeline: [{ $unionWith: { pipeline: [{ $out: "c" }] } }],
                },
              },
            ],
          },
        },
      ],
    ],
  ];

  it.each(WRITING)(
    "refuses a pipeline that writes, at any depth: %j",
    (pipeline) => {
      const collection = fakeCollection();

      expect(() => readOnly(collection).aggregate(pipeline)).toThrow(
        /Explore only reads: \$(out|merge) is not a read/,
      );
      expect(collection.aggregate).not.toHaveBeenCalled();
    },
  );

  it("sends a pipeline that only reads", async () => {
    const collection = fakeCollection();
    const pipeline = [
      { $match: { a: { $in: [1, 2] } } },
      { $group: { _id: "$a", all: { $mergeObjects: "$$ROOT" } } },
      { $limit: 101 },
    ];

    await readOnly(collection).aggregate(pipeline, { maxTimeMS: 5 }).toArray();

    expect(collection.aggregate).toHaveBeenCalledWith(pipeline, {
      maxTimeMS: 5,
    });
  });
});

describe("readOnly's options", () => {
  const CALLS = {
    find: (view, options) => view.find({}, options),
    aggregate: (view, options) => view.aggregate([{ $match: {} }], options),
    countDocuments: (view, options) => view.countDocuments({}, options),
    distinct: (view, options) => view.distinct("a", {}, options),
    estimatedDocumentCount: (view, options) =>
      view.estimatedDocumentCount(options),
  };
  const OPTIONS_AT = {
    find: 1,
    aggregate: 1,
    countDocuments: 1,
    distinct: 2,
    estimatedDocumentCount: 0,
  };

  it.each([
    ["aggregate", "out"],
    ["countDocuments", "out"],
    ["aggregate", "bypassDocumentValidation"],
    ["aggregate", "writeConcern"],
    ["find", "comment"],
    ["distinct", "maxTimeMS"],
    ["estimatedDocumentCount", "hint"],
  ])("refuses %s's %s option and never reaches the collection", (name, key) => {
    const collection = fakeCollection();

    expect(() => CALLS[name](readOnly(collection), { [key]: "copy" })).toThrow(
      `Explore only reads: ${name} takes no ${key} option`,
    );
    expect(collection[name]).not.toHaveBeenCalled();
  });

  it.each(READS)("sends %s a copy of the options it allows", (name) => {
    const collection = fakeCollection();
    const options = Object.fromEntries(
      READ_OPTIONS[name].map((key) => [key, 1]),
    );

    CALLS[name](readOnly(collection), options);
    options.out = "copy";

    const sent = collection[name].mock.calls[0][OPTIONS_AT[name]];

    expect(sent).toEqual(
      Object.fromEntries(READ_OPTIONS[name].map((key) => [key, 1])),
    );
    expect(sent).not.toBe(options);
  });

  it("sends the pipeline it checked, not one changed after", () => {
    const collection = fakeCollection();
    const pipeline = [{ $match: { a: 1 } }, { $facet: { b: [] } }];

    readOnly(collection).aggregate(pipeline);
    pipeline.push({ $out: "late" });
    pipeline[1].$facet.b.push({ $merge: "late" });
    pipeline[0].$out = "late";

    const [[sent]] = collection.aggregate.mock.calls;

    expect(sent).toEqual([{ $match: { a: 1 } }, { $facet: { b: [] } }]);
    expect(writeStageIn(sent)).toBe(null);
  });

  it("keeps a pipeline's values as they are", () => {
    const collection = fakeCollection();
    const id = new ObjectId();
    const at = new Date(0);

    readOnly(collection).aggregate([{ $match: { _id: id, at } }]);

    const [[[{ $match }]]] = collection.aggregate.mock.calls;

    expect($match._id).toBe(id);
    expect($match.at).toBe(at);
  });
});

describe("writeStageIn", () => {
  it("names the write stage a pipeline holds, or none", () => {
    expect(WRITE_STAGES).toEqual(["$out", "$merge"]);
    expect(writeStageIn([{ $group: { _id: "$out" } }])).toBe(null);
    expect(writeStageIn([{ $facet: { a: [{ $merge: "x" }] } }])).toBe("$merge");
  });
});
