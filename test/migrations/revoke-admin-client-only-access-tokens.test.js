import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
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
import { up as revokeAdminClientOnlyTokens } from "../../migrations/20261028140000-revoke-admin-client-only-access-tokens.js";
import { reportAccessTokenIdentity } from "../../src/auth/access-token-identity.js";
import { logger } from "../../src/common/logger.js";

// Seeded by test/auth-setup.js for the rest of the suite.
const SUITE_TOKENS = [
  "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8",
  "05d17100b346c29d6760a0fdedcf8623945b53a26f7f811ae70835610f9e6797",
];

const ADMIN = "fg-grants-platform-admin";

let client;
let accessTokens;

const aToken = (fields) => ({
  id: randomUUID().replaceAll("-", "").padEnd(64, "0"),
  expiresAt: null,
  ...fields,
});

const remaining = async (tokens) =>
  (
    await accessTokens
      .find({ id: { $in: tokens.map(({ id }) => id) } })
      .toArray()
  ).map(({ id }) => id);

const migrate = () => revokeAdminClientOnlyTokens(client.db());

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  accessTokens = client.db().collection("access_tokens");
});

afterEach(async () => {
  await accessTokens.deleteMany({ id: { $nin: SUITE_TOKENS } });
});

afterAll(async () => {
  await client?.close();
});

describe("revoking admin client tokens without a clientId", () => {
  it.each([
    ["missing", {}],
    ["null", { clientId: null }],
    ["blank", { clientId: "  " }],
    ["non-string", { clientId: 42 }],
  ])("revokes one whose clientId is %s", async (_, fields) => {
    const token = aToken({ client: ADMIN, ...fields });
    await accessTokens.insertOne({ ...token });

    await migrate();

    expect(await remaining([token])).toEqual([]);
  });

  it("keeps every token that has a clientId or another client", async () => {
    const kept = [
      aToken({ client: ADMIN, clientId: ADMIN }),
      aToken({ client: ADMIN, clientId: ADMIN, seeded: true }),
      aToken({ clientId: ADMIN }),
      aToken({ client: ADMIN, clientId: "grants-ui" }),
      aToken({ client: "grants-ui" }),
      aToken({ client: "grants-ui", clientId: "grants-ui" }),
      aToken({}),
    ];
    await accessTokens.insertMany(kept.map((token) => ({ ...token })));

    await migrate();

    expect((await remaining(kept)).sort()).toEqual(
      kept.map(({ id }) => id).sort(),
    );
    expect(
      await accessTokens.countDocuments({ id: { $in: SUITE_TOKENS } }),
    ).toBe(2);
  });

  it("logs the count and revokes nothing when run again", async () => {
    await accessTokens.insertMany([
      aToken({ client: ADMIN }),
      aToken({ client: ADMIN, clientId: "" }),
    ]);
    const info = vi.spyOn(logger, "info");

    await migrate();
    await migrate();

    expect(info.mock.calls).toEqual([
      [`Revoked 2 ${ADMIN} access tokens without a clientId`],
      [`Revoked 0 ${ADMIN} access tokens without a clientId`],
    ]);
  });

  it("leaves no admin client only tokens in the boot report", async () => {
    await accessTokens.insertOne(aToken({ client: ADMIN }));
    await migrate();
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");

    await reportAccessTokenIdentity();

    expect([...info.mock.calls, ...warn.mock.calls].flat()).toEqual([
      expect.stringContaining(" 0 admin client only,"),
    ]);
  });
});
