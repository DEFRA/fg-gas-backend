import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseApplicationTimestamps } from "../../migrations/20261005120000-normalise-application-timestamps.js";
import { logger } from "../../src/common/logger.js";

let client;
let applications;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
});

afterAll(async () => {
  await client?.close();
});

const seed = (clientRef, fields) => ({
  _id: new ObjectId(),
  clientRef,
  code: "woodland",
  createdAt: "2026-06-16T10:00:00.000Z",
  ...fields,
});

const byRef = async () =>
  Object.fromEntries(
    (await applications.find({}).toArray()).map((a) => [a.clientRef, a]),
  );

const migrate = () => normaliseApplicationTimestamps(client.db());

describe("normalising application submittedAt to Dates", () => {
  it("rewrites an offset or second-precision string as the Date of its instant", async () => {
    await applications.insertMany([
      seed("canonical", { submittedAt: "2026-06-16T10:04:00.456Z" }),
      seed("offset", { submittedAt: "2026-06-16T11:03:00+01:00" }),
      seed("seconds", { submittedAt: "2026-06-16T10:00:01Z" }),
    ]);

    await migrate();

    const rows = await byRef();
    expect(rows.canonical.submittedAt).toEqual(
      new Date("2026-06-16T10:04:00.456Z"),
    );
    expect(rows.offset.submittedAt).toEqual(
      new Date("2026-06-16T10:03:00.000Z"),
    );
    expect(rows.seconds.submittedAt).toEqual(
      new Date("2026-06-16T10:00:01.000Z"),
    );
  });

  it("leaves Dates, null and missing exactly as they are", async () => {
    await applications.insertMany([
      seed("date", { submittedAt: new Date("2026-06-16T10:04:00.456Z") }),
      seed("null", { submittedAt: null }),
      seed("missing", {}),
    ]);
    const before = await applications.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await applications.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application submittedAt values to Dates, 0 not an instant left as stored",
    );
  });

  it("leaves a value that is no instant as stored, and counts it", async () => {
    await applications.insertMany([
      seed("unparsable", { submittedAt: "not-an-instant" }),
      seed("number", { submittedAt: 1_750_000_000_000 }),
      seed("string", { submittedAt: "2026-06-16T10:00:01Z" }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byRef();
    expect(rows.unparsable.submittedAt).toBe("not-an-instant");
    expect(rows.number.submittedAt).toBe(1_750_000_000_000);
    expect(info).toHaveBeenCalledWith(
      "Normalised 1 application submittedAt values to Dates, 2 not an instant left as stored",
    );
  });
});

describe("normalising application updatedAt to ISO strings", () => {
  it("rewrites a Date, offset or second-precision string as the canonical ISO string of its instant", async () => {
    await applications.insertMany([
      seed("date", { updatedAt: new Date("2026-06-16T10:04:00.456Z") }),
      seed("offset", { updatedAt: "2026-06-16T11:03:00+01:00" }),
      seed("seconds", { updatedAt: "2026-06-16T10:00:01Z" }),
    ]);

    await migrate();

    const rows = await byRef();
    expect(rows.date.updatedAt).toBe("2026-06-16T10:04:00.456Z");
    expect(rows.offset.updatedAt).toBe("2026-06-16T10:03:00.000Z");
    expect(rows.seconds.updatedAt).toBe("2026-06-16T10:00:01.000Z");
  });

  it("leaves canonical values, null and missing as they are", async () => {
    await applications.insertMany([
      seed("canonical", { updatedAt: "2026-06-16T10:05:00.123Z" }),
      seed("null", { updatedAt: null }),
      seed("missing", {}),
    ]);
    const before = await applications.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await applications.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application updatedAt values to ISO strings, 0 not an instant left as stored",
    );
  });

  it("leaves a value that is no instant as stored, and counts it", async () => {
    await applications.insertOne(seed("empty", { updatedAt: "" }));
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect((await byRef()).empty.updatedAt).toBe("");
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application updatedAt values to ISO strings, 1 not an instant left as stored",
    );
  });
});

describe("the application timestamps migration", () => {
  it("can be re-applied, changing nothing the second time", async () => {
    await applications.insertMany([
      seed("mixed", {
        submittedAt: "2026-06-16T11:03:00+01:00",
        updatedAt: new Date("2026-06-16T10:04:00.456Z"),
      }),
      seed("unparsable", { submittedAt: "not-an-instant" }),
    ]);

    await migrate();
    const once = await applications.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await applications.find({}).toArray()).toEqual(once);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application submittedAt values to Dates, 1 not an instant left as stored",
    );
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 application updatedAt values to ISO strings, 0 not an instant left as stored",
    );
  });

  it("exports up and nothing else", async () => {
    const migration =
      await import("../../migrations/20261005120000-normalise-application-timestamps.js");

    expect(Object.keys(migration)).toEqual(["up"]);
  });
});
