import { MongoClient, ObjectId } from "mongodb";
import { env } from "node:process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  workflowFetchDefinitionsResponseSchema,
  workflowVersionPageSchemas,
  workflowVersionsSchema,
} from "../../src/grant-admin/schemas/workflow-version-page.schema.js";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { wreck } from "../helpers/wreck.js";

const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ACTOR = "UTF-8''%C5%81ukasz";
const OPERATOR = { "x-actor": ACTOR, "x-actor-id": OID };
const AUDIT_TOPIC =
  "arn:aws:sns:eu-west-2:000000000000:gas__sns__audit_topic_arn";
const CODE = "Casework-Smoke";

// Longer than GAS gives Caseworking, so a timeout is GAS's answer, not ours.
const CLIENT_TIMEOUT_MS = 10_000;
const SLOW = { timeout: 15_000 };

let client;
let configVersions;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  const db = client.db();
  configVersions = db.collection("config_versions");
  outbox = db.collection("outbox");
});

afterAll(async () => {
  await client?.close();
});

beforeEach(async () => {
  await resetCwStub();
});

const VERSIONS = [
  { version: "2.0.0", status: "draft", receivedAt: "2026-10-15T10:04:00.000Z" },
  {
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-01T09:00:00.000Z",
  },
];

const DOCUMENT = {
  _id: "6710c4e2a1b2c3d4e5f6a7b8",
  code: CODE,
  schemeName: "Casework smoke",
  version: "1.2.0",
  phases: [],
  requiredRoles: { allOf: ["Casework.Read"], anyOf: [] },
  endpoints: [
    {
      code: "land-parcels",
      service: "LAND_DATA",
      path: "/parcels/{sbi}",
      method: "GET",
    },
  ],
};

const ADDRESSES = [
  {
    code: "land-parcels",
    service: "LAND_DATA",
    url: "https://land-data.example/api/v2/parcels/{sbi}",
  },
];

const aVersionRecord = (version, status, overrides = {}) => ({
  version: {
    grantCode: CODE,
    version,
    status,
    receivedAt: VERSIONS.find((entry) => entry.version === version).receivedAt,
    fetchStatus: "fetched",
  },
  versions: VERSIONS,
  current: "1.2.0",
  storedBytes: 48213,
  summary: {
    schemeName: DOCUMENT.schemeName,
    requiredRoles: DOCUMENT.requiredRoles,
  },
  document: DOCUMENT,
  addresses: ADDRESSES,
  ...overrides,
});

const NOT_STORED = aVersionRecord("2.0.0", "draft", {
  version: {
    grantCode: CODE,
    version: "2.0.0",
    status: "draft",
    receivedAt: "2026-10-15T10:04:00.000Z",
    fetchStatus: "permanent_error",
  },
  storedBytes: null,
  summary: null,
  document: null,
  addresses: [],
});

const get = (path, headers = OPERATOR) =>
  wreck.get(`/grant-admin/workflows/${path}`, {
    headers,
    timeout: CLIENT_TIMEOUT_MS,
  });

const post = (path, headers = OPERATOR) =>
  wreck.post(`/grant-admin/workflows/${path}`, {
    headers,
    timeout: CLIENT_TIMEOUT_MS,
  });

const workflowRequests = async () =>
  (await cwStubRequests()).filter((request) => request.box === "workflows");

const auditRows = (action) =>
  outbox
    .find({ target: AUDIT_TOPIC, "event.audit.entities.action": action })
    .toArray();

const statusOf = (promise) =>
  promise.then(
    () => 200,
    (error) => error.output.statusCode,
  );

describe("GET /grant-admin/workflows/{code}/versions", () => {
  it("answers Caseworking's versions, newest first, asked as the operator", async () => {
    await setCwStub({
      workflows: {
        versions: {
          [CODE]: { code: CODE, current: "1.2.0", versions: VERSIONS },
        },
      },
    });

    const { payload } = await get(`${CODE}/versions`);

    expect(workflowVersionsSchema.validate(payload).error).toBeUndefined();
    expect(payload).toEqual({
      code: CODE,
      current: "1.2.0",
      versions: VERSIONS,
    });
    const [request] = await workflowRequests();
    expect(request).toMatchObject({
      method: "GET",
      path: `/actuators/workflows/${CODE}/versions`,
      actor: ACTOR,
      actorId: OID,
    });
  });

  it("answers 404 WORKFLOW_NOT_FOUND for a code Caseworking does not have", async () => {
    const error = await get("nowhere/versions").catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("WORKFLOW_NOT_FOUND");
  });
});

