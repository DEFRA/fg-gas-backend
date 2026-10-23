import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseStartDate } from "../../migrations/20261023100000-normalise-grant-start-date.js";
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

const seed = (version, startDate) => ({
  _id: new ObjectId(),
  code: "woodland",
  version,
  metadata: { description: "Woodland", startDate },
  phases: [],
});

const startDates = async () =>
  Object.fromEntries(
    (await grants.find({ code: "woodland" }).toArray()).map((grant) => [
      grant.version,
      grant.metadata.startDate,
    ]),
  );

const migrate = () => normaliseStartDate(client.db());

describe("normalising grant start dates to ISO strings", () => {
  it("rewrites a Date and an unparsed extended JSON date as the ISO string of its instant", async () => {
    await grants.insertMany([
      seed("0.0.0", new Date("2023-01-01T00:00:00.000Z")),
      seed("1.0.0", { $date: "2100-01-01T10:00:00Z" }),
      seed("1.1.0", { $date: "2100-05-01T00:00:00+01:00" }),
    ]);

    await migrate();

    expect(await startDates()).toEqual({
      "0.0.0": "2023-01-01T00:00:00.000Z",
      "1.0.0": "2100-01-01T10:00:00.000Z",
      "1.1.0": "2100-04-30T23:00:00.000Z",
    });
  });

  it("rewrites a four-digit year as the ISO string of its first instant", async () => {
    await grants.insertMany([seed("1.0.0", 2026), seed("2.0.0", 2027.0)]);

    await migrate();

    expect(await startDates()).toEqual({
      "1.0.0": "2026-01-01T00:00:00.000Z",
      "2.0.0": "2027-01-01T00:00:00.000Z",
    });
  });

  it("leaves a start date stored as a string, and the rest of the grant, as stored", async () => {
    const stored = [
      seed("1.0.0", "2026-04-01T00:00:00.000Z"),
      seed("2.0.0", "2026-04-01T00:00:00Z"),
    ];
    await grants.insertMany(stored);

    await migrate();

    expect(await grants.find({ code: "woodland" }).toArray()).toStrictEqual(
      stored,
    );
  });

  it("leaves a value that is no instant as stored, and counts it", async () => {
    const info = vi.spyOn(logger, "info");
    await grants.insertMany([
      seed("1.0.0", { $date: "not a date" }),
      seed("2.0.0", { published: "2026-04-01" }),
      seed("3.0.0", new Date("2023-01-01T00:00:00.000Z")),
      seed("4.0.0", 1700000000000),
      seed("5.0.0", 2026.5),
      seed("6.0.0", [2026]),
      seed("7.0.0", [{ $date: "2100-01-01T10:00:00Z" }]),
    ]);

    await migrate();

    expect(await startDates()).toEqual({
      "1.0.0": { $date: "not a date" },
      "2.0.0": { published: "2026-04-01" },
      "3.0.0": "2023-01-01T00:00:00.000Z",
      "4.0.0": 1700000000000,
      "5.0.0": 2026.5,
      "6.0.0": [2026],
      "7.0.0": [{ $date: "2100-01-01T10:00:00Z" }],
    });
    expect(info).toHaveBeenCalledWith(
      "Normalised 1 grant start dates to ISO strings, 6 not an instant left as stored",
    );
  });

  it("changes nothing when run again", async () => {
    await grants.insertMany([
      seed("0.0.0", new Date("2023-01-01T00:00:00.000Z")),
      seed("1.0.0", { $date: "2100-01-01T10:00:00Z" }),
    ]);
    await migrate();
    const once = await grants.find({ code: "woodland" }).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await grants.find({ code: "woodland" }).toArray()).toStrictEqual(
      once,
    );
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 grant start dates to ISO strings, 0 not an instant left as stored",
    );
  });
});
