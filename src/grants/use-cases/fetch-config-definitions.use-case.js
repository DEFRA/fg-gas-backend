import Boom from "@hapi/boom";
import { findConfigDefinition } from "../../common/config-broker/config-catalog.repository.js";
import { storeDefinition } from "../../common/config-broker/definition-stores.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { save } from "../repositories/grant.repository.js";
import {
  configVersionNotFound,
  GRANT_VERSION_NOT_FOUND,
} from "../services/config-version-not-found.js";
import { isDefinitionDefect } from "../services/definition-defect.js";
import { loadConfigVersionFiles } from "./load-config-version-files.js";
import { checkGrantDefinition } from "./validate-config-definitions.js";

const HTTP_CONFLICT = 409;
const MESSAGE_MAX = 500;

class NoLocation extends Error {}

const s3Reasons = {
  NoSuchKey: "missing",
  AccessDenied: "forbidden",
  PARSE_ERROR: "unparseable",
};

const s3ReasonOf = (error) => s3Reasons[error.code] ?? "timeout";

// Null when the failure is no outcome of the file but of GAS itself.
const reasonOf = (error) => {
  if (error instanceof NoLocation) {
    return "missing";
  }

  if (error instanceof S3FetchError) {
    return s3ReasonOf(error);
  }

  return isDefinitionDefect(error) ? "invalid" : null;
};

const failed = (file, reason, error) => ({
  file,
  outcome: "failed",
  reason,
  message: reason === "invalid" ? error.message.slice(0, MESSAGE_MAX) : null,
});

const assertForGrant = (grant, grantCode) => {
  if (grant.code !== grantCode) {
    throw Boom.badImplementation(
      `Definition is for "${grant.code}", not "${grantCode}"`,
    );
  }
};

// Grants' own file is held to its arrival check, and must be the version's own grant:
// an aliased release's definition would be stored under a code the version page never reads.
const storeGrant = async ({ grantCode, version, definition }) => {
  const grant = checkGrantDefinition(definition, version);
  assertForGrant(grant, grantCode);

  try {
    await save(grant);
  } catch (error) {
    if (!(error.isBoom && error.output.statusCode === HTTP_CONFLICT)) {
      throw error;
    }
  }
};

const stores = {
  grant: storeGrant,
  agreement: (file) => storeDefinition("agreement", file),
  payment: (file) => storeDefinition("payment", file),
};

const fetchFile = async ({ grantCode, version, file }) => {
  const location = await findConfigDefinition({
    grantCode,
    version,
    definitionType: file,
  });

  if (!location?.s3Key) {
    throw new NoLocation();
  }

  const definition = await fetchConfigFile(location.s3Bucket, location.s3Key);
  await stores[file]({ grantCode, version, definition });
};

const logFailure = ({ grantCode, version, file }, why) =>
  logger.error(
    { event: { action: "admin-definition-fetch-failed" } },
    `The ${file} definition for ${grantCode}@${version} was not fetched: ${why}`,
  );

const outcomeOf = async (target) => {
  try {
    await fetchFile(target);
    return { file: target.file, outcome: "stored" };
  } catch (error) {
    const reason = reasonOf(error);

    if (!reason) {
      throw error;
    }

    logFailure(target, `${reason}: ${error.message}`);
    return failed(target.file, reason, error);
  }
};

const fetchNext = async (handled, { grantCode, version }, file) => {
  const files = await handled;
  const target = { grantCode, version, file };

  try {
    return [...files, await outcomeOf(target)];
  } catch (error) {
    logFailure(target, `${error.name}: ${error.message}`);
    throw Boom.internal("Fetch definitions stopped", { files });
  }
};

// One at a time, so a stop part-way says exactly what was stored before it.
const fetchEach = (configVersion, missingFiles) =>
  missingFiles.reduce(
    (handled, file) => fetchNext(handled, configVersion, file),
    Promise.resolve([]),
  );

const fetchConfigDefinitions = async ({ grantCode, version }) => {
  const found = await loadConfigVersionFiles({ code: grantCode, version });

  if (!found) {
    throw configVersionNotFound();
  }

  return {
    files: await fetchEach({ grantCode, version }, found.missingFiles()),
  };
};

const errorCodeOf = (error) =>
  error.output?.payload?.reason === GRANT_VERSION_NOT_FOUND
    ? GRANT_VERSION_NOT_FOUND
    : "UNEXPECTED_FAILURE";

const toAuditFile = ({ file, outcome, reason }) => ({
  file,
  outcome,
  ...(reason && { reason }),
});

// A refused or stopped fetch still names each file it handled before it stopped.
const auditedFiles = (result, error) =>
  (error ? (error.data?.files ?? []) : result.files).map(toAuditFile);

const buildFetchConfigDefinitionsAudit = (
  [{ grantCode, version, caller }],
  result,
  error,
) =>
  buildAuditEvent({
    entity: auditEntities.GRANT,
    action: auditActions.FETCH_CONFIG_DEFINITION,
    entityid: grantCode,
    details: {
      caller,
      version,
      files: auditedFiles(result, error),
      ...(error && { errorCode: errorCodeOf(error) }),
    },
    security: PMC_0706_SECURITY,
  });

export const fetchConfigDefinitionsUseCase = withAudit(
  fetchConfigDefinitions,
  buildFetchConfigDefinitionsAudit,
);
