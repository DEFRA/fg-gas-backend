import hapi from "@hapi/hapi";
import { ClientSession, Collection } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createHash } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let replSet;
let db;
let mongoClient;
let server;
let withRequestContext;
let ConfigVersion;
let FetchStatus;
const base = "/api/allow-list/grants";
const url = `${base}/sbi/000000001`;
const headers = { authorization: "Bearer available-grants-test-token" };
const inject = (path = url, overrides = {}) =>
  withRequestContext({}, () =>
    server.inject({ url: path, headers, ...overrides }),
  );

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "available-grants-http-test");
  vi.resetModules();
  ({ db, mongoClient } = await import("../../common/mongo-client.js"));
  await mongoClient.connect();
  ({ withRequestContext } =
    await import("../../common/get-request-context.js"));
  ({ ConfigVersion, FetchStatus } =
    await import("../models/config-version.js"));
  const { auth } = await import("../../auth/auth.js");
  const { checkAllowListRoute, missingAllowListIdentifiersRoute } =
    await import("./check-allow-list.route.js");
  const { getAvailableGrantsRoute, missingAvailableGrantsIdentifiersRoute } =
    await import("./get-available-grants.route.js");
  server = hapi.server({ router: { stripTrailingSlash: true } });
  await server.register(auth);
  server.route([
    checkAllowListRoute,
    missingAllowListIdentifiersRoute,
    getAvailableGrantsRoute,
    missingAvailableGrantsIdentifiersRoute,
  ]);
  await server.initialize();
});
beforeEach(async () => {
  await db.dropDatabase();
  await db.collection("access_tokens").insertOne({
    id: createHash("sha256")
      .update("available-grants-test-token")
      .digest("hex"),
    clientId: "grants-ui",
    expiresAt: null,
  });
  const config = ConfigVersion.new({
    grantCode: "woodland",
    version: "1.0.0",
    status: "active",
    s3Bucket: "config",
    s3Key: "woodland/gas.json",
  });
  config.fetchStatus = FetchStatus.Fetched;
  await db.collection("config_versions").insertOne(config.toDocument());
  const { save } = await import("../repositories/grant.repository.js");
  const { Grant } = await import("../models/grant.js");
  await save(
    new Grant({
      code: "woodland",
      version: "1.0.0",
      metadata: { description: "Woodland", startDate: "2026-01-01" },
      actions: [],
      phases: [],
    }),
  );
  await db
    .collection("grant_settings")
    .insertOne({ grantCode: "woodland", open: true });
});
afterAll(async () => {
  await server?.stop();
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
});

