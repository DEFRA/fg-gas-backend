import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseAmendablePositions } from "../../migrations/20261024110000-normalise-grant-amendable-positions.js";
import { logger } from "../../src/common/logger.js";

let client;
let grants;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

const seed = (version, amendablePositions) => ({
  _id: new ObjectId(),
  code: "grasslands",
  version,
  metadata: { description: "Grasslands", startDate: "2026-04-01T00:00:00Z" },
  phases: [],
  amendablePositions,
});

const amendablePositions = async () =>
  Object.fromEntries(
    (await grants.find({}).toArray()).map((grant) => [
      grant.version,
      grant.amendablePositions,
    ]),
  );

const migrate = () => normaliseAmendablePositions(client.db());

describe("normalising grants with no amendable positions to an empty list", () => {
  it("makes null or missing amendable positions an empty list", async () => {
    const { amendablePositions: _, ...missing } = seed("0.1.0", []);
    await grants.insertMany([seed("0.0.0", null), missing]);

    await migrate();

    expect(await amendablePositions()).toEqual({ "0.0.0": [], "0.1.0": [] });
  });

  it("leaves a grant's listed amendable positions, and the rest of it, as stored", async () => {
    const stored = [
      seed("1.0.0", ["PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW"]),
      seed("2.0.0", []),
      seed("3.0.0", [null, "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW"]),
    ];
    await grants.insertMany(stored);

    await migrate();

    expect(await grants.find({}).toArray()).toStrictEqual(stored);
  });

  it("counts the grants it normalised and those it left, and changes nothing when run again", async () => {
    await grants.insertMany([
      seed("0.0.0", null),
      seed("1.0.0", []),
      seed("2.0.0", "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW"),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();
    const once = await grants.find({}).toArray();
    await migrate();

    expect(await grants.find({}).toArray()).toStrictEqual(once);
    expect(info.mock.calls).toEqual([
      [
        "Normalised 1 grants with no amendable positions to an empty list, 1 not a list left as stored",
      ],
      [
        "Normalised 0 grants with no amendable positions to an empty list, 1 not a list left as stored",
      ],
    ]);
  });
});
