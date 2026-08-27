import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfigVersion } from "../helpers/applications.js";
import { wreck } from "../helpers/wreck.js";

let client;
let db;
let applications;
let claims;

const claimableAt = {
  phase: "PRE_AWARD",
  stage: "REVIEW_APPLICATION",
  status: "APPLICATION_RECEIVED",
};

const entitlementTemplate = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description: "The maximum eligible woodland area that can be claimed.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
  },
  maxEntitlements: 1,
  availableAt: [claimableAt],
  claim: {
    claimableAt: [claimableAt],
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const grantPayload = (code) => ({
  code,
  version: "0.0.0",
  metadata: {
    description: "Claim submission test grant",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [],
  amendablePositions: [],
  entitlementTemplates: [entitlementTemplate],
  phases: [
    {
      code: "PRE_AWARD",
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          question1: { type: "string" },
        },
      },
      stages: [
        {
          code: "REVIEW_APPLICATION",
          statuses: [{ code: "APPLICATION_RECEIVED", validFrom: [] }],
        },
      ],
    },
  ],
});

const claimPayload = (code, clientRef, clientClaimRef) => ({
  metadata: {
    grantCode: code,
    clientRef,
    claimCode: "ENT_CS_CAPITAL_PA3",
    clientClaimRef,
    sbi: "113593357",
    crn: "1100943757",
    frn: "1100943757",
    configVersion: "1.0.0",
    submittedAt: "2026-08-07T11:16:05.745Z",
  },
  answers: {
    claimAmountPence: 150000,
  },
});

const seedGrantAndApplication = async (code) => {
  await wreck.post("/grants", { json: true, payload: grantPayload(code) });
  await seedConfigVersion(db, code);
  const clientRef = `wmp-${randomUUID().slice(0, 8)}`;

  await wreck.post(`/grants/${code}/applications`, {
    payload: {
      metadata: {
        clientRef,
        submittedAt: new Date().toISOString(),
        sbi: "113593357",
        frn: "1100943757",
        crn: "1100943757",
        configVersion: "1.0.0",
      },
      answers: { question1: "test" },
    },
  });

  return clientRef;
};

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  applications = db.collection("applications");
  claims = db.collection("claims");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants/{grantCode}/applications/{clientRef}/claims", () => {
  it("persists a claim and returns 201 with the internal claimId", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const clientRef = await seedGrantAndApplication(code);

    const response = await wreck.post(
      `/grants/${code}/applications/${clientRef}/claims`,
      { payload: claimPayload(code, clientRef, "WMP-C0001") },
    );

    expect(response.res.statusCode).toBe(201);
    expect(response.payload.claimId).toEqual(expect.any(String));

    const stored = await claims.findOne({
      code,
      clientRef,
      clientClaimRef: "WMP-C0001",
    });
    expect(stored.claimCode).toBe("ENT_CS_CAPITAL_PA3");
    expect(stored.answers).toEqual({ claimAmountPence: 150000 });
    expect(stored._id.toString()).toBe(response.payload.claimId);
  });

  it("returns 200 and does not insert a duplicate for the same clientClaimRef", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const clientRef = await seedGrantAndApplication(code);
    const payload = claimPayload(code, clientRef, "WMP-C0001");

    await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
      payload,
    });

    const response = await wreck.post(
      `/grants/${code}/applications/${clientRef}/claims`,
      { payload },
    );

    expect(response.res.statusCode).toBe(200);
    expect(
      await claims.countDocuments({
        code,
        clientRef,
        clientClaimRef: "WMP-C0001",
      }),
    ).toBe(1);
  });

  it("returns 422 when the maximum claims limit has been reached", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const clientRef = await seedGrantAndApplication(code);

    await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
      payload: claimPayload(code, clientRef, "WMP-C0001"),
    });

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0002"),
      });
      throw new Error("expected 422");
    } catch (error) {
      expect(error.data.payload.statusCode).toBe(422);
      expect(error.data.payload.message).toBe(
        "Maximum number of claims for this entitlement has been reached.",
      );
    }
  });

  it("returns 409 when the application is not in a claimable state", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const clientRef = await seedGrantAndApplication(code);

    await applications.updateOne(
      { clientRef, code },
      { $set: { currentStatus: "IN_REVIEW" } },
    );

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0001"),
      });
      throw new Error("expected 409");
    } catch (error) {
      expect(error.data.payload.statusCode).toBe(409);
      expect(error.data.payload.message).toBe(
        "Application is not in a valid state to accept claims for this entitlement.",
      );
    }
  });

  it("returns 400 when the path grantCode does not match the payload", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const clientRef = await seedGrantAndApplication(code);

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload("other-grant", clientRef, "WMP-C0001"),
      });
      throw new Error("expected 400");
    } catch (error) {
      expect(error.data.payload.statusCode).toBe(400);
      expect(error.data.payload.message).toBe(
        "The grant code provided in the path parameters does not match the grant code specified in the payload metadata.",
      );
    }
  });
});
