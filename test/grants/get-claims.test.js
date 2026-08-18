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

// The position createTestGrant's phases describe, and where the application
// below sits unless a test moves it.
const position = {
  phase: ApplicationPhase.PreAward,
  stage: ApplicationStage.Assessment,
  status: ApplicationStatus.Received,
};

const template = (overrides = {}) => ({
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
  availableAt: position,
  ...overrides,
});

// The application is stored without a configVersion, so the grant resolves by
// code at the unversioned sentinel - the same route application-status takes.
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

const getClaims = () =>
  wreck.get(`/grant-admin/grants/${code}/applications/${clientRef}/claims`, {
    json: true,
  });

describe("GET /grant-admin/grants/{code}/applications/{clientRef}/claims", () => {
  it("returns a template whose availableAt fully matches the application position", async () => {
    await seed({ entitlementTemplates: [template()] });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toHaveLength(1);
    expect(response.payload.availableEntitlements[0]).toMatchObject({
      claimCode,
      materialised: false,
      maxEntitlements: 1,
      availableAt: position,
    });
    expect(response.payload.claimableEntitlements).toEqual([]);
    expect(response.payload.claims).toEqual([]);
  });

  it("returns a template that declares only the phase the application is in", async () => {
    await seed({
      entitlementTemplates: [
        template({ availableAt: { phase: position.phase } }),
      ],
    });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toHaveLength(1);
    expect(response.payload.availableEntitlements[0].claimCode).toBe(claimCode);
  });

  it("excludes a materialised template", async () => {
    await seed({
      entitlementTemplates: [
        template({ materialised: true, fields: undefined }),
      ],
    });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toEqual([]);
  });

  it("excludes a template when the application is in another phase", async () => {
    await seed({
      entitlementTemplates: [
        template({ availableAt: { phase: position.phase } }),
      ],
      currentPhase: "POST_AWARD",
    });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toEqual([]);
  });

  it("excludes a template that has reached maxEntitlements", async () => {
    await seed({ entitlementTemplates: [template({ maxEntitlements: 1 })] });
    await entitlements.insertOne({ clientRef, code, claimCode });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toEqual([]);
  });

  it("returns an empty list when the grant defines no templates", async () => {
    await seed({ entitlementTemplates: [] });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.availableEntitlements).toEqual([]);
    expect(response.payload.claimableEntitlements).toEqual([]);
    expect(response.payload.claims).toEqual([]);
  });
});
