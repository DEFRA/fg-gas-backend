import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { applyWoodlandMigration } from "./apply-woodland-migration.js";
import { prepareWoodlandMigration } from "./dry-run-woodland-migration.js";
import {
  inspectWoodlandMigrationTargets,
  reconcileWoodlandMigration,
  writeWoodlandMigration,
} from "./woodland-migration.repository.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../common/logger.js");
vi.mock("./dry-run-woodland-migration.js");
vi.mock("./woodland-migration.repository.js");

const sourceChecksum = `sha256:${"a".repeat(64)}`;
const summary = {
  valid: true,
  agreements: 2,
  versions: 3,
  failures: 0,
  sourceChecksum,
};
const preparedAgreements = [
  { agreementNumber: "WMP0001" },
  { agreementNumber: "WMP0002" },
];
const approval = {
  confirmation: "APPLY_WOODLAND_MIGRATION",
  expectedAgreements: 2,
  expectedVersions: 3,
  sourceChecksum,
};
const decisions = {
  insert: [preparedAgreements[0]],
  replace: [],
  skip: [preparedAgreements[1]],
};
const session = { id: "session" };

beforeEach(() => {
  vi.resetAllMocks();
  prepareWoodlandMigration.mockResolvedValue({ summary, preparedAgreements });
  inspectWoodlandMigrationTargets.mockResolvedValue(decisions);
  reconcileWoodlandMigration.mockResolvedValue(undefined);
  withTransaction.mockImplementation((callback) => callback(session));
});

describe("applyWoodlandMigration", () => {
  it("validates, writes in one transaction, and reconciles after commit", async () => {
    await expect(applyWoodlandMigration(approval)).resolves.toEqual({
      valid: true,
      agreements: 2,
      versions: 3,
      inserted: 1,
      replaced: 0,
      skipped: 1,
      sourceChecksum,
    });

    expect(prepareWoodlandMigration).toHaveBeenCalledWith({
      mode: "apply-validation",
      retainVersions: true,
    });
    expect(inspectWoodlandMigrationTargets).toHaveBeenNthCalledWith(
      1,
      preparedAgreements,
    );
    expect(inspectWoodlandMigrationTargets).toHaveBeenNthCalledWith(
      2,
      preparedAgreements,
      session,
    );
    expect(writeWoodlandMigration).toHaveBeenCalledWith(decisions, session);
    expect(reconcileWoodlandMigration).toHaveBeenNthCalledWith(
      1,
      preparedAgreements,
      session,
    );
    expect(reconcileWoodlandMigration).toHaveBeenNthCalledWith(
      2,
      preparedAgreements,
    );
  });

  it.each([
    [
      "invalid confirmation",
      summary,
      { ...approval, confirmation: "not-approved" },
    ],
    ["validation failure", { ...summary, valid: false }, approval],
    ["agreement count change", summary, { ...approval, expectedAgreements: 1 }],
    ["version count change", summary, { ...approval, expectedVersions: 2 }],
    [
      "source checksum change",
      summary,
      { ...approval, sourceChecksum: `sha256:${"b".repeat(64)}` },
    ],
  ])("writes nothing on %s", async (_scenario, preparedSummary, request) => {
    prepareWoodlandMigration.mockResolvedValue({
      summary: preparedSummary,
      preparedAgreements,
    });

    await expect(applyWoodlandMigration(request)).rejects.toMatchObject({
      output: { statusCode: 409 },
    });

    expect(inspectWoodlandMigrationTargets).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeWoodlandMigration).not.toHaveBeenCalled();
  });

  it("fails before the transaction when target data conflicts", async () => {
    inspectWoodlandMigrationTargets.mockRejectedValueOnce(
      new Error("target conflict"),
    );

    await expect(applyWoodlandMigration(approval)).rejects.toThrow(
      "target conflict",
    );

    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeWoodlandMigration).not.toHaveBeenCalled();
  });

  it("propagates a transactional write failure without reconciling", async () => {
    writeWoodlandMigration.mockRejectedValue(new Error("write failed"));

    await expect(applyWoodlandMigration(approval)).rejects.toThrow(
      "write failed",
    );

    expect(reconcileWoodlandMigration).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: {
          action: "woodland-migration-apply-completed",
          outcome: "failure",
        },
      },
      "Woodland migration apply failed",
    );
  });

  it("reports a failed response when post-commit reconciliation fails", async () => {
    reconcileWoodlandMigration
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("reconciliation failed"));

    await expect(applyWoodlandMigration(approval)).rejects.toThrow(
      "reconciliation failed",
    );

    expect(writeWoodlandMigration).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: {
          action: "woodland-migration-apply-completed",
          outcome: "failure",
        },
      },
      "Woodland migration apply failed",
    );
  });
});
