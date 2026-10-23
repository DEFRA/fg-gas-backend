import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normaliseGrantActions } from "../../migrations/20261022130000-normalise-grant-actions.js";
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

const seed = (code, fields) => ({
  _id: new ObjectId(),
  code,
  version: "1.0.0",
  metadata: { description: code, startDate: new Date("2026-01-01") },
  ...fields,
});

const byCode = async () =>
  Object.fromEntries((await grants.find({}).toArray()).map((g) => [g.code, g]));

const migrate = () => normaliseGrantActions(client.db());

describe("normalising grant actions to an array", () => {
  it("gives a grant with null or missing actions no actions", async () => {
    await grants.insertMany([
      seed("null", { actions: null }),
      seed("missing", {}),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byCode();
    expect(rows.null.actions).toEqual([]);
    expect(rows.missing.actions).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      "Normalised 2 grants stored without actions to no actions, 0 with non-array actions left as stored",
    );
  });

  it("leaves non-array actions as stored and counts them", async () => {
    const object = { name: "calculate" };
    await grants.insertMany([
      seed("object", { actions: object }),
      seed("string", { actions: "calculate" }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();

    const rows = await byCode();
    expect(rows.object.actions).toEqual(object);
    expect(rows.string.actions).toBe("calculate");
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 grants stored without actions to no actions, 2 with non-array actions left as stored",
    );
  });

  it("leaves a grant that declares actions exactly as it is", async () => {
    await grants.insertMany([
      seed("none", { actions: [] }),
      seed("some", {
        actions: [
          { name: "calculate", method: "POST", url: "http://example.com" },
        ],
      }),
      seed("holding null", {
        actions: [
          null,
          { name: "calculate", method: "POST", url: "http://example.com" },
        ],
      }),
    ]);
    const before = await grants.find({}).toArray();
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await grants.find({}).toArray()).toEqual(before);
    expect(info).toHaveBeenCalledWith(
      "Normalised 0 grants stored without actions to no actions, 0 with non-array actions left as stored",
    );
  });
});
