import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Long, MongoClient, ObjectId } from "mongodb";
import { readFile } from "node:fs/promises";
import { env } from "node:process";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { loadAgreementDefinition } from "../../src/agreements/use-cases/load-agreement-definition.js";
import { withWorstFetchStatus } from "../../src/common/config-broker/config-catalog.repository.js";
import { config } from "../../src/common/config.js";
import { inboxStamps } from "../../src/events/stamps.js";
import {
  fetchDefinitionsResponseSchema,
  grantVersionPageSchemas,
  grantVersionsSchema,
} from "../../src/grant-admin/schemas/grant-version-page.schema.js";
import {
  CASE_STATUS_UPDATED_EVENT_TYPE,
  CONFIG_VERSION_UPDATED_EVENT_TYPE,
} from "../../src/grants/events/inbound-event-types.js";
import { GrantDocument } from "../../src/grants/models/grant-document.js";
import { Grant } from "../../src/grants/models/grant.js";
import { resolveAndFetchGrant } from "../../src/grants/services/resolve-config-version.service.js";
import { loadPaymentDefinition } from "../../src/payments/use-cases/load-payment-definition.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
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
let inbox;
let grantDefinition;
let pmfPaymentDefinition;
let paymentDefinition;
let agreementDefinition;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  configVersions = db.collection("config_versions");
  grants = db.collection("grants");
  agreementDefinitions = db.collection("agreements__definitions");
  paymentDefinitions = db.collection("payments__definitions");
  outbox = db.collection("outbox");
  inbox = db.collection("inbox");
  grantDefinition = JSON.parse(
    await readFile(
      new URL("../fixtures/pmf-grant-definition.json", import.meta.url),
    ),
  );
  pmfPaymentDefinition = JSON.parse(
    await readFile(
      new URL(
        "../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
        import.meta.url,
      ),
    ),
  );
  paymentDefinition = await readSeed("woodland/1.39.1/gas/payment.json");
  agreementDefinition = await readSeed(
    "pigs-might-fly/1.0.0/gas/agreement.json",
  );
});

const readSeed = async (path) =>
  JSON.parse(
    await readFile(new URL(`../../compose/seed/${path}`, import.meta.url)),
  );

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

const fetchStateOf = (version, fetchStatus) => {
  const {
    fetchedAt: _,
    lastFetchAttemptAt: __,
    ...shown
  } = fileState(version, fetchStatus);

  return shown;
};

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

