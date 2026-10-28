import { MongoClient } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { up as backfillClientIds } from "../../migrations/20261028120000-backfill-access-token-client-id.js";
import {
  reportAccessTokenIdentity,
  SEEDED_CLIENT_ID_INDEX,
} from "../../src/auth/access-token-identity.js";
import { logger } from "../../src/common/logger.js";
import { requireAdminClient } from "../../src/grant-admin/admin-client.js";
import { createServer } from "../../src/server.js";

// Seeded by test/auth-setup.js for the rest of the suite.
const SUITE_TOKENS = [
  "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8",
  "05d17100b346c29d6760a0fdedcf8623945b53a26f7f811ae70835610f9e6797",
];

const ADMIN = "fg-grants-platform-admin";
const EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

let client;
let accessTokens;

const hash = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");

const aToken = (fields) => {
  const raw = randomUUID();
  return { raw, record: { id: hash(raw), expiresAt: EXPIRES_AT, ...fields } };
};

const insert = async (...tokens) => {
  await accessTokens.insertMany(tokens.map(({ record }) => ({ ...record })));
};

const stored = async ({ record }) =>
  accessTokens.findOne({ id: record.id }, { projection: { _id: 0 } });

const migrate = () => backfillClientIds(client.db());

const dropSeededClientIdIndex = () =>
  accessTokens.dropIndex(SEEDED_CLIENT_ID_INDEX).catch(() => {});

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  accessTokens = client.db().collection("access_tokens");
});

beforeEach(async () => {
  await accessTokens.deleteMany({ id: { $nin: SUITE_TOKENS } });
  await dropSeededClientIdIndex();
});

afterEach(async () => {
  await accessTokens.deleteMany({ id: { $nin: SUITE_TOKENS } });
  await dropSeededClientIdIndex();
  await migrate();
});

afterAll(async () => {
  await client?.close();
});

