import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as roundTotalHectares } from "../../migrations/20261109120000-round-wmp-total-hectares.js";
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

const seed = (clientRef, answers, { code = "woodland", phases } = {}) => ({
  _id: new ObjectId(),
  clientRef,
  code,
  currentPhase: "PHASE_PRE_AWARD",
  currentStage: "STAGE_REVIEW_APPLICATION",
  currentStatus: "STATUS_RECEIVED",
  createdAt: "2026-11-05T09:38:07.443Z",
  updatedAt: "2026-11-05T10:15:22.951Z",
  phases: phases ?? [{ code: "PHASE_PRE_AWARD", answers }],
});

const findByRef = (clientRef) => applications.findOne({ clientRef });

const migrate = () => roundTotalHectares(client.db());

describe("rounding woodland totalHectaresForSelectedParcels to 4 decimal places", () => {
  it("rounds an unrounded total and leaves the rest of the application as stored", async () => {
    const stored = seed("wmp-unrounded", {
      woodlandName: "Test wood",
      totalHectaresForSelectedParcels: 270.54729999999995,
      landParcels: [{ parcelId: "SD0000-0001", areaHa: 129.2422 }],
    });
    await applications.insertOne(stored);

    await migrate();

    expect(await findByRef("wmp-unrounded")).toStrictEqual({
      ...stored,
      phases: [
        {
          code: "PHASE_PRE_AWARD",
          answers: {
            woodlandName: "Test wood",
            totalHectaresForSelectedParcels: 270.5473,
            landParcels: [{ parcelId: "SD0000-0001", areaHa: 129.2422 }],
          },
        },
      ],
    });
  });

  it.each([
    [4.3024000000000004, 4.3024],
    [12.605900000000002, 12.6059],
    [13.778399999999998, 13.7784],
  ])("rounds %d to %d", async (from, to) => {
    await applications.insertOne(
      seed("wmp-noise", { totalHectaresForSelectedParcels: from }),
    );

    await migrate();

    const { phases } = await findByRef("wmp-noise");
    expect(phases[0].answers.totalHectaresForSelectedParcels).toBe(to);
  });

  it("rounds only the phases that need it", async () => {
    await applications.insertOne(
      seed("wmp-phases", null, {
        phases: [
          {
            code: "PHASE_PRE_AWARD",
            answers: { totalHectaresForSelectedParcels: 1.2345 },
          },
          {
            code: "PHASE_CLAIM",
            answers: { totalHectaresForSelectedParcels: 0.30000000000000004 },
          },
        ],
      }),
    );

    await migrate();

    const { phases } = await findByRef("wmp-phases");
    expect(phases.map((phase) => phase.answers)).toEqual([
      { totalHectaresForSelectedParcels: 1.2345 },
      { totalHectaresForSelectedParcels: 0.3 },
    ]);
  });

  it("leaves clean, missing and non-numeric totals and other grants as stored", async () => {
    const stored = [
      seed("wmp-clean", { totalHectaresForSelectedParcels: 270.5473 }),
      seed("wmp-whole", { totalHectaresForSelectedParcels: 20 }),
      seed("wmp-missing", { woodlandName: "Test wood" }),
      seed("wmp-text", { totalHectaresForSelectedParcels: "4.30240000001" }),
      seed("wmp-no-answers", null, { phases: [{ code: "PHASE_PRE_AWARD" }] }),
      seed("wmp-no-phases", null, { phases: [] }),
      seed(
        "frps-unrounded",
        { totalHectaresForSelectedParcels: 4.3024000000000004 },
        { code: "frps-private-beta" },
      ),
    ];
    await applications.insertMany(stored);

    await migrate();

    expect(
      await applications.find({}).sort({ clientRef: 1 }).toArray(),
    ).toStrictEqual(
      [...stored].sort((a, b) => a.clientRef.localeCompare(b.clientRef)),
    );
  });

  it("logs each value it rounded and changes nothing when run again", async () => {
    await applications.insertMany([
      seed("wmp-a", { totalHectaresForSelectedParcels: 4.3024000000000004 }),
      seed("wmp-b", { totalHectaresForSelectedParcels: 270.5473 }),
      seed("wmp-c", null, {
        phases: [
          {
            code: "PHASE_PRE_AWARD",
            answers: { totalHectaresForSelectedParcels: 12.605900000000002 },
          },
          {
            code: "PHASE_CLAIM",
            answers: { totalHectaresForSelectedParcels: 13.778399999999998 },
          },
        ],
      }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();
    const once = await applications.find({}).toArray();
    await migrate();

    expect(await applications.find({}).toArray()).toStrictEqual(once);
    expect(info.mock.calls).toEqual([
      [
        "Rounded totalHectaresForSelectedParcels to 4 decimal places on 2 woodland applications: wmp-a 4.3024000000000004 -> 4.3024; wmp-c 12.605900000000002 -> 12.6059, 13.778399999999998 -> 13.7784",
      ],
      [
        "Rounded totalHectaresForSelectedParcels to 4 decimal places on 0 woodland applications",
      ],
    ]);
  });
});
