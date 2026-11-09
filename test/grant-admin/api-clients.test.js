import { MongoClient, ObjectId } from "mongodb";
import { createHash, randomBytes } from "node:crypto";
import { env } from "node:process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { cwStubRequests, resetCwStub, setCwStub } from "../helpers/cw-stub.js";
import { endOfUkDay } from "../../src/common/end-of-uk-day.js";
import { createServer } from "../../src/server.js";
import { wreck } from "../helpers/wreck.js";

// The suite's own credential, seeded by test/auth-setup.js.
const SUITE_HASH =
  "12b9377cbe7e5c94e8a70d9d23929523d14afa954793130f8a3959c7b849aca8";
const ADMIN = "fg-grants-platform-admin";
const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const operator = { "x-actor": "Ann Operator", "x-actor-id": OID };

const hashOf = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");
const newRawToken = () => randomBytes(32).toString("base64url");

let client;
let accessTokens;
let outbox;

beforeAll(async () => {
  client = await MongoClient.connect(env.MONGO_URI);
  accessTokens = client.db().collection("access_tokens");
  outbox = client.db().collection("outbox");
});

beforeEach(async () => {
  await resetCwStub();
});

const FIXTURES = { $or: [{ clientId: /^it-/ }, { itFixture: true }] };

afterEach(async () => {
  await accessTokens.deleteMany(FIXTURES);
  await accessTokens.updateOne(
    { id: SUITE_HASH },
    { $unset: { revokedAt: "", revokedBy: "", expiresAt: "" } },
  );
});

afterAll(async () => {
  await client?.close();
});

// Longer than GAS gives Caseworking, so a timeout is GAS's answer, not ours.
const CLIENT_TIMEOUT_MS = 10_000;

const get = (path) =>
  wreck.get(path, { headers: operator, timeout: CLIENT_TIMEOUT_MS });

const post = (path, payload) =>
  wreck.post(path, { headers: operator, payload, timeout: CLIENT_TIMEOUT_MS });

const bodyOf = (error) => {
  const payload = error.data?.payload;

  return Buffer.isBuffer(payload) ? JSON.parse(payload.toString()) : payload;
};

const failureOf = async (call) => {
  const error = await call().catch((e) => e);

  return { statusCode: error.output?.statusCode, body: bodyOf(error) };
};

const hintOf = (raw) => raw.slice(-4);

const issue = (
  service,
  clientId,
  tokenHash,
  newClient,
  tokenHint = "abcd",
  expiresAt = null,
) =>
  post(`/grant-admin/clients/${service}/${clientId}/tokens`, {
    tokenHash,
    tokenHint,
    expiresAt,
    newClient,
  });

const tokenPath = (service, clientId, tokenId) =>
  `/grant-admin/clients/${service}/${clientId}/tokens/${tokenId}`;

const remove = (service, clientId, tokenId) =>
  wreck.delete(tokenPath(service, clientId, tokenId), {
    headers: operator,
    timeout: CLIENT_TIMEOUT_MS,
  });

const changeExpiry = (service, clientId, tokenId, expiresAt) =>
  wreck.put(`${tokenPath(service, clientId, tokenId)}/expiry`, {
    headers: operator,
    payload: { expiresAt },
    timeout: CLIENT_TIMEOUT_MS,
  });

const rotate = (service, clientId, tokenId, raw, keepOld) =>
  post(`${tokenPath(service, clientId, tokenId)}/rotate`, {
    tokenHash: hashOf(raw),
    tokenHint: hintOf(raw),
    keepOld,
  });

