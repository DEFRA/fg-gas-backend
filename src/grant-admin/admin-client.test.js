import Boom from "@hapi/boom";
import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { ADMIN_CLIENT, requireAdminClient } from "./admin-client.js";

// A server shaped like the real one: a default auth strategy that accepts any
// persisted client, and the guard registered against one plugin's routes.
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

  // The point of the guard: this caller's credential is perfectly valid, and
  // GAS issues credentials to several services.
  it("refuses another service with 403, not 401", async () => {
    const { statusCode, result } = await get("some-other-service");

    expect(statusCode).toBe(403);
    expect(result.error).toBe("Forbidden");
  });

  it("names the surface rather than the client it expects", async () => {
    const { result } = await get("some-other-service");

    expect(result.message).toBe("The grant-admin API is not open to this client");
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

  // The rest of GAS's service API keeps answering the clients it was issued
  // to - the guard is sandboxed to the grant-admin plugin's own routes.
  it("leaves routes outside the plugin alone", async () => {
    const { statusCode } = await get("some-other-service", "/grants/woodland");

    expect(statusCode).toBe(200);
  });
});
