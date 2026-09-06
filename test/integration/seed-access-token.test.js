import { Collection, MongoClient } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up as createSeededClientIndex } from "../../migrations/20260825090000-unique-seeded-access-token-per-client.js";
import { seedAccessToken } from "../../src/auth/seed-access-token.js";
import { config } from "../../src/common/config.js";
import { createServer } from "../../src/server.js";

const SUITE_TOKEN =
  "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8";

const hash = (n) => n.toString().padStart(64, "0");

let client;
let accessTokens;

const seedWith = async (value) => {
  config.serviceAccessTokenHash = value;
  await seedAccessToken();
};

const idsFor = async (filter) =>
  (await accessTokens.find(filter).toArray()).map((doc) => doc.id).sort();

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  accessTokens = client.db().collection("access_tokens");
});

afterEach(async () => {
  await accessTokens.deleteMany({ id: { $ne: SUITE_TOKEN } });
});

afterAll(async () => {
  await client?.close();
});

describe("seedAccessToken", () => {
  it("issues a token for the configured client", async () => {
    await seedWith(`alpha:${hash(1)}`);

    expect(await accessTokens.findOne({ id: hash(1) })).toMatchObject({
      id: hash(1),
      client: "alpha",
      clientId: "alpha",
      expiresAt: null,
      seeded: true,
    });
  });

  it("replaces the client's previous hash when rotated", async () => {
    await seedWith(`alpha:${hash(1)}`);
    await seedWith(`alpha:${hash(2)}`);

    expect(await idsFor({ client: "alpha" })).toEqual([hash(2)]);
  });

  it("leaves other clients' tokens alone", async () => {
    await seedWith(`beta:${hash(9)}`);
    await seedWith(`alpha:${hash(1)}`);
    await seedWith(`alpha:${hash(2)}`);

    expect(await idsFor({ client: "beta" })).toEqual([hash(9)]);
  });

  it("never removes a hand-minted token, even for the same client", async () => {
    await accessTokens.insertOne({
      id: hash(7),
      client: "alpha",
      expiresAt: null,
    });

    await seedWith(`alpha:${hash(1)}`);
    await seedWith(`alpha:${hash(2)}`);

    expect(await idsFor({ client: "alpha" })).toEqual(
      [hash(2), hash(7)].sort(),
    );
  });

  it("leaves the suite's own access token untouched", async () => {
    await seedWith(`alpha:${hash(1)}`);

    expect(await accessTokens.findOne({ id: SUITE_TOKEN })).not.toBeNull();
  });

  it.each([undefined, "", "   ", "alpha", `alpha:${"a".repeat(63)}`])(
    "writes nothing and revokes nothing for %o",
    async (value) => {
      await seedWith(`alpha:${hash(1)}`);
      await seedWith(value);

      expect(await idsFor({ client: "alpha" })).toEqual([hash(1)]);
    },
  );

  it("leaves the existing credential in place when the write fails", async () => {
    await seedWith(`alpha:${hash(1)}`);

    vi.spyOn(Collection.prototype, "replaceOne").mockRejectedValueOnce(
      new Error("connection reset by peer"),
    );

    await seedWith(`alpha:${hash(2)}`);

    expect(await idsFor({ client: "alpha" })).toEqual([hash(1)]);
  });

  it("keeps one credential when instances rotate concurrently", async () => {
    await Promise.all([
      seedWith(`alpha:${hash(1)}`),
      seedWith(`alpha:${hash(2)}`),
    ]);

    expect(await idsFor({ client: "alpha", seeded: true })).toHaveLength(1);
  });

  it("rejects a second seeded credential for the same client", async () => {
    await seedWith(`alpha:${hash(1)}`);

    await expect(
      accessTokens.insertOne({
        id: hash(2),
        client: "alpha",
        clientId: "alpha",
        expiresAt: null,
        seeded: true,
      }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("issues a credential that authenticates against the running API", async () => {
    const token = randomUUID();
    const digest = createHash("sha256").update(token, "utf8").digest("hex");

    await seedWith(`alpha:${digest}`);

    // Not started, so it is never stopped either: server.js closes the shared
    // mongo client on stop, which would strand every later test.
    const server = await createServer();
    server.route({
      method: "GET",
      path: "/probe",
      handler: (request) => request.auth.credentials,
    });

    const accepted = await server.inject({
      url: "/probe",
      headers: { authorization: `Bearer ${token}` },
    });
    const rejected = await server.inject({
      url: "/probe",
      headers: { authorization: `Bearer ${randomUUID()}` },
    });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.result.service).toBe("alpha");
    expect(rejected.statusCode).toBe(401);
  });

  it("seeds into a database bootstrapped from empty", async () => {
    await accessTokens.drop().catch(() => {});
    await accessTokens.createIndex({ id: 1 }, { unique: true });
    await accessTokens.createIndex({ client: 1 });
    await accessTokens.createIndex({ expiresAt: 1 });
    await createSeededClientIndex(client.db());

    await seedWith(`alpha:${hash(1)}`);

    expect(await accessTokens.findOne({ id: hash(1) })).not.toBeNull();

    await accessTokens.insertOne({ id: SUITE_TOKEN, client: "test" });
  });

  it("orphans the old record when the client is renamed", async () => {
    await seedWith(`old-name:${hash(1)}`);
    await seedWith(`new-name:${hash(2)}`);

    expect(await idsFor({ seeded: true })).toEqual([hash(1), hash(2)].sort());
  });
});
