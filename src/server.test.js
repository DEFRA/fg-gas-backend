import Joi from "joi";
import { up } from "migrate-mongo";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, mongoClient } from "./common/mongo-client.js";
import { createServer } from "./server.js";

// Mock Mongo client and DB so auth can validate bearer tokens without a real database
vi.mock("./common/mongo-client.js", () => {
  return {
    mongoClient: {
      connect: vi.fn(),
      close: vi.fn(),
    },
    db: {
      collection: vi.fn(),
    },
  };
});
vi.mock("migrate-mongo");

describe("server", () => {
  beforeEach(() => {
    up.mockResolvedValue(["001-initial-migration.js", "002-add-some-data.js"]);
    vi.clearAllMocks();

    const validId = crypto
      .createHash("sha256")
      .update("token", "utf8")
      .digest("hex");
    const expiredId = crypto
      .createHash("sha256")
      .update("expired", "utf8")
      .digest("hex");

    const tokensById = {
      [validId]: { id: validId, clientId: "http-client" },
      [expiredId]: {
        id: expiredId,
        clientId: "http-client",
        expiresAt: new Date(Date.now() - 1000),
      },
    };

    const accessTokens = {
      findOne: vi.fn(async (query) => {
        if (!query?.id) {
          return null;
        }

        return tokensById[query.id] ?? null;
      }),
    };

    db.collection.mockImplementation((name) => {
      if (name === "access_tokens") return accessTokens;
      return { findOne: vi.fn() };
    });
  });

  it("strips trailing slashes", async () => {
    const server = await createServer();
    server.route({
      method: "GET",
      path: "/path",
      handler: () => "Hello, World!",
    });

    await server.initialize();

    const response = await server.inject({
      method: "GET",
      url: "/path/",
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.request.url.pathname).toBe("/path");
  });

  it("calls MongoClient on start and stop", async () => {
    vi.spyOn(mongoClient, "connect");
    const server = await createServer();

    await server.initialize();

    server.events.emit("start");
    expect(mongoClient.connect).toHaveBeenCalled();

    server.events.emit("stop");
    expect(mongoClient.close).toHaveBeenCalled();
  });

  it("validates routes", async () => {
    const server = await createServer();
    const expectedErrorMessage = '"Payload" must be of type object';

    server.route({
      method: "POST",
      path: "/broken",
      options: {
        validate: {
          payload: Joi.object({ username: Joi.string().required() }).label(
            "Payload",
          ),
        },
      },
      async handler() {
        /* should not get here */
      },
    });

    await server.initialize();

    const { result, statusCode } = await server.inject({
      method: "POST",
      url: "/broken",
      headers: {
        authorization: "Bearer token",
      },
    });

    expect(statusCode).toBe(400);
    expect(result.message).toBe(expectedErrorMessage);
  });

  describe("auth", () => {
    it("rejects requests without bearer token", async () => {
      const server = await createServer();
      server.route({
        method: "GET",
        path: "/secure",
        handler: () => "ok",
      });

      await server.initialize();

      const res = await server.inject({ method: "GET", url: "/secure" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects requests with invalid token", async () => {
      const server = await createServer();
      server.route({
        method: "GET",
        path: "/secure",
        handler: () => "ok",
      });

      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/secure",
        headers: { authorization: "Bearer wrong" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects requests with expired token", async () => {
      const server = await createServer();
      server.route({
        method: "GET",
        path: "/secure",
        handler: () => "ok",
      });

      await server.initialize();

      const res = await server.inject({
        method: "GET",
        url: "/secure",
        headers: { authorization: "Bearer expired" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