const LATER = new Date("2099-01-01T00:00:00.000Z");
const PAST = new Date("2000-01-01T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const revoke = (service, clientId, tokenId) =>
  post(`/grant-admin/clients/${service}/${clientId}/tokens/${tokenId}/revoke`);

const insertRow = async (fields) => {
  const { insertedId } = await accessTokens.insertOne({
    id: hashOf(newRawToken()),
    expiresAt: null,
    ...fields,
  });

  return insertedId;
};

const suiteTokenId = async () =>
  (await accessTokens.findOne({ id: SUITE_HASH }))._id.toHexString();

const auditRows = (action) =>
  outbox.find({ "event.audit.entities.action": action }).toArray();

// Every stored outbox row, so a hash anywhere in one is caught.
const everyOutboxRow = async () =>
  JSON.stringify(await outbox.find({}).toArray());

const callAs = (raw) =>
  wreck
    .get("/grant-admin/buckets", {
      headers: { authorization: `Bearer ${raw}` },
    })
    .catch((e) => e.output.statusCode);

const listed = async (service) => {
  const { payload } = await get(`/grant-admin/clients/${service}`);

  return payload;
};

const rowOf = (payload, tokenId) =>
  payload.tokens.find((token) => token.tokenId === tokenId.toString());

describe("GAS API clients", () => {
  it("lists every token row, nameless ones with no name, and no hash", async () => {
    const createdAt = new Date("2026-10-01T10:00:00.000Z");
    const named = await insertRow({
      clientId: "it-dated",
      client: "it-dated",
      createdAt,
      createdBy: "Ann Operator",
      tokenHint: "wxyz",
    });
    const nameless = await insertRow({ itFixture: true });
    const adminLegacy = await insertRow({ itFixture: true, client: ADMIN });
    const misnamed = await insertRow({
      itFixture: true,
      clientId: "Grants_UI",
    });

    const payload = await listed("gas");
    const namedHash = (await accessTokens.findOne({ _id: named })).id;

    expect(payload.service).toBe("gas");
    expect(rowOf(payload, named)).toEqual({
      tokenId: named.toHexString(),
      clientId: "it-dated",
      status: "ACTIVE",
      tokenHint: "wxyz",
      createdAt: createdAt.toISOString(),
      createdBy: "Ann Operator",
      expiresAt: null,
      revokedAt: null,
      revokedBy: null,
      inUse: false,
      stored: {
        _id: { $oid: named.toHexString() },
        id: `${namedHash.slice(0, 3)}••••••${namedHash.slice(-3)}`,
        clientId: "it-dated",
        client: "it-dated",
        expiresAt: null,
        createdAt: { $date: "2026-10-01T10:00:00Z" },
        createdBy: "Ann Operator",
        tokenHint: "wxyz",
      },
    });
    expect(rowOf(payload, nameless).stored).toMatchObject({ itFixture: true });
    for (const id of [nameless, adminLegacy, misnamed]) {
      expect(rowOf(payload, id)).toMatchObject({
        clientId: null,
        inUse: false,
      });
    }
    expect(rowOf(payload, await suiteTokenId())).toMatchObject({
      clientId: ADMIN,
      inUse: true,
    });
    expect(payload.tokens.filter(({ inUse }) => inUse)).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain(SUITE_HASH);
    expect(JSON.stringify(payload)).not.toMatch(/[0-9a-f]{64}/);
    expect(payload.tokens.every(({ stored }) => stored.id.length === 12)).toBe(
      true,
    );

    const [viewed] = await auditRows("VIEW_API_CLIENT");
    expect(viewed.event.audit).toMatchObject({
      status: "success",
      entities: [{ entity: "API_CLIENT", entityid: "gas" }],
    });
    expect(await everyOutboxRow()).not.toContain(SUITE_HASH);
  });

  it("issues a client's first token, which works at once and stops on revoke", async () => {
    const raw = newRawToken();

    const { res, payload } = await issue(
      "gas",
      "it-consumer",
      hashOf(raw),
      true,
      hintOf(raw),
    );

    expect(res.statusCode).toBe(201);
    expect(payload).toMatchObject({
      service: "gas",
      token: {
        clientId: "it-consumer",
        status: "ACTIVE",
        tokenHint: hintOf(raw),
        createdBy: "Ann Operator",
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
        inUse: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain(hashOf(raw));

    const stored = await accessTokens.findOne({ id: hashOf(raw) });
    expect(stored).toMatchObject({
      clientId: "it-consumer",
      expiresAt: null,
      createdBy: "Ann Operator",
      tokenHint: hintOf(raw),
    });
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored).not.toHaveProperty("updatedAt");
    expect(stored).not.toHaveProperty("seeded");
    expect(stored).not.toHaveProperty("client");

    // Authenticated, and refused only because the surface is the admin's.
    expect(await callAs(raw)).toBe(403);

    await revoke("gas", "it-consumer", payload.token.tokenId);

    expect(await callAs(raw)).toBe(401);
    const row = rowOf(await listed("gas"), payload.token.tokenId);
    expect(row.status).toBe("REVOKED");
    expect(row.revokedBy).toBe("Ann Operator");
    expect(row.expiresAt).toBe(row.revokedAt);

    const [issued] = await auditRows("ISSUE_API_TOKEN");
    expect(issued.event.audit).toMatchObject({
      status: "success",
      entities: [{ entity: "API_CLIENT", entityid: "it-consumer" }],
      details: {
        service: "gas",
        tokenId: payload.token.tokenId,
        newClient: true,
        caller: ADMIN,
        actor: "Ann Operator",
      },
    });
    expect(issued.event.security.pmccode).toBe("0705");
    expect(await auditRows("REVOKE_API_TOKEN")).toHaveLength(1);
    expect(await everyOutboxRow()).not.toContain(hashOf(raw));
    expect(await everyOutboxRow()).not.toContain(SUITE_HASH);
  });

  it("issues however many tokens a client already has active", async () => {
    await insertRow({ clientId: "it-busy" });
    await insertRow({ clientId: "it-busy" });

    const { res } = await issue("gas", "it-busy", hashOf(newRawToken()), false);

    expect(res.statusCode).toBe(201);
  });

  describe("the token this request calls with", () => {
    it("can't be revoked, even with another active, and the refusal is audited", async () => {
      await insertRow({ clientId: ADMIN, client: ADMIN, itFixture: true });
      const tokenId = await suiteTokenId();

      expect(
        await failureOf(() => revoke("gas", ADMIN, tokenId)),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_IN_USE" },
      });

      const row = await accessTokens.findOne({ id: SUITE_HASH });
      expect(row).not.toHaveProperty("revokedAt");
      expect(row.expiresAt).toBeUndefined();

      const [refused] = await auditRows("REVOKE_API_TOKEN");
      expect(refused.event.audit).toMatchObject({
        status: "failure",
        details: { service: "gas", tokenId, errorCode: "API_TOKEN_IN_USE" },
      });
      expect(await everyOutboxRow()).not.toContain(SUITE_HASH);
    });

    it("leaves the platform client's other token revocable", async () => {
      const other = await insertRow({
        clientId: ADMIN,
        client: ADMIN,
        itFixture: true,
      });

      const { res } = await revoke("gas", ADMIN, other.toHexString());

      expect(res.statusCode).toBe(204);
    });

    it("leaves the platform client able to be issued a token", async () => {
      const { res } = await issue("gas", ADMIN, hashOf(newRawToken()), false);

      await accessTokens.updateOne(
        { createdBy: "Ann Operator", clientId: ADMIN },
        { $set: { itFixture: true } },
      );

      expect(res.statusCode).toBe(201);
    });
  });

  it("can't revoke a nameless or misnamed row under any name", async () => {
    const nameless = await insertRow({ itFixture: true, client: ADMIN });
    const misnamed = await insertRow({
      itFixture: true,
      clientId: "Grants_UI",
    });

    for (const [name, id] of [
      [ADMIN, nameless],
      ["it-anyone", nameless],
      ["Grants_UI", misnamed],
    ]) {
      expect(
        await failureOf(() => revoke("gas", name, id.toHexString())),
      ).toMatchObject({
        statusCode: 404,
        body: { errorCode: "API_TOKEN_NOT_FOUND" },
      });
    }

    for (const id of [nameless, misnamed]) {
      expect(await accessTokens.findOne({ _id: id })).not.toHaveProperty(
        "revokedAt",
      );
    }
  });

  it("revokes a token whose expiresAt is not a date, as auth treats it as active", async () => {
    const odd = await insertRow({
      clientId: "it-odd",
      expiresAt: "2099-01-01",
    });

    const { res } = await revoke("gas", "it-odd", odd.toHexString());

    expect(res.statusCode).toBe(204);
    expect((await accessTokens.findOne({ _id: odd })).expiresAt).toBeInstanceOf(
      Date,
    );
  });

  describe("expiry on issue", () => {
    it.each([
      ["a future date", LATER],
      ["never", null],
    ])("issues a token that expires %s", async (_, expiresAt) => {
      const raw = newRawToken();

      const { payload } = await issue(
        "gas",
        "it-dated",
        hashOf(raw),
        true,
        hintOf(raw),
        expiresAt,
      );

      expect(payload.token.expiresAt).toBe(expiresAt?.toISOString() ?? null);
      expect(
        (await accessTokens.findOne({ id: hashOf(raw) })).expiresAt,
      ).toEqual(expiresAt);
      expect(await callAs(raw)).toBe(403);
    });

    it("refuses an expiry that is not an ISO date, and audits it", async () => {
      const hash = hashOf(newRawToken());

      expect(
        await failureOf(() =>
          issue("gas", "it-dated", hash, true, "abcd", "next tuesday"),
        ),
      ).toMatchObject({
        statusCode: 400,
        body: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
      const [refused] = await auditRows("ISSUE_API_TOKEN");
      expect(refused.event.audit).toMatchObject({
        status: "failure",
        details: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
    });

    it.each([
      ["in the past", PAST],
      ["after year 9999", "+010000-01-02T00:00:00.000Z"],
    ])("refuses an expiry %s", async (_, expiresAt) => {
      const hash = hashOf(newRawToken());

      expect(
        await failureOf(() =>
          issue("gas", "it-dated", hash, true, "abcd", expiresAt),
        ),
      ).toMatchObject({
        statusCode: 400,
        body: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
      expect(await accessTokens.countDocuments({ id: hash })).toBe(0);
    });
  });

  describe("changing a token's expiry", () => {
    const tokenFor = async (fields) => {
      const raw = newRawToken();
      const _id = await insertRow({
        clientId: "it-expiry",
        id: hashOf(raw),
        tokenHint: hintOf(raw),
        ...fields,
      });
      return { raw, tokenId: _id.toHexString() };
    };

    it.each([
      ["an active", {}],
      ["an expired", { expiresAt: PAST }],
    ])("sets %s token's expiry, and it works until then", async (_, fields) => {
      const { raw, tokenId } = await tokenFor(fields);

      const { payload } = await changeExpiry(
        "gas",
        "it-expiry",
        tokenId,
        LATER,
      );

      expect(payload.token).toMatchObject({
        tokenId,
        status: "ACTIVE",
        expiresAt: LATER.toISOString(),
      });
      expect(await callAs(raw)).toBe(403);
    });

    it("revives a revoked token, which authenticates again", async () => {
      const { raw, tokenId } = await tokenFor({
        revokedAt: PAST,
        revokedBy: "Bob Operator",
        expiresAt: PAST,
      });
      expect(await callAs(raw)).toBe(401);

      const { payload } = await changeExpiry("gas", "it-expiry", tokenId, null);

      expect(payload.token).toMatchObject({
        status: "ACTIVE",
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
      });
      expect(await callAs(raw)).toBe(403);

      const [changed] = await auditRows("CHANGE_API_TOKEN_EXPIRY");
      expect(changed.event.audit).toMatchObject({
        status: "success",
        entities: [{ entityid: "it-expiry" }],
        details: {
          tokenId,
          expiresAt: "never",
          previousExpiresAt: PAST.toISOString(),
          revived: true,
        },
      });
      expect(changed.event.security.pmccode).toBe("0705");
      const stored = await everyOutboxRow();
      expect(stored).not.toContain(hashOf(raw));
      expect(stored).not.toContain(`"${hintOf(raw)}"`);
    });

    it("refuses a date in the past", async () => {
      const { tokenId } = await tokenFor({});

      expect(
        await failureOf(() => changeExpiry("gas", "it-expiry", tokenId, PAST)),
      ).toMatchObject({
        statusCode: 400,
        body: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
    });

    it("refuses an expiry that is not an ISO date, and audits it", async () => {
      const { tokenId } = await tokenFor({});

      expect(
        await failureOf(() =>
          changeExpiry("gas", "it-expiry", tokenId, "next tuesday"),
        ),
      ).toMatchObject({
        statusCode: 400,
        body: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
      const [refused] = await auditRows("CHANGE_API_TOKEN_EXPIRY");
      expect(refused.event.audit).toMatchObject({
        status: "failure",
        details: {
          tokenId,
          expiresAt: "next tuesday",
          errorCode: "API_TOKEN_INVALID_EXPIRY",
        },
      });
    });

    it("refuses a malformed expiry on the token this request calls with as invalid", async () => {
      expect(
        await failureOf(async () =>
          changeExpiry("gas", ADMIN, await suiteTokenId(), "next tuesday"),
        ),
      ).toMatchObject({
        statusCode: 400,
        body: { errorCode: "API_TOKEN_INVALID_EXPIRY" },
      });
    });

    it("refuses to set the token this request calls with to the past", async () => {
      expect(
        await failureOf(async () =>
          changeExpiry("gas", ADMIN, await suiteTokenId(), PAST),
        ),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_IN_USE" },
      });
      expect((await accessTokens.findOne({ id: SUITE_HASH })).expiresAt).toBe(
        undefined,
      );
    });
  });

  describe("rotating a token", () => {
    const activeToken = async (expiresAt = LATER) => {
      const raw = newRawToken();
      const _id = await insertRow({
        clientId: "it-rotate",
        id: hashOf(raw),
        expiresAt,
      });
      return { raw, tokenId: _id.toHexString() };
    };

    const overlapEnd = (overlapMs) => (at) =>
      overlapMs === 0 ? at : endOfUkDay(new Date(at + overlapMs)).getTime();

    it.each([
      ["none", overlapEnd(0)],
      ["24h", overlapEnd(24 * HOUR_MS)],
      ["7d", overlapEnd(7 * 24 * HOUR_MS)],
    ])(
      "keeps the old token for %s, and the new one takes its expiry",
      async (keepOld, endFrom) => {
        const old = await activeToken();
        const raw = newRawToken();
        const before = Date.now();

        const { res, payload } = await rotate(
          "gas",
          "it-rotate",
          old.tokenId,
          raw,
          keepOld,
        );

        expect(res.statusCode).toBe(201);
        expect(payload.token).toMatchObject({
          clientId: "it-rotate",
          status: "ACTIVE",
          tokenHint: hintOf(raw),
          expiresAt: LATER.toISOString(),
        });
        const stopsAt = (await accessTokens.findOne({ id: hashOf(old.raw) }))
          .expiresAt;
        expect(stopsAt.getTime()).toBeGreaterThanOrEqual(endFrom(before));
        expect(stopsAt.getTime()).toBeLessThanOrEqual(endFrom(Date.now()));
        expect(await callAs(old.raw)).toBe(keepOld === "none" ? 401 : 403);
        expect(await callAs(raw)).toBe(403);

        const [rotated] = await auditRows("ROTATE_API_TOKEN");
        expect(rotated.event.audit.details).toMatchObject({
          tokenId: old.tokenId,
          newTokenId: payload.token.tokenId,
          keepOld,
          oldExpiresAt: stopsAt.toISOString(),
        });
        const stored = await everyOutboxRow();
        expect(stored).not.toContain(hashOf(raw));
        expect(stored).not.toContain(`"${hintOf(raw)}"`);
      },
    );

    it("never keeps the old token past its own expiry", async () => {
      const soon = new Date(Date.now() + HOUR_MS);
      const old = await activeToken(soon);

      const { payload } = await rotate(
        "gas",
        "it-rotate",
        old.tokenId,
        newRawToken(),
        "7d",
      );

      expect(payload.token.expiresAt).toBe(soon.toISOString());
      expect(
        (await accessTokens.findOne({ id: hashOf(old.raw) })).expiresAt,
      ).toEqual(soon);
    });

    it("refuses to end the token this request calls with at once", async () => {
      const raw = newRawToken();

      expect(
        await failureOf(async () =>
          rotate("gas", ADMIN, await suiteTokenId(), raw, "none"),
        ),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_IN_USE" },
      });
      expect(await accessTokens.countDocuments({ id: hashOf(raw) })).toBe(0);
    });

    it("refuses a token that is not active", async () => {
      const old = await activeToken(PAST);
      const raw = newRawToken();

      expect(
        await failureOf(() =>
          rotate("gas", "it-rotate", old.tokenId, raw, "24h"),
        ),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_NOT_ACTIVE" },
      });
      expect(await accessTokens.countDocuments({ id: hashOf(raw) })).toBe(0);
    });

    // A rotate that loses to a revoke must write nothing, its new token included.
    it("never inserts a token when it loses a race with a revoke", async () => {
      for (let round = 0; round < 10; round++) {
        const old = await activeToken();
        const raw = newRawToken();

        const [rotated] = await Promise.allSettled([
          rotate("gas", "it-rotate", old.tokenId, raw, "24h"),
          revoke("gas", "it-rotate", old.tokenId),
        ]);

        if (rotated.status === "rejected") {
          expect(rotated.reason.output.statusCode).toBe(409);
          expect(await accessTokens.countDocuments({ id: hashOf(raw) })).toBe(
            0,
          );
        }
      }
    });
  });

  describe("deleting a token", () => {
    const revokedRow = (clientId, fields = {}) =>
      insertRow({
        clientId,
        revokedAt: new Date(),
        expiresAt: new Date(),
        ...fields,
      });

    it("refuses an active token, and audits the refusal", async () => {
      const live = await insertRow({ clientId: "it-live" });

      expect(
        await failureOf(() => remove("gas", "it-live", live.toHexString())),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_ACTIVE" },
      });
      expect(await accessTokens.countDocuments({ _id: live })).toBe(1);
      const [refused] = await auditRows("DELETE_API_TOKEN");
      expect(refused.event.audit).toMatchObject({
        status: "failure",
        details: { tokenId: live.toHexString(), errorCode: "API_TOKEN_ACTIVE" },
      });
    });

    it("deletes a revoked token and an expired one, auditing each by id alone", async () => {
      const raw = newRawToken();
      const revoked = await revokedRow("it-done", {
        id: hashOf(raw),
        tokenHint: hintOf(raw),
      });
      const expired = await insertRow({ clientId: "it-done", expiresAt: PAST });
      await insertRow({ clientId: "it-done" });

      for (const id of [revoked, expired]) {
        const { res } = await remove("gas", "it-done", id.toHexString());
        expect(res.statusCode).toBe(204);
      }

      expect(await accessTokens.countDocuments({ clientId: "it-done" })).toBe(
        1,
      );
      const deleted = await auditRows("DELETE_API_TOKEN");
      expect(
        deleted.map(({ event }) => event.audit.details.tokenId).sort(),
      ).toEqual([revoked.toHexString(), expired.toHexString()].sort());
      expect(deleted[0].event.security.pmccode).toBe("0705");
      const stored = await everyOutboxRow();
      expect(stored).not.toContain(hashOf(raw));
      expect(stored).not.toContain(`"${hintOf(raw)}"`);
    });

    it("frees the client's name once its last token is deleted", async () => {
      const last = await revokedRow("it-last");

      await remove("gas", "it-last", last.toHexString());

      const { res } = await issue(
        "gas",
        "it-last",
        hashOf(newRawToken()),
        true,
      );
      expect(res.statusCode).toBe(201);
    });

    it.each([
      ["an unknown token", "it-anyone", () => new ObjectId()],
      [
        "a misnamed row",
        "Grants_UI",
        () => revokedRow("Grants_UI", { itFixture: true }),
      ],
    ])("is 404 for %s", async (_, clientId, make) => {
      const tokenId = (await make()).toHexString();

      expect(
        await failureOf(() => remove("gas", clientId, tokenId)),
      ).toMatchObject({
        statusCode: 404,
        body: { errorCode: "API_TOKEN_NOT_FOUND" },
      });
    });

    // Whichever commits first, a revived token is never deleted.
    it("never deletes a token revived at the same moment", async () => {
      for (let round = 0; round < 10; round++) {
        const tokenId = (await revokedRow("it-race")).toHexString();

        const [deleted, revived] = await Promise.allSettled([
          remove("gas", "it-race", tokenId),
          changeExpiry("gas", "it-race", tokenId, null),
        ]);

        expect(
          deleted.status === "fulfilled" && revived.status === "fulfilled",
        ).toBe(false);
        if (revived.status === "fulfilled") {
          expect(
            await accessTokens.countDocuments({ _id: new ObjectId(tokenId) }),
          ).toBe(1);
        }
      }
    });
  });

  // compose/compose.test-cw.yml boots GAS with the old seeding secret set.
  it("writes nothing on boot from a seeding secret that is still set", async () => {
    expect(
      await accessTokens.countDocuments({
        $or: [{ clientId: "it-boot-seed" }, { client: "it-boot-seed" }],
      }),
    ).toBe(0);
  });

  it("refuses a revoked token after a restart", async () => {
    const raw = newRawToken();
    const { payload } = await issue("gas", "it-restart", hashOf(raw), true);
    await revoke("gas", "it-restart", payload.token.tokenId);

    // Not started, so it is never stopped either: server.js closes the shared
    // mongo client on stop, which would strand every later test.
    const restarted = await createServer();
    restarted.route({ method: "GET", path: "/probe", handler: () => "ok" });

    const res = await restarted.inject({
      url: "/probe",
      headers: { authorization: `Bearer ${raw}` },
    });

    expect(res.statusCode).toBe(401);
  });

  describe("refusals", () => {
    it.each([
      [
        "an invalid name",
        "it-Bad",
        "a".repeat(64),
        "abcd",
        true,
        400,
        "API_CLIENT_INVALID_NAME",
      ],
      [
        "an invalid hash",
        "it-ok",
        "A".repeat(64),
        "abcd",
        true,
        400,
        "API_TOKEN_INVALID_HASH",
      ],
      [
        "an invalid hint",
        "it-ok",
        "a".repeat(64),
        "ab+d",
        true,
        400,
        "API_TOKEN_INVALID_HINT",
      ],
      [
        "a missing client",
        "it-nobody",
        "a".repeat(64),
        "abcd",
        false,
        404,
        "API_CLIENT_NOT_FOUND",
      ],
      [
        "a 65-character name",
        "a".repeat(65),
        "a".repeat(64),
        "abcd",
        true,
        400,
        "API_CLIENT_INVALID_NAME",
      ],
      [
        "a name of 64 hex characters",
        "b".repeat(64),
        "a".repeat(64),
        "abcd",
        true,
        400,
        "API_CLIENT_INVALID_NAME",
      ],
    ])(
      "refuses %s",
      async (_, name, hash, hint, newClient, statusCode, errorCode) => {
        expect(
          await failureOf(() => issue("gas", name, hash, newClient, hint)),
        ).toMatchObject({ statusCode, body: { errorCode } });
        expect(await accessTokens.countDocuments({ id: hash })).toBe(0);
        const [refused] = await auditRows("ISSUE_API_TOKEN");
        expect(refused.event.audit).toMatchObject({
          status: "failure",
          details: { errorCode },
        });
      },
    );

    it("refuses a new client whose name has any row, even revoked", async () => {
      await insertRow({
        clientId: "it-taken",
        revokedAt: new Date(),
        expiresAt: new Date(),
      });

      expect(
        await failureOf(() =>
          issue("gas", "it-taken", hashOf(newRawToken()), true),
        ),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_CLIENT_EXISTS" },
      });
    });

    it("refuses to revoke a token that is not active", async () => {
      const gone = await insertRow({
        clientId: "it-gone",
        revokedAt: new Date(),
        expiresAt: new Date(),
      });

      expect(
        await failureOf(() => revoke("gas", "it-gone", gone.toHexString())),
      ).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_NOT_ACTIVE" },
      });
    });

    it("answers a repeated hash with a plain 409 that quotes nothing", async () => {
      const raw = newRawToken();
      await insertRow({ clientId: "it-first", id: hashOf(raw) });
      await insertRow({ clientId: "it-second" });

      const failure = await failureOf(() =>
        issue("gas", "it-second", hashOf(raw), false),
      );

      expect(failure).toMatchObject({
        statusCode: 409,
        body: { errorCode: "API_TOKEN_DUPLICATE" },
      });
      expect(JSON.stringify(failure.body)).not.toContain(hashOf(raw));
      expect(JSON.stringify(failure.body)).not.toContain("E11000");

      const [refused] = await auditRows("ISSUE_API_TOKEN");
      expect(refused.event.audit.details.errorCode).toBe("API_TOKEN_DUPLICATE");
      expect(await everyOutboxRow()).not.toContain(hashOf(raw));
    });
  });
});

describe("Caseworking API clients, through GAS", () => {
  const TOKEN_ID = new ObjectId().toHexString();
  const cwRow = {
    tokenId: TOKEN_ID,
    clientId: "fg-gas-backend",
    status: "ACTIVE",
    tokenHint: null,
    createdAt: null,
    createdBy: null,
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    inUse: true,
  };

  it("passes Caseworking's rows on, its inUse and nameless rows included", async () => {
    const listedRow = {
      ...cwRow,
      stored: {
        _id: { $oid: TOKEN_ID },
        id: "abc••••••def",
        client: "fg-gas-backend",
        expiresAt: null,
      },
    };
    const tokens = [
      listedRow,
      {
        ...listedRow,
        tokenId: new ObjectId().toHexString(),
        clientId: null,
        inUse: false,
      },
    ];
    await setCwStub({ clients: { list: { tokens } } });

    expect(await listed("cw")).toEqual({ service: "cw", tokens });
    const [sent] = await cwStubRequests();
    expect(sent).toMatchObject({
      path: "/actuators/clients",
      actor: "Ann Operator",
      actorId: OID,
    });
    const [viewed] = await auditRows("VIEW_API_CLIENT");
    expect(viewed.event.audit.entities[0].entityid).toBe("cw");
  });

  // Node refuses a header above U+00FF, so the name goes on as it came.
  it("names a non-ASCII operator to Caseworking encoded, and audits it decoded", async () => {
    const encoded = "UTF-8''%C5%81ukasz";
    const headers = { ...operator, "x-actor": encoded };

    const { payload } = await wreck.get("/grant-admin/clients/cw", {
      headers,
    });
    const { res } = await wreck.post(
      `/grant-admin/clients/cw/fg-gas-backend/tokens/${TOKEN_ID}/revoke`,
      { headers },
    );

    expect(payload.service).toBe("cw");
    expect(res.statusCode).toBe(204);
    expect((await cwStubRequests()).map(({ actor }) => actor)).toEqual([
      encoded,
      encoded,
    ]);
    const [revoked] = await auditRows("REVOKE_API_TOKEN");
    expect(revoked.event.audit.details.actor).toBe("Łukasz");
  });

  it("passes Caseworking's caller-token refusal on, audited as a FAILURE", async () => {
    await setCwStub({
      clients: {
        refusal: {
          status: 409,
          body: { errorCode: "API_TOKEN_IN_USE", message: "SECRET-CW" },
        },
      },
    });

    const failure = await failureOf(() =>
      revoke("cw", "fg-gas-backend", TOKEN_ID),
    );

    expect(failure).toMatchObject({
      statusCode: 409,
      body: { errorCode: "API_TOKEN_IN_USE" },
    });
    expect(JSON.stringify(failure.body)).not.toContain("SECRET-CW");
    const [refused] = await auditRows("REVOKE_API_TOKEN");
    expect(refused.event.audit).toMatchObject({
      status: "failure",
      details: {
        service: "cw",
        tokenId: TOKEN_ID,
        errorCode: "API_TOKEN_IN_USE",
      },
    });
    expect(await everyOutboxRow()).not.toContain(SUITE_HASH);
  });

  it("leaves Caseworking's name rule to Caseworking", async () => {
    await setCwStub({
      clients: {
        refusal: {
          status: 400,
          body: { errorCode: "API_CLIENT_INVALID_NAME" },
        },
      },
    });

    const failure = await failureOf(() =>
      issue("cw", "Bad_Name", hashOf(newRawToken()), true),
    );

    expect(failure).toMatchObject({
      statusCode: 400,
      body: { errorCode: "API_CLIENT_INVALID_NAME" },
    });
    expect(await cwStubRequests()).toHaveLength(1);
  });

  it.each([
    [403, {}, 403],
    [404, { errorCode: "API_TOKEN_NOT_FOUND" }, 404],
    [404, { message: "Not Found" }, 502],
    [500, { message: "SECRET-CW" }, 502],
  ])("answers Caseworking's %i as %i", async (status, body, expected) => {
    await setCwStub({ clients: { refusal: { status, body } } });

    expect(
      (await failureOf(() => revoke("cw", "fg-gas-backend", TOKEN_ID)))
        .statusCode,
    ).toBe(expected);
  });

  it("forwards a delete, an expiry change and a rotate to Caseworking", async () => {
    const raw = newRawToken();
    await setCwStub({
      clients: {
        token: {
          token: { ...cwRow, expiresAt: LATER.toISOString(), inUse: false },
          previousExpiresAt: null,
          revived: false,
          oldExpiresAt: LATER.toISOString(),
        },
      },
    });

    const deleted = await remove("cw", "role-reader", TOKEN_ID);
    const changed = await changeExpiry("cw", "role-reader", TOKEN_ID, LATER);
    const rotated = await rotate("cw", "role-reader", TOKEN_ID, raw, "7d");

    expect(deleted.res.statusCode).toBe(204);
    expect(changed.payload.token.expiresAt).toBe(LATER.toISOString());
    expect(rotated.res.statusCode).toBe(201);
    const sent = await cwStubRequests();
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `DELETE /actuators/clients/role-reader/tokens/${TOKEN_ID}`,
      `PUT /actuators/clients/role-reader/tokens/${TOKEN_ID}/expiry`,
      `POST /actuators/clients/role-reader/tokens/${TOKEN_ID}/rotate`,
    ]);
    expect(sent[1].body).toEqual({ expiresAt: LATER.toISOString() });
    expect(sent[2].body).toEqual({
      tokenHash: hashOf(raw),
      tokenHint: hintOf(raw),
      keepOld: "7d",
    });
    expect(await everyOutboxRow()).not.toContain(hashOf(raw));
  });

  it.each([
    [
      "a delete",
      () => remove("cw", "role-reader", TOKEN_ID),
      "API_TOKEN_ACTIVE",
    ],
    [
      "an expiry change",
      () => changeExpiry("cw", "role-reader", TOKEN_ID, null),
      "API_TOKEN_IN_USE",
    ],
    [
      "a rotate",
      () => rotate("cw", "role-reader", TOKEN_ID, newRawToken(), "none"),
      "API_TOKEN_IN_USE",
    ],
  ])("passes Caseworking's refusal of %s on", async (_, call, errorCode) => {
    await setCwStub({
      clients: { refusal: { status: 409, body: { errorCode } } },
    });

    expect(await failureOf(call)).toMatchObject({
      statusCode: 409,
      body: { errorCode },
    });
  });

  it(
    "is a 504 when Caseworking does not answer",
    { timeout: 15000 },
    async () => {
      await setCwStub({ clients: { mode: "timeout" } });

      expect(
        (await failureOf(() => revoke("cw", "fg-gas-backend", TOKEN_ID)))
          .statusCode,
      ).toBe(504);
    },
  );

  it("sends Caseworking the hash and hint, and keeps the hash out of the answer and the audit", async () => {
    const raw = newRawToken();
    await setCwStub({
      clients: {
        issue: {
          token: {
            ...cwRow,
            clientId: "role-reader",
            tokenHint: hintOf(raw),
            inUse: false,
          },
        },
      },
    });

    const { res, payload } = await issue(
      "cw",
      "role-reader",
      hashOf(raw),
      true,
      hintOf(raw),
    );

    expect(res.statusCode).toBe(201);
    expect(payload.token.tokenHint).toBe(hintOf(raw));
    expect(JSON.stringify(payload)).not.toContain(hashOf(raw));
    const [sent] = await cwStubRequests();
    expect(sent.body).toEqual({
      tokenHash: hashOf(raw),
      tokenHint: hintOf(raw),
      expiresAt: null,
      newClient: true,
    });
    expect(await everyOutboxRow()).not.toContain(hashOf(raw));
  });
});
