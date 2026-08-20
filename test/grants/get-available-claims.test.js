import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../../src/grants/models/application.js";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { createTestGrant } from "../helpers/grants.js";
import { wreck } from "../helpers/wreck.js";

let applications;
let grants;
let entitlements;
let client;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  applications = client.db().collection("applications");
  grants = client.db().collection("grants");
  entitlements = client.db().collection("entitlements");
});

afterAll(async () => {
  await client?.close();
});

const code = "grant-1";
const clientRef = "client-ref-1";
const claimCode = "ENT_CS_CAPITAL_PA3";

const position = {
  phase: ApplicationPhase.PreAward,
  stage: ApplicationStage.Assessment,
  status: ApplicationStatus.Received,
};

const template = (overrides = {}) => ({
  claimCode,
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
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
    actionVersion: {
      input: false,
      value: "1.2.3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: position,
  ...overrides,
});

const seed = async ({ entitlementTemplates, currentPhase } = {}) => {
  await grants.insertOne(
    new GrantDocument(createTestGrant({ code, entitlementTemplates })),
  );

  await applications.insertOne(
    Application.new({
      clientRef,
      code,
      currentPhase: currentPhase ?? position.phase,
      currentStage: position.stage,
      currentStatus: position.status,
      phases: [{ code: position.phase, questions: {} }],
      identifiers: { sbi: "123", frn: "456", crn: "789", defraId: "abc" },
    }),
  );
};

const getAvailableClaims = () =>
  wreck.get(`/grants/${code}/entitlements/${clientRef}/available-claims`, {
    json: true,
  });

describe("GET /grants/{grantCode}/entitlements/{clientRef}/available-claims", () => {
  it("returns available claims with merged template metadata when entitlements exist (AC1 + AC2)", async () => {
    await seed({ entitlementTemplates: [template()] });
    await entitlements.insertOne({
      clientRef,
      code,
      claimCode,
      data: {
        totalHectares: 455000,
        actionCode: "PA3",
        actionVersion: "1.2.3",
      },
    });

    const response = await getAvailableClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableClaims).toHaveLength(1);
    expect(response.payload.availableClaims[0]).toMatchObject({
      code: claimCode,
      name: "PA3 Woodland Management Plan entitlement",
      data: {
        totalHectares: {
          value: 455000,
          decimalPlaces: 4,
          minValue: 0.5,
          maxValue: null,
        },
        actionCode: { value: "PA3" },
        actionVersion: { value: "1.2.3" },
      },
    });
  });

  it("returns empty list when no entitlements exist for the application (AC3)", async () => {
    await seed({ entitlementTemplates: [template()] });

    const response = await getAvailableClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableClaims).toEqual([]);
  });

  it("returns empty list when the grant defines no templates", async () => {
    await seed({ entitlementTemplates: [] });

    const response = await getAvailableClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableClaims).toEqual([]);
  });

  it("excludes materialised templates", async () => {
    await seed({
      entitlementTemplates: [
        template({ materialised: true, fields: undefined }),
      ],
    });
    await entitlements.insertOne({ clientRef, code, claimCode });

    const response = await getAvailableClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableClaims).toEqual([]);
  });

  it("excludes entitlements when application is in a different phase", async () => {
    await seed({
      entitlementTemplates: [
        template({ availableAt: { phase: position.phase } }),
      ],
      currentPhase: "POST_AWARD",
    });
    await entitlements.insertOne({
      clientRef,
      code,
      claimCode,
      data: { totalHectares: 100 },
    });

    const response = await getAvailableClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableClaims).toEqual([]);
  });

  it("returns 404 when application does not exist (AC4)", async () => {
    await seed({ entitlementTemplates: [template()] });

    const response = await wreck.get(
      `/grants/${code}/entitlements/nonexistent-ref/available-claims`,
      { json: true },
    );

    expect(response.res.statusCode).toBe(404);
  });
});
