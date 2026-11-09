import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { AccessToken } from "../models/access-token.js";
import {
  changeTokenExpiry,
  deleteToken,
  findAllTokens,
  findCallerTokenId,
  findClientToken,
  findClientTokens,
  insertToken,
  revokeToken,
  shortenRotatedToken,
} from "./access-token.repository.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../../common/config.js", () => ({
  config: { adminReadTimeoutMs: 1500 },
}));

const HASH = "f".repeat(64);
const CALLER_HASH = "c".repeat(64);
const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
const NOW = new Date("2026-11-04T10:00:00.000Z");
const session = { id: "session" };

let accessTokens;
let cursor;

beforeEach(() => {
  cursor = { toArray: vi.fn().mockResolvedValue([]) };
  accessTokens = {
    find: vi.fn().mockReturnValue(cursor),
    aggregate: vi.fn().mockReturnValue(cursor),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
  };
  db.collection.mockImplementation((name) =>
    name === "access_tokens" ? accessTokens : null,
  );
});

const withoutHash = expect.objectContaining({
  projection: { id: 0 },
  readPreference: "primary",
});

describe("access token reads", () => {
  it("lists every row from the primary, its hash masked by Mongo", async () => {
    await findAllTokens();

    expect(accessTokens.aggregate).toHaveBeenCalledWith(
      [
        {
          $set: {
            id: {
              $concat: [
                { $substrCP: ["$id", 0, 3] },
                "••••••",
                { $substrCP: ["$id", 61, 3] },
              ],
            },
          },
        },
      ],
      { readPreference: "primary", maxTimeMS: 1500 },
    );
    expect(accessTokens.find).not.toHaveBeenCalled();
  });

  it("lists each token with its row as stored, in relaxed Extended JSON", async () => {
    cursor.toArray.mockResolvedValue([
      {
        _id: new ObjectId(TOKEN_ID),
        id: "fff••••••fff",
        client: "grants-ui",
        expiresAt: NOW,
        revokedAt: null,
      },
    ]);

    const [{ token, stored }] = await findAllTokens();

    expect(token).toBeInstanceOf(AccessToken);
    expect(token.tokenId).toBe(TOKEN_ID);
    expect(token.id).toBeUndefined();
    expect(stored).toEqual({
      _id: { $oid: TOKEN_ID },
      id: "fff••••••fff",
      client: "grants-ui",
      expiresAt: { $date: "2026-11-04T10:00:00Z" },
      revokedAt: null,
    });
  });

  it("reads one client's rows by clientId, without hashes", async () => {
    await findClientTokens("grants-ui", session);

    expect(accessTokens.find).toHaveBeenCalledWith(
      { clientId: "grants-ui" },
      expect.objectContaining({ projection: { id: 0 }, session }),
    );
  });

  it("reads one token only under its own client's name", async () => {
    await findClientToken("grants-ui", TOKEN_ID);

    expect(accessTokens.findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(TOKEN_ID), clientId: "grants-ui" },
      withoutHash,
    );
  });

  it("finds the caller's own row by its hash, loading only its id", async () => {
    const _id = new ObjectId(TOKEN_ID);
    accessTokens.findOne.mockResolvedValue({ _id });

    expect(await findCallerTokenId(CALLER_HASH)).toBe(_id);
    expect(accessTokens.findOne).toHaveBeenCalledWith(
      { id: CALLER_HASH },
      expect.objectContaining({ projection: { _id: 1 } }),
    );
  });

  it("answers null when no row holds the caller's hash", async () => {
    expect(await findCallerTokenId(CALLER_HASH)).toBeNull();
  });
});

describe("insertToken", () => {
  it("inserts in the session and answers the new id", async () => {
    const insertedId = new ObjectId(TOKEN_ID);
    accessTokens.insertOne.mockResolvedValue({ insertedId });

    expect(await insertToken({ id: HASH }, session)).toBe(insertedId);
    expect(accessTokens.insertOne).toHaveBeenCalledWith(
      { id: HASH },
      { session },
    );
  });

  it("turns a duplicate hash into a plain 409 that quotes nothing", async () => {
    accessTokens.insertOne.mockRejectedValue(
      Object.assign(
        new Error(`E11000 duplicate key error dup key: { id: "${HASH}" }`),
        { code: 11000 },
      ),
    );

    const error = await insertToken({ id: HASH }, session).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.errorCode).toBe("API_TOKEN_DUPLICATE");
    expect(JSON.stringify(error.output.payload)).not.toContain(HASH);
    expect(error.message).not.toContain(HASH);
  });

  it("rethrows any other failure", async () => {
    const failure = new Error("network");
    accessTokens.insertOne.mockRejectedValue(failure);

    await expect(insertToken({ id: HASH }, session)).rejects.toBe(failure);
  });
});

