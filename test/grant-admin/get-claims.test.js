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
const claimsPage = {
  claims: {
    details: {
      banner: {
        title: { text: "$.answers.applicant.business.name", type: "string" },
        summary: {
          scheme: { label: "Scheme", text: "Test Grant", type: "string" },
          applicationId: {
            label: "Application ID",
            text: "$.clientRef",
            type: "string",
          },
          sbi: { label: "SBI", text: "$.identifiers.sbi", type: "string" },
        },
      },
    },
  },
};

const seed = async (options = {}) => {
  const { entitlementTemplates, currentPhase, answers } = options;

  // Key presence rather than a default, so a test can seed a grant that
  // configures no pages at all by passing "pages: undefined".
  const pages = "pages" in options ? options.pages : claimsPage;

  await grants.insertOne(
    new GrantDocument(createTestGrant({ code, entitlementTemplates, pages })),
  );

  await applications.insertOne(
    Application.new({
      clientRef,
      code,
      currentPhase: currentPhase ?? position.phase,
      currentStage: position.stage,
      currentStatus: position.status,
      phases: [
        {
          code: position.phase,
          questions: {},
          answers: answers ?? {
            applicant: { business: { name: "Elmwood Land Co" } },
          },
        },
      ],
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

  // The header the grant configures for this page, resolved against the
  // application it is being viewed for.
  it("heads the page with the banner the grant configures", async () => {
    await seed({ entitlementTemplates: [template()] });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.banner.title).toEqual({
      text: "Elmwood Land Co",
      type: "string",
    });
    expect(response.payload.banner.summary).toMatchObject({
      scheme: { label: "Scheme", text: "Test Grant" },
      applicationId: { label: "Application ID", text: clientRef },
      sbi: { label: "SBI", text: "123" },
    });
  });

  it("drops a field the application has no answer for", async () => {
    await seed({ entitlementTemplates: [template()], answers: {} });

    const response = await getClaims();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.banner.title).toBeUndefined();
    expect(response.payload.banner.summary.sbi.text).toBe("123");
  });

  // A page headed by nothing tells a case officer less than an honest 404 does.
  it("answers 404 for a grant that configures no claims page", async () => {
    await seed({ entitlementTemplates: [template()], pages: undefined });

    await expect(getClaims()).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});