describe("available grants HTTP contract", () => {
  it("returns metadata using SBI alone despite populated CRN restrictions", async () => {
    await db.collection("allow_lists").insertOne({
      grantCode: "woodland",
      global: { sbi: ["000000001"], crn: ["0000000002"] },
    });
    const response = await inject(`${base}/sbi/000000001`);
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({
      grants: [
        { code: "woodland", title: "Woodland", description: "Woodland" },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns grant display metadata for an authenticated business without caching", async () => {
    const response = await inject();
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({
      grants: [
        { code: "woodland", title: "Woodland", description: "Woodland" },
      ],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("available grants request validation", () => {
  it.each([base, `${base}/sbi`])("rejects missing SBI: %s", async (path) => {
    const response = await inject(path);
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("available grants authentication and validation", () => {
  it.each([undefined, "Bearer invalid-test-token"])(
    "rejects invalid authentication %s",
    async (authorization) => {
      const response = await inject(url, {
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.result).not.toHaveProperty("grants");
    },
  );
  it("rejects expired service credentials", async () => {
    await db
      .collection("access_tokens")
      .updateMany({}, { $set: { expiresAt: new Date("2000-01-01") } });
    expect((await inject()).statusCode).toBe(401);
  });
  it("rejects authenticated credentials without service identity", async () => {
    const response = await inject(url, {
      auth: { strategy: "service", credentials: { tokenId: "synthetic" } },
    });
    expect(response.statusCode).toBe(401);
    expect(response.result).not.toHaveProperty("grants");
  });
  it("accepts the existing legacy service identity during migration", async () => {
    await db
      .collection("access_tokens")
      .updateMany(
        {},
        { $unset: { clientId: "" }, $set: { client: "legacy-grants-ui" } },
      );
    const response = await inject();
    expect(response.statusCode).toBe(200);
    const audit = await db
      .collection("outbox")
      .findOne({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" });
    expect(audit.event.audit.details.caller).toBe("legacy-grants-ui");
  });
  it.each([
    `${base}/sbi/00000001`,
    `${base}/sbi/0000000001`,
    `${base}/sbi/00000000A`,
    `${url}?crn=0000000001`,
    `${url}?version=1.0.0`,
    `${url}?caller=spoofed`,
  ])("rejects invalid input %s", async (path) => {
    const response = await inject(path);
    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).not.toHaveProperty("grants");
  });
  it.each([
    `${base}/sbi/unrelated/path`,
    `${base}/crn/unrelated/path`,
    `${url}/unrelated`,
  ])("keeps unrelated paths as 404: %s", async (path) => {
    expect((await inject(path)).statusCode).toBe(404);
  });
  it("keeps the individual grant API working alongside the bulk API", async () => {
    const response = await inject(
      `${base}/woodland/sbi/000000001/crn/0000000001`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ allowed: true });
  });
});

describe("available grants audited HTTP results", () => {
  it("records caller and zero-prefixed applicant identifiers before returning codes", async () => {
    const response = await inject(url, {
      headers: { ...headers, "x-actor": "spoofed" },
    });
    expect(response.statusCode).toBe(200);
    const audits = await db
      .collection("outbox")
      .find({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" })
      .toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0].event.audit.accounts).not.toHaveProperty("crn");
    expect(audits[0].event).toMatchObject({
      security: { pmccode: "0706" },
      audit: {
        status: "SUCCESS",
        accounts: { sbi: "000000001" },
        details: { caller: "grants-ui", grantCodes: ["woodland"] },
      },
    });
  });
  it("returns and audits a successful empty result", async () => {
    await db.collection("grant_settings").deleteMany({});
    const response = await inject();
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ grants: [] });
    const audit = await db
      .collection("outbox")
      .findOne({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" });
    expect(audit.event.audit).toMatchObject({
      status: "SUCCESS",
      details: { grantCodes: [] },
    });
  });
  it("fails and audits a broken current definition without returning a grant list", async () => {
    await db.collection("config_versions").updateMany(
      {},
      {
        $set: { "definitions.grant.fetchStatus": FetchStatus.PermanentError },
      },
    );
    const response = await inject();
    expect(response.statusCode).toBe(502);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).not.toHaveProperty("grants");
    const audit = await db
      .collection("outbox")
      .findOne({ "event.audit.entities.action": "GET_AVAILABLE_GRANTS" });
    expect(audit.event.audit.status).toBe("FAILURE");
  });
  it.each([true, false])(
    "withholds the result when audit writing fails (open=%s)",
    async (open) => {
      await db.collection("grant_settings").updateMany({}, { $set: { open } });
      const original = Collection.prototype.insertMany;
      vi.spyOn(Collection.prototype, "insertMany").mockImplementation(function (
        ...args
      ) {
        if (this.collectionName === "outbox")
          throw new Error("Audit unavailable");
        return original.apply(this, args);
      });
      const response = await inject();
      expect(response.statusCode).toBe(500);
      expect(response.result).not.toHaveProperty("grants");
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );
  it("withholds the result when the audit transaction cannot commit", async () => {
    vi.spyOn(ClientSession.prototype, "commitTransaction").mockRejectedValue(
      new Error("Audit commit unavailable"),
    );
    const response = await inject();
    expect(response.statusCode).toBe(500);
    expect(response.result).not.toHaveProperty("grants");
  });
});

describe("SBI-only bulk request shape", () => {
  it.each([`${base}/sbi/000000001/crn/0000000001`, `${base}/crn/0000000001`])(
    "does not expose a bulk CRN path: %s",
    async (path) => {
      expect((await inject(path)).statusCode).toBe(404);
    },
  );
  it("does not request CRN when the bulk SBI is missing", async () => {
    const response = await inject(`${base}/sbi`);
    expect(response.statusCode).toBe(400);
    expect(response.result.message).toBe("SBI is required");
  });
});

describe("grant display configuration", () => {
  it("returns the configured title and description from the latest Active version", async () => {
    const { saveFromDefinition } =
      await import("../repositories/grant.repository.js");
    await saveFromDefinition(
      {
        code: "woodland",
        metadata: {
          title: "Apply for woodland support",
          description: "Funding for woodland plans",
          startDate: "2026-01-01",
        },
        actions: [],
        phases: [],
      },
      "2.0.0",
    );
    await saveFromDefinition(
      {
        code: "woodland",
        metadata: {
          title: "Draft title",
          description: "Draft description",
          startDate: "2026-01-01",
        },
        actions: [],
        phases: [],
      },
      "3.0.0",
    );
    const versions = [
      ["2.0.0", "active"],
      ["3.0.0", "draft"],
    ].map(([version, status]) => {
      const config = ConfigVersion.new({
        grantCode: "woodland",
        version,
        status,
        s3Bucket: "config",
        s3Key: `woodland/${version}/gas.json`,
      });
      config.fetchStatus = FetchStatus.Fetched;
      return config.toDocument();
    });
    await db.collection("config_versions").insertMany(versions);
    const response = await inject();
    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({
      grants: [
        {
          code: "woodland",
          title: "Apply for woodland support",
          description: "Funding for woodland plans",
        },
      ],
    });
  });
});
