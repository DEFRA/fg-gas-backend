import { createHash } from "node:crypto";
import { config } from "../../../common/config.js";
import { logger } from "../../../common/logger.js";
import { loadAgreementDefinition } from "../../use-cases/load-agreement-definition.js";
import {
  mapLegacyWoodlandVersion,
  validateMappedWoodlandVersion,
} from "./map-legacy-woodland-version.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

const recordId = (agreementNumber) =>
  createHash("sha256").update(agreementNumber).digest("hex").slice(0, 16);

const sourceIssues = (agreementNumber, page) =>
  page.agreement.agreementNumber === agreementNumber &&
  page.grant.agreementNumber === agreementNumber
    ? []
    : [{ path: "agreementNumber", reason: "source.identity.mismatch" }];

const logVersion = ({ agreementNumber, version, issues }) => {
  logger.info(
    {
      event: { action: "woodland-migration-dry-run-version" },
      migration: {
        recordId: recordId(agreementNumber),
        version,
        valid: issues.length === 0,
        issues,
      },
    },
    "Woodland migration dry-run checked a version",
  );
};

const logEmptyAgreement = (agreementNumber) => {
  logger.info(
    {
      event: { action: "woodland-migration-dry-run-agreement" },
      migration: {
        recordId: recordId(agreementNumber),
        valid: false,
        issues: [{ path: "versions", reason: "source.versions.empty" }],
      },
    },
    "Woodland migration dry-run found no versions",
  );
};

// Paging keeps memory bounded; flattening the loops would require buffering.
// eslint-disable-next-line complexity
export const dryRunWoodlandMigration = async () => {
  await loadAgreementDefinition({
    code: "woodland",
    configVersion: config.woodlandMigration.configVersion,
    resolution: "exact",
  });
  const agreementNumbers = await fetchWoodlandAgreementNumbers();
  const summary = {
    valid: true,
    agreements: agreementNumbers.length,
    versions: 0,
    failures: 0,
  };

  for (const agreementNumber of agreementNumbers) {
    let agreementVersions = 0;

    for await (const page of fetchWoodlandAgreementVersionPages(
      agreementNumber,
    )) {
      for (const sourceVersion of page.versions) {
        summary.versions += 1;
        agreementVersions += 1;
        let issues;

        try {
          const mapped = mapLegacyWoodlandVersion({
            agreement: page.agreement,
            grant: page.grant,
            sourceVersion,
            version: agreementVersions,
            configVersion: config.woodlandMigration.configVersion,
          });
          issues = [
            ...sourceIssues(agreementNumber, page),
            ...validateMappedWoodlandVersion(mapped),
          ];
        } catch {
          issues = [{ path: "value", reason: "mapping.failed" }];
        }

        if (issues.length > 0) {
          summary.failures += 1;
        }
        logVersion({ agreementNumber, version: agreementVersions, issues });
      }
    }

    if (agreementVersions === 0) {
      summary.failures += 1;
      logEmptyAgreement(agreementNumber);
    }
  }

  summary.valid = summary.failures === 0;
  logger.info(
    {
      event: { action: "woodland-migration-dry-run-completed" },
      migration: summary,
    },
    "Woodland migration dry-run completed",
  );

  return summary;
};