describe("backfilling clientId on access tokens", () => {
  it("copies client to clientId and keeps the rest of the record", async () => {
    const seeded = aToken({ client: "grants-ui", seeded: true });
    const minted = aToken({ client: "grants-ui" });
    const blank = aToken({ client: "other-ui", clientId: "  " });
    await insert(seeded, minted, blank);

    await migrate();

    expect(await stored(seeded)).toEqual({
      ...seeded.record,
      clientId: "grants-ui",
    });
    expect(await stored(minted)).toEqual({
      ...minted.record,
      clientId: "grants-ui",
    });
    expect((await stored(blank)).clientId).toBe("other-ui");
  });

  it("does not copy the admin client, which would grant admin access", async () => {
    const legacyAdmin = aToken({ client: ADMIN });
    await insert(legacyAdmin);

    await migrate();

    expect(await stored(legacyAdmin)).toEqual(legacyAdmin.record);
  });

  it.each([
    ["canonical", { clientId: "grants-ui" }],
    ["matching", { client: "grants-ui", clientId: "grants-ui" }],
    ["conflicting", { client: "grants-ui", clientId: "other-ui" }],
    ["identity-less", {}],
    ["blank", { client: " " }],
    ["null", { client: null }],
    ["non-string", { client: 42 }],
  ])("leaves a %s record as stored", async (_, fields) => {
    const token = aToken(fields);
    await insert(token);

    await migrate();

    expect(await stored(token)).toEqual(token.record);
  });

  it("changes nothing when run again", async () => {
    const tokens = [
      aToken({ client: "grants-ui", seeded: true }),
      aToken({ client: ADMIN }),
      aToken({ client: "grants-ui", clientId: "other-ui" }),
    ];
    await insert(...tokens);
    await migrate();
    const first = await Promise.all(tokens.map(stored));
    const info = vi.spyOn(logger, "info");

    await migrate();

    expect(await Promise.all(tokens.map(stored))).toEqual(first);
    expect(info).toHaveBeenCalledWith(
      "Copied client to clientId on 0 access tokens, seeded clientId index created",
    );
  });

  it("creates a unique seeded clientId index", async () => {
    await insert(aToken({ client: "grants-ui", seeded: true }));

    await migrate();

    await expect(
      accessTokens.insertOne({
        id: hash(randomUUID()),
        client: "renamed",
        clientId: "grants-ui",
        seeded: true,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("defers the index when seeded records share a clientId", async () => {
    await insert(
      aToken({ client: "grants-ui", seeded: true }),
      aToken({ client: "other-ui", clientId: "grants-ui", seeded: true }),
    );
    const info = vi.spyOn(logger, "info");

    await expect(migrate()).resolves.toBeUndefined();

    const names = (await accessTokens.indexes()).map(({ name }) => name);
    expect(names).not.toContain(SEEDED_CLIENT_ID_INDEX);
    expect(names).toContain("clientId_1");
    expect(info).toHaveBeenCalledWith(
      "Copied client to clientId on 1 access tokens, seeded clientId index deferred",
    );
  });
});

describe("access after the backfill", () => {
  // Not started, so it is never stopped either: server.js closes the shared
  // mongo client on stop, which would strand every later test.
  let server;

  beforeAll(async () => {
    server = await createServer();
    server.route([
      {
        method: "GET",
        path: "/probe",
        handler: (request) => request.auth.credentials,
      },
      {
        method: "GET",
        path: "/admin-probe",
        options: { pre: [{ method: requireAdminClient }] },
        handler: (request) => request.auth.credentials,
      },
    ]);
  });

  const call = (url, { raw }) =>
    server.inject({ url, headers: { authorization: `Bearer ${raw}` } });

  it("accepts the same bearer token as the same service", async () => {
    const legacy = aToken({ client: "grants-ui" });
    await insert(legacy);

    await migrate();

    const response = await call("/probe", legacy);
    expect(response.statusCode).toBe(200);
    expect(response.result.service).toBe("grants-ui");
    expect((await stored(legacy)).expiresAt).toEqual(EXPIRES_AT);
  });

  it("keeps admin access exactly as it was", async () => {
    const admin = aToken({ client: ADMIN, clientId: ADMIN });
    const legacyAdmin = aToken({ client: ADMIN });
    const other = aToken({ client: "grants-ui" });
    await insert(admin, legacyAdmin, other);

    const before = await Promise.all(
      [admin, legacyAdmin, other].map((token) => call("/admin-probe", token)),
    );
    await migrate();
    const after = await Promise.all(
      [admin, legacyAdmin, other].map((token) => call("/admin-probe", token)),
    );

    expect(before.map(({ statusCode }) => statusCode)).toEqual([200, 403, 403]);
    expect(after.map(({ statusCode }) => statusCode)).toEqual([200, 403, 403]);
  });

  it("still rejects expired and unknown tokens", async () => {
    const expired = aToken({
      client: "grants-ui",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    await insert(expired);

    await migrate();

    expect((await call("/probe", expired)).statusCode).toBe(401);
    expect((await call("/probe", { raw: randomUUID() })).statusCode).toBe(401);
  });
});

describe("reporting access token identity", () => {
  it("counts each shape without logging tokens or hashes", async () => {
    await insert(
      aToken({ client: "grants-ui", clientId: "grants-ui" }),
      aToken({ client: "grants-ui", clientId: "other-ui", seeded: true }),
      aToken({ client: "grants-ui", clientId: "other-ui" }),
      aToken({ client: "legacy-ui" }),
      aToken({ client: ADMIN }),
      aToken({ client: "" }),
      aToken({ client: "dup", clientId: "dup", seeded: true }),
      aToken({ client: "dup-renamed", clientId: "dup", seeded: true }),
    );
    const warn = vi.spyOn(logger, "warn");

    await reportAccessTokenIdentity();

    // The suite's own two tokens are canonical too.
    expect(warn).toHaveBeenCalledWith(
      "Access token identity: 4 canonical, 3 conflicting (2 seeded), 1 client only, 1 admin client only, 1 without an identity, 2 seeded sharing a clientId, seeded clientId index missing",
    );
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/[0-9a-f]{64}/);
  });

  it("logs info once every token is canonical and indexed", async () => {
    await insert(aToken({ client: "grants-ui", seeded: true }));
    await migrate();
    const info = vi.spyOn(logger, "info");

    await reportAccessTokenIdentity();

    expect(info).toHaveBeenCalledWith(
      "Access token identity: 3 canonical, 0 conflicting (0 seeded), 0 client only, 0 admin client only, 0 without an identity, 0 seeded sharing a clientId, seeded clientId index present",
    );
  });
});
