import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { grantAdmin } from "./index.js";

describe("grant-admin", () => {
  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    expect(server.registrations["grant-admin"]).toBeDefined();
  });

  it("registers the admin claims endpoints", async () => {
    const server = hapi.server();
    await server.register(grantAdmin);

    const routes = server.table().map(({ method, path }) => ({ method, path }));

    expect(routes).toEqual([
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
        path: "/grant-admin/grants/{code}/applications/{clientRef}/claims/entitlements",
      },
    ]);
  });
});
