import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "../repositories/access-token.repository.js";
import {
  changeApiTokenExpiry,
  deleteApiToken,
  issueApiToken,
  listApiTokens,
  revokeApiToken,
  rotateApiToken,
} from "./api-client.service.js";

vi.mock("../repositories/access-token.repository.js");

const NOW = new Date("2026-11-04T10:00:00.000Z");
const EARLIER = new Date("2026-11-01T10:00:00.000Z");
const HASH = "a".repeat(64);
const CALLER_HASH = "c".repeat(64);
const session = { id: "session" };

const A = new ObjectId("6650c1f2a9e4b1d07c20bd91");
const B = new ObjectId("6650c1f2a9e4b1d07c20bd92");
const C = new ObjectId("6650c1f2a9e4b1d07c20bd93");

const row = (_id, fields = {}) => ({
  _id,
  clientId: "grants-ui",
  expiresAt: null,
  ...fields,
});

const errorCodeOf = (error) => error.output.payload.errorCode;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listApiTokens", () => {
  it("answers every row, nameless ones by no name, marking the caller's", async () => {
    findAllTokens.mockResolvedValue(
      [
        row(A, { createdAt: EARLIER, tokenHint: "wxyz" }),
        row(B, { clientId: "Grants_UI" }),
        row(C, { clientId: undefined, client: "fg-grants-platform-admin" }),
      ].map((document) => ({
        token: AccessToken.fromDocument(document),
        stored: { _id: { $oid: document._id.toHexString() } },
      })),
    );
    findCallerTokenId.mockResolvedValue(new ObjectId(A.toHexString()));

    const { tokens } = await listApiTokens({ callerHash: CALLER_HASH });

    expect(findCallerTokenId).toHaveBeenCalledWith(CALLER_HASH);
    expect(tokens).toEqual([
      {
        tokenId: A.toHexString(),
        clientId: "grants-ui",
        status: "ACTIVE",
        tokenHint: "wxyz",
        createdAt: EARLIER,
        createdBy: null,
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
        inUse: true,
        stored: { _id: { $oid: A.toHexString() } },
      },
      expect.objectContaining({ tokenId: B.toHexString(), clientId: null }),
      expect.objectContaining({ tokenId: C.toHexString(), clientId: null }),
    ]);
    expect(tokens.filter(({ inUse }) => inUse)).toHaveLength(1);
  });
});

