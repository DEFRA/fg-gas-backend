import { BSON, ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCollection } from "./read-only.js";
import { RAW_CAP_BYTES, readStoredDocuments } from "./stored-document.js";

vi.mock("./read-only.js", () => ({ readCollection: vi.fn() }));

const RECORD = { _id: new ObjectId(), ref: "r-1", n: 1 };

let aggregate;

const replying = (replies) => {
  aggregate = vi.fn(() => ({ toArray: async () => replies }));
  readCollection.mockReturnValue({ aggregate });
};

beforeEach(() => replying([]));

const read = (options = {}) =>
  readStoredDocuments("records", {
    match: { ref: "r-1" },
    maxBytes: RAW_CAP_BYTES,
    maxTimeMS: 1500,
    readPreference: "primary",
    ...options,
  });

const sentStages = () => aggregate.mock.calls[0][0];
const sentDocument = () => sentStages().at(-1).$project.d.$cond[1];

describe("readStoredDocuments", () => {
  it("is capped at 1 MiB for a Raw view", () => {
    expect(RAW_CAP_BYTES).toBe(1024 * 1024);
  });

  it("reads only through Explore's read-only view, raw", async () => {
    await read();

    expect(readCollection).toHaveBeenCalledWith("records");
    expect(aggregate).toHaveBeenCalledWith(expect.any(Array), {
      raw: true,
      maxTimeMS: 1500,
      readPreference: "primary",
    });
  });

  it("sends the record's size, and the record only within maxBytes", async () => {
    await read({ maxBytes: 4096 });

    expect(sentStages()).toEqual([
      { $match: { ref: "r-1" } },
      {
        $project: {
          _id: 0,
          s: { $bsonSize: "$$ROOT" },
          d: {
            $cond: [
              { $lte: [{ $bsonSize: "$$ROOT" }, 4096] },
              "$$ROOT",
              "$$REMOVE",
            ],
          },
        },
      },
    ]);
  });

  it("limits the records read when asked", async () => {
    await read({ limit: 1 });

    expect(sentStages()[1]).toEqual({ $limit: 1 });
  });

  it("unsets and sets inside the projection, after the size is measured", async () => {
    await read({ unset: ["comments"], set: { id: "masked" } });

    expect(sentStages()).toHaveLength(2);
    expect(sentDocument()).toEqual({
      $setField: {
        field: { $literal: "id" },
        input: {
          $unsetField: { field: { $literal: "comments" }, input: "$$ROOT" },
        },
        value: "masked",
      },
    });
  });

  it("gives each record's size and its own bytes, copied out of the reply", async () => {
    const reply = BSON.serialize({ s: 77, d: RECORD });

    replying([reply]);

    const [found] = await read();

    expect(found.storedBytes).toBe(77);
    expect(found.document).toEqual(Buffer.from(BSON.serialize(RECORD)));

    reply.fill(0);

    expect(BSON.deserialize(found.document)).toEqual(RECORD);
  });

  it("gives a record past maxBytes as its size alone", async () => {
    replying([BSON.serialize({ s: RAW_CAP_BYTES + 1 })]);

    expect(await read()).toEqual([
      { storedBytes: RAW_CAP_BYTES + 1, document: null },
    ]);
  });
});
