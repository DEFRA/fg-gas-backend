import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../common/config.js";
import { logger } from "../../../common/logger.js";
import { loadAgreementDefinition } from "../../use-cases/load-agreement-definition.js";
import { dryRunWoodlandMigration } from "./dry-run-woodland-migration.js";
import {
  mapLegacyWoodlandVersion,
  validateMappedWoodlandVersion,
} from "./map-legacy-woodland-version.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

vi.mock("../../../common/logger.js");
vi.mock("../../use-cases/load-agreement-definition.js");
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

  it("logs only hashed record IDs and version ordinals", async () => {
    await dryRunWoodlandMigration();

    const logs = JSON.stringify(logger.info.mock.calls);
    expect(logs).not.toContain("WMP0001");
    expect(logs).not.toContain("WMP0002");
    expect(logs).toContain("woodland-migration-dry-run-completed");
    expect(logs).toContain('"version":3');
  });
});
