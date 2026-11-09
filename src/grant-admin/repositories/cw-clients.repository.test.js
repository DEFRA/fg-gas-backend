import { beforeEach, describe, expect, it, vi } from "vitest";
import { wreck } from "../../common/wreck.js";
import {
  changeCwApiTokenExpiry,
  deleteCwApiToken,
  findCwApiTokens,
  issueCwApiToken,
  revokeCwApiToken,
  rotateCwApiToken,
} from "./cw-clients.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/logger.js");
vi.mock("../../common/mongo-client.js", () => ({ db: {} }));
vi.mock("../../common/wreck.js", () => ({
  wreck: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const URL_BASE = "http://cw.test";
const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
const HASH = "e".repeat(64);
const ACTOR = "Ann Operator";

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = "cw-token";
  cwBackend.timeoutMs = 3000;
});

const httpError = (statusCode, body) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: Buffer.from(JSON.stringify(body ?? {})) },
  });

const cwToken = {
  tokenId: TOKEN_ID,
  clientId: "fg-gas-backend",
  status: "ACTIVE",
  tokenHint: "x9Q_",
  createdAt: "2026-11-02T10:00:00.000Z",
  createdBy: "Ann Operator",
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: true,
};

const stored = {
  _id: { $oid: TOKEN_ID },
  id: "eee••••••eee",
  client: "fg-gas-backend",
  tokenHint: "x9Q_",
  expiresAt: null,
  createdAt: { $date: "2026-11-02T10:00:00Z" },
  createdBy: "Ann Operator",
};

const listed = { ...cwToken, stored };

const failureOf = async (call) => {
  const error = await call().catch((e) => e);

  return {
    statusCode: error.output.statusCode,
    errorCode: error.output.payload.errorCode,
    message: error.message,
  };
};

describe("findCwApiTokens", () => {
  it("reads Caseworking's rows and keeps only the fields GAS answers", async () => {
    wreck.get.mockResolvedValue({
      payload: {
        tokens: [
          { ...listed, id: HASH },
          { ...listed, clientId: null, tokenHint: null, inUse: false },
        ],
      },
    });

    const answer = await findCwApiTokens({ actor: ACTOR });

    expect(wreck.get).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer cw-token",
          "x-actor": ACTOR,
        }),
      }),
    );
    expect(answer.tokens).toEqual([
      { ...listed, createdAt: new Date(cwToken.createdAt) },
      {
        ...listed,
        createdAt: new Date(cwToken.createdAt),
        clientId: null,
        tokenHint: null,
        inUse: false,
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain(HASH);
  });

  it("passes the stored row on exactly as sent, every field it has", async () => {
    const row = { ...stored, revokedAt: null, revokedBy: null, legacy: 1 };
    wreck.get.mockResolvedValue({
      payload: { tokens: [{ ...listed, stored: row }] },
    });

    expect((await findCwApiTokens({ actor: ACTOR })).tokens[0].stored).toEqual(
      row,
    );
  });

  it.each([
    ["an unmasked id", { id: HASH }],
    ["a hash in another field", { tokenHash: HASH }],
    ["a nested value", { extra: { id: HASH } }],
    ["a hash as a key", { [HASH]: 1 }],
  ])("is a 502 quoting no hash on a stored row with %s", async (_, extra) => {
    wreck.get.mockResolvedValue({
      payload: { tokens: [{ ...listed, stored: { ...stored, ...extra } }] },
    });

    const failure = await failureOf(() => findCwApiTokens({ actor: ACTOR }));

    expect(failure.statusCode).toBe(502);
    expect(JSON.stringify(failure)).not.toContain(HASH);
  });

  it("passes Caseworking's inUse through unchanged", async () => {
    wreck.get.mockResolvedValue({ payload: { tokens: [listed] } });

    expect((await findCwApiTokens({ actor: ACTOR })).tokens[0].inUse).toBe(
      true,
    );
  });

  it("is a 502 when the answer cannot be read", async () => {
    wreck.get.mockResolvedValue({ payload: { tokens: "nope" } });

    expect((await failureOf(() => findCwApiTokens({}))).statusCode).toBe(502);
  });
});

