import { MongoClient } from "mongodb";
import { env } from "node:process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../../src/grants/models/application.js";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { createTestGrant } from "../helpers/grants.js";
import { wreck } from "../helpers/wreck.js";

let client;
let applications;
let grants;
let entitlements;
let claims;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  applications = db.collection("applications");
  grants = db.collection("grants");
  entitlements = db.collection("entitlements");
  claims = db.collection("claims");
  outbox = db.collection("outbox");
});

afterEach(async () => {
  await claims.deleteMany({ code, clientRef });
});

afterAll(async () => {
  await client?.close();
});

const code = "change-entitlement-grant";
const clientRef = "change-entitlement-ref";
const claimCode = "ENT_CS_CAPITAL_PA3";
const entitlementId = "entitlement-1";

const position = {
  phase: ApplicationPhase.PreAward,
  stage: ApplicationStage.Assessment,
  status: ApplicationStatus.Received,
};

const template = {
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
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: [position],
  claim: { claimableAt: [position], limits: { maximumClaims: 1 } },
};

const pages = {
  claims: {
    details: {
      banner: {
        title: { text: "$.answers.applicant.business.name", type: "string" },
      },
    },
  },
};

// The entitlement was created while the application could still take one; it
// has since moved on to where it waits for a claim.
const seed = async () => {
  await grants.insertOne(
    new GrantDocument(
      createTestGrant({ code, entitlementTemplates: [template], pages }),
    ),
  );
  await applications.insertOne(
    Application.new({
      clientRef,
      code,
      currentPhase: ApplicationPhase.PostAward,
      currentStage: position.stage,
      currentStatus: position.status,
      phases: [
        {
          code: position.phase,
          questions: {},
          answers: { applicant: { business: { name: "Elmwood Land Co" } } },
        },
      ],
      identifiers: { sbi: "123", frn: "456", crn: "789", defraId: "abc" },
    }),
  );
  await entitlements.insertOne({
    id: entitlementId,
    clientRef,
    code,
    claimCode,
    instanceNumber: 1,
    configVersion: "1.0.0",
    data: { totalHectares: 455000, actionCode: "PA3" },
    createdAt: "2026-09-02T00:00:00.000Z",
  });
};

const submitClaim = () =>
  claims.insertOne({
    code,
    clientRef,
    claimCode,
    entitlementId,
    clientClaimRef: "change-entitlement-ref-C01",
    metadata: { clientClaimRef: "change-entitlement-ref-C01" },
    claim: { entitlementId, totalClaimAmountPence: 150000 },
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });

const url = (id = entitlementId) =>
  `/grant-admin/grants/${code}/applications/${clientRef}/claims/entitlements/${id}`;

const getEntitlement = (id) => wreck.get(url(id), { json: true });

const putEntitlement = ({ id, data, actor } = {}) =>
  wreck.put(url(id), {
    json: true,
    payload: { data: data ?? { totalHectares: { value: 300000 } } },
    headers: actor ? { "x-actor": actor } : {},
  });

const storedEntitlement = () => entitlements.findOne({ id: entitlementId });

const refusal = (statusCode, errorCode) => ({
  data: { payload: { statusCode, ...(errorCode && { errorCode }) } },
});

describe("GET /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}", () => {
  it("returns the entitlement and the template it was made under, after the add window has closed", async () => {
    await seed();

    const response = await getEntitlement();

    expect(response.res.statusCode).toBe(200);
    expect(response.payload.claimableEntitlement).toMatchObject({
      entitlementId,
      claimCode,
      canEdit: true,
      data: { totalHectares: expect.objectContaining({ value: 45.5 }) },
    });
    expect(response.payload.entitlementTemplate).toMatchObject({
      claimCode,
      fields: template.fields,
    });
    expect(response.payload.banner.title.text).toBe("Elmwood Land Co");
  });

  it("returns 409 once a claim has been made against the entitlement", async () => {
    await seed();
    await submitClaim();

    await expect(getEntitlement()).rejects.toMatchObject(refusal(409));
  });

  it("returns 404 for an entitlement the application does not have", async () => {
    await seed();

    await expect(getEntitlement("entitlement-unknown")).rejects.toMatchObject(
      refusal(404),
    );
  });
});

describe("PUT /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}", () => {
  it("changes the input field, keeps the fixed one and records when", async () => {
    await seed();

    const response = await putEntitlement();

    expect(response.res.statusCode).toBe(200);

    const stored = await storedEntitlement();

    expect(stored.data).toEqual({ totalHectares: 300000, actionCode: "PA3" });
    expect(stored.createdAt).toBe("2026-09-02T00:00:00.000Z");
    expect(new Date(stored.updatedAt).getTime()).not.toBeNaN();
  });

  it("writes an UPDATE audit event naming the person who made the change", async () => {
    await seed();

    await putEntitlement({ actor: "Ada Lovelace" });

    const audit = await outbox.findOne({
      "event.audit.entities.action": "UPDATE",
      "event.audit.entities.entityid": entitlementId,
    });

    expect(audit).not.toBeNull();
    expect(audit.event.audit.entities[0]).toMatchObject({
      entity: "ENTITLEMENT",
      action: "UPDATE",
      entityid: entitlementId,
    });
    expect(audit.event.audit.details).toMatchObject({
      code,
      clientRef,
      claimCode,
      actor: "Ada Lovelace",
    });
    expect(audit.event.audit.status).toBe("SUCCESS");
  });

  it("refuses with ENTITLEMENT_CLAIMED and changes nothing once a claim has been made", async () => {
    await seed();
    await submitClaim();

    await expect(putEntitlement()).rejects.toMatchObject({
      data: {
        payload: {
          statusCode: 409,
          errorCode: "ENTITLEMENT_CLAIMED",
          message:
            "PA3 Woodland Management Plan entitlement has a claim against it and cannot be changed.",
        },
      },
    });
    expect((await storedEntitlement()).data.totalHectares).toBe(455000);
  });

  it("refuses with INVALID_ENTITLEMENT_DATA and changes nothing for a fixed field", async () => {
    await seed();

    await expect(
      putEntitlement({
        data: {
          totalHectares: { value: 300000 },
          actionCode: { value: "PA4" },
        },
      }),
    ).rejects.toMatchObject(refusal(422, "INVALID_ENTITLEMENT_DATA"));
    expect((await storedEntitlement()).data).toEqual({
      totalHectares: 455000,
      actionCode: "PA3",
    });
  });

  it("refuses with ENTITLEMENT_NOT_FOUND for an entitlement the application does not have", async () => {
    await seed();

    await expect(
      putEntitlement({ id: "entitlement-unknown" }),
    ).rejects.toMatchObject(refusal(404, "ENTITLEMENT_NOT_FOUND"));
  });
});
