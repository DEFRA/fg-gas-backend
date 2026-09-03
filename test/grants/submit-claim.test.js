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
let entitlements;

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

const claimPayload = (code, clientRef, clientClaimRef, entitlementId) => ({
  metadata: {
    grantCode: code,
    clientRef,
    claimCode: "ENT_CS_CAPITAL_PA3",
    entitlementId,
    clientClaimRef,
    sbi: "113593357",
    crn: "1100943757",
    frn: "1100943757",
    configVersion: "1.0.0",
    submittedAt: "2026-08-07T11:16:05.745Z",
  },
  claim: {
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

  const entitlementId = randomUUID();
  await entitlements.insertOne({
    _id: entitlementId,
    id: entitlementId,
    clientRef,
    code,
    claimCode: "ENT_CS_CAPITAL_PA3",
    instanceNumber: 1,
    configVersion: "1.0.0",
    data: { totalHectares: 12.5 },
    createdAt: new Date().toISOString(),
  });

  return { clientRef, entitlementId };
};

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  applications = db.collection("applications");
  claims = db.collection("claims");
  entitlements = db.collection("entitlements");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grants/{grantCode}/applications/{clientRef}/claims", () => {
  it("persists a claim and returns 201 with the internal claimId", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    const response = await wreck.post(
      `/grants/${code}/applications/${clientRef}/claims`,
      { payload: claimPayload(code, clientRef, "WMP-C0001", entitlementId) },
    );

    expect(response.res.statusCode).toBe(201);
    expect(response.payload.claimId).toEqual(expect.any(String));

    const stored = await claims.findOne({
      code,
      clientRef,
      clientClaimRef: "WMP-C0001",
    });
    expect(stored.claimCode).toBe("ENT_CS_CAPITAL_PA3");
    expect(stored.claim).toEqual({ claimAmountPence: 150000 });
    expect(stored._id.toString()).toBe(response.payload.claimId);
  });

  it("records the entitlement a claim was submitted against", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
      payload: claimPayload(code, clientRef, "WMP-C0001", entitlementId),
    });

    const stored = await claims.findOne({ code, clientRef });
    expect(stored.entitlementId).toBe(entitlementId);
  });

  it("refuses an entitlement id that belongs to another application", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef } = await seedGrantAndApplication(code);

    await expect(
      wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0001", randomUUID()),
      }),
    ).rejects.toMatchObject({ data: { payload: { statusCode: 404 } } });

    expect(await claims.countDocuments({ code, clientRef })).toBe(0);
  });

  it("refuses a claim that does not name an entitlement", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);
    const payload = claimPayload(code, clientRef, "WMP-C0001", entitlementId);
    delete payload.metadata.entitlementId;

    await expect(
      wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload,
      }),
    ).rejects.toMatchObject({ data: { payload: { statusCode: 400 } } });
  });

  // The case the single-instance guard used to make impossible: two
  // entitlements under one claim code, each with its own claim budget.
  it("claims two entitlements for the same claim code independently", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    const secondId = randomUUID();
    await entitlements.insertOne({
      _id: secondId,
      id: secondId,
      clientRef,
      code,
      claimCode: "ENT_CS_CAPITAL_PA3",
      instanceNumber: 2,
      configVersion: "1.0.0",
      data: { totalHectares: 20 },
      createdAt: new Date().toISOString(),
    });

    const first = await wreck.post(
      `/grants/${code}/applications/${clientRef}/claims`,
      { payload: claimPayload(code, clientRef, "WMP-C0001", entitlementId) },
    );
    expect(first.res.statusCode).toBe(201);

    // maximumClaims is 1, so the first entitlement is now full. The second
    // must still accept a claim of its own.
    const second = await wreck.post(
      `/grants/${code}/applications/${clientRef}/claims`,
      { payload: claimPayload(code, clientRef, "WMP-C0002", secondId) },
    );
    expect(second.res.statusCode).toBe(201);

    await expect(
      wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0003", entitlementId),
      }),
    ).rejects.toMatchObject({ data: { payload: { statusCode: 422 } } });

    expect(await claims.countDocuments({ code, clientRef })).toBe(2);
  });

  it("returns 200 and does not insert a duplicate for the same clientClaimRef", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);
    const payload = claimPayload(code, clientRef, "WMP-C0001", entitlementId);

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
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
      payload: claimPayload(code, clientRef, "WMP-C0001", entitlementId),
    });

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0002", entitlementId),
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
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    await applications.updateOne(
      { clientRef, code },
      { $set: { currentStatus: "IN_REVIEW" } },
    );

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(code, clientRef, "WMP-C0001", entitlementId),
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
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(
          "other-grant",
          clientRef,
          "WMP-C0001",
          entitlementId,
        ),
      });
      throw new Error("expected 400");
    } catch (error) {
      expect(error.data.payload.statusCode).toBe(400);
      expect(error.data.payload.message).toBe(
        "The grant code provided in the path parameters does not match the grant code specified in the payload metadata.",
      );
    }
  });

  it("returns 400 when the path clientRef does not match the payload", async () => {
    const code = `claim-grant-${randomUUID().slice(0, 8)}`;
    const { clientRef, entitlementId } = await seedGrantAndApplication(code);

    try {
      await wreck.post(`/grants/${code}/applications/${clientRef}/claims`, {
        payload: claimPayload(
          code,
          "other-client-ref",
          "WMP-C0001",
          entitlementId,
        ),
      });
      throw new Error("expected 400");
    } catch (error) {
      expect(error.data.payload.statusCode).toBe(400);
      expect(error.data.payload.message).toBe(
        "The client reference provided in the path parameters does not match the client reference specified in the payload metadata.",
      );
    }
  });
});
