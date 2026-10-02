import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { grantAdmin } from "./index.js";

describe("grant-admin", () => {
  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(server.registrations["grant-admin"]).toBeDefined();
  });

  it("registers the admin claims, events and applications endpoints", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server
      .table()
      .map(({ method, path }) => `${method} ${path}`)
      .sort();

    expect(routes).toEqual([
      "get /grant-admin/events/page",
      "get /grant-admin/events/{service}/{box}/{id}",
      "get /grant-admin/grants/{code}/applications/{clientRef}/claims",
      "get /grant-admin/grants/{code}/applications/{clientRef}/claims/{claimCode}",
      "get /grant-admin/grants/{code}/applications/{clientRef}/events",
      "get /grant-admin/grants/{code}/applications/{clientRef}/overview",
      "get /grant-admin/grants/{code}/applications/{clientRef}/raw",
      "post /grant-admin/applications/search",
      "post /grant-admin/events/{service}/{box}/{id}/payload",
      "post /grant-admin/events/{service}/{box}/{id}/purge",
      "post /grant-admin/events/{service}/{box}/{id}/redrive",
      "post /grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements",
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

    expect(routes).toContain("get /grant-admin/events/page");
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
});

describe("grant-admin route conflicts", () => {
  it("routes /events/page to the page route, not the detail route", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const match = server.match("get", "/grant-admin/events/page");

    expect(match.path).toBe("/grant-admin/events/page");
  });

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
