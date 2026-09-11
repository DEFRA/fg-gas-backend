import hapi from "@hapi/hapi";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../common/config.js";
import { testEndpoints } from "./index.js";

describe("test-endpoints", () => {
  const originalFlag = config.enableTestEndpoints;

  afterEach(() => {
    config.enableTestEndpoints = originalFlag;
  });

  const registerServer = async () => {
    const server = hapi.server();
    await server.register(testEndpoints);
    return server;
  };

  it("registers as a hapi plugin", async () => {
    config.enableTestEndpoints = true;
    const server = await registerServer();

    expect(server.registrations["test-endpoints"]).toBeDefined();
  });

  it("registers the test endpoints when the flag is enabled", async () => {
    config.enableTestEndpoints = true;
    const server = await registerServer();

    const routes = server.table().map(({ method, path }) => ({ method, path }));

    expect(routes).toEqual(
      expect.arrayContaining([
        { method: "post", path: "/api/test/agreements" },
        {
          method: "post",
          path: "/api/test/agreements/{agreementNumber}/status",
        },
      ]),
    );
  });

  it("registers no routes when the flag is disabled", async () => {
    config.enableTestEndpoints = false;
    const server = await registerServer();

    expect(server.table()).toEqual([]);
  });

  it("returns 404 for both endpoints when the flag is disabled", async () => {
    config.enableTestEndpoints = false;
    const server = await registerServer();

    const created = await server.inject({
      method: "POST",
      url: "/api/test/agreements",
      payload: {},
    });
    const updated = await server.inject({
      method: "POST",
      url: "/api/test/agreements/PMF123456789/status",
      payload: { status: "withdrawn" },
    });

    expect(created.statusCode).toBe(404);
    expect(updated.statusCode).toBe(404);
  });
});
