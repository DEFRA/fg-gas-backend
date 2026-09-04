import { config } from "../../common/config.js";
import { logger } from "../../common/logger.js";
import { loadAgreementDefinitionReadOnly } from "../use-cases/load-agreement-definition.js";
import {
  mapLegacyWoodlandVersion,
  validateMappedWoodlandVersion,
} from "./map-legacy-woodland-version.js";
import {
  createAgreementSourceChecksum,
  createLegacyEvidence,
  createMigrationSourceChecksum,
} from "./woodland-migration-checksum.js";
import {
  fetchWoodlandAgreementNumbers,
  fetchWoodlandAgreementVersionPages,
} from "./woodland-migration-source.js";

const identityIssue = (path) => ({
  path,
  reason: "source.identity.mismatch",
});

const sourceValueIssue = (path) => ({
  path,
  reason: "source.value.mismatch",
});

const hasConflictingValues = (values) => {
  const observed = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => value.toString());
  return new Set(observed).size > 1;
};

const identityFieldIssues = (page, sourceVersion) =>
  [
    [
      "clientRef",
      [page.agreement.clientRef, page.grant.clientRef, sourceVersion.clientRef],
    ],
    [
      "identifiers.sbi",
      [page.agreement.sbi, page.grant.sbi, sourceVersion.identifiers?.sbi],
    ],
    [
      "identifiers.frn",
      [page.agreement.frn, page.grant.frn, sourceVersion.identifiers?.frn],
    ],
  ].flatMap(([path, values]) =>
    hasConflictingValues(values) ? [identityIssue(path)] : [],
  );

const mappedFieldIssues = (page, sourceVersion) =>
  [
    ["code", [page.agreement.code, page.grant.code, sourceVersion.code]],
    ["schemeCode", [sourceVersion.scheme, sourceVersion.schemeCode]],
    ["name", [sourceVersion.agreementName, sourceVersion.name]],
  ].flatMap(([path, values]) =>
    hasConflictingValues(values) ? [sourceValueIssue(path)] : [],
  );

const sourceIssues = (agreementNumber, page, sourceVersion) => [
  ...(hasConflictingValues([
    agreementNumber,
    page.agreement.agreementNumber,
    page.grant.agreementNumber,
  ])
    ? [identityIssue("agreementNumber")]
    : []),
  ...identityFieldIssues(page, sourceVersion),
  ...mappedFieldIssues(page, sourceVersion),
];

const eventTextMaxLength = 256;
const issueReason = ({ path, reason }) =>
  `${path}:${reason}`.slice(0, eventTextMaxLength);
const versionReference = (agreementNumber, version) =>
  `${agreementNumber}:${version}`;
const migrationAction = (mode, subject) =>
  `woodland-migration-${mode}-${subject}`;

const logVersion = ({ agreementNumber, version, issues, mode }) => {
  const event = {
    action: migrationAction(mode, "version"),
    reference: versionReference(agreementNumber, version),
  };

  if (issues.length === 0) {
    logger.info(
      { event: { ...event, outcome: "success" } },
      "Woodland migration version passed validation",
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
      "Woodland migration version failed validation",
    );
  }
};

const logEmptyAgreement = (agreementNumber, mode) => {
  logger.info(
    {
      event: {
        action: migrationAction(mode, "agreement"),
        reference: agreementNumber,
        outcome: "failure",
        reason: "versions:source.versions.empty",
      },
    },
    "Woodland migration found no versions",
  );
};

