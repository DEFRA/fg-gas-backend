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
import { logger } from "../../common/logger.js";
import { catchUpWoodlandMigration } from "./catch-up-woodland-migration.js";
import { catchUpWoodlandMigrationRoute } from "./catch-up-woodland-migration.route.js";
import { prepareWoodlandMigration } from "./dry-run-woodland-migration.js";
import { catchUpWoodlandAgreement } from "./woodland-migration.repository.js";

vi.mock("../../common/logger.js");
vi.mock("./dry-run-woodland-migration.js");
vi.mock("./woodland-migration.repository.js");

const sourceChecksum = `sha256:${"a".repeat(64)}`;
const summary = {
  valid: true,
  agreements: 4,
  offeredAgreements: 1,
  acceptedAgreements: 3,
  versions: 7,
  sourceChecksum,
};
const preparedAgreements = ["WMP0001", "WMP0002", "WMP0003", "WMP0004"].map(
  (agreementNumber) => ({ agreementNumber }),
);

beforeEach(() => {
  vi.resetAllMocks();
  prepareWoodlandMigration.mockResolvedValue({ summary, preparedAgreements });
});

describe("catchUpWoodlandMigration", () => {
  it("rejects an invalid source before any writes", async () => {
    prepareWoodlandMigration.mockResolvedValue({
      summary: { ...summary, valid: false },
      preparedAgreements,
    });

    await expect(catchUpWoodlandMigration()).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(catchUpWoodlandAgreement).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: {
          action: "woodland-migration-catch-up-completed",
          outcome: "failure",
        },
      },
      "Woodland migration catch-up rejected an invalid source",
    );
  });

  it("tallies per-agreement outcomes and safe failure reasons", async () => {
    catchUpWoodlandAgreement
      .mockResolvedValueOnce({ outcome: "inserted" })
      .mockResolvedValueOnce({ outcome: "updated" })
      .mockResolvedValueOnce({ outcome: "preserved" })
      .mockResolvedValueOnce({
        outcome: "failed",
        reason: "identity.mismatch",
      });

    await expect(catchUpWoodlandMigration()).resolves.toEqual({
      valid: true,
      agreements: 4,
      offeredAgreements: 1,
      acceptedAgreements: 3,
      versions: 7,
      inserted: 1,
      updated: 1,
      preserved: 1,
      failed: 1,
      failures: [{ agreementNumber: "WMP0004", reason: "identity.mismatch" }],
      sourceChecksum,
    });
    expect(prepareWoodlandMigration).toHaveBeenCalledWith({
      mode: "catch-up-validation",
      retainVersions: true,
    });
  });

  it("contains an escaped repository rejection and continues", async () => {
    catchUpWoodlandAgreement
      .mockResolvedValueOnce({ outcome: "inserted" })
      .mockRejectedValueOnce(new Error("unexpected"))
      .mockResolvedValueOnce({ outcome: "preserved" })
      .mockResolvedValueOnce({ outcome: "updated" });

    const result = await catchUpWoodlandMigration();

    expect(result).toMatchObject({
      inserted: 1,
      updated: 1,
      preserved: 1,
      failed: 1,
    });
    expect(result.failures).toEqual([
      { agreementNumber: "WMP0002", reason: "write.error" },
    ]);
    expect(catchUpWoodlandAgreement).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["success", { outcome: "preserved" }, 0],
    ["failure", { outcome: "failed", reason: "write.conflict" }, 4],
  ])(
    "logs a %s completion with counts only",
    async (outcome, agreementOutcome, failed) => {
      catchUpWoodlandAgreement.mockResolvedValue(agreementOutcome);

      await catchUpWoodlandMigration();

      expect(logger.info).toHaveBeenLastCalledWith(
        {
          event: {
            action: "woodland-migration-catch-up-completed",
            outcome,
            reason: `agreements=4 inserted=0 updated=0 preserved=${4 - failed} failed=${failed} checksum=${sourceChecksum}`,
          },
        },
        "Woodland migration catch-up completed",
      );
    },
  );
});

describe("catchUpWoodlandMigrationRoute", () => {
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
    server.route(catchUpWoodlandMigrationRoute);
    await server.initialize();
  });

  afterAll(() => server.stop());

  it.each([
    ["without a content-length header", {}],
    ["with content-length zero", { "content-length": "0" }],
  ])(
    "accepts a bodyless request %s from an authenticated service",
    async (_description, bodyHeaders) => {
      catchUpWoodlandAgreement.mockResolvedValue({ outcome: "preserved" });

      const response = await server.inject({
        method: "POST",
        url: "/admin/migrations/woodland/catch-up",
        headers: {
          ...bodyHeaders,
          "x-test-service": "fg-grants-platform-admin",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual({
        valid: true,
        agreements: 4,
        offeredAgreements: 1,
        acceptedAgreements: 3,
        versions: 7,
        inserted: 0,
        updated: 0,
        preserved: 4,
        failed: 0,
        failures: [],
        sourceChecksum,
      });
      expect(prepareWoodlandMigration).toHaveBeenCalledOnce();
    },
  );

  it("rejects explicit JSON null before catch-up runs", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/catch-up",
      headers: {
        "content-type": "application/json",
        "x-test-service": "woodland-migration-operator",
      },
      payload: "null",
    });

    expect(response.statusCode).toBe(400);
    expect(prepareWoodlandMigration).not.toHaveBeenCalled();
  });

  it("rejects an operator object payload before catch-up runs", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/catch-up",
      headers: { "x-test-service": "woodland-migration-operator" },
      payload: { confirmation: "CATCH_UP_WOODLAND_MIGRATION" },
    });

    expect(response.statusCode).toBe(400);
    expect(prepareWoodlandMigration).not.toHaveBeenCalled();
  });

  it("returns 409 when whole-source validation fails", async () => {
    prepareWoodlandMigration.mockResolvedValue({
      summary: { ...summary, valid: false },
      preparedAgreements,
    });

    const response = await server.inject({
      method: "POST",
      url: "/admin/migrations/woodland/catch-up",
      headers: { "x-test-service": "woodland-migration-operator" },
    });

    expect(response.statusCode).toBe(409);
    expect(catchUpWoodlandAgreement).not.toHaveBeenCalled();
  });
});
