import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as backfillOriginalTotalHectares } from "../../migrations/20261110120000-backfill-wmp-original-total-hectares.js";
import { logger } from "../../src/common/logger.js";

let client;
let applications;
let entitlements;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  entitlements = client.db().collection("entitlements");
});

afterAll(async () => {
  await client?.close();
});

const application = (clientRef, phases, { code = "woodland" } = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code,
  currentPhase: "PHASE_PRE_AWARD",
  currentStage: "STAGE_PREPARE_CLAIM",
  currentStatus: "STATUS_PREPARING_CLAIM",
  phases,
});

const preAward = (answers) => [{ code: "PHASE_PRE_AWARD", answers }];

const entitlement = (
  clientRef,
  data,
  { code = "woodland", claimCode = "ENT_CS_CAPITAL_PA3" } = {},
) => ({
  _id: new ObjectId(),
  id: `entitlement-${clientRef}`,
  clientRef,
  code,
  claimCode,
  instanceNumber: 1,
  configVersion: "1.0.0",
  data,
  createdAt: "2026-11-05T09:38:07.443Z",
});

const preField = { totalHectares: 200000, actionCode: "PA3" };

const findByRef = (clientRef) => entitlements.findOne({ clientRef });

const migrate = () => backfillOriginalTotalHectares(client.db());

describe("backfilling originalTotalHectares on woodland PA3 entitlements", () => {
  it("stores the application's total, scaled, and leaves the rest as stored", async () => {
    await applications.insertOne(
      application(
        "wmp-old",
        preAward({ totalHectaresForSelectedParcels: 270.5473 }),
      ),
    );
    const stored = entitlement("wmp-old", preField);
    await entitlements.insertOne(stored);

    await migrate();

    expect(await findByRef("wmp-old")).toStrictEqual({
      ...stored,
      data: { ...preField, originalTotalHectares: 2705473 },
    });
  });

  it("reads the total from the latest phase that answers it", async () => {
    await applications.insertOne(
      application("wmp-phases", [
        {
          code: "PHASE_PRE_AWARD",
          answers: { totalHectaresForSelectedParcels: 1.5 },
        },
        {
          code: "PHASE_CLAIM",
          answers: { totalHectaresForSelectedParcels: 2.25 },
        },
        { code: "PHASE_POST_AWARD", answers: {} },
      ]),
    );
    await entitlements.insertOne(entitlement("wmp-phases", preField));

    await migrate();

    const { data } = await findByRef("wmp-phases");
    expect(data.originalTotalHectares).toBe(22500);
  });

  it("leaves entitlements it cannot or should not fill as stored", async () => {
    await applications.insertMany([
      application("wmp-has", preAward({ totalHectaresForSelectedParcels: 9 })),
      application("wmp-missing", preAward({ woodlandName: "Test wood" })),
      application(
        "wmp-unrounded",
        preAward({ totalHectaresForSelectedParcels: 4.3024000000000004 }),
      ),
      application(
        "wmp-text",
        preAward({ totalHectaresForSelectedParcels: "4.3024" }),
      ),
      application("frps-1", preAward({ totalHectaresForSelectedParcels: 3 }), {
        code: "frps-private-beta",
      }),
      application(
        "wmp-other-claim",
        preAward({ totalHectaresForSelectedParcels: 3 }),
      ),
    ]);
    const stored = [
      entitlement("wmp-has", { ...preField, originalTotalHectares: 1234 }),
      entitlement("wmp-missing", preField),
      entitlement("wmp-unrounded", preField),
      entitlement("wmp-text", preField),
      entitlement("wmp-no-application", preField),
      entitlement("frps-1", preField, { code: "frps-private-beta" }),
      entitlement("wmp-other-claim", preField, { claimCode: "ENT_OTHER" }),
    ];
    await entitlements.insertMany(stored);

    await migrate();

    expect(
      await entitlements.find({}).sort({ clientRef: 1 }).toArray(),
    ).toStrictEqual(
      [...stored].sort((a, b) => a.clientRef.localeCompare(b.clientRef)),
    );
  });

  it("logs each entitlement and changes nothing when run again", async () => {
    await applications.insertMany([
      application(
        "wmp-a",
        preAward({ totalHectaresForSelectedParcels: 4.3024 }),
      ),
      application("wmp-b", preAward({ woodlandName: "Test wood" })),
    ]);
    await entitlements.insertMany([
      entitlement("wmp-a", preField),
      entitlement("wmp-b", preField),
    ]);
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");

    await migrate();
    const once = await entitlements.find({}).toArray();
    await migrate();

    expect(await entitlements.find({}).toArray()).toStrictEqual(once);
    expect(info.mock.calls).toEqual([
      [
        "Backfilling originalTotalHectares on entitlement entitlement-wmp-a (application wmp-a): 4.3024",
      ],
      [
        "Backfilled originalTotalHectares on 1 of 2 woodland entitlements missing it",
      ],
      [
        "Backfilled originalTotalHectares on 0 of 1 woodland entitlements missing it",
      ],
    ]);
    expect(warn.mock.calls).toEqual([
      [
        "Not backfilling originalTotalHectares on entitlement entitlement-wmp-b (application wmp-b): totalHectaresForSelectedParcels is undefined",
      ],
      [
        "Not backfilling originalTotalHectares on entitlement entitlement-wmp-b (application wmp-b): totalHectaresForSelectedParcels is undefined",
      ],
    ]);
  });
});
