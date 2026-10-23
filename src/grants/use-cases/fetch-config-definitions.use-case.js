import Boom from "@hapi/boom";
import { findConfigDefinition } from "../../common/config-broker/config-catalog.repository.js";
import {
  storeDefinition,
  storedDefinitionVersions,
} from "../../common/config-broker/definition-stores.js";
import { logger } from "../../common/logger.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import {
  PMC_0706_SECURITY,
  auditActions,
  auditEntities,
} from "../../events/audit-constants.js";
import { buildAuditEvent, withAudit } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { save } from "../repositories/grant.repository.js";
import {
  configVersionNotFound,
  GRANT_VERSION_NOT_FOUND,
} from "../services/config-version-not-found.js";
import { isDefinitionDefect } from "../services/definition-defect.js";
import { loadConfigVersionFiles } from "./load-config-version-files.js";
import { checkGrantDefinition } from "./check-grant-definition.js";

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
const storeGrant = async ({ grantCode, version, definition }, session) => {
  const grant = checkGrantDefinition(definition, version);
  assertForGrant(grant, grantCode);
  await save(grant, session);
};

const stores = {
  grant: storeGrant,
  agreement: (file, session) => storeDefinition("agreement", file, session),
  payment: (file, session) => storeDefinition("payment", file, session),
};

const readFile = async ({ grantCode, version, file }) => {
  const location = await findConfigDefinition({
    grantCode,
    version,
    definitionType: file,
  });

  if (!location?.s3Key) {
    throw new NoLocation();
  }

  return fetchConfigFile(location.s3Bucket, location.s3Key);
};

const logFailure = ({ grantCode, version, file }, why) =>
  logger.error(
    { event: { action: "admin-definition-fetch-failed" } },
    `The ${file} definition for ${grantCode}@${version} was not fetched: ${why}`,
  );

const isTransient = (error) =>
  error.hasErrorLabel?.("TransientTransactionError") ?? false;

// A failure that is no outcome of the file stops the fetch, naming the files that
// failed before it; nothing is stored, as every store shares one transaction.
const settle = async (target, step, handled) => {
  try {
    return await step();
  } catch (error) {
    const reason = reasonOf(error);

    if (reason) {
      logFailure(target, `${reason}: ${error.message}`);
      return failed(target.file, reason, error);
    }

    if (isTransient(error)) {
      throw error;
    }

    logFailure(target, `${error.name}: ${error.message}`);
    throw Boom.internal("Fetch definitions stopped", {
      files: handled.filter(({ outcome }) => outcome === "failed"),
    });
  }
};

// One at a time, so a stop part-way says exactly which files failed before it.
const inTurn = (items, next) =>
  items.reduce(async (handling, item) => {
    const handled = await handling;
    return [...handled, await next(item, handled)];
  }, Promise.resolve([]));

const readEach = (configVersion, missingFiles) =>
  inTurn(missingFiles, (file, handled) => {
    const target = { ...configVersion, file };

    return settle(
      target,
      async () => ({ target, definition: await readFile(target) }),
      handled,
    );
  });

const isStored = async ({ grantCode, version, file }, session) =>
  (await storedDefinitionVersions(file, grantCode, [version], session)).has(
    version,
  );

// A file stored since it was found missing counts as stored. Checked in the
// transaction, so one stored by a fetch still running makes this one retry.
const storeEach = (reads, session) =>
  inTurn(reads, (read, handled) =>
    read.target
      ? settle(
          read.target,
          async () => {
            const { grantCode, version, file } = read.target;

            if (!(await isStored(read.target, session))) {
              await stores[file](
                { grantCode, version, definition: read.definition },
                session,
              );
            }

            return { file, outcome: "stored" };
          },
          handled,
        )
      : read,
  );

const storeFetched = async ({ reads, refusal }, session) => {
  if (refusal) {
    throw refusal;
  }

  return { files: await storeEach(reads, session) };
};

const readMissingFiles = async ({ grantCode, version }) => {
  const [found] = await loadConfigVersionFiles({
    code: grantCode,
    versions: [version],
  });

  if (!found) {
    throw configVersionNotFound();
  }

  return readEach({ grantCode, version }, found.missingFiles());
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

const storeFetchedWithAudit = withAudit(
  storeFetched,
  buildFetchConfigDefinitionsAudit,
);

// S3 is read before the transaction; the definitions and their audit event
// commit together.
export const fetchConfigDefinitionsUseCase = async (args) => {
  const fetched = await readMissingFiles(args).then(
    (reads) => ({ ...args, reads }),
    (refusal) => ({ ...args, refusal }),
  );

  return fetched.refusal
    ? storeFetchedWithAudit(fetched)
    : withTransaction((session) => storeFetchedWithAudit(fetched, session));
};