// Stamped as GAS's writers stamp a version they record.
const insertVersions = async (...rows) => {
  const ids = rows.map(({ _id }) => _id);
  await configVersions.insertMany(rows);
  await configVersions.updateMany({ _id: { $in: ids } }, [
    withWorstFetchStatus,
  ]);

  return configVersions.find({ _id: { $in: ids } }).toArray();
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
    await insertVersions(
      aConfigVersion("1.2.0", "active", "2026-10-10T16:25:00.000Z"),
      aConfigVersion("10.0.0", "draft", "2026-10-15T10:04:00.000Z"),
      aConfigVersion("1.10.0", "active", "2026-10-12T09:00:00.000Z"),
    );

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
          fetchStatus: "pending",
          stored: false,
        },
        {
          version: "1.10.0",
          status: "active",
          receivedAt: "2026-10-12T09:00:00.000Z",
          fetchStatus: "pending",
          stored: false,
        },
        {
          version: "1.2.0",
          status: "active",
          receivedAt: "2026-10-10T16:25:00.000Z",
          fetchStatus: "pending",
          stored: false,
        },
      ],
    });
    expect(await auditRows("VIEW_GRANT_VERSION")).toEqual([]);
  });

  it("names no current version for a draft-only grant", async () => {
    await insertVersions(
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

  beforeEach(async () => {
    await resetCwStub();
  });

  const workflowRequests = async () =>
    (await cwStubRequests()).filter((request) => request.box === "workflows");

  const storeWorkflowVersions = (...versions) =>
    setCwStub({
      workflows: {
        records: Object.fromEntries(
          versions.map((version) => [`${CODE}/${version}`, {}]),
        ),
      },
    });

  it("a draft with nothing stored: every file not stored, no definition, and the row unchanged", async () => {
    const [row] = await insertVersions(DRAFT);

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
      s3Bucket: "config-broker-local",
      files: {
        grant: { stored: false, ...fetchStateOf("2.0.0", "pending") },
        agreement: { stored: false, ...fetchStateOf("2.0.0", "pending") },
        payment: {
          stored: false,
          ...fetchStateOf("2.0.0", "permanent_error"),
        },
      },
      versions: [
        {
          version: "2.0.0",
          status: "draft",
          receivedAt: "2026-10-15T10:04:00.000Z",
          fetchStatus: "permanent_error",
          stored: false,
        },
      ],
      counterpart: null,
    });
    expect(definition.definition).toBeNull();
    expect(definition.sectionErrors).toEqual([]);
    expect(overview.overview).toEqual({
      description: null,
      startDate: null,
      adminRole: null,
      storedBytes: null,
    });
    expect(overview.header.receivedAt).toBe("2026-10-15T10:04:00.000Z");
    expect(await configVersions.findOne({ _id: DRAFT._id })).toStrictEqual(row);
  });

  it("a stored version: its files stored, the overview facts and the document as stored", async () => {
    await insertVersions(DRAFT);
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
    expect(overview.header.files).toMatchObject({
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

  it.each(["overview", "phases"])(
    "%s: the workflow link, asked of Caseworking with no operator name",
    async (tab) => {
      await insertVersions(DRAFT);
      await storeWorkflowVersions("2.0.0");

      const { payload } = await get(`${CODE}/versions/2.0.0/${tab}`);

      expect(
        grantVersionPageSchemas[tab].validate(payload).error,
      ).toBeUndefined();
      expect(payload.header.counterpart).toEqual({ exists: true });
      expect(await workflowRequests()).toEqual([
        expect.objectContaining({
          method: "GET",
          path: `/actuators/workflows/${CODE}/versions/2.0.0/existence`,
          actor: null,
        }),
      ]);
    },
  );

  it("overview: no workflow link when Caseworking has only another version", async () => {
    await insertVersions(DRAFT);
    await storeWorkflowVersions("1.2.0");

    const { payload } = await get(`${CODE}/versions/2.0.0/overview`);

    expect(payload.header.counterpart).toEqual({ exists: false });
  });

  it("overview: the workflow link is unknown, and the page still drawn, when Caseworking is down", async () => {
    await insertVersions(DRAFT);
    await setCwStub({ workflows: { mode: "down" } });

    const { payload, res } = await get(`${CODE}/versions/2.0.0/overview`);

    expect(res.statusCode).toBe(200);
    expect(payload.header.counterpart).toBeNull();
    expect(payload.overview).not.toBeNull();
  });

  it("definition: Caseworking is not asked for the workflow link", async () => {
    await insertVersions(DRAFT);
    await storeWorkflowVersions("2.0.0");

    const { payload } = await get(`${CODE}/versions/2.0.0/definition`);

    expect(payload.header.counterpart).toBeNull();
    expect(await workflowRequests()).toEqual([]);
  });

  it("a stored payment definition shows as stored", async () => {
    await insertVersions(DRAFT);
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: {},
    });

    const { payload } = await get(`${CODE}/versions/2.0.0/overview`);

    expect(payload.header.files.payment).toMatchObject({
      stored: true,
      fetchStatus: "permanent_error",
    });
  });

  it("a stored BSON number goes out as plain JSON", async () => {
    await insertVersions(DRAFT);
    await storeGrant("2.0.0");
    await grants.updateOne(
      { code: CODE, version: "2.0.0" },
      { $set: { big: Long.fromString("9007199254740993") } },
    );

    const { payload } = await get(`${CODE}/versions/2.0.0/definition`);

    expect(payload.definition.big).toBe("9007199254740993");
  });

  it("a stored document over the section cap is too large to show", async () => {
    await insertVersions(DRAFT);
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
    await insertVersions(DRAFT);
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
          processEffects: [],
        },
        {
          to: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
          kind: "move",
          from: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
          matchedBy: expect.any(String),
          processes: expect.any(Array),
          processEffects: expect.any(Array),
        },
        {
          to: "PRE_AWARD:REVIEW_APPLICATION:WITHDRAWAL_REQUESTED",
          kind: "move",
          from: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
          matchedBy: "status",
          processes: ["REQUEST_APPLICATION_WITHDRAWAL"],
          processEffects: [
            {
              process: "REQUEST_APPLICATION_WITHDRAWAL",
              setsStatus: "APPLICATION_WITHDRAWN",
              tellsCw: true,
              onlyWhen: "no agreement is on offer",
            },
          ],
        },
      ]),
    );
    expect(payload.lifecycle.phases[0].stages[0].statuses[0]).toEqual({
      code: "APPLICATION_RECEIVED",
      name: null,
    });
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
    await insertVersions(DRAFT);
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
    await insertVersions(DRAFT);

    const { payload } = await get(`${CODE}/versions/2.0.0/phases`);

    expect(payload).toMatchObject({
      lifecycle: null,
      problem: null,
      sectionErrors: [],
    });
  });

  it("writes one VIEW_GRANT_VERSION row per tab read, with the operator, PMC 0706, the version and the tab", async () => {
    await insertVersions(DRAFT);

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
    await insertVersions(DRAFT);

    const error = await get(`${CODE}/versions/9.9.9/overview`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("GRANT_VERSION_NOT_FOUND");
    const [row] = await auditRows("VIEW_GRANT_VERSION");
    expect(row.event.audit.status).toBe("FAILURE");
    expect(row.event.audit.details.tab).toBe("overview");
  });
});

