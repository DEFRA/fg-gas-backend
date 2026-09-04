import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { grantAdmin } from "./index.js";

describe("grant-admin", () => {
  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(server.registrations["grant-admin"]).toBeDefined();
  });

  it("registers the admin claims and events endpoints", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server.table().map(({ method, path }) => ({ method, path }));

    expect(routes).toEqual([
      {
        method: "get",
        path: "/grant-admin/events",
      },
      {
        method: "get",
        path: "/grant-admin/events/breakdown",
      },
      {
        method: "get",
        path: "/grant-admin/events/counts",
      },
      {
        method: "get",
        path: "/grant-admin/events/{service}/{box}/{id}",
      },
      {
        method: "get",
        path: "/grant-admin/grants/{code}/applications/{clientRef}/claims",
      },
      {
        method: "post",
        path: "/grant-admin/events/{service}/{box}/{id}/redrive",
      },
    ]);
  });

  it("registers the admin events endpoint", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server
      .table()
      .map(({ method, path }) => `${method} ${path}`);

    expect(routes).toContain("get /grant-admin/events");
    expect(routes).toContain("get /grant-admin/events/counts");
    expect(routes).toContain("get /grant-admin/events/{service}/{box}/{id}");
    expect(routes).toContain(
      "post /grant-admin/events/{service}/{box}/{id}/redrive",
    );
  });
});

describe("grant-admin route conflicts", () => {
  // `/events/breakdown` and `/events/counts` are single-segment paths and
  // `/events/{service}/{box}/{id}` is a three-segment one, so they cannot
  // collide - but the router, not a comment, is what proves it.
  it("routes /events/breakdown to the breakdown route, not the detail route", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const match = server.match("get", "/grant-admin/events/breakdown");

    expect(match.path).toBe("/grant-admin/events/breakdown");
  });

  it("routes /events/counts to the counts route", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(server.match("get", "/grant-admin/events/counts").path).toBe(
      "/grant-admin/events/counts",
    );
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
