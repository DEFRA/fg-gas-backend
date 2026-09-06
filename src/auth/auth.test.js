import crypto from "node:crypto";
import Jwt from "@hapi/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../common/config.js";
import { db } from "../common/mongo-client.js";
import { createServer } from "../server.js";

// Mock Mongo client and DB so auth can validate bearer tokens without a real database
vi.mock("../common/mongo-client.js", () => ({
  mongoClient: { connect: vi.fn(), close: vi.fn() },
  db: { collection: vi.fn() },
}));

describe("auth plugin", () => {
  let validId;
  let tokensById;

  beforeEach(() => {
    vi.clearAllMocks();

    validId = crypto.createHash("sha256").update("good", "utf8").digest("hex");

    tokensById = {
      [validId]: { id: validId, clientId: "http-client" },
    };

    const accessTokens = {
      findOne: vi.fn(async (query) => {
        if (!query?.id) return null;
        return tokensById[query.id] ?? null;
      }),
    };

    db.collection.mockImplementation((name) => {
      if (name === "access_tokens") return accessTokens;
      return { findOne: vi.fn() };
    });
  });

  it("authenticates requests with a valid bearer token and exposes credentials", async () => {
    const server = await createServer();
    server.route({
      method: "GET",
      path: "/secure",
      handler: (request) => ({ creds: request.auth.credentials }),
    });

    await server.initialize();

    const res = await server.inject({
      method: "GET",
      url: "/secure",
      headers: { authorization: "Bearer good" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.result.creds).toEqual({
      service: "http-client",
      tokenId: validId,
    });
  });

  it("accepts whitespace around the token (header is trimmed)", async () => {
    const server = await createServer();
    server.route({ method: "GET", path: "/secure", handler: () => "ok" });

    await server.initialize();

    const res = await server.inject({
      method: "GET",
      url: "/secure",
      headers: { authorization: "Bearer   good   " },
    });

    expect(res.statusCode).toBe(200);
  });

  it("rejects requests with an invalid token", async () => {
    const server = await createServer();
    server.route({ method: "GET", path: "/secure", handler: () => "ok" });

    await server.initialize();

    const res = await server.inject({
      method: "GET",
      url: "/secure",
      headers: { authorization: "Bearer wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it('requires exact "Bearer " prefix casing', async () => {
    const server = await createServer();
    server.route({ method: "GET", path: "/secure", handler: () => "ok" });

    await server.initialize();

    const res = await server.inject({
      method: "GET",
      url: "/secure",
      headers: { authorization: "bearer good" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("does not verify caller tokens on non-agreement routes", async () => {
    const server = await createServer();
    server.route({
      method: "GET",
      path: "/secure",
      handler: (request) => ({ callerToken: request.app.callerToken ?? null }),
    });

    await server.initialize();

    const res = await server.inject({
      method: "GET",
      url: "/secure",
      headers: {
        authorization: "Bearer good",
        "x-encrypted-auth": "eyJ.forwarded.caller-token",
      },
    });

    // /secure is not an agreement route, so the caller token is ignored.
    expect(res.statusCode).toBe(200);
    expect(res.result.callerToken).toBeNull();
  });

  describe("caller token verification (FGP-1307)", () => {
    const DEFAULT_SECRET = "gas-default-secret-at-least-256-bits-long-000000";
    const DEFAULT_KID = "agreements-hs256-1";
    const ROTATED_KID = "agreements-hs256-2";
    const ROTATED_SECRET = "gas-rotated-secret-at-least-256-bits-long-000000";

    let savedCallerToken;

    const mintToken = (secret, { header, ...payload } = {}) =>
      Jwt.token.generate(
        {
          iss: "grants-ui",
          aud: ["agreements-ui", "gas"],
          sub: "1234567890",
          source: "defra",
          grantCode: "pigs-might-fly",
          sbi: "300000000",
          clientRef: "client-ref",
          ...payload,
        },
        secret,
        { ttlSec: 300, ...(header ? { header } : {}) },
      );

    const routeExposingCallerToken = (server) =>
      server.route({
        method: "GET",
        path: "/agreements/current",
        handler: (request) => ({ callerToken: request.app.callerToken }),
      });

    beforeEach(() => {
      savedCallerToken = { ...config.callerToken };
      config.callerToken.secret = DEFAULT_SECRET;
      config.callerToken.defaultKid = DEFAULT_KID;
      config.callerToken.keyring = {};
      config.callerToken.enforce = true;
    });

    afterEach(() => {
      config.callerToken = savedCallerToken;
    });

    it("verifies a forwarded caller token (warn-only) without breaking the request", async () => {
      config.callerToken.enforce = false;

      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": "eyJ.forwarded.caller-token",
        },
      });

      // Warn-only: a bad/unverifiable caller token must not break the request.
      expect(res.statusCode).toBe(200);
      expect(res.result.callerToken.verified).toBe(false);
    });

    it("records a missing-token reason (warn-only) when no caller token is sent", async () => {
      config.callerToken.enforce = false;

      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: { authorization: "Bearer good" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.result.callerToken).toEqual({
        verified: false,
        reason: "missing-token",
      });
    });

    it("accepts a fully valid caller token when enforcing", async () => {
      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": mintToken(DEFAULT_SECRET),
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.result.callerToken.verified).toBe(true);
      expect(res.result.callerToken.warnings).toEqual([]);
    });

    it("verifies a rotated caller token by its kid using the keyring", async () => {
      config.callerToken.keyring = { [ROTATED_KID]: ROTATED_SECRET };

      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": mintToken(ROTATED_SECRET, {
            header: { kid: ROTATED_KID },
          }),
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.result.callerToken.verified).toBe(true);
    });

    it("rejects a request with no caller token when enforcing", async () => {
      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: { authorization: "Bearer good" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects a caller token signed with the wrong secret when enforcing", async () => {
      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": mintToken(
            "a-different-secret-at-least-256-bits-long-00000",
          ),
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects a caller token with an unknown kid when enforcing", async () => {
      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": mintToken(DEFAULT_SECRET, {
            header: { kid: "not-in-keyring" },
          }),
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects a caller token from an issuer outside the allow-list when enforcing", async () => {
      const server = await createServer();
      routeExposingCallerToken(server);
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/agreements/current",
        headers: {
          authorization: "Bearer good",
          "x-encrypted-auth": mintToken(DEFAULT_SECRET, { iss: "attacker" }),
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("ignores caller tokens on non-agreement routes even when enforcing", async () => {
      const server = await createServer();
      server.route({
        method: "GET",
        path: "/secure",
        handler: (request) => ({
          callerToken: request.app.callerToken ?? null,
        }),
      });
      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/secure",
        headers: { authorization: "Bearer good" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.result.callerToken).toBeNull();
    });
  });
});
