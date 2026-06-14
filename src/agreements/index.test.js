import hapi from "@hapi/hapi";
import { beforeEach, describe, expect, it } from "vitest";
import { agreements } from "./index.js";

describe("agreements", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
  });

  it("registers Agreement routes", async () => {
    await server.register(agreements);
    await server.initialize();

    const routePaths = server.table().map((route) => ({
      method: route.method,
      path: route.path,
    }));

    expect(routePaths).toEqual([
      {
        method: "post",
        path: "/agreements/{agreementNumber}/actions/{name}",
      },
    ]);
  });
});
