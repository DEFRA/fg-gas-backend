import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { prepareWoodlandMigration } from "./dry-run-woodland-migration.js";
import { catchUpWoodlandAgreement } from "./woodland-migration.repository.js";

// eslint-disable-next-line complexity
export const catchUpWoodlandMigration = async () => {
  logger.info(
    { event: { action: "woodland-migration-catch-up-started" } },
    "Woodland migration catch-up started",
  );

  const { summary, preparedAgreements } = await prepareWoodlandMigration({
    mode: "catch-up-validation",
    retainVersions: true,
  });
  if (!summary.valid) {
    logger.info(
      {
        event: {
          action: "woodland-migration-catch-up-completed",
          outcome: "failure",
        },
      },
      "Woodland migration catch-up rejected an invalid source",
    );
    throw Boom.conflict("Woodland migration source validation failed");
  }

  const counts = { inserted: 0, updated: 0, preserved: 0, failed: 0 };
  const failures = [];
  for (const prepared of preparedAgreements) {
    let outcome = "failed";
    let reason = "write.error";
    try {
      ({ outcome, reason } = await catchUpWoodlandAgreement(prepared));
    } catch {
      // The repository primitive should not throw. Keep later agreements isolated
      // if an unexpected failure escapes it.
    }
    counts[outcome] += 1;
    if (outcome === "failed") {
      failures.push({ agreementNumber: prepared.agreementNumber, reason });
    }
  }

  const result = {
    valid: true,
    agreements: summary.agreements,
    offeredAgreements: summary.offeredAgreements,
    acceptedAgreements: summary.acceptedAgreements,
    versions: summary.versions,
    ...counts,
    failures,
    sourceChecksum: summary.sourceChecksum,
  };
  logger.info(
    {
      event: {
        action: "woodland-migration-catch-up-completed",
        outcome: counts.failed === 0 ? "success" : "failure",
        reason: `agreements=${result.agreements} inserted=${counts.inserted} updated=${counts.updated} preserved=${counts.preserved} failed=${counts.failed} checksum=${result.sourceChecksum}`,
      },
    },
    "Woodland migration catch-up completed",
  );
  return result;
};
