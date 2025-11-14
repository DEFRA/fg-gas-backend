import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
