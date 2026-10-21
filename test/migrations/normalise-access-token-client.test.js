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

describe("normalising access token client", () => {
  it.each([
    {},
    { client: null },
    { client: "  " },
    { client: 123 },
    { client: ["grants-ui"] },
  ])(
    "copies the legacy identity when client is unusable: %j",
    async (fields) => {
      await tokens.insertOne({
        id: "synthetic-hash",
        clientId: "grants-ui",
        expiresAt: new Date("2099-01-01"),
        seeded: true,
        ...fields,
      });
      const before = await tokens.findOne({});

      await up(database);

      expect(await tokens.findOne({})).toEqual({
        ...before,
        client: "grants-ui",
      });
    },
  );

  it("leaves canonical records and unusable legacy identities unchanged", async () => {
    await tokens.insertMany([
      { id: "client-only", client: "grants-ui", expiresAt: null },
      { id: "matching", client: "admin", clientId: "admin", seeded: true },
      { id: "blank", clientId: " " },
      { id: "wrong-type", clientId: ["grants-ui"] },
      { id: "unidentified" },
    ]);
    const before = await tokens.find({}).toArray();

    await up(database);

    expect(await tokens.find({}).toArray()).toEqual(before);
  });

  it("refuses conflicting identities before changing any token", async () => {
    await tokens.insertMany([
      { id: "needs-migration", clientId: "grants-ui" },
      {
        id: "conflicting",
        client: "fg-grants-platform-admin",
        clientId: "grants-ui",
      },
    ]);
    const before = await tokens.find({}).toArray();

    await expect(up(database)).rejects.toThrow(/conflicting/i);

    expect(await tokens.find({}).toArray()).toEqual(before);
  });

  it("can be run again without changing the migrated records", async () => {
    await tokens.insertOne({ id: "synthetic-hash", clientId: "grants-ui" });
    await up(database);
    const once = await tokens.find({}).toArray();

    await up(database);

    expect(await tokens.find({}).toArray()).toEqual(once);
    expect(once[0].client).toBe("grants-ui");
  });

  it("preserves the bearer token and its service identity after migration", async () => {
    const token = "synthetic-existing-token";
    const id = createHash("sha256").update(token).digest("hex");
    await tokens.insertOne({ id, clientId: "grants-ui", expiresAt: null });

    await up(database);

    const server = hapi.server();
    await server.register(auth);
    server.route({
      method: "GET",
      path: "/probe",
      handler: (request) => request.auth.credentials,
    });
    try {
      const response = await server.inject({
        url: "/probe",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({ service: "grants-ui", tokenId: id });
      expect((await tokens.findOne({ id })).clientId).toBe("grants-ui");
    } finally {
      await server.stop();
    }
  });
});
