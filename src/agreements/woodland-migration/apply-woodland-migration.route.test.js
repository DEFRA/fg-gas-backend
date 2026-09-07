import hapi from "@hapi/hapi";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { applyWoodlandMigration } from "./apply-woodland-migration.js";
import { applyWoodlandMigrationRoute } from "./apply-woodland-migration.route.js";

vi.mock("./apply-woodland-migration.js");

const checksum =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const approval = {
  confirmation: "APPLY_WOODLAND_MIGRATION",
  expectedAgreements: 70,
  expectedVersions: 70,
  sourceChecksum: checksum,
};

describe("applyWoodlandMigrationRoute", () => {
  let server;

  beforeAll(async () => {
    server = hapi.server();
    server.auth.scheme("test", () => ({
      authenticate: (request, h) =>
        h.authenticated({
          credentials: {
            service: request.headers["x-test-service"] ?? "other-service",
          },
        }),
    }));
    server.auth.strategy("test", "test");
    server.auth.default("test");
    server.route(applyWoodlandMigrationRoute);
    await server.initialize();
  });

  afterAll(() => server.stop());
  beforeEach(() => vi.clearAllMocks());

  it("applies the approved source for the dedicated operator", async () => {
    const result = {
      valid: true,
      agreements: 70,
      versions: 70,
      inserted: 70,
      replaced: 0,
      skipped: 0,
      sourceChecksum: checksum,
    };
    applyWoodlandMigration.mockResolvedValue(result);

    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/apply",
      headers: { "x-test-service": "woodland-migration-operator" },
      payload: approval,
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual(result);
    expect(applyWoodlandMigration).toHaveBeenCalledWith(approval);
  });

  it("rejects other authenticated services", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/apply",
      headers: { "x-test-service": "another-service" },
      payload: approval,
    });

    expect(response.statusCode).toBe(403);
    expect(applyWoodlandMigration).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...approval, confirmation: "yes" }],
    [{ ...approval, expectedAgreements: 0 }],
    [{ ...approval, expectedVersions: 0 }],
    [{ ...approval, sourceChecksum: "not-a-checksum" }],
  ])("rejects an invalid approval payload", async (payload) => {
    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/apply",
      headers: { "x-test-service": "woodland-migration-operator" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(applyWoodlandMigration).not.toHaveBeenCalled();
  });
});