describe("GET /grant-admin/workflows/{code}/versions/{version}/{tab}", () => {
  beforeEach(async () => {
    await setCwStub({
      workflows: {
        records: {
          [`${CODE}/1.2.0`]: aVersionRecord("1.2.0", "active"),
          [`${CODE}/2.0.0`]: NOT_STORED,
        },
      },
    });
  });

  it("overview: the stored workflow's facts, the header and the grant link, read without the document", async () => {
    await configVersions.insertOne({
      _id: new ObjectId(),
      grantCode: CODE,
      version: "1.2.0",
      status: "active",
    });

    const { payload: page, res } = await get(`${CODE}/versions/1.2.0/overview`);

    expect(res.headers["cache-control"]).toBe("no-store");
    expect(
      workflowVersionPageSchemas.overview.validate(page).error,
    ).toBeUndefined();
    expect(page.header).toEqual({
      code: CODE,
      version: "1.2.0",
      status: "active",
      receivedAt: "2026-10-01T09:00:00.000Z",
      files: { workflow: { stored: true, fetchStatus: "fetched" } },
      versions: VERSIONS,
      counterpart: { exists: true },
    });
    expect(page.overview).toEqual({
      schemeName: "Casework smoke",
      requiredRoles: { allOf: ["Casework.Read"], anyOf: [] },
      storedBytes: 48213,
    });
    const [request] = await workflowRequests();
    expect(request.path).toBe(`/actuators/workflows/${CODE}/versions/1.2.0`);
    expect(request.query).toEqual({});
  });

  it("overview: a workflow with no grant says so", async () => {
    const { payload } = await get(`${CODE}/versions/1.2.0/overview`);

    expect(payload.header.counterpart).toEqual({ exists: false });
  });

  it("definition: the stored workflow and each endpoint's address, with no grant link read", async () => {
    const { payload: page } = await get(`${CODE}/versions/1.2.0/definition`);

    expect(
      workflowVersionPageSchemas.definition.validate(page).error,
    ).toBeUndefined();
    expect(page.definition).toEqual({
      workflow: DOCUMENT,
      addresses: ADDRESSES,
    });
    expect(page.header.counterpart).toBeNull();
    const [request] = await workflowRequests();
    expect(request.query).toEqual({ include: "document" });
  });

  it("raw: Caseworking's workflow document whole, with its size, and no addresses", async () => {
    const { payload: page } = await get(`${CODE}/versions/1.2.0/raw`);

    expect(workflowVersionPageSchemas.raw.validate(page).error).toBeUndefined();
    expect(page.raw).toEqual(DOCUMENT);
    expect(page.storedBytes).toBe(48213);
    expect(page).not.toHaveProperty("addresses");
  });

  it.each([
    ["overview", { schemeName: null, requiredRoles: null, storedBytes: null }],
    ["definition", null],
    ["raw", null],
  ])(
    "%s: a workflow not stored is null, with no section error",
    async (tab, expected) => {
      const { payload: page } = await get(`${CODE}/versions/2.0.0/${tab}`);

      expect(
        workflowVersionPageSchemas[tab].validate(page).error,
      ).toBeUndefined();
      expect(page.header.files).toEqual({
        workflow: { stored: false, fetchStatus: "permanent_error" },
      });
      expect(page[tab]).toEqual(expected);
      expect(page.sectionErrors).toEqual([]);
    },
  );

  it("raw: a document over 1 MiB is too large to show, its size still given", async () => {
    await setCwStub({
      workflows: {
        records: {
          [`${CODE}/1.2.0`]: aVersionRecord("1.2.0", "active", {
            storedBytes: 1_100_100,
            document: { ...DOCUMENT, pad: "x".repeat(1_100_000) },
          }),
        },
      },
    });

    const { payload } = await get(`${CODE}/versions/1.2.0/raw`);

    expect(payload.raw).toBeNull();
    expect(payload.storedBytes).toBe(1_100_100);
    expect(payload.sectionErrors).toEqual([
      { section: "raw", message: "too large to show" },
    ]);
  });

  it("writes one VIEW_WORKFLOW_VERSION row per tab read, with the operator, PMC 0706, the version and the tab", async () => {
    await get(`${CODE}/versions/1.2.0/raw`);

    const rows = await auditRows("VIEW_WORKFLOW_VERSION");
    expect(rows).toHaveLength(1);
    expect(rows[0].segregationRef).toBe("admin-view-workflow-version");
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          {
            entity: "WORKFLOW",
            action: "VIEW_WORKFLOW_VERSION",
            entityid: CODE,
          },
        ],
        details: { version: "1.2.0", tab: "raw" },
      },
    });
  });

  it("answers 404 WORKFLOW_VERSION_NOT_FOUND for an unknown version, audited as a FAILURE", async () => {
    const error = await get(`${CODE}/versions/9.9.9/overview`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("WORKFLOW_VERSION_NOT_FOUND");
    const [row] = await auditRows("VIEW_WORKFLOW_VERSION");
    expect(row.event.audit.status).toBe("FAILURE");
  });

  it(
    "answers 504 when Caseworking times out and 502 when it fails",
    SLOW,
    async () => {
      await setCwStub({ workflows: { mode: "timeout" } });
      expect(await statusOf(get(`${CODE}/versions/1.2.0/overview`))).toBe(504);

      await setCwStub({ workflows: { mode: "error" } });
      expect(await statusOf(get(`${CODE}/versions/1.2.0/overview`))).toBe(502);
    },
  );
});

