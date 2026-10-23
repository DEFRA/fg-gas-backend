import { Collection } from "mongodb";
import hapi from "@hapi/hapi";
import { MongoMemoryReplSet } from "mongodb-memory-server";
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
let up;
let server;
let withRequestContext;
const headers = {
  "x-actor": "Jo Operator",
  "x-actor-id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
};
const url = "/grant-admin/grants/woodland/settings";
const checkUrl = "/api/allow-list/grants/woodland/sbi/106000033/crn/1042000000";
const request = (method, path, payload) =>
  withRequestContext({}, () =>
    server.inject({ method, url: path, headers, ...(payload && { payload }) }),
  );
vi.mock("../../grant-admin/repositories/cw-users.repository.js", () => ({
  findCwUserRoles: vi.fn(async () => ({ roles: ["ROLE_WOODLAND_ADMIN"] })),
}));

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  vi.stubEnv("MONGO_URI", replSet.getUri());
  vi.stubEnv("MONGO_DATABASE", "grant-settings-test");
  vi.resetModules();
  ({ mongoClient, db } = await import("../../common/mongo-client.js"));
  await mongoClient.connect();
  ({ withRequestContext } =
    await import("../../common/get-request-context.js"));
  const { getGrantSettingsRoute, saveGrantSettingsRoute } =
    await import("../../grant-admin/routes/grant-settings.route.js");
  const { checkAllowListRoute } =
    await import("../routes/check-allow-list.route.js");
  const { setAuditActor } =
    await import("../../grant-admin/set-audit-actor.js");
  server = hapi.server();
  server.ext("onRequest", (req, h) => {
    req.auth.credentials = { service: "fg-grants-platform-admin" };
    return h.continue;
  });
  server.ext("onPostAuth", setAuditActor);
  server.route([
    getGrantSettingsRoute,
    saveGrantSettingsRoute,
    checkAllowListRoute,
  ]);
  await server.initialize();
});
beforeEach(async () => {
  await db.dropDatabase();
  const { Grant } = await import("../models/grant.js");
  const { save } = await import("./grant.repository.js");
  const { ConfigVersion, FetchStatus } =
    await import("../models/config-version.js");
  const version = ConfigVersion.new({
    grantCode: "woodland",
    version: "1.0.0",
    status: "active",
    s3Key: "woodland/gas.json",
    s3Bucket: "config",
  });
  version.fetchStatus = FetchStatus.Fetched;
  await db.collection("config_versions").insertOne(version.toDocument());
  await save(
    new Grant({
      code: "woodland",
      version: "1.0.0",
      metadata: { description: "Woodland", startDate: "2026-01-01" },
      admin: { role: "ROLE_WOODLAND_ADMIN" },
      actions: [],
      phases: [],
    }),
  );
});
afterAll(async () => {
  await server?.stop();
  await mongoClient?.close();
  await replSet?.stop();
  vi.unstubAllEnvs();
});
describe("grant settings Mongo integration", () => {
  it("creates an idempotent unique grant-code index without seeding records", async () => {
    ({ up } =
      await import("../../../migrations/20261023120000-add-grant-settings-index.js"));
    await up(db);
    await up(db);
    const settings = db.collection("grant_settings");
    expect(await settings.countDocuments()).toBe(0);
    await settings.insertOne({ grantCode: "woodland", open: false });
    await expect(
      settings.insertOne({ grantCode: "woodland", open: true }),
    ).rejects.toMatchObject({ code: 11000 });
  });
  it("persists settings through HTTP, defaults to closed and retains restrictions across close/reopen", async () => {
    await up(db);
    await db.collection("allow_lists").insertOne({
      grantCode: "woodland",
      global: { sbi: ["106000033"], crn: ["1042000000"] },
    });
    expect((await request("GET", url)).result).toEqual({
      grantCode: "woodland",
      open: false,
    });
    expect((await request("GET", checkUrl)).result).toEqual({ allowed: false });
    expect(await db.collection("grant_settings").countDocuments()).toBe(0);
    expect((await request("PUT", url, { open: true })).statusCode).toBe(200);
    expect((await request("GET", url)).result).toEqual({
      grantCode: "woodland",
      open: true,
    });
    expect((await request("GET", checkUrl)).result).toEqual({ allowed: true });
    await request("PUT", url, { open: false });
    expect((await request("GET", checkUrl)).result).toEqual({ allowed: false });
    await request("PUT", url, { open: true });
    expect((await request("GET", checkUrl)).result).toEqual({ allowed: true });
    expect(
      (await request("GET", checkUrl.replace("106000033", "106000099"))).result,
    ).toEqual({ allowed: false });
    expect(await db.collection("grant_settings").countDocuments()).toBe(1);
    const audits = await db
      .collection("outbox")
      .find({ "event.audit.entities.action": "SAVE_GRANT_SETTINGS" })
      .toArray();
    expect(audits).toHaveLength(3);
    expect(audits[0].event).toMatchObject({
      user: headers["x-actor-id"],
      audit: {
        status: "SUCCESS",
        details: {
          oldSettings: { grantCode: "woodland", open: false },
          newSettings: { grantCode: "woodland", open: true },
        },
      },
    });
  });
  it("rejects concurrent duplicate creation and keeps one settings document", async () => {
    await up(db);
    const responses = await Promise.all([
      request("PUT", url, { open: true }),
      request("PUT", url, { open: false }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await db.collection("grant_settings").countDocuments()).toBe(1);
  });

  it("rolls back the actual settings write if the audit insert fails", async () => {
    await up(db);
    const original = Collection.prototype.insertMany;
    const insert = vi
      .spyOn(Collection.prototype, "insertMany")
      .mockImplementation(function (...args) {
        if (this.collectionName === "outbox")
          throw new Error("Audit unavailable");
        return original.apply(this, args);
      });
    const response = await request("PUT", url, { open: true });
    insert.mockRestore();
    expect(response.statusCode).toBe(500);
    expect((await request("GET", url)).result).toEqual({
      grantCode: "woodland",
      open: false,
    });
    expect(await db.collection("grant_settings").countDocuments()).toBe(0);
  });
});