describe("issueCwApiToken", () => {
  it("sends only the hash, the hint and whether the client is new", async () => {
    wreck.post.mockResolvedValue({
      payload: { token: { ...cwToken, clientId: "role-reader", inUse: false } },
    });

    await issueCwApiToken(
      "role-reader",
      { tokenHash: HASH, tokenHint: "x9Q_", expiresAt: null, newClient: true },
      { actor: ACTOR },
    );

    expect(wreck.post).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients/role-reader/tokens`,
      expect.objectContaining({
        payload: {
          tokenHash: HASH,
          tokenHint: "x9Q_",
          expiresAt: null,
          newClient: true,
        },
        headers: expect.objectContaining({ "x-actor": ACTOR }),
      }),
    );
  });
});

describe("revokeCwApiToken", () => {
  it("names the operator in a header, not the query", async () => {
    wreck.post.mockResolvedValue({ payload: null });

    await revokeCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR });

    expect(wreck.post).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients/role-reader/tokens/${TOKEN_ID}/revoke`,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-actor": ACTOR }),
      }),
    );
  });
});

describe("deleteCwApiToken", () => {
  it("deletes the token, naming the operator in a header", async () => {
    wreck.delete.mockResolvedValue({ payload: null });

    await deleteCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR });

    expect(wreck.delete).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients/role-reader/tokens/${TOKEN_ID}`,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-actor": ACTOR }),
      }),
    );
  });

  it.each([
    [409, "API_TOKEN_ACTIVE"],
    [404, "API_TOKEN_NOT_FOUND"],
  ])("keeps Caseworking's %i %s", async (status, errorCode) => {
    wreck.delete.mockRejectedValue(httpError(status, { errorCode }));

    expect(
      await failureOf(() =>
        deleteCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR }),
      ),
    ).toMatchObject({ statusCode: status, errorCode });
  });
});

describe("changeCwApiTokenExpiry", () => {
  it("puts the new expiry and answers the row", async () => {
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    wreck.put.mockResolvedValue({
      payload: {
        token: { ...cwToken, expiresAt: expiresAt.toISOString() },
        previousExpiresAt: "2026-11-03T10:00:00.000Z",
        revived: true,
      },
    });

    const { token, previousExpiresAt, revived } = await changeCwApiTokenExpiry(
      "role-reader",
      TOKEN_ID,
      { expiresAt },
      { actor: ACTOR },
    );

    expect(wreck.put).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients/role-reader/tokens/${TOKEN_ID}/expiry`,
      expect.objectContaining({ payload: { expiresAt } }),
    );
    expect(token.expiresAt).toEqual(expiresAt);
    expect(previousExpiresAt).toEqual(new Date("2026-11-03T10:00:00.000Z"));
    expect(revived).toBe(true);
  });
});

describe("rotateCwApiToken", () => {
  it("sends only the new hash, hint and overlap, and answers the new row", async () => {
    wreck.post.mockResolvedValue({
      payload: { token: cwToken, oldExpiresAt: "2026-11-05T10:00:00.000Z" },
    });

    const { oldExpiresAt } = await rotateCwApiToken(
      "role-reader",
      TOKEN_ID,
      { tokenHash: HASH, tokenHint: "x9Q_", keepOld: "24h" },
      { actor: ACTOR },
    );

    expect(wreck.post).toHaveBeenCalledWith(
      `${URL_BASE}/actuators/clients/role-reader/tokens/${TOKEN_ID}/rotate`,
      expect.objectContaining({
        payload: { tokenHash: HASH, tokenHint: "x9Q_", keepOld: "24h" },
      }),
    );
    expect(oldExpiresAt).toEqual(new Date("2026-11-05T10:00:00.000Z"));
  });
});

