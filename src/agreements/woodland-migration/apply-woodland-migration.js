import Boom from "@hapi/boom";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { prepareWoodlandMigration } from "./dry-run-woodland-migration.js";
import {
  inspectWoodlandMigrationTargets,
  reconcileWoodlandMigration,
  writeWoodlandMigration,
} from "./woodland-migration.repository.js";

const preconditionFailed = (message) => Boom.conflict(message);

// eslint-disable-next-line complexity
const requireApprovedSource = (summary, approval) => {
  if (approval.confirmation !== "APPLY_WOODLAND_MIGRATION") {
    throw preconditionFailed("Woodland migration confirmation is invalid");
  }
  if (!summary.valid) {
    throw preconditionFailed("Woodland migration validation failed");
  }
  if (
    summary.agreements !== approval.expectedAgreements ||
    summary.versions !== approval.expectedVersions
  ) {
    throw preconditionFailed("Woodland migration source counts changed");
  }
  if (summary.sourceChecksum !== approval.sourceChecksum) {
    throw preconditionFailed("Woodland migration source checksum changed");
  }
};

const resultFrom = (summary, decisions) => ({
  valid: true,
  agreements: summary.agreements,
  versions: summary.versions,
  inserted: decisions.insert.length,
  replaced: decisions.replace.length,
  skipped: decisions.skip.length,
  sourceChecksum: summary.sourceChecksum,
});

export const applyWoodlandMigration = async (approval) => {
  logger.info(
    { event: { action: "woodland-migration-apply-started" } },
    "Woodland migration apply started",
  );

  try {
    const { summary, preparedAgreements } = await prepareWoodlandMigration({
      mode: "apply-validation",
      retainVersions: true,
    });
    requireApprovedSource(summary, approval);

    // Fail before opening a transaction when the currently visible target is
    // already in conflict. The same inspection runs again inside the
    // transaction to close the race between this check and the first write.
    await inspectWoodlandMigrationTargets(preparedAgreements);

    const decisions = await withTransaction(async (session) => {
      const currentDecisions = await inspectWoodlandMigrationTargets(
        preparedAgreements,
        session,
      );
      await writeWoodlandMigration(currentDecisions, session);
      await reconcileWoodlandMigration(preparedAgreements, session);
      return currentDecisions;
    });

    // A successful commit is followed by a primary read so a lost or partial
    // response cannot be mistaken for reconciliation evidence.
    await reconcileWoodlandMigration(preparedAgreements);
    const result = resultFrom(summary, decisions);
    logger.info(
      {
        event: {
          action: "woodland-migration-apply-completed",
          outcome: "success",
          reason: `agreements=${result.agreements} versions=${result.versions} inserted=${result.inserted} replaced=${result.replaced} skipped=${result.skipped} checksum=${result.sourceChecksum}`,
        },
      },
      "Woodland migration apply completed",
    );
    return result;
  } catch (error) {
    logger.info(
      {
        event: {
          action: "woodland-migration-apply-completed",
          outcome: "failure",
        },
      },
      "Woodland migration apply failed",
    );
    throw error;
  }
};
