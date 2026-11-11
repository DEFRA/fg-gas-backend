import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../mongo-client.js";
import { countBins } from "./bins.js";
import { COUNT_CAP } from "./engine.js";
import { ledBucket, testBucket } from "./test-bucket.js";

vi.mock("../logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("../mongo-client.js", () => ({ db: { collection: vi.fn() } }));

const HOUR = 60 * 60 * 1000;
const FROM = "2026-10-09T00:30:00.000Z";
const TO = "2026-10-09T06:30:00.000Z";

let collection;

const answer = (groups) => {
  collection = {
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => groups) })),
  };
  db.collection.mockReturnValue(collection);
};

const count = (bucket = testBucket(), window = { from: FROM, to: TO }) =>
  countBins(bucket, {
    where: { status: "DEAD_LETTER" },
    ...window,
    binMs: 2 * HOUR,
  });

const pipelineOf = () => collection.aggregate.mock.calls[0][0];

describe("countBins", () => {
  beforeEach(() => answer([]));

  it("answers every bin from `from` to `to`, oldest first, empty ones as 0", async () => {
    answer([{ _id: 1, count: 4 }]);

    expect(await count()).toEqual([
      {
        from: "2026-10-09T00:30:00.000Z",
        to: "2026-10-09T02:30:00.000Z",
        count: 0,
        capped: false,
      },
      {
        from: "2026-10-09T02:30:00.000Z",
        to: "2026-10-09T04:30:00.000Z",
        count: 4,
        capped: false,
      },
      {
        from: "2026-10-09T04:30:00.000Z",
        to: "2026-10-09T06:30:00.000Z",
        count: 0,
        capped: false,
      },
    ]);
  });

  it("ends a last bin that does not fit at `to`", async () => {
    const bins = await count(testBucket(), {
      from: FROM,
      to: "2026-10-09T03:30:00.000Z",
    });

    expect(bins.map(({ to }) => to)).toEqual([
      "2026-10-09T02:30:00.000Z",
      "2026-10-09T03:30:00.000Z",
    ]);
  });

  it("stops a bin at the count cap and says so", async () => {
    answer([
      { _id: 0, count: COUNT_CAP + 1 },
      { _id: 2, count: COUNT_CAP },
    ]);

    const bins = await count();

    expect(bins[0]).toMatchObject({ count: COUNT_CAP, capped: true });
    expect(bins[2]).toMatchObject({ count: COUNT_CAP, capped: false });
  });

  it("reads in one aggregation on the status line, within the window", async () => {
    await count();

    expect(collection.aggregate).toHaveBeenCalledOnce();
    expect(pipelineOf()[0]).toEqual({
      $match: {
        $and: [
          { status: "DEAD_LETTER" },
          {
            publicationDate: { $gte: new Date(FROM), $lte: new Date(TO) },
          },
        ],
      },
    });
    expect(collection.aggregate.mock.calls[0][1]).toEqual({
      hint: { status: 1, publicationDate: -1, _id: -1 },
      maxTimeMS: expect.any(Number),
    });
  });

  it("bins by milliseconds since `from`, a row at `to` in the last bin", async () => {
    await count();

    expect(pipelineOf()[1]).toEqual({
      $group: {
        _id: {
          $min: [
            2,
            {
              $floor: {
                $divide: [
                  { $subtract: ["$publicationDate", new Date(FROM)] },
                  2 * HOUR,
                ],
              },
            },
          ],
        },
        count: { $sum: 1 },
      },
    });
  });

  it("reads a time stored as text as a date, and bounds it as text", async () => {
    await count(
      testBucket({
        time: { field: "publicationDate", type: "isoString", label: "Rec" },
      }),
    );

    expect(JSON.stringify(pipelineOf()[0])).toContain(`"$gte":"${FROM}"`);
    expect(JSON.stringify(pipelineOf()[1])).toContain(
      '{"$toDate":"$publicationDate"}',
    );
  });

  it("fills a lead with every value it lists, as the list does", async () => {
    await count(ledBucket());

    expect(pipelineOf()[0].$match.$and).toContainEqual({
      eventType: { $in: ["case.create", "case.update.status", "audit", null] },
    });
  });

  it("refuses a read that ran out of time", async () => {
    collection.aggregate.mockReturnValue({
      toArray: vi.fn(async () => {
        throw Object.assign(new Error("timed out"), { code: 50 });
      }),
    });

    await expect(count()).rejects.toMatchObject({
      output: { payload: { reason: "TIMED_OUT" } },
    });
  });

  it("will not count without an index line for its filter", async () => {
    await expect(
      countBins(testBucket(), {
        where: { grantCode: "x" },
        from: FROM,
        to: TO,
        binMs: 2 * HOUR,
      }),
    ).rejects.toThrow('Bucket "test.outbox" has no index line for its bins');
  });
});