describe("revokeToken", () => {
  const token = {
    revokedAt: NOW,
    revokedBy: "Ann Operator",
    expiresAt: NOW,
  };

  const revoke = (loadedExpiresAt = null) =>
    revokeToken(
      {
        clientId: "grants-ui",
        tokenId: TOKEN_ID,
        callerHash: CALLER_HASH,
        loadedExpiresAt,
        token,
      },
      session,
    );

  it("never matches the caller's own token, and only the row as it was read", async () => {
    accessTokens.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await revoke("2099-01-01");

    expect(accessTokens.updateOne).toHaveBeenCalledWith(
      {
        _id: new ObjectId(TOKEN_ID),
        clientId: "grants-ui",
        id: { $ne: CALLER_HASH },
        revokedAt: null,
        expiresAt: "2099-01-01",
      },
      expect.anything(),
      { session },
    );
  });

  it("writes who revoked it and when, and expires it", async () => {
    accessTokens.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await revoke();

    expect(accessTokens.updateOne.mock.calls[0][1]).toEqual({
      $set: { revokedAt: NOW, revokedBy: "Ann Operator", expiresAt: NOW },
    });
  });

  it.each([
    [1, true],
    [0, false],
  ])("with %i row changed answers %s", async (modifiedCount, revoked) => {
    accessTokens.updateOne.mockResolvedValue({ modifiedCount });

    expect(await revoke()).toBe(revoked);
  });
});

describe("deleteToken", () => {
  it("deletes the one row, only while it can't call", async () => {
    accessTokens.deleteOne.mockResolvedValue({ deletedCount: 1 });

    expect(
      await deleteToken(
        { clientId: "grants-ui", tokenId: TOKEN_ID, now: NOW },
        session,
      ),
    ).toBe(true);
    expect(accessTokens.deleteOne).toHaveBeenCalledWith(
      {
        _id: new ObjectId(TOKEN_ID),
        clientId: "grants-ui",
        $or: [
          { revokedAt: { $ne: null } },
          { expiresAt: { $type: "date", $lte: NOW } },
        ],
      },
      { session },
    );
  });
});

describe("guarded token updates", () => {
  const loaded = { expiresAt: null, revokedAt: NOW };
  const guard = {
    _id: new ObjectId(TOKEN_ID),
    clientId: "grants-ui",
    revokedAt: NOW,
    expiresAt: null,
  };

  it("sets a new expiry, and revives, only on the row as it was read", async () => {
    accessTokens.updateOne.mockResolvedValue({ matchedCount: 1 });

    expect(
      await changeTokenExpiry(
        {
          clientId: "grants-ui",
          tokenId: TOKEN_ID,
          loaded,
          token: { expiresAt: NOW },
        },
        session,
      ),
    ).toBe(true);
    expect(accessTokens.updateOne).toHaveBeenCalledWith(
      guard,
      {
        $set: { expiresAt: NOW },
        $unset: { revokedAt: "", revokedBy: "" },
      },
      { session },
    );
  });

  it.each([
    [true, { ...guard, id: { $ne: CALLER_HASH } }],
    [false, guard],
  ])(
    "shortens a rotated token, excluding the caller's own when at once is %s",
    async (immediately, filter) => {
      accessTokens.updateOne.mockResolvedValue({ matchedCount: 0 });

      expect(
        await shortenRotatedToken(
          {
            clientId: "grants-ui",
            tokenId: TOKEN_ID,
            loaded,
            token: { expiresAt: NOW },
            callerHash: CALLER_HASH,
            immediately,
          },
          session,
        ),
      ).toBe(false);
      expect(accessTokens.updateOne).toHaveBeenCalledWith(
        filter,
        { $set: { expiresAt: NOW } },
        { session },
      );
    },
  );
});