describe("GET /grant-admin/grants/{code}/versions/{version}/payment", () => {
  const WITH_PAYMENT = aConfigVersion(
    "2.0.0",
    "draft",
    "2026-10-15T10:04:00.000Z",
    { payment: fileState("2.0.0", "pending") },
  );

  it("answers the stored payment definition as stored, audited with its tab", async () => {
    await configVersions.insertOne(WITH_PAYMENT);
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: pmfPaymentDefinition,
    });

    const { payload, res } = await get(`${CODE}/versions/2.0.0/payment`);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      grantVersionPageSchemas.payment.validate(payload).error,
    ).toBeUndefined();
    expect(payload.header.files.payment).toMatchObject({
      stored: true,
      fetchStatus: "pending",
    });
    expect(payload.payment).toStrictEqual(pmfPaymentDefinition);
    expect(payload.sectionErrors).toEqual([]);
    const rows = await auditRows("VIEW_GRANT_VERSION");
    expect(rows).toHaveLength(1);
    expect(rows[0].event.audit).toMatchObject({
      status: "SUCCESS",
      details: { version: "2.0.0", tab: "payment" },
    });
  });

  it("a payment file not stored is null; the read stores nothing and leaves the config version unchanged", async () => {
    const s3 = new S3Client({
      region: config.region,
      endpoint: config.awsEndpointUrl,
      forcePathStyle: true,
    });
    const Key = `${CODE}/payment-read/2.0.0/gas/payment.json`;
    const inS3 = aConfigVersion("2.0.0", "draft", "2026-10-15T10:04:00.000Z", {
      payment: { ...fileState("2.0.0", "pending"), s3Key: Key },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: inS3.s3Bucket,
        Key,
        Body: JSON.stringify(pmfPaymentDefinition),
        ContentType: "application/json",
      }),
    );
    await configVersions.insertOne(inS3);

    try {
      const { payload } = await get(`${CODE}/versions/2.0.0/payment`);

      expect(payload.header.files.payment).toMatchObject({
        stored: false,
        fetchStatus: "pending",
      });
      expect(payload.payment).toBeNull();
      expect(payload.sectionErrors).toEqual([]);
      expect(await configVersions.findOne({ _id: inS3._id })).toStrictEqual(
        inS3,
      );
      expect(await paymentDefinitions.countDocuments()).toBe(0);
    } finally {
      await s3.send(new DeleteObjectCommand({ Bucket: inS3.s3Bucket, Key }));
    }
  });

  it("a stored definition over the section cap is too large to show", async () => {
    await configVersions.insertOne(WITH_PAYMENT);
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: {
        ...pmfPaymentDefinition,
        padding: "x".repeat(1_100_000),
      },
    });

    const { payload } = await get(`${CODE}/versions/2.0.0/payment`);

    expect(payload.payment).toBeNull();
    expect(payload.sectionErrors).toEqual([
      { section: "payment", message: "too large to show" },
    ]);
  });

  it("answers 404 NO_DEFINITION_FILE for a version with no payment file, audited as a FAILURE", async () => {
    await configVersions.insertOne(
      aConfigVersion("2.0.0", "draft", "2026-10-15T10:04:00.000Z"),
    );

    const error = await get(`${CODE}/versions/2.0.0/payment`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("NO_DEFINITION_FILE");
    const [row] = await auditRows("VIEW_GRANT_VERSION");
    expect(row.event.audit.status).toBe("FAILURE");
    expect(row.event.audit.details.tab).toBe("payment");
  });
});