describe("issueApiToken", () => {
  const issue = (fields = {}) =>
    issueApiToken(
      {
        clientId: "grants-ui",
        tokenHash: HASH,
        tokenHint: "wxyz",
        expiresAt: null,
        newClient: true,
        by: "Ann",
        ...fields,
      },
      session,
    );

  it("inserts the new row in the session and answers it without the hash", async () => {
    findClientTokens.mockResolvedValue([]);
    insertToken.mockResolvedValue(A);

    const answer = await issue();

    expect(findClientTokens).toHaveBeenCalledWith("grants-ui", session);
    expect(insertToken).toHaveBeenCalledWith(
      {
        id: HASH,
        clientId: "grants-ui",
        expiresAt: null,
        createdAt: NOW,
        createdBy: "Ann",
        tokenHint: "wxyz",
      },
      session,
    );
    expect(answer).toEqual({
      token: {
        tokenId: A.toHexString(),
        clientId: "grants-ui",
        status: "ACTIVE",
        tokenHint: "wxyz",
        createdAt: NOW,
        createdBy: "Ann",
        expiresAt: null,
        revokedAt: null,
        revokedBy: null,
        inUse: false,
      },
    });
    expect(JSON.stringify(answer)).not.toContain(HASH);
  });

  it("writes nothing when the model refuses", async () => {
    findClientTokens.mockResolvedValue([row(A)]);

    expect(errorCodeOf(await issue().catch((e) => e))).toBe(
      "API_CLIENT_EXISTS",
    );
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("counts a row named outside the name rule as no row of the client", async () => {
    findClientTokens.mockResolvedValue([row(A, { clientId: "Grants_UI" })]);

    expect(
      errorCodeOf(
        await issue({ clientId: "Grants_UI", newClient: false }).catch(
          (e) => e,
        ),
      ),
    ).toBe("API_CLIENT_INVALID_NAME");
  });
});

describe("revokeApiToken", () => {
  const revoke = (clientId = "grants-ui") =>
    revokeApiToken(
      {
        clientId,
        tokenId: A.toHexString(),
        callerHash: CALLER_HASH,
        by: "Ann",
      },
      session,
    );

  beforeEach(() => {
    findClientToken.mockResolvedValue(row(A));
    findCallerTokenId.mockResolvedValue(B);
    revokeToken.mockResolvedValue(true);
  });

  it("revokes another token, guarded on the expiry it read", async () => {
    await revoke();

    expect(findCallerTokenId).toHaveBeenCalledWith(CALLER_HASH, session);
    expect(revokeToken).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenId: A.toHexString(),
        callerHash: CALLER_HASH,
        loadedExpiresAt: null,
        token: expect.objectContaining({
          revokedAt: NOW,
          revokedBy: "Ann",
          expiresAt: NOW,
        }),
      },
      session,
    );
  });

  it("guards on the expiry as read, whatever its type", async () => {
    findClientToken.mockResolvedValue(row(A, { expiresAt: "2099-01-01" }));

    await revoke();

    expect(revokeToken.mock.calls[0][0].loadedExpiresAt).toBe("2099-01-01");
  });

  it("refuses the caller's own token and writes nothing", async () => {
    findCallerTokenId.mockResolvedValue(new ObjectId(A.toHexString()));

    const error = await revoke().catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(errorCodeOf(error)).toBe("API_TOKEN_IN_USE");
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("refuses when the row changed before the write", async () => {
    revokeToken.mockResolvedValue(false);

    expect(errorCodeOf(await revoke().catch((e) => e))).toBe(
      "API_TOKEN_NOT_ACTIVE",
    );
  });

  it("is 404 for a token not under that client's name", async () => {
    findClientToken.mockResolvedValue(null);

    expect(errorCodeOf(await revoke().catch((e) => e))).toBe(
      "API_TOKEN_NOT_FOUND",
    );
  });

  it("is 404 for a row whose name breaks the name rule", async () => {
    findClientToken.mockResolvedValue(row(A, { clientId: "Grants_UI" }));

    expect(errorCodeOf(await revoke("Grants_UI").catch((e) => e))).toBe(
      "API_TOKEN_NOT_FOUND",
    );
    expect(revokeToken).not.toHaveBeenCalled();
  });
});

describe("deleteApiToken", () => {
  const remove = () =>
    deleteApiToken(
      { clientId: "grants-ui", tokenId: A.toHexString() },
      session,
    );

  it("deletes a revoked token in the session", async () => {
    findClientToken.mockResolvedValue(
      row(A, { revokedAt: EARLIER, expiresAt: EARLIER }),
    );
    deleteToken.mockResolvedValue(true);

    await remove();

    expect(deleteToken).toHaveBeenCalledWith(
      { clientId: "grants-ui", tokenId: A.toHexString(), now: NOW },
      session,
    );
  });

  it("deletes nothing while the token is active", async () => {
    findClientToken.mockResolvedValue(row(A));

    expect(errorCodeOf(await remove().catch((e) => e))).toBe(
      "API_TOKEN_ACTIVE",
    );
    expect(deleteToken).not.toHaveBeenCalled();
  });

  it.each([
    ["was revived", row(A), "API_TOKEN_ACTIVE"],
    ["is gone", null, "API_TOKEN_NOT_FOUND"],
  ])(
    "reads it again when the delete matched nothing, and it %s",
    async (_, reread, errorCode) => {
      findClientToken
        .mockResolvedValueOnce(row(A, { expiresAt: EARLIER }))
        .mockResolvedValueOnce(reread);
      deleteToken.mockResolvedValue(false);

      expect(errorCodeOf(await remove().catch((e) => e))).toBe(errorCode);
    },
  );

  it("is 404 for a row whose name breaks the name rule", async () => {
    findClientToken.mockResolvedValue(
      row(A, { clientId: "Grants_UI", expiresAt: EARLIER }),
    );

    expect(
      errorCodeOf(
        await deleteApiToken(
          { clientId: "Grants_UI", tokenId: A.toHexString() },
          session,
        ).catch((e) => e),
      ),
    ).toBe("API_TOKEN_NOT_FOUND");
  });
});

describe("changeApiTokenExpiry", () => {
  const change = (expiresAt) =>
    changeApiTokenExpiry(
      {
        clientId: "grants-ui",
        tokenId: A.toHexString(),
        callerHash: CALLER_HASH,
        expiresAt,
      },
      session,
    );

  beforeEach(() => {
    findCallerTokenId.mockResolvedValue(B);
    changeTokenExpiry.mockResolvedValue(true);
  });

  it("revives a revoked token, guarded on the row it read", async () => {
    findClientToken.mockResolvedValue(
      row(A, { revokedAt: EARLIER, revokedBy: "Ann", expiresAt: EARLIER }),
    );
    const later = new Date("2027-01-01T00:00:00.000Z");

    const answer = await change(later);

    expect(changeTokenExpiry).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenId: A.toHexString(),
        loaded: { expiresAt: EARLIER, revokedAt: EARLIER },
        token: expect.objectContaining({ expiresAt: later, revokedAt: null }),
      },
      session,
    );
    expect(answer).toMatchObject({
      previousExpiresAt: EARLIER,
      revived: true,
      token: { status: "ACTIVE", expiresAt: later, revokedAt: null },
    });
  });

  it("refuses to stop the caller's own token, writing nothing", async () => {
    findClientToken.mockResolvedValue(row(A));
    findCallerTokenId.mockResolvedValue(new ObjectId(A.toHexString()));

    expect(errorCodeOf(await change(EARLIER).catch((e) => e))).toBe(
      "API_TOKEN_IN_USE",
    );
    expect(changeTokenExpiry).not.toHaveBeenCalled();
  });

  it("refuses when the row changed before the write", async () => {
    findClientToken.mockResolvedValue(row(A));
    changeTokenExpiry.mockResolvedValue(false);

    expect(errorCodeOf(await change(null).catch((e) => e))).toBe(
      "API_TOKEN_NOT_ACTIVE",
    );
  });
});

