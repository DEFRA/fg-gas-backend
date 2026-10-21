import hapi from "@hapi/hapi";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
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
import { up } from "../../migrations/20261021120000-normalise-access-token-client.js";
import { auth } from "../../src/auth/auth.js";
import { db } from "../../src/common/mongo-client.js";
import { requireAdminClient } from "../../src/grant-admin/admin-client.js";

vi.mock("../../src/common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

let mongo;
let connection;
let database;
let tokens;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  connection = await MongoClient.connect(mongo.getUri());
  database = connection.db("token-migration");
  tokens = database.collection("access_tokens");
  await tokens.createIndex({ id: 1 }, { unique: true });
  await tokens.createIndex(
    { client: 1, seeded: 1 },
    {
      unique: true,
      partialFilterExpression: { seeded: true },
    },
  );
});

beforeEach(async () => {
  await tokens.deleteMany({});
  db.collection.mockImplementation((name) => database.collection(name));
});

afterAll(async () => {
  await connection?.close();
  await mongo?.stop();
});

const probe = async (token, url = "/probe") => {
  const server = hapi.server();
  await server.register(auth);
  server.route({
    method: "GET",
    path: "/probe",
    handler: (request) => request.auth.credentials,
  });
  await server.register({
    name: "guarded",
    register(inner) {
      inner.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });
      inner.route({
        method: "GET",
        path: "/admin",
        handler: () => ({ ok: true }),
      });
    },
  });
  try {
    return await server.inject({
      url,
      headers: { authorization: `Bearer ${token}` },
    });
  } finally {
    await server.stop();
  }
};

const insertToken = async (fields) => {
  const token = "synthetic-existing-token";
  const id = createHash("sha256").update(token).digest("hex");
  await tokens.insertOne({ id, expiresAt: null, ...fields });
  return { token, id };
};

describe("normalising access token client without blocking startup", () => {
  it.each([
    [{ client: "grants-ui" }, "grants-ui", 403],
    [{ clientId: "grants-ui" }, "grants-ui", 403],
    [{ client: "fg-grants-platform-admin" }, "fg-grants-platform-admin", 403],
    [{ clientId: "fg-grants-platform-admin" }, "fg-grants-platform-admin", 200],
    [
      {
        client: "fg-grants-platform-admin",
        clientId: "fg-grants-platform-admin",
      },
      "fg-grants-platform-admin",
      200,
    ],
    [
      { client: "fg-grants-platform-admin", clientId: "grants-ui" },
      "grants-ui",
      403,
    ],
    [
      { client: "grants-ui", clientId: "fg-grants-platform-admin" },
      "fg-grants-platform-admin",
      200,
    ],
  ])(
    "preserves authentication and admin access for %j",
    async (fields, service, adminStatus) => {
      const { token, id } = await insertToken(fields);
      const before = await tokens.findOne({ id });

      await expect(up(database)).resolves.toBeUndefined();

      const response = await probe(token);
      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({
        service,
        tokenId: id,
        grantAdminAccess: adminStatus === 200,
      });
      expect((await probe(token, "/admin")).statusCode).toBe(adminStatus);
      const after = await tokens.findOne({ id });
      expect(after.id).toBe(before.id);
      expect(after.expiresAt).toEqual(before.expiresAt);
      expect(after.clientId).toEqual(before.clientId);
    },
  );

  it.each([null, "", "  ", 123, ["grants-ui"]])(
    "copies a valid legacy identity over unusable client %j",
    async (client) => {
      const { id } = await insertToken({
        client,
        clientId: "grants-ui",
        seeded: true,
      });
      const before = await tokens.findOne({ id });

      await up(database);

      expect(await tokens.findOne({ id })).toEqual({
        ...before,
        client: "grants-ui",
        grantAdminAccess: false,
      });
    },
  );

  it.each([null, "", "  ", 123, ["fg-grants-platform-admin"]])(
    "does not promote client-only admin records with malformed legacy identity %j",
    async (clientId) => {
      const { token } = await insertToken({
        client: "fg-grants-platform-admin",
        clientId,
      });

      await expect(up(database)).resolves.toBeUndefined();

      expect((await probe(token, "/admin")).statusCode).toBe(403);
    },
  );

  it("keeps expired tokens expired", async () => {
    const expiresAt = new Date("2000-01-01");
    const { token, id } = await insertToken({
      clientId: "fg-grants-platform-admin",
      expiresAt,
    });

    await up(database);

    expect((await probe(token)).statusCode).toBe(401);
    expect((await probe(token, "/admin")).statusCode).toBe(401);
    expect((await tokens.findOne({ id })).expiresAt).toEqual(expiresAt);
  });

  it("is idempotent and does not replace an explicit permission decision", async () => {
    const { id } = await insertToken({
      clientId: "fg-grants-platform-admin",
      grantAdminAccess: false,
    });
    await up(database);
    const once = await tokens.find({}).toArray();

    await up(database);

    expect(await tokens.find({}).toArray()).toEqual(once);
    expect((await tokens.findOne({ id })).grantAdminAccess).toBe(false);
  });

  it("keeps a conflicting seeded token with its existing rotation owner", async () => {
    const { token, id } = await insertToken({
      client: "old-rotation-owner",
      clientId: "fg-grants-platform-admin",
      seeded: true,
    });

    await up(database);

    expect(await tokens.findOne({ id })).toMatchObject({
      client: "old-rotation-owner",
      clientId: "fg-grants-platform-admin",
      seeded: true,
      identityMigrationPending: true,
    });
    expect((await probe(token)).result.service).toBe(
      "fg-grants-platform-admin",
    );
    expect((await probe(token, "/admin")).statusCode).toBe(200);
  });

  it.each(["grants-ui", "fg-grants-platform-admin"])(
    "keeps %s usable if its canonical client would collide with the seeded-client index",
    async (client) => {
      const { token, id } = await insertToken({
        clientId: client,
        seeded: true,
      });
      await tokens.insertOne({
        id: "other-admin-token",
        client,
        clientId: client,
        seeded: true,
      });

      await expect(up(database)).resolves.toBeUndefined();

      expect((await probe(token)).result.service).toBe(client);
      expect((await probe(token, "/admin")).statusCode).toBe(
        client === "fg-grants-platform-admin" ? 200 : 403,
      );
      expect((await tokens.findOne({ id })).identityMigrationPending).toBe(
        true,
      );
      expect(await tokens.countDocuments({})).toBe(2);
    },
  );
});