describe("GET /grant-admin/grants/{code}/versions/{version}/agreement", () => {
  const ACTIVE = aConfigVersion("1.2.0", "active", "2026-10-10T16:25:00.000Z", {
    agreement: fileState("1.2.0", "fetched"),
  });

  let agreementDefinition;

  beforeAll(async () => {
    const seeded = JSON.parse(
      await readFile(
        new URL(
          "../../compose/seed/pigs-might-fly/1.0.0/gas/agreement.json",
          import.meta.url,
        ),
      ),
    );

    agreementDefinition = {
      ...seeded,
      code: CODE,
      endpoints: [
        {
          code: "PARCELS",
          method: "GET",
          service: "LAND_DATA",
          path: "/api/v2/parcels/{sbi}",
        },
        {
          code: "SIGNING",
          method: "POST",
          service: "AGREEMENT_SIGNING",
          path: "/sign",
        },
      ],
      processDefinitions: {
        ...seeded.processDefinitions,
        FETCH_PARCELS: {
          type: "endpoint",
          endpoint: {
            method: "GET",
            service: "LAND_DATA",
            path: "/api/v2/parcels/{sbi}",
          },
          request: { body: { scheme: "woodland" } },
          output: { parcels: "$.response.parcels" },
        },
        SEND_DOCUMENT: {
          type: "endpoint",
          endpoint: {
            method: "POST",
            service: "AGREEMENT_DOCS",
            path: "/documents",
          },
          request: { body: { scheme: "woodland" } },
          output: { name: "$.response.name" },
        },
      },
    };
  });

  const storeAgreement = (definition) =>
    agreementDefinitions.insertOne({
      code: CODE,
      version: "1.2.0",
      definition,
    });

  it("answers the definition as stored with each endpoint's Service Address, and nothing of the service's secrets", async () => {
    await configVersions.insertOne(ACTIVE);
    await storeAgreement(agreementDefinition);

    const { payload, res } = await get(`${CODE}/versions/1.2.0/agreement`);

    expect(res.statusCode).toBe(200);
    expect(
      grantVersionPageSchemas.agreement.validate(payload).error,
    ).toBeUndefined();
    expect(payload.agreement.definition).toStrictEqual(agreementDefinition);
    expect(payload.agreement.problem).toBeNull();
    expect(payload.agreement.addresses).toEqual([
      {
        process: "GENERATE_OFFER",
        service: "GRANT_FUNDING_CALCULATOR",
        url: expect.stringMatching(
          /^http:\/\/host\.docker\.internal:\d+\/paymentSchedule$/,
        ),
      },
      {
        process: "FETCH_PARCELS",
        service: "LAND_DATA",
        url: "https://land-data.test/base/api/v2/parcels/{sbi}",
      },
      { process: "SEND_DOCUMENT", service: "AGREEMENT_DOCS", url: null },
    ]);
    expect(payload.agreement.endpointAddresses).toEqual([
      {
        code: "PARCELS",
        service: "LAND_DATA",
        url: "https://land-data.test/base/api/v2/parcels/{sbi}",
      },
      { code: "SIGNING", service: "AGREEMENT_SIGNING", url: null },
    ]);
    expect(payload.agreement.missingServiceUrls).toEqual([
      "AGREEMENT_SIGNING_URL",
      "AGREEMENT_DOCS_URL",
    ]);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("u:p");
    expect(text).not.toContain("k=v");
  });

  it("answers a stored definition GAS cannot load as stored, with its problem and no addresses", async () => {
    const refused = { ...agreementDefinition, code: "other-grant" };
    await configVersions.insertOne(ACTIVE);
    await storeAgreement(refused);

    const { payload, res } = await get(`${CODE}/versions/1.2.0/agreement`);

    expect(res.statusCode).toBe(200);
    expect(payload.agreement).toStrictEqual({
      definition: refused,
      addresses: [],
      endpointAddresses: [],
      missingServiceUrls: [],
      problem: `Agreement definition code "other-grant" does not match "${CODE}"`,
    });
    expect(payload.sectionErrors).toEqual([]);
  });

  it("answers null when the agreement file is not stored, and the file waiting in S3 is not fetched", async () => {
    const s3 = new S3Client({
      region: config.region,
      endpoint: config.awsEndpointUrl,
      forcePathStyle: true,
    });
    const Key = `${CODE}/agreement-read/1.2.0/gas/agreement.json`;
    const inS3 = aConfigVersion("1.2.0", "active", "2026-10-10T16:25:00.000Z", {
      agreement: { ...fileState("1.2.0", "pending"), s3Key: Key },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: inS3.s3Bucket,
        Key,
        Body: JSON.stringify(agreementDefinition),
        ContentType: "application/json",
      }),
    );
    await configVersions.insertOne(inS3);

    try {
      const { payload } = await get(`${CODE}/versions/1.2.0/agreement`);

      expect(payload.header.files.agreement).toMatchObject({
        stored: false,
        fetchStatus: "pending",
      });
      expect(payload.agreement).toBeNull();
      expect(payload.sectionErrors).toEqual([]);
      expect(await configVersions.findOne({ _id: inS3._id })).toStrictEqual(
        inS3,
      );
      expect(await agreementDefinitions.countDocuments()).toBe(0);
    } finally {
      await s3.send(new DeleteObjectCommand({ Bucket: inS3.s3Bucket, Key }));
    }
  });

  it("answers 404 NO_DEFINITION_FILE for a version with no agreement file", async () => {
    await configVersions.insertOne(
      aConfigVersion("1.2.0", "active", "2026-10-10T16:25:00.000Z"),
    );

    const error = await get(`${CODE}/versions/1.2.0/agreement`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("NO_DEFINITION_FILE");
  });

  it("is audited as a VIEW_GRANT_VERSION of the agreement tab", async () => {
    await configVersions.insertOne(ACTIVE);

    await get(`${CODE}/versions/1.2.0/agreement`);

    const [row] = await auditRows("VIEW_GRANT_VERSION");
    expect(row.event.audit.details).toMatchObject({
      version: "1.2.0",
      tab: "agreement",
    });
  });
});