const validateVersion = ({ agreementNumber, page, sourceVersion, version }) => {
  try {
    const agreementVersion = mapLegacyWoodlandVersion({
      agreement: page.agreement,
      grant: page.grant,
      sourceVersion,
      version,
      configVersion: config.woodlandMigration.configVersion,
    });
    return {
      agreementVersion,
      issues: [
        ...sourceIssues(agreementNumber, page, sourceVersion),
        ...validateMappedWoodlandVersion(agreementVersion, sourceVersion),
      ],
    };
  } catch {
    return {
      agreementVersion: null,
      issues: [{ path: "value", reason: "mapping.failed" }],
    };
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

// eslint-disable-next-line complexity
const legacyEnvelope = (page, sourceVersion, index) => ({
  agreement: page.legacySource?.agreement ?? page.agreement,
  grant: page.legacySource?.grant ?? page.grant,
  version: page.legacySource?.versions?.[index] ?? sourceVersion,
});

const processPage = ({
  agreementNumber,
  page,
  firstVersion,
  mode,
  retainVersions,
}) => {
  const result = {
    versions: page.versions.length,
    failures: 0,
    reasons: {},
    preparedVersions: [],
    versionChecksums: [],
  };

  page.versions.forEach((sourceVersion, index) => {
    const version = firstVersion + index;
    const evidence = createLegacyEvidence(
      legacyEnvelope(page, sourceVersion, index),
    );
    const { agreementVersion, issues } = validateVersion({
      agreementNumber,
      page,
      sourceVersion,
      version,
    });
    result.failures += Number(issues.length > 0);
    result.versionChecksums.push(evidence.checksum);
    countReasons(result.reasons, issues);
    logVersion({ agreementNumber, version, issues, mode });

    if (retainVersions && agreementVersion) {
      result.preparedVersions.push({ agreementVersion, evidence });
    }
  });

  return result;
};

const processAgreement = async ({ agreementNumber, mode, retainVersions }) => {
  const result = {
    versions: 0,
    failures: 0,
    reasons: {},
    preparedVersions: [],
    versionChecksums: [],
  };

  for await (const page of fetchWoodlandAgreementVersionPages(
    agreementNumber,
  )) {
    const pageResult = processPage({
      agreementNumber,
      page,
      firstVersion: result.versions + 1,
      mode,
      retainVersions,
    });
    result.versions += pageResult.versions;
    result.failures += pageResult.failures;
    result.preparedVersions.push(...pageResult.preparedVersions);
    result.versionChecksums.push(...pageResult.versionChecksums);
    mergeReasonCounts(result.reasons, pageResult.reasons);
  }

  if (result.versions === 0) {
    result.failures = 1;
    result.reasons["source.versions.empty"] = 1;
    logEmptyAgreement(agreementNumber, mode);
  }

  result.sourceChecksum = createAgreementSourceChecksum({
    agreementNumber,
    configVersion: config.woodlandMigration.configVersion,
    versionChecksums: result.versionChecksums,
  });
  return result;
};

const logCompleted = (summary, reasons, mode, aborted = false) => {
  const passed = Math.max(0, summary.versions - summary.failures);
  logger.info(
    {
      event: {
        action: migrationAction(mode, "completed"),
        outcome: summary.valid ? "success" : "failure",
        reason: `agreements=${summary.agreements} versions=${summary.versions} passed=${passed} failures=${summary.failures} aborted=${aborted} checksum=${summary.sourceChecksum ?? "unavailable"} reasons=${JSON.stringify(reasons)}`,
      },
    },
    "Woodland migration validation completed",
  );
};

/* eslint-disable complexity */
export const prepareWoodlandMigration = async ({
  mode = "dry-run",
  retainVersions = false,
} = {}) => {
  const summary = {
    valid: false,
    agreements: 0,
    versions: 0,
    failures: 0,
    sourceChecksum: null,
  };
  const reasons = {};
  const preparedAgreements = [];
  const agreementChecksums = [];

  logger.info(
    { event: { action: migrationAction(mode, "started") } },
    "Woodland migration validation started",
  );

  try {
    await loadAgreementDefinitionReadOnly({
      code: "woodland",
      configVersion: config.woodlandMigration.configVersion,
      resolution: "exact",
    });
    const agreementNumbers = await fetchWoodlandAgreementNumbers();
    summary.agreements = agreementNumbers.length;

    for (const agreementNumber of agreementNumbers) {
      const result = await processAgreement({
        agreementNumber,
        mode,
        retainVersions,
      });
      summary.versions += result.versions;
      summary.failures += result.failures;
      agreementChecksums.push(result.sourceChecksum);
      mergeReasonCounts(reasons, result.reasons);

      if (retainVersions) {
        preparedAgreements.push({
          agreementNumber,
          sourceChecksum: result.sourceChecksum,
          versions: result.preparedVersions,
        });
      }
    }

    summary.sourceChecksum = createMigrationSourceChecksum({
      configVersion: config.woodlandMigration.configVersion,
      agreementChecksums,
    });
    summary.valid = summary.failures === 0;
    logCompleted(summary, reasons, mode);
    return {
      summary,
      reasons,
      preparedAgreements,
    };
  } catch (error) {
    reasons["run.failed"] = 1;
    logCompleted(summary, reasons, mode, true);
    throw error;
  }
};
/* eslint-enable complexity */

export const dryRunWoodlandMigration = async () => {
  const { summary } = await prepareWoodlandMigration();
  return summary;
};
