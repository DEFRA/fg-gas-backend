import { Long, MongoClient, ObjectId } from "mongodb";
import { readFile } from "node:fs/promises";
import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  grantVersionPageSchemas,
  grantVersionsSchema,
} from "../../src/grant-admin/schemas/grant-version-page.schema.js";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { Grant } from "../../src/grants/models/grant.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPERATOR = { "x-actor": "Jo Operator", "x-actor-id": OID };
const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";
const CODE = "woodland";

let client;
let configVersions;
let grants;
let agreementDefinitions;
let paymentDefinitions;
let outbox;
let grantDefinition;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  configVersions = db.collection("config_versions");
  grants = db.collection("grants");
  agreementDefinitions = db.collection("agreements__definitions");
  paymentDefinitions = db.collection("payments__definitions");
  outbox = db.collection("outbox");
  grantDefinition = JSON.parse(
    await readFile(
      new URL("../fixtures/pmf-grant-definition.json", import.meta.url),
    ),
  );
});

afterAll(async () => {
  await client?.close();
});

const fileState = (version, fetchStatus) => ({
  s3Key: `${CODE}/${version}/gas.json`,
  fetchStatus,
  fetchAttempts: 0,
  fetchError: null,
  fetchedAt: null,
  lastFetchAttemptAt: null,
});

const aConfigVersion = (version, status, receivedAt, definitions = {}) => {
  const [major, minor, patch] = version.split(".").map(Number);

  return {
    _id: new ObjectId(),
    grantCode: CODE,
    version,
    major,
    minor,
    patch,
    status,
    s3Bucket: "config-broker-local",
    receivedAt,
    definitions: { grant: fileState(version, "pending"), ...definitions },
  };
};

const storeGrant = (version, overrides = {}) =>
  grants.insertOne(
    new GrantDocument(
      new Grant({ ...grantDefinition, code: CODE, ...overrides, version }),
    ),
  );

const get = (path) =>
  wreck.get(`/grant-admin/grants/${path}`, { headers: OPERATOR });

const auditRows = (action) =>
  outbox
    .find({ target: AUDIT_TOPIC, "event.audit.entities.action": action })
    .toArray();

describe("GET /grant-admin/grants/{code}/versions", () => {
  it("answers every version newest first, naming the newest active one current", async () => {
    await configVersions.insertMany([
      aConfigVersion("1.2.0", "active", "2026-10-10T16:25:00.000Z"),
      aConfigVersion("10.0.0", "draft", "2026-10-15T10:04:00.000Z"),
      aConfigVersion("1.10.0", "active", "2026-10-12T09:00:00.000Z"),
    ]);

    const { payload, res } = await get(`${CODE}/versions`);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(grantVersionsSchema.validate(payload).error).toBeUndefined();
    expect(payload).toEqual({
      code: CODE,
      current: "1.10.0",
      versions: [
        {
          version: "10.0.0",
          status: "draft",
          receivedAt: "2026-10-15T10:04:00.000Z",
        },
        {
          version: "1.10.0",
          status: "active",
          receivedAt: "2026-10-12T09:00:00.000Z",
        },
        {
          version: "1.2.0",
          status: "active",
          receivedAt: "2026-10-10T16:25:00.000Z",
        },
      ],
    });
    expect(await auditRows("VIEW_GRANT_VERSION")).toEqual([]);
  });

  it("names no current version for a draft-only grant", async () => {
    await configVersions.insertOne(
      aConfigVersion("2.0.0", "draft", "2026-10-15T10:04:00.000Z"),
    );

    expect((await get(`${CODE}/versions`)).payload.current).toBeNull();
  });

  it("answers 404 GRANT_NOT_FOUND for a grant with no versions", async () => {
    const error = await get("nothing/versions").catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("GRANT_NOT_FOUND");
  });
});

