import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { auth } from "../auth/auth.js";
import { db } from "../common/mongo-client.js";
import { ADMIN_CLIENT, requireAdminClient } from "./admin-client.js";

vi.mock("../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
}));

const serverFor = async (client) => {
  const server = hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (request, h) =>
      client === null
        ? h.unauthenticated(Boom.unauthorized("no credential"))
        : h.authenticated({ credentials: { service: client } }),
  }));
  server.auth.strategy("service", "stub");
  server.auth.default("service");

  await server.register({
    name: "guarded",
    register(inner) {
      inner.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });
      inner.route({
        method: "GET",
        path: "/grant-admin/events",
        handler: () => ({ ok: true }),
      });
    },
  });

  // Registered by a different plugin, so the guard must not touch it.
  await server.register({
    name: "elsewhere",
    register(inner) {
      inner.route({
        method: "GET",
        path: "/grants/woodland",
        handler: () => ({ ok: true }),
      });
    },
  });

  await server.initialize();

  return server;
};

const get = async (client, url = "/grant-admin/events") =>
  (await serverFor(client)).inject({ method: "GET", url });

describe("requireAdminClient", () => {
  it("lets the grants platform admin through", async () => {
    const { statusCode, result } = await get(ADMIN_CLIENT);

    expect(statusCode).toBe(200);
    expect(result).toEqual({ ok: true });
  });

  it("refuses another service with 403, not 401", async () => {
    const { statusCode, result } = await get("some-other-service");

    expect(statusCode).toBe(403);
    expect(result.error).toBe("Forbidden");
  });

  it("names the surface rather than the client it expects", async () => {
    const { result } = await get("some-other-service");

    expect(result.message).toBe(
      "The grant-admin API is not open to this client",
    );
    expect(JSON.stringify(result)).not.toContain(ADMIN_CLIENT);
  });

  it("leaves an unauthenticated caller as a 401", async () => {
    const { statusCode } = await get(null);

    expect(statusCode).toBe(401);
  });

  // A near-miss is not a match: the check is the whole name.
  it.each(["fg-grants-platform-admin-staging", "grants-platform-admin", ""])(
    "refuses %p",
    async (client) => {
      expect((await get(client)).statusCode).toBe(403);
    },
  );

  it("leaves routes outside the plugin alone", async () => {
    const { statusCode } = await get("some-other-service", "/grants/woodland");

    expect(statusCode).toBe(200);
  });
});

describe("requireAdminClient with service bearer authentication", () => {
  it.each([
    [{ client: "fg-grants-platform-admin" }, 200],
    [{ client: "grants-ui" }, 403],
    [{ clientId: "grants-ui", client: "fg-grants-platform-admin" }, 403],
  ])("authorises token record %j with status %i", async (identity, status) => {
    const token = "test-admin-guard-token";
    const id = createHash("sha256").update(token).digest("hex");
    db.collection.mockReturnValue({
      findOne: vi.fn(async (query) =>
        query.id === id ? { id, ...identity, expiresAt: null } : null,
      ),
    });

    const server = hapi.server();
    await server.register(auth);
    await server.register({
      name: "guarded",
      register(inner) {
        inner.ext("onPostAuth", requireAdminClient, { sandbox: "plugin" });
        inner.route({
          method: "GET",
          path: "/grant-admin/events",
          handler: () => ({ ok: true }),
        });
      },
    });
    await server.initialize();

    try {
      const response = await server.inject({
        method: "GET",
        url: "/grant-admin/events",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(status);
      if (status === 200) {
        expect(response.result).toEqual({ ok: true });
      } else {
        expect(response.result.message).toBe(
          "The grant-admin API is not open to this client",
        );
      }
    } finally {
      await server.stop();
    }
  });
});
