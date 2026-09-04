import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfigVersion } from "../helpers/applications.js";
import { wreck } from "../helpers/wreck.js";

let client;
let db;
let entitlements;

const claimCode = "ENT_CS_CAPITAL_PA3";
const position = {
  phase: "PRE_AWARD",
  stage: "REVIEW_APPLICATION",
  status: "APPLICATION_RECEIVED",
};

const entitlementTemplate = {
  claimCode,
  name: "PA3 Woodland Management Plan entitlement",
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
  availableAt: [position],
};

// A template whose fixed field reads from the agreement. Nothing in this suite
// creates an agreement, so the reference has nothing to resolve against.
const agreementDependentTemplate = {
  ...entitlementTemplate,
  fields: {
    ...entitlementTemplate.fields,
    actionVersion: {
      input: false,
      value: "jsonata: $.agreement.actions[code='PA3'].version",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
};

const grantPayload = (code, template = entitlementTemplate) => ({
  code,
  version: "0.0.0",
  metadata: {
    description: "Entitlement creation test grant",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [],
  amendablePositions: [],
  entitlementTemplates: [template],
  phases: [
    {
      code: position.phase,
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { question1: { type: "string" } },
      },
      stages: [
        {
          code: position.stage,
          statuses: [{ code: position.status, validFrom: [] }],
        },
      ],
    },
  ],
});

const seedGrantAndApplication = async (template = entitlementTemplate) => {
  const code = `entitlement-grant-${randomUUID().slice(0, 8)}`;
  const clientRef = `wmp-${randomUUID().slice(0, 8)}`;

  await wreck.post("/grants", { payload: grantPayload(code, template) });
  await seedConfigVersion(db, code);
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

  return { code, clientRef };
};

const createEntitlement = ({ code, clientRef, ...payload }) =>
  wreck.post(
    `/grant-admin/grants/${code}/applications/${clientRef}/claims/entitlements`,
    {
      payload: {
        grantCode: code,
        clientRef,
        claimCode,
        data: { totalHectares: { value: 12.5 } },
        ...payload,
      },
    },
  );

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  db = client.db();
  entitlements = db.collection("entitlements");
});

afterAll(async () => {
  await client?.close();
});

describe("POST /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements", () => {
  it("returns 201 and the current entitlement response shape", async () => {
    const target = await seedGrantAndApplication();

    const response = await createEntitlement(target);

    expect(response.res.statusCode).toBe(201);
    expect(response.payload).toMatchObject({
      ...target,
      claimCode,
      instanceNumber: 1,
      configVersion: "1.0.0",
      data: { totalHectares: 12.5 },
    });
    expect(response.payload.id).toEqual(expect.any(String));
    expect(response.payload.createdAt).toEqual(expect.any(String));
  });

  it("returns 422 with INVALID_ENTITLEMENT_DATA for unexpected input", async () => {
    const target = await seedGrantAndApplication();

    await expect(
      createEntitlement({
        ...target,
        data: { unexpected: { value: 12.5 } },
      }),
    ).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 422,
          errorCode: "INVALID_ENTITLEMENT_DATA",
        },
      },
    });
  });

  it("returns 409 with ENTITLEMENT_LIMIT_EXCEEDED at capacity", async () => {
    const target = await seedGrantAndApplication();
    await entitlements.insertOne({
      id: randomUUID(),
      ...target,
      claimCode,
      instanceNumber: 1,
      configVersion: "1.0.0",
      data: { totalHectares: 10 },
      createdAt: new Date().toISOString(),
    });

    await expect(createEntitlement(target)).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 409,
          errorCode: "ENTITLEMENT_LIMIT_EXCEEDED",
        },
      },
    });
  });

  it("returns 422 with INVALID_CLAIM_CODE for a code the grant does not define", async () => {
    const target = await seedGrantAndApplication();

    await expect(
      createEntitlement({ ...target, claimCode: "ENT_UNKNOWN" }),
    ).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 422,
          errorCode: "INVALID_CLAIM_CODE",
        },
      },
    });
  });

  it("returns 422 with ENTITLEMENT_DATA_UNRESOLVED when the agreement data a fixed field needs is missing", async () => {
    const target = await seedGrantAndApplication(agreementDependentTemplate);

    await expect(createEntitlement(target)).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 422,
          errorCode: "ENTITLEMENT_DATA_UNRESOLVED",
        },
      },
    });

    expect(await entitlements.countDocuments(target)).toBe(0);
  });

  it("returns 404 with APPLICATION_NOT_FOUND when the application is absent", async () => {
    const code = `entitlement-grant-${randomUUID().slice(0, 8)}`;

    await expect(
      createEntitlement({ code, clientRef: "missing-application" }),
    ).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 404,
          errorCode: "APPLICATION_NOT_FOUND",
        },
      },
    });
  });
});