describe("GET /grant-admin/grants/{code}/versions/{version}/{tab}", () => {
  const DRAFT = aConfigVersion("2.0.0", "draft", "2026-10-15T10:04:00.000Z", {
    agreement: fileState("2.0.0", "pending"),
    payment: fileState("2.0.0", "permanent_error"),
  });

  it("a draft with nothing stored: every file not stored, no definition, and the row unchanged", async () => {
    await configVersions.insertOne(DRAFT);

    const { payload: overview } = await get(`${CODE}/versions/2.0.0/overview`);
    const { payload: definition, res } = await get(
      `${CODE}/versions/2.0.0/definition`,
    );

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      grantVersionPageSchemas.definition.validate(definition).error,
    ).toBeUndefined();
    expect(definition.header).toEqual({
      code: CODE,
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
      files: {
        grant: { stored: false, fetchStatus: "pending" },
        agreement: { stored: false, fetchStatus: "pending" },
        payment: { stored: false, fetchStatus: "permanent_error" },
      },
      versions: [
        {
          version: "2.0.0",
          status: "draft",
          receivedAt: "2026-10-15T10:04:00.000Z",
        },
      ],
    });
    expect(definition.definition).toBeNull();
    expect(definition.sectionErrors).toEqual([]);
    expect(overview.overview).toEqual({
      description: null,
      startDate: null,
      adminRole: null,
      storedBytes: null,
    });
    expect(await configVersions.findOne({ _id: DRAFT._id })).toStrictEqual(
      DRAFT,
    );
  });

  it("a stored version: its files stored, the overview facts and the document as stored", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0", { admin: { role: "WOODLAND_ADMIN" } });
    await agreementDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: {},
    });

    const { payload: overview } = await get(`${CODE}/versions/2.0.0/overview`);
    const { payload: definition } = await get(
      `${CODE}/versions/2.0.0/definition`,
    );

    expect(
      grantVersionPageSchemas.overview.validate(overview).error,
    ).toBeUndefined();
    expect(overview.header.files).toEqual({
      grant: { stored: true, fetchStatus: "pending" },
      agreement: { stored: true, fetchStatus: "pending" },
      payment: { stored: false, fetchStatus: "permanent_error" },
    });
    expect(overview.overview).toEqual({
      description: "Pigs Might Fly",
      startDate: "2100-01-01T00:00:00.000Z",
      adminRole: "WOODLAND_ADMIN",
      storedBytes: expect.any(Number),
    });
    const { _id, ...stored } = await grants.findOne({
      code: CODE,
      version: "2.0.0",
    });
    expect(definition.definition).toStrictEqual(
      JSON.parse(JSON.stringify(stored)),
    );
    expect(definition.definition).not.toHaveProperty("_id");
  });

  it("a stored grant without a description is refused, not shown as not stored", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0");
    await grants.updateOne(
      { code: CODE, version: "2.0.0" },
      { $unset: { "metadata.description": "" } },
    );

    const error = await get(`${CODE}/versions/2.0.0/overview`).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
  });

  it("a stored payment definition shows as stored", async () => {
    await configVersions.insertOne(DRAFT);
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: {},
    });

    const { payload } = await get(`${CODE}/versions/2.0.0/overview`);

    expect(payload.header.files.payment).toEqual({
      stored: true,
      fetchStatus: "permanent_error",
    });
  });

  it("a stored BSON number goes out as plain JSON", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0");
    await grants.updateOne(
      { code: CODE, version: "2.0.0" },
      { $set: { big: Long.fromString("9007199254740993") } },
    );

    const { payload } = await get(`${CODE}/versions/2.0.0/definition`);

    expect(payload.definition.big).toBe("9007199254740993");
  });

  it("a stored document over the section cap is too large to show", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0", {
      metadata: {
        ...grantDefinition.metadata,
        description: "x".repeat(1100000),
      },
    });

    const { payload } = await get(`${CODE}/versions/2.0.0/definition`);

    expect(payload.definition).toBeNull();
    expect(payload.sectionErrors).toEqual([
      { section: "definition", message: "too large to show" },
    ]);
  });

  it("phases: the stored grant's lifecycle as Grants resolves it, audited with its tab", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0");

    const { payload } = await get(`${CODE}/versions/2.0.0/phases`);

    expect(
      grantVersionPageSchemas.phases.validate(payload).error,
    ).toBeUndefined();
    expect(payload.problem).toBeNull();
    expect(payload.lifecycle).toMatchObject({
      initialPosition: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_RECEIVED",
      amendablePositions: [
        "PRE_AWARD:REVIEW_OFFER:APPLICATION_AMEND",
        "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:APPLICATION_AMEND",
      ],
      claimApproval: null,
    });
    expect(payload.lifecycle.waysIn).toEqual(
      expect.arrayContaining([
        {
          to: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_RECEIVED",
          kind: "any",
          processes: [],
        },
        {
          to: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
          kind: "move",
          from: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
          processes: expect.any(Array),
        },
      ]),
    );
    expect(payload.lifecycle.externalMappings).toContainEqual({
      source: "CW",
      code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      whileIn: "PRE_AWARD:REVIEW_APPLICATION",
      mappedTo: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
      to: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
    });
    const [row] = await auditRows("VIEW_GRANT_VERSION");
    expect(row.event.audit.details).toMatchObject({
      version: "2.0.0",
      tab: "phases",
    });
  });

  it("phases: why a stored grant has no lifecycle, shown rather than skipped", async () => {
    await configVersions.insertOne(DRAFT);
    await storeGrant("2.0.0");
    await grants.updateOne(
      { code: CODE, version: "2.0.0" },
      { $set: { "phases.0.stages.0.statuses": [] } },
    );

    const { payload } = await get(`${CODE}/versions/2.0.0/phases`);

    expect(payload.lifecycle).toBeNull();
    expect(payload.problem).toBe(
      `Grant "${CODE}" has a lifecycle GAS cannot read: "phases[0].stages[0].statuses" must contain at least 1 items`,
    );
    expect(payload.sectionErrors).toEqual([]);
  });

  it("phases: neither a lifecycle nor a problem when the grant file is not stored", async () => {
    await configVersions.insertOne(DRAFT);

    const { payload } = await get(`${CODE}/versions/2.0.0/phases`);

    expect(payload).toMatchObject({
      lifecycle: null,
      problem: null,
      sectionErrors: [],
    });
  });

  it("writes one VIEW_GRANT_VERSION row per tab read, with the operator, PMC 0706, the version and the tab", async () => {
    await configVersions.insertOne(DRAFT);

    await get(`${CODE}/versions/2.0.0/definition`);

    const rows = await auditRows("VIEW_GRANT_VERSION");
    expect(rows).toHaveLength(1);
    expect(rows[0].segregationRef).toBe("admin-view-grant-version");
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          { entity: "GRANT", action: "VIEW_GRANT_VERSION", entityid: CODE },
        ],
        details: { version: "2.0.0", tab: "definition" },
      },
    });
  });

  it("answers 404 GRANT_VERSION_NOT_FOUND for an unknown version, audited as a FAILURE", async () => {
    await configVersions.insertOne(DRAFT);

    const error = await get(`${CODE}/versions/9.9.9/overview`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("GRANT_VERSION_NOT_FOUND");
    const [row] = await auditRows("VIEW_GRANT_VERSION");
    expect(row.event.audit.status).toBe("FAILURE");
    expect(row.event.audit.details.tab).toBe("overview");
  });
});