describe("Caseworking's refusals", () => {
  const revoke = () =>
    revokeCwApiToken("fg-gas-backend", TOKEN_ID, { actor: ACTOR });

  it.each([
    "API_TOKEN_IN_USE",
    "API_TOKEN_NOT_ACTIVE",
    "API_CLIENT_EXISTS",
    "API_TOKEN_ACTIVE",
    "API_TOKEN_DUPLICATE",
  ])("keeps a 409 %s", async (errorCode) => {
    wreck.post.mockRejectedValue(
      httpError(409, { errorCode, message: "SECRET-CW-MESSAGE" }),
    );

    const failure = await failureOf(revoke);

    expect(failure).toMatchObject({ statusCode: 409, errorCode });
    expect(failure.message).not.toContain("SECRET-CW-MESSAGE");
  });

  it("does not repeat an errorCode it does not know", async () => {
    wreck.post.mockRejectedValue(httpError(409, { errorCode: "<script>" }));

    expect(await failureOf(revoke)).toMatchObject({
      statusCode: 409,
      errorCode: "UNEXPECTED_FAILURE",
    });
  });

  it.each(["API_CLIENT_NOT_FOUND", "API_TOKEN_NOT_FOUND"])(
    "keeps a 404 %s",
    async (errorCode) => {
      wreck.post.mockRejectedValue(httpError(404, { errorCode }));

      expect(await failureOf(revoke)).toMatchObject({
        statusCode: 404,
        errorCode,
      });
    },
  );

  it("treats a 404 with no errorCode as a Caseworking without the routes", async () => {
    wreck.post.mockRejectedValue(httpError(404, { message: "Not Found" }));

    expect((await failureOf(revoke)).statusCode).toBe(502);
  });

  it.each([
    "API_CLIENT_INVALID_NAME",
    "API_TOKEN_INVALID_HASH",
    "API_TOKEN_INVALID_HINT",
    "API_TOKEN_INVALID_EXPIRY",
  ])("keeps a 400 %s", async (errorCode) => {
    wreck.post.mockRejectedValue(httpError(400, { errorCode }));

    expect(await failureOf(revoke)).toMatchObject({
      statusCode: 400,
      errorCode,
    });
  });

  it("treats a 400 with no errorCode as Caseworking unavailable", async () => {
    wreck.post.mockRejectedValue(httpError(400, { message: "SECRET" }));

    expect((await failureOf(revoke)).statusCode).toBe(502);
  });

  it("keeps a 403", async () => {
    wreck.post.mockRejectedValue(httpError(403, {}));

    expect(await failureOf(revoke)).toMatchObject({
      statusCode: 403,
      errorCode: "CW_FORBIDDEN",
    });
  });

  it.each([504, 408])(
    "is a 504 when Caseworking does not answer (%i)",
    async (status) => {
      wreck.post.mockRejectedValue(httpError(status));

      expect((await failureOf(revoke)).statusCode).toBe(504);
    },
  );

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])(
    "is a 503 CW_UNREACHABLE when nothing was sent (%s)",
    async (code) => {
      wreck.post.mockRejectedValue(
        Object.assign(new Error("Client request error"), {
          code,
          output: { statusCode: 502 },
        }),
      );

      expect(await failureOf(revoke)).toMatchObject({
        statusCode: 503,
        errorCode: "CW_UNREACHABLE",
      });
    },
  );

  it("is still a 502 when the connection broke after sending", async () => {
    wreck.post.mockRejectedValue(
      Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
        output: { statusCode: 502 },
      }),
    );

    expect((await failureOf(revoke)).statusCode).toBe(502);
  });

  it("is a 502 for anything else", async () => {
    wreck.post.mockRejectedValue(httpError(500, { message: "SECRET" }));

    const failure = await failureOf(revoke);

    expect(failure.statusCode).toBe(502);
    expect(failure.message).not.toContain("SECRET");
  });
});
