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
        path: "/grant-admin/events/page",
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
        method: "get",
        path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/{claimCode}",
      },
      {
        method: "post",
        path: "/grant-admin/events/{service}/{box}/{id}/redrive",
      },
      {
        method: "post",
        path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements",
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
    expect(routes).toContain("get /grant-admin/events/page");
    expect(routes).toContain("get /grant-admin/events/{service}/{box}/{id}");
    expect(routes).toContain(
      "post /grant-admin/events/{service}/{box}/{id}/redrive",
    );
  });

  it.each(["/grant-admin/events/counts", "/grant-admin/events/breakdown"])(
    "no longer registers %s",
    async (path) => {
      const server = hapi.server();
      await server.register(grantAdmin);

      const routes = server.table().map(({ path: registered }) => registered);

      expect(routes).not.toContain(path);
    },
  );
});

describe("grant-admin route conflicts", () => {
  // The segment counts differ, so the paths cannot collide - proven here by
  // the router rather than a comment.
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
