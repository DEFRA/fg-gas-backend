import { createHash } from "node:crypto";
import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { loadAgreementDefinition } from "../use-cases/load-agreement-definition.js";
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

const validateVersion = ({ agreementNumber, page, sourceVersion, version }) => {
  try {
    const mapped = mapLegacyWoodlandVersion({
      agreement: page.agreement,
      grant: page.grant,
      sourceVersion,
      version,
      configVersion: config.woodlandMigration.configVersion,
    });
    return [
      ...sourceIssues(agreementNumber, page),
      ...validateMappedWoodlandVersion(mapped),
    ];
  } catch {
    return [{ path: "value", reason: "mapping.failed" }];
  }
};

const processPage = (agreementNumber, page, firstVersion) => {
  let failures = 0;

  page.versions.forEach((sourceVersion, index) => {
    const version = firstVersion + index;
    const issues = validateVersion({
      agreementNumber,
      page,
      sourceVersion,
      version,
    });
    failures += Number(issues.length > 0);
    logVersion({ agreementNumber, version, issues });
  });

  return { versions: page.versions.length, failures };
};

const processAgreement = async (agreementNumber) => {
  const result = { versions: 0, failures: 0 };

  for await (const page of fetchWoodlandAgreementVersionPages(
    agreementNumber,
  )) {
    const pageResult = processPage(agreementNumber, page, result.versions + 1);
    result.versions += pageResult.versions;
    result.failures += pageResult.failures;
  }

  if (result.versions === 0) {
    result.failures = 1;
    logEmptyAgreement(agreementNumber);
  }

  return result;
};

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
    const result = await processAgreement(agreementNumber);
    summary.versions += result.versions;
    summary.failures += result.failures;
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
