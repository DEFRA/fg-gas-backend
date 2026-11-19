import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readShell } from "../services/shell-cache.js";
import { viewShellRoute } from "./view-shell.route.js";

vi.mock("../../common/logger.js");
vi.mock("../services/shell-cache.js");

const SHELL = {
  catalogue: { buckets: [], sourceErrors: [{ hop: "CW-BE" }] },
};

describe("GET /grant-admin/shell", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(viewShellRoute);
    await server.initialize();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("answers the catalogue as every tagged answer carries it", async () => {
    readShell.mockResolvedValue(SHELL);

    const response = await server.inject("/grant-admin/shell");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.result).toEqual({ shell: SHELL });
  });

  it("answers a null shell when the catalogue cannot be built", async () => {
    readShell.mockResolvedValue(null);

    const response = await server.inject("/grant-admin/shell");

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({ shell: null });
  });
});