describe("GET /grant-admin/grants/{code}/versions/{version}/entitlements", () => {
  const ACCEPTED = {
    phase: "POST_AGREEMENT_MONITORING",
    stage: "MONITORING",
    status: "AGREEMENT_ACCEPTED",
  };
  const ENTITLEMENTS = {
    entitlementTemplates: [
      {
        claimCode: "MAINTENANCE",
        name: "Maintenance payment",
        availableAt: [{ phase: "POST_AGREEMENT_MONITORING" }],
        claim: { claimableAt: [ACCEPTED], requiresApproval: true },
      },
    ],
    claims: {
      onClaimApproval: { currentPosition: ACCEPTED, targetPosition: ACCEPTED },
      requiredRoles: { allOf: ["Grants.Claims.Read"], anyOf: [] },
    },
  };
  const WITH_PAYMENT = aConfigVersion(
    "2.0.0",
    "draft",
    "2026-10-15T10:04:00.000Z",
    { payment: fileState("2.0.0", "pending") },
  );

  const namingAccepted = (phases) =>
    phases.map((phase) => ({
      ...phase,
      stages: phase.stages.map((stage) => ({
        ...stage,
        statuses: stage.statuses.map((status) =>
          status.code === ACCEPTED.status
            ? { ...status, name: "Agreement accepted" }
            : status,
        ),
      })),
    }));

  it("answers the templates as the model reads them, the claims, the status names and the stored payment definition, audited with its tab", async () => {
    await configVersions.insertOne(WITH_PAYMENT);
    await storeGrant("2.0.0", {
      ...ENTITLEMENTS,
      phases: namingAccepted(grantDefinition.phases),
    });
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: pmfPaymentDefinition,
    });

    const { payload, res } = await get(`${CODE}/versions/2.0.0/entitlements`);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      grantVersionPageSchemas.entitlements.validate(payload).error,
    ).toBeUndefined();
    expect(payload.entitlements).toStrictEqual({
      entitlementTemplates: [
        {
          claimCode: "MAINTENANCE",
          name: "Maintenance payment",
          materialised: true,
          maxEntitlements: 1,
          availableAt: [{ phase: "POST_AGREEMENT_MONITORING" }],
          claim: {
            claimableAt: [ACCEPTED],
            limits: { maximumClaims: 1, allowsPartialClaims: false },
            requiresApproval: true,
            requiresEvidence: false,
          },
        },
      ],
      claims: ENTITLEMENTS.claims,
      statusNames: {
        "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED":
          "Agreement accepted",
      },
      payment: pmfPaymentDefinition,
    });
    expect(payload.sectionErrors).toEqual([]);
    const rows = await auditRows("VIEW_GRANT_VERSION");
    expect(rows).toHaveLength(1);
    expect(rows[0].event.audit).toMatchObject({
      status: "SUCCESS",
      details: { version: "2.0.0", tab: "entitlements" },
    });
  });

  it("a version with no payment file is read, with no templates, no claims and no payment definition", async () => {
    await configVersions.insertOne(
      aConfigVersion("2.0.0", "draft", "2026-10-15T10:04:00.000Z"),
    );
    await storeGrant("2.0.0");

    const { payload } = await get(`${CODE}/versions/2.0.0/entitlements`);

    expect(payload.entitlements).toStrictEqual({
      entitlementTemplates: [],
      claims: null,
      statusNames: {},
      payment: null,
    });
    expect(payload.sectionErrors).toEqual([]);
  });

  it("a grant file not stored is null, with no section error", async () => {
    await configVersions.insertOne(WITH_PAYMENT);

    const { payload } = await get(`${CODE}/versions/2.0.0/entitlements`);

    expect(payload.header.files.grant.stored).toBe(false);
    expect(payload.entitlements).toBeNull();
    expect(payload.sectionErrors).toEqual([]);
  });

  it("a stored payment definition over the section cap makes the section too large to show", async () => {
    await configVersions.insertOne(WITH_PAYMENT);
    await storeGrant("2.0.0", ENTITLEMENTS);
    await paymentDefinitions.insertOne({
      code: CODE,
      version: "2.0.0",
      definition: {
        ...pmfPaymentDefinition,
        padding: "x".repeat(1_100_000),
      },
    });

    const { payload } = await get(`${CODE}/versions/2.0.0/entitlements`);

    expect(payload.entitlements).toBeNull();
    expect(payload.sectionErrors).toEqual([
      { section: "entitlements", message: "too large to show" },
    ]);
  });

  it("a stored grant the model refuses is a section error", async () => {
    await configVersions.insertOne(WITH_PAYMENT);
    await storeGrant("2.0.0", ENTITLEMENTS);
    await grants.updateOne(
      { code: CODE, version: "2.0.0" },
      { $set: { "entitlementTemplates.0.materialised": null } },
    );

    const { payload } = await get(`${CODE}/versions/2.0.0/entitlements`);

    expect(payload.entitlements).toBeNull();
    expect(payload.sectionErrors).toEqual([
      {
        section: "entitlements",
        message: "An internal server error occurred",
      },
    ]);
  });
});

