import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { loadAgreementDefinition } from "../use-cases/load-agreement-definition.js";
import { dryRunWoodlandMigration } from "./dry-run-woodland-migration.js";
import {
  mapLegacyWoodlandVersion,
  validateMappedWoodlandVersion,
} from "./map-legacy-woodland-version.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

vi.mock("../../common/logger.js");
vi.mock("../use-cases/load-agreement-definition.js");
vi.mock("./map-legacy-woodland-version.js");
vi.mock("./woodland-migration-source.js");

beforeEach(() => {
  vi.resetAllMocks();
  config.woodlandMigration.configVersion = "1.0.0";
  fetchWoodlandAgreementNumbers.mockResolvedValue(["WMP0001", "WMP0002"]);
  fetchWoodlandAgreementVersionPages.mockImplementation((agreementNumber) =>
    (async function* () {
      if (agreementNumber === "WMP0001") {
        yield {
          agreement: { agreementNumber },
          grant: { agreementNumber },
          versions: [{ valid: true }, { valid: false }],
          nextOffset: 2,
        };
        yield {
          agreement: { agreementNumber },
          grant: { agreementNumber },
          versions: [{ valid: true }],
          nextOffset: null,
        };
      } else {
        yield {
          agreement: { agreementNumber },
          grant: { agreementNumber },
          versions: [],
          nextOffset: null,
        };
      }
    })(),
  );
  mapLegacyWoodlandVersion.mockImplementation(
    ({ sourceVersion }) => sourceVersion,
  );
  validateMappedWoodlandVersion.mockImplementation(({ valid }) =>
    valid ? [] : [{ path: "items", reason: "items.invalid" }],
  );
});

describe("dryRunWoodlandMigration", () => {
  it("processes every page, writes nothing, and returns a small summary", async () => {
    await expect(dryRunWoodlandMigration()).resolves.toEqual({
      valid: false,
      agreements: 2,
      versions: 3,
      failures: 2,
    });
    expect(loadAgreementDefinition).toHaveBeenCalledWith({
      code: "woodland",
      configVersion: "1.0.0",
      resolution: "exact",
    });
    expect(mapLegacyWoodlandVersion).toHaveBeenCalledTimes(3);
    expect(mapLegacyWoodlandVersion).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ version: 3, configVersion: "1.0.0" }),
    );
    expect(fetchWoodlandAgreementVersionPages).toHaveBeenCalledTimes(2);
  });

  it("counts source identity and mapping failures", async () => {
    fetchWoodlandAgreementNumbers.mockResolvedValue(["WMP0001"]);
    fetchWoodlandAgreementVersionPages.mockImplementation(() =>
      (async function* () {
        yield {
          agreement: { agreementNumber: "WMP0001" },
          grant: { agreementNumber: "WMP9999" },
          versions: [{ valid: true }, { valid: true }],
          nextOffset: null,
        };
      })(),
    );
    mapLegacyWoodlandVersion
      .mockImplementationOnce(() => {
        throw new Error("sensitive mapping value");
      })
      .mockImplementation(({ sourceVersion }) => sourceVersion);

    await expect(dryRunWoodlandMigration()).resolves.toEqual({
      valid: false,
      agreements: 1,
      versions: 2,
      failures: 2,
    });
  });

  it("rejects conflicting identities across Agreement, Grant, and Version", async () => {
    fetchWoodlandAgreementNumbers.mockResolvedValue(["WMP0001"]);
    fetchWoodlandAgreementVersionPages.mockImplementation(() =>
      (async function* () {
        yield {
          agreement: {
            agreementNumber: "WMP0001",
            clientRef: "agreement-client",
            sbi: "111111111",
            frn: "1111111111",
          },
          grant: {
            agreementNumber: "WMP0001",
            clientRef: "grant-client",
            sbi: "222222222",
            frn: "2222222222",
          },
          versions: [
            {
              valid: true,
              clientRef: "version-client",
              identifiers: { sbi: "333333333", frn: "3333333333" },
            },
          ],
          nextOffset: null,
        };
      })(),
    );

    await expect(dryRunWoodlandMigration()).resolves.toEqual({
      valid: false,
      agreements: 1,
      versions: 1,
      failures: 1,
    });
    expect(logger.info.mock.calls.map(([context]) => context)).toEqual(
      expect.arrayContaining([
        {
          event: expect.objectContaining({
            outcome: "failure",
            reason: "clientRef:source.identity.mismatch",
          }),
        },
        {
          event: expect.objectContaining({
            outcome: "failure",
            reason: "identifiers.sbi:source.identity.mismatch",
          }),
        },
        {
          event: expect.objectContaining({
            outcome: "failure",
            reason: "identifiers.frn:source.identity.mismatch",
          }),
        },
      ]),
    );
  });

  it("logs diagnostics in CDP-indexed ECS fields with agreement references", async () => {
    await dryRunWoodlandMigration();

    const contexts = logger.info.mock.calls.map(([context]) => context);
    expect(contexts.every((context) => context.event)).toBe(true);
    expect(contexts.some((context) => context.migration)).toBe(false);
    expect(contexts).toEqual(
      expect.arrayContaining([
        {
          event: expect.objectContaining({
            action: "woodland-migration-dry-run-version",
            reference: "WMP0001:3",
            outcome: "success",
          }),
        },
        {
          event: expect.objectContaining({
            action: "woodland-migration-dry-run-agreement",
            reference: "WMP0002",
            outcome: "failure",
          }),
        },
        {
          event: { action: "woodland-migration-dry-run-started" },
        },
        {
          event: {
            action: "woodland-migration-dry-run-completed",
            outcome: "failure",
            reason:
              'agreements=2 versions=3 passed=1 failures=2 aborted=false reasons={"items.invalid":1,"source.versions.empty":1}',
          },
        },
      ]),
    );
  });

  it("does not report negative passed versions for an empty agreement", async () => {
    fetchWoodlandAgreementNumbers.mockResolvedValue(["WMP0002"]);

    await dryRunWoodlandMigration();

    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: {
          action: "woodland-migration-dry-run-completed",
          outcome: "failure",
          reason:
            'agreements=1 versions=0 passed=0 failures=1 aborted=false reasons={"source.versions.empty":1}',
        },
      },
      "Woodland migration dry-run completed",
    );
  });

  it("logs a final failure when the run aborts", async () => {
    fetchWoodlandAgreementNumbers.mockRejectedValue(new Error("source failed"));

    await expect(dryRunWoodlandMigration()).rejects.toThrow("source failed");

    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: {
          action: "woodland-migration-dry-run-completed",
          outcome: "failure",
          reason:
            'agreements=0 versions=0 passed=0 failures=0 aborted=true reasons={"run.failed":1}',
        },
      },
      "Woodland migration dry-run completed",
    );
  });
});
