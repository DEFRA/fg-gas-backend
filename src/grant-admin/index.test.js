import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { grantAdmin } from "./index.js";

describe("grant-admin", () => {
  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(server.registrations["grant-admin"]).toBeDefined();
  });

  it("registers the admin claims, events, buckets, applications, cases, grant version and workflow version endpoints", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server
      .table()
      .map(({ method, path }) => `${method} ${path}`)
      .sort();

    expect(routes).toEqual([
      "get /grant-admin/buckets",
      "get /grant-admin/events/{service}/{box}/{id}",
      "get /grant-admin/grants/{code}/allow-list",
      "get /grant-admin/grants/{code}/applications/{clientRef}/claims",
      "get /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}",
      "get /grant-admin/grants/{code}/applications/{clientRef}/claims/{claimCode}",
      "get /grant-admin/grants/{code}/applications/{clientRef}/events",
      "get /grant-admin/grants/{code}/applications/{clientRef}/overview",
      "get /grant-admin/grants/{code}/applications/{clientRef}/raw",
      "get /grant-admin/grants/{code}/versions",
      "get /grant-admin/grants/{code}/versions/{version}/agreement",
      "get /grant-admin/grants/{code}/versions/{version}/definition",
      "get /grant-admin/grants/{code}/versions/{version}/entitlements",
      "get /grant-admin/grants/{code}/versions/{version}/overview",
      "get /grant-admin/grants/{code}/versions/{version}/payment",
      "get /grant-admin/grants/{code}/versions/{version}/phases",
      "get /grant-admin/workflows/{code}/versions",
      "get /grant-admin/workflows/{code}/versions/{version}/definition",
      "get /grant-admin/workflows/{code}/versions/{version}/overview",
      "get /grant-admin/workflows/{code}/versions/{version}/raw",
      "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/events",
      "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/overview",
      "get /grant-admin/workflows/{workflowCode}/cases/{caseRef}/raw",
      "post /grant-admin/buckets/{bucketId}/query",
      "post /grant-admin/buckets/{bucketId}/summaries/{summaryId}",
      "post /grant-admin/events/{service}/{box}/{id}/payload",
      "post /grant-admin/events/{service}/{box}/{id}/purge",
      "post /grant-admin/events/{service}/{box}/{id}/redrive",
      "post /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements",
      "post /grant-admin/grants/{code}/versions/{version}/fetch",
      "post /grant-admin/workflows/{code}/versions/{version}/fetch",
      "put /grant-admin/grants/{code}/allow-list",
      "put /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements/{entitlementId}",
    ]);
  });

  it("still routes a claims path to the claims route beside the application tabs", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(
      server.match(
        "get",
        "/grant-admin/grants/woodland/applications/ref-1/claims",
      ).path,
    ).toBe("/grant-admin/grants/{code}/applications/{clientRef}/claims");
  });

  it("registers the admin events endpoint", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server
      .table()
      .map(({ method, path }) => `${method} ${path}`);

    expect(routes).toContain("get /grant-admin/events/{service}/{box}/{id}");
    expect(routes).toContain(
      "post /grant-admin/events/{service}/{box}/{id}/redrive",
    );
    expect(routes).toContain(
      "post /grant-admin/events/{service}/{box}/{id}/purge",
    );
    expect(routes).toContain(
      "post /grant-admin/events/{service}/{box}/{id}/payload",
    );
  });

  it("protects the allow-list routes from other authenticated clients", async () => {
    const server = hapi.server();
    server.auth.scheme("stub", () => ({
      authenticate: (_request, h) =>
        h.authenticated({ credentials: { service: "some-other-service" } }),
    }));
    server.auth.strategy("service", "stub");
    server.auth.default("service");
    await server.register(grantAdmin);
    await server.initialize();

    const response = await server.inject({
      method: "GET",
      url: "/grant-admin/grants/woodland/allow-list",
      headers: {
        "x-actor": "Jo Operator",
        "x-actor-id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      },
    });

    expect(response.statusCode).toBe(403);
    await server.stop();
  });
});

describe("grant-admin route conflicts", () => {
  it.each([
    ["get", "/grant-admin/events/page"],
    ["post", "/grant-admin/applications/search"],
    ["post", "/grant-admin/cases/search"],
  ])(
    "no longer routes %s %s, which a bucket replaced",
    async (method, path) => {
      const server = hapi.server();
      await server.register(grantAdmin);

      expect(server.match(method, path)).toBeNull();
    },
  );

  it("still routes a three-segment detail path to the detail route", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(
      server.match(
        "get",
        "/grant-admin/events/gas/inbox/665f1c2e9a1b2c3d4e5f6a7b",
      ).path,
    ).toBe("/grant-admin/events/{service}/{box}/{id}");
  });
});