describe("rotateApiToken", () => {
  const rotate = (keepOld = "24h") =>
    rotateApiToken(
      {
        clientId: "grants-ui",
        tokenId: A.toHexString(),
        callerHash: CALLER_HASH,
        tokenHash: HASH,
        tokenHint: "wxyz",
        keepOld,
        by: "Ann",
      },
      session,
    );

  beforeEach(() => {
    findClientToken.mockResolvedValue(row(A));
    findCallerTokenId.mockResolvedValue(B);
    shortenRotatedToken.mockResolvedValue(true);
    insertToken.mockResolvedValue(C);
  });

  it("shortens the old token, then inserts the new one with its expiry", async () => {
    const answer = await rotate("none");

    expect(shortenRotatedToken).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenId: A.toHexString(),
        loaded: { expiresAt: null, revokedAt: null },
        token: expect.objectContaining({ expiresAt: NOW }),
        callerHash: CALLER_HASH,
        immediately: true,
      },
      session,
    );
    expect(insertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: HASH,
        clientId: "grants-ui",
        expiresAt: null,
      }),
      session,
    );
    expect(answer).toMatchObject({
      token: { tokenId: C.toHexString(), expiresAt: null, inUse: false },
      oldExpiresAt: NOW,
    });
    expect(JSON.stringify(answer)).not.toContain(HASH);
  });

  it("inserts nothing when the old token changed meanwhile", async () => {
    shortenRotatedToken.mockResolvedValue(false);

    expect(errorCodeOf(await rotate().catch((e) => e))).toBe(
      "API_TOKEN_NOT_ACTIVE",
    );
    expect(insertToken).not.toHaveBeenCalled();
  });

  it("refuses to end the caller's own token at once", async () => {
    findCallerTokenId.mockResolvedValue(new ObjectId(A.toHexString()));

    expect(errorCodeOf(await rotate("none").catch((e) => e))).toBe(
      "API_TOKEN_IN_USE",
    );
    expect(insertToken).not.toHaveBeenCalled();
  });
});
