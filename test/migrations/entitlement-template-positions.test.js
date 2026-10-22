import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { up as normalisePositions } from "../../migrations/20261024100000-normalise-entitlement-template-positions.js";
import { logger } from "../../src/common/logger.js";
import { toGrant } from "../../src/grants/repositories/grant.repository.js";

let client;
let grants;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  grants = client.db().collection("grants");
});

afterAll(async () => {
  await client?.close();
});

const PREPARING = {
  phase: "PHASE_PRE_AWARD",
  stage: "STAGE_PREPARE_CLAIM",
  status: "STATUS_PREPARING_CLAIM",
};

const template = (claimCode, availableAt, claim = null) => ({
  claimCode,
  name: `${claimCode} entitlement`,
  materialised: true,
  maxEntitlements: 1,
  availableAt,
  claim,
});

const seed = (version, entitlementTemplates) => ({
  _id: new ObjectId(),
  code: "woodland",
  version,
  metadata: { description: "Woodland", startDate: "2026-04-01T00:00:00Z" },
  actions: [],
  phases: [
    {
      code: "PHASE_PRE_AWARD",
      stages: [
        {
          code: "STAGE_PREPARE_CLAIM",
          statuses: [{ code: "STATUS_PREPARING_CLAIM" }],
        },
      ],
    },
  ],
  entitlementTemplates,
});

const LIMITS = {
  limits: { maximumClaims: 1, allowsPartialClaims: false },
  requiresApproval: false,
  requiresEvidence: false,
};

const stored = (version) => grants.findOne({ code: "woodland", version });

const migrate = () => normalisePositions(client.db());

describe("normalising single entitlement template positions to lists", () => {
  it("makes a single availableAt position a one-position list, which the model then loads", async () => {
    await grants.insertMany([
      seed("1.24.0", [template("PA3", PREPARING, LIMITS)]),
      seed("1.25.0", [
        template("PA3", [PREPARING], {
          ...LIMITS,
          claimableAt: [{ phase: "PHASE_PRE_AWARD" }],
        }),
        template("PA4", { phase: "PHASE_PRE_AWARD" }),
      ]),
    ]);

    await migrate();

    expect((await stored("1.24.0")).entitlementTemplates).toStrictEqual([
      template("PA3", [PREPARING], LIMITS),
    ]);
    expect((await stored("1.25.0")).entitlementTemplates).toStrictEqual([
      template("PA3", [PREPARING], {
        ...LIMITS,
        claimableAt: [{ phase: "PHASE_PRE_AWARD" }],
      }),
      template("PA4", [{ phase: "PHASE_PRE_AWARD" }]),
    ]);
    expect(toGrant(await stored("1.24.0")).entitlementTemplates).toHaveLength(
      1,
    );
    expect(toGrant(await stored("1.25.0")).entitlementTemplates).toHaveLength(
      2,
    );
  });

  it("leaves grants whose positions are lists, or that have no templates, as stored", async () => {
    const lists = seed("1.27.0", [
      template("PA3", [PREPARING], { ...LIMITS, claimableAt: [PREPARING] }),
      template("PA4", [PREPARING]),
    ]);
    const none = seed("0.0.0", null);
    const { entitlementTemplates: _, ...absent } = seed("0.1.0", []);
    await grants.insertMany([lists, none, absent]);

    await migrate();

    expect(await grants.find({}).sort({ version: 1 }).toArray()).toStrictEqual([
      none,
      absent,
      lists,
    ]);
  });

  it("leaves an availableAt that is neither a list nor a position as stored, and counts its grant", async () => {
    const { availableAt: _, ...missing } = template("PA4", []);
    const unreadable = [
      seed("1.10.0", [template("PA3", "PHASE_PRE_AWARD")]),
      seed("1.11.0", [template("PA3", [PREPARING]), missing]),
      seed("1.12.0", [template("PA3", null)]),
    ];
    await grants.insertMany(unreadable);
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await grants.find({}).sort({ version: 1 }).toArray()).toStrictEqual(
      unreadable,
    );
    expect(info.mock.calls).toEqual([
      [
        "Normalised single entitlement template positions to lists in 0 grants, 3 with an availableAt that is no list left as stored",
      ],
    ]);
  });

  it("counts the grants it normalised, and changes nothing when run again", async () => {
    await grants.insertMany([
      seed("1.24.0", [template("PA3", PREPARING, LIMITS)]),
      seed("1.27.0", [template("PA3", [PREPARING], LIMITS)]),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();
    const once = await grants.find({}).toArray();
    await migrate();

    expect(await grants.find({}).toArray()).toStrictEqual(once);
    expect(info.mock.calls).toEqual([
      [
        "Normalised single entitlement template positions to lists in 1 grants, 0 with an availableAt that is no list left as stored",
      ],
      [
        "Normalised single entitlement template positions to lists in 0 grants, 0 with an availableAt that is no list left as stored",
      ],
    ]);
  });
});