describe("GET /grant-admin/grants/{code}/versions/{version}/events", () => {
  // Stamped as the inbox writer stamps an arriving message.
  const anInboxRow = (type, data, publicationDate, status = "COMPLETED") => {
    const event = { id: new ObjectId().toHexString(), type, data };

    return {
      _id: new ObjectId(),
      messageId: event.id,
      type,
      status,
      completionAttempts: 1,
      publicationDate,
      claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      event,
      ...inboxStamps(event, { segregationRef: data.grantCode ?? CODE }),
    };
  };

  const aConfigVersionEvent = (grantCode, version, publicationDate, status) =>
    anInboxRow(
      CONFIG_VERSION_UPDATED_EVENT_TYPE,
      { grantCode, version, status: "active" },
      publicationDate,
      status,
    );

  it("lists each version's own config version events, newest first, with a dead-lettered event as a dead letter", async () => {
    await configVersions.insertMany([
      aConfigVersion("1.0.0", "active", "2026-10-10T09:00:00.000Z"),
      aConfigVersion("1.1.0", "active", "2026-10-11T09:00:00.000Z"),
    ]);
    const stored = aConfigVersionEvent(
      CODE,
      "1.0.0",
      "2026-10-10T09:00:00.000Z",
    );
    const deadLettered = aConfigVersionEvent(
      CODE,
      "1.0.0",
      "2026-10-13T09:00:00.000Z",
      "DEAD_LETTER",
    );
    const next = aConfigVersionEvent(CODE, "1.1.0", "2026-10-11T09:00:00.000Z");
    await inbox.insertMany([
      stored,
      deadLettered,
      next,
      aConfigVersionEvent(
        CODE.toUpperCase(),
        "1.0.0",
        "2026-10-12T09:00:00.000Z",
      ),
      aConfigVersionEvent("other-grant", "1.0.0", "2026-10-12T09:00:00.000Z"),
      anInboxRow(
        CASE_STATUS_UPDATED_EVENT_TYPE,
        { workflowCode: "other-workflow", caseRef: CODE },
        "2026-10-12T09:00:00.000Z",
      ),
    ]);

    const { payload: page, res } = await get(`${CODE}/versions/1.0.0/events`);
    const { payload: nextPage } = await get(`${CODE}/versions/1.1.0/events`);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(grantVersionPageSchemas.events.validate(page).error).toBeUndefined();
    expect(page.events.rows.map(({ id }) => id)).toEqual([
      deadLettered._id.toHexString(),
      stored._id.toHexString(),
    ]);
    expect(page.events.rows[0]).toMatchObject({
      service: "gas",
      box: "inbox",
      eventId: deadLettered.messageId,
      type: "ConfigVersionUpdated",
      status: "DEAD_LETTER",
      statusRole: "error",
    });
    expect(page.events.more).toBe(false);
    expect(page.sourceErrors).toEqual([]);
    expect(nextPage.events.rows.map(({ id }) => id)).toEqual([
      next._id.toHexString(),
    ]);
    const rows = await auditRows("VIEW_GRANT_VERSION");
    expect(rows.map((row) => row.event.audit.details)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: "1.0.0", tab: "events" }),
        expect.objectContaining({ version: "1.1.0", tab: "events" }),
      ]),
    );
  });

  it("answers no events for a code none were stamped for", async () => {
    await configVersions.insertOne(
      aConfigVersion("1.0.0", "active", "2026-10-10T09:00:00.000Z"),
    );

    const { payload: page } = await get(`${CODE}/versions/1.0.0/events`);

    expect(page.events).toEqual({ rows: [], more: false });
  });
});

