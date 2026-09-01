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

const eventTextMaxLength = 256;
const issueReason = ({ path, reason }) =>
  `${path}:${reason}`.slice(0, eventTextMaxLength);
const versionReference = (agreementNumber, version) =>
  `${recordId(agreementNumber)}:${version}`;

const logVersion = ({ agreementNumber, version, issues }) => {
  const event = {
    action: "woodland-migration-dry-run-version",
    reference: versionReference(agreementNumber, version),
  };

  if (issues.length === 0) {
    logger.info(
      { event: { ...event, outcome: "success" } },
      "Woodland migration dry-run version passed validation",
    );
    return;
  }

  for (const issue of issues) {
    logger.info(
      {
        event: {
          ...event,
          outcome: "failure",
          reason: issueReason(issue),
        },
      },
      "Woodland migration dry-run version failed validation",
    );
  }
};

const logEmptyAgreement = (agreementNumber) => {
  logger.info(
    {
      event: {
        action: "woodland-migration-dry-run-agreement",
        reference: recordId(agreementNumber),
        outcome: "failure",
        reason: "versions:source.versions.empty",
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
      ...validateMappedWoodlandVersion(mapped, sourceVersion),
    ];
  } catch {
    return [{ path: "value", reason: "mapping.failed" }];
  }
};

const countReasons = (counts, issues) => {
  for (const { reason } of issues) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
};

const mergeReasonCounts = (target, source) => {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
};

const processPage = (agreementNumber, page, firstVersion) => {
  const result = { versions: page.versions.length, failures: 0, reasons: {} };

  page.versions.forEach((sourceVersion, index) => {
    const version = firstVersion + index;
    const issues = validateVersion({
      agreementNumber,
      page,
      sourceVersion,
      version,
    });
    result.failures += Number(issues.length > 0);
    countReasons(result.reasons, issues);
    logVersion({ agreementNumber, version, issues });
  });

  return result;
};

const processAgreement = async (agreementNumber) => {
  const result = { versions: 0, failures: 0, reasons: {} };

  for await (const page of fetchWoodlandAgreementVersionPages(
    agreementNumber,
  )) {
    const pageResult = processPage(agreementNumber, page, result.versions + 1);
    result.versions += pageResult.versions;
    result.failures += pageResult.failures;
    mergeReasonCounts(result.reasons, pageResult.reasons);
  }

  if (result.versions === 0) {
    result.failures = 1;
    result.reasons["source.versions.empty"] = 1;
    logEmptyAgreement(agreementNumber);
  }

  return result;
};

const logCompleted = (summary, reasons, aborted = false) => {
  const passed = Math.max(0, summary.versions - summary.failures);
  logger.info(
    {
      event: {
        action: "woodland-migration-dry-run-completed",
        outcome: summary.valid ? "success" : "failure",
        reason: `agreements=${summary.agreements} versions=${summary.versions} passed=${passed} failures=${summary.failures} aborted=${aborted} reasons=${JSON.stringify(reasons)}`,
      },
    },
    "Woodland migration dry-run completed",
  );
};

export const dryRunWoodlandMigration = async () => {
  const summary = {
    valid: false,
    agreements: 0,
    versions: 0,
    failures: 0,
  };
  const reasons = {};

  logger.info(
    { event: { action: "woodland-migration-dry-run-started" } },
    "Woodland migration dry-run started",
  );

  try {
    await loadAgreementDefinition({
      code: "woodland",
      configVersion: config.woodlandMigration.configVersion,
      resolution: "exact",
    });
    const agreementNumbers = await fetchWoodlandAgreementNumbers();
    summary.agreements = agreementNumbers.length;

    for (const agreementNumber of agreementNumbers) {
      const result = await processAgreement(agreementNumber);
      summary.versions += result.versions;
      summary.failures += result.failures;
      mergeReasonCounts(reasons, result.reasons);
    }

    summary.valid = summary.failures === 0;
    logCompleted(summary, reasons);
    return summary;
  } catch (error) {
    reasons["run.failed"] = 1;
    logCompleted(summary, reasons, true);
    throw error;
  }
};
