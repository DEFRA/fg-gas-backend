import hapi from "@hapi/hapi";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dryRunWoodlandMigration } from "./dry-run-woodland-migration.js";
import { dryRunWoodlandMigrationRoute } from "./dry-run-woodland-migration.route.js";

vi.mock("./dry-run-woodland-migration.js");

describe("dryRunWoodlandMigrationRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.route(dryRunWoodlandMigrationRoute);
    await server.initialize();
  });

  afterAll(() => server.stop());

  it("returns the dry-run summary", async () => {
    const summary = {
      valid: true,
      agreements: 50,
      versions: 5274,
      failures: 0,
      sourceChecksum:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    dryRunWoodlandMigration.mockResolvedValue(summary);

    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/dry-run",
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(summary);
  });
});