describe("POST /grant-admin/grants/{code}/versions/{version}/fetch", () => {
  const BUCKET = "config-broker-local";
  const s3Client = new S3Client({
    region: config.region,
    endpoint: config.awsEndpointUrl,
    forcePathStyle: true,
  });

  const keyOf = (code, version, file) =>
    `admin-fetch/${code}/${version}/gas/${file}.json`;

  const put = (key, definition) =>
    s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(definition),
        ContentType: "application/json",
      }),
    );

  const located = (code, version, file, fetchStatus = "pending") => ({
    ...fileState(version, fetchStatus),
    s3Key: keyOf(code, version, file),
  });

  const aPublishedVersion = (
    version,
    { status = "draft", grantStatus = "pending", code = CODE } = {},
  ) => ({
    ...aConfigVersion(version, status, "2026-10-15T10:04:00.000Z"),
    grantCode: code,
    definitions: {
      grant: located(code, version, "gas", grantStatus),
      agreement: located(code, version, "agreement"),
      payment: located(code, version, "payment"),
    },
  });

  const publish = (version, { code = CODE, files = {} } = {}) => {
    const published = {
      gas: { ...grantDefinition, code },
      agreement: { ...agreementDefinition, code },
      payment: { ...paymentDefinition, code },
      ...files,
    };

    return Promise.all(
      Object.entries(published)
        .filter(([, definition]) => definition)
        .map(([file, definition]) =>
          put(keyOf(code, version, file), definition),
        ),
    );
  };

  const fetchDefinitions = async (code, version) => {
    const { payload } = await wreck.post(
      `/grant-admin/grants/${code}/versions/${version}/fetch`,
      { headers: OPERATOR },
    );

    expect(fetchDefinitionsResponseSchema.validate(payload).error).toBe(
      undefined,
    );

    return payload;
  };

  const ALL_STORED = {
    files: [
      { file: "grant", outcome: "stored" },
      { file: "agreement", outcome: "stored" },
      { file: "payment", outcome: "stored" },
    ],
  };

  it("stores every file, leaves the version row as it was and audits the operator", async () => {
    const [row] = await insertVersions(aPublishedVersion("3.0.0"));
    await publish("3.0.0");

    expect(await fetchDefinitions(CODE, "3.0.0")).toEqual(ALL_STORED);

    expect(row.worstFetchStatus).toBe("pending");
    expect(await configVersions.findOne({ _id: row._id })).toStrictEqual(row);
    const { payload } = await get(`${CODE}/versions/3.0.0/definition`);
    expect(payload.header.versions).toEqual([
      expect.objectContaining({
        version: "3.0.0",
        fetchStatus: "pending",
        stored: true,
      }),
    ]);
    expect(payload.header.files).toMatchObject({
      grant: { stored: true, fetchStatus: "pending" },
      agreement: { stored: true, fetchStatus: "pending" },
      payment: { stored: true, fetchStatus: "pending" },
    });
    expect(payload.definition.code).toBe(CODE);
    const rows = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          {
            entity: "GRANT",
            action: "FETCH_CONFIG_DEFINITION",
            entityid: CODE,
          },
        ],
        details: { version: "3.0.0", files: ALL_STORED.files },
      },
    });
  });

  it("reports a missing payment file, stores nothing for it and still stores the others", async () => {
    const [row] = await insertVersions(aPublishedVersion("3.0.1"));
    await publish("3.0.1", { files: { payment: null } });

    expect(await fetchDefinitions(CODE, "3.0.1")).toEqual({
      files: [
        { file: "grant", outcome: "stored" },
        { file: "agreement", outcome: "stored" },
        {
          file: "payment",
          outcome: "failed",
          reason: "missing",
          message: null,
        },
      ],
    });

    expect(
      await paymentDefinitions.findOne({ code: CODE, version: "3.0.1" }),
    ).toBeNull();
    expect(await configVersions.findOne({ _id: row._id })).toStrictEqual(row);
  });

  it("reports a file arrival would refuse as invalid, with GAS's reason", async () => {
    await insertVersions(aPublishedVersion("3.0.2"));
    await publish("3.0.2", {
      files: { payment: { ...paymentDefinition, code: CODE, unknownField: 1 } },
    });

    const { files } = await fetchDefinitions(CODE, "3.0.2");

    expect(files[2]).toEqual({
      file: "payment",
      outcome: "failed",
      reason: "invalid",
      message: expect.any(String),
    });
    expect(
      await paymentDefinitions.findOne({ code: CODE, version: "3.0.2" }),
    ).toBeNull();
  });

  it("answers no files once every one is stored, and two at once leave one copy of each", async () => {
    await insertVersions(aPublishedVersion("3.0.3"));
    await publish("3.0.3");

    const both = await Promise.all([
      fetchDefinitions(CODE, "3.0.3"),
      fetchDefinitions(CODE, "3.0.3"),
    ]);

    expect(both).toEqual([ALL_STORED, ALL_STORED]);
    expect(await fetchDefinitions(CODE, "3.0.3")).toEqual({ files: [] });
    const filter = { code: CODE, version: "3.0.3" };
    expect(await grants.countDocuments(filter)).toBe(1);
    expect(await agreementDefinitions.countDocuments(filter)).toBe(1);
    expect(await paymentDefinitions.countDocuments(filter)).toBe(1);
  });

  it("stores a version GAS won't use, and leaves it so", async () => {
    const [row] = await insertVersions(
      aPublishedVersion("3.0.4", { grantStatus: "permanent_error" }),
    );
    await publish("3.0.4");

    expect(await fetchDefinitions(CODE, "3.0.4")).toEqual(ALL_STORED);
    expect(await configVersions.findOne({ _id: row._id })).toStrictEqual(row);
  });

  it("refuses an aliased grant file, storing nothing for it, each time it is asked", async () => {
    const ALIAS = "frps-private-beta";
    await insertVersions(aPublishedVersion("3.0.5", { code: "farm-payments" }));
    await publish("3.0.5", {
      code: "farm-payments",
      files: { gas: { ...grantDefinition, code: ALIAS } },
    });
    const refused = {
      file: "grant",
      outcome: "failed",
      reason: "invalid",
      message: `Definition is for "${ALIAS}", not "farm-payments"`,
    };

    const first = await fetchDefinitions("farm-payments", "3.0.5");
    const again = await fetchDefinitions("farm-payments", "3.0.5");

    expect(first).toEqual({ files: [refused, ...ALL_STORED.files.slice(1)] });
    expect(again).toEqual({ files: [refused] });
    const { payload } = await get("farm-payments/versions/3.0.5/overview");
    expect(payload.header.files.grant.stored).toBe(false);
    expect(await grants.countDocuments({ version: "3.0.5" })).toBe(0);
  });

  it("answers 404 GRANT_VERSION_NOT_FOUND for an unknown version, audited as a FAILURE", async () => {
    const error = await wreck
      .post(`/grant-admin/grants/${CODE}/versions/9.9.9/fetch`, {
        headers: OPERATOR,
      })
      .catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("GRANT_VERSION_NOT_FOUND");
    const [row] = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(row.event.audit).toMatchObject({
      status: "FAILURE",
      details: { files: [], errorCode: "GRANT_VERSION_NOT_FOUND" },
    });
  });

  it("refuses an operator with no Entra id", async () => {
    const error = await wreck
      .post(`/grant-admin/grants/${CODE}/versions/3.0.0/fetch`, {
        headers: { "x-actor": "Jo Operator" },
      })
      .catch((e) => e);

    expect(error.output.statusCode).toBe(400);
  });

  it("GAS still resolves an admin-fetched version as before, and records it fetched", async () => {
    vi.stubEnv("GRANT_FUNDING_CALCULATOR_URL", "http://127.0.0.1:1");
    await insertVersions(aPublishedVersion("3.0.6", { status: "active" }));
    await publish("3.0.6");
    await fetchDefinitions(CODE, "3.0.6");

    const resolved = await resolveAndFetchGrant(CODE, "3.0.6");
    const agreement = await loadAgreementDefinition({
      code: CODE,
      configVersion: "3.0.6",
      resolution: "exact",
    });
    const payment = await loadPaymentDefinition({
      code: CODE,
      configVersion: "3.0.6",
    });

    expect(resolved.resolvedVersion).toBe("3.0.6");
    expect(resolved.grant).toMatchObject({ code: CODE, version: "3.0.6" });
    expect(agreement.configVersion).toBe("3.0.6");
    expect(payment.code).toBe(CODE);
    const { definitions } = await configVersions.findOne({
      grantCode: CODE,
      version: "3.0.6",
    });
    expect(definitions.grant.fetchStatus).toBe("fetched");
    expect(definitions.agreement.fetchStatus).toBe("fetched");
    expect(definitions.payment.fetchStatus).toBe("fetched");
  });
});