describe("POST /grant-admin/workflows/{code}/versions/{version}/fetch", () => {
  const FAILED = {
    files: [
      {
        file: "workflow",
        outcome: "failed",
        reason: "invalid",
        message: "Workflow phases are not unique",
      },
    ],
  };

  it("asks Caseworking to fetch, naming the operator, and audits the answered fetch as a SUCCESS", async () => {
    await setCwStub({
      workflows: {
        fetches: {
          [`${CODE}/2.0.0`]: {
            files: [{ file: "workflow", outcome: "stored" }],
          },
        },
      },
    });

    const { payload } = await post(`${CODE}/versions/2.0.0/fetch`);

    expect(
      workflowFetchDefinitionsResponseSchema.validate(payload).error,
    ).toBeUndefined();
    expect(payload).toEqual({
      files: [{ file: "workflow", outcome: "stored" }],
    });
    const [request] = await workflowRequests();
    expect(request).toMatchObject({
      method: "POST",
      path: `/actuators/workflows/${CODE}/versions/2.0.0/fetch`,
      query: { by: "Łukasz" },
      actorId: OID,
    });
    const rows = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(rows).toHaveLength(1);
    expect(rows[0].segregationRef).toBe(`fetch-definition-${CODE}`);
    expect(rows[0].event).toMatchObject({
      user: OID,
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        entities: [
          {
            entity: "WORKFLOW",
            action: "FETCH_CONFIG_DEFINITION",
            entityid: CODE,
          },
        ],
        details: {
          version: "2.0.0",
          files: [{ file: "workflow", outcome: "stored" }],
        },
      },
    });
  });

  it("answers a refused file with Caseworking's reason, audited as a SUCCESS naming it", async () => {
    await setCwStub({ workflows: { fetches: { [`${CODE}/2.0.0`]: FAILED } } });

    const { payload } = await post(`${CODE}/versions/2.0.0/fetch`);

    expect(payload).toEqual(FAILED);
    const [row] = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(row.event.audit.details.files).toEqual([
      { file: "workflow", outcome: "failed", reason: "invalid" },
    ]);
  });

  it("answers 404 WORKFLOW_VERSION_NOT_FOUND for an unknown version, audited as a FAILURE", async () => {
    const error = await post(`${CODE}/versions/9.9.9/fetch`).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.data.payload.reason).toBe("WORKFLOW_VERSION_NOT_FOUND");
    const [row] = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(row.event.audit).toMatchObject({
      status: "FAILURE",
      details: { errorCode: "WORKFLOW_VERSION_NOT_FOUND", files: [] },
    });
  });

  it("answers 502 when Caseworking is down, audited as a FAILURE", async () => {
    await setCwStub({ workflows: { mode: "error" } });

    expect(await statusOf(post(`${CODE}/versions/2.0.0/fetch`))).toBe(502);
    const [row] = await auditRows("FETCH_CONFIG_DEFINITION");
    expect(row.event.audit.status).toBe("FAILURE");
  });

  it("refuses an operator with no name, asking Caseworking nothing and auditing nothing", async () => {
    expect(
      await statusOf(
        post(`${CODE}/versions/2.0.0/fetch`, { "x-actor-id": OID }),
      ),
    ).toBe(400);
    expect(await workflowRequests()).toEqual([]);
    expect(await auditRows("FETCH_CONFIG_DEFINITION")).toEqual([]);
  });
});
