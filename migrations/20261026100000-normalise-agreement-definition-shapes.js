import { missingEndpointServiceUrls } from "../src/agreements/services/integrations/resolve-endpoint-service-url.js";
import { checkAgreementDefinition } from "../src/agreements/use-cases/compile-agreement-definition.js";
import { buildFetchStateUpdate } from "../src/common/config-broker/fetch-state-update.js";
import { FetchStatus } from "../src/common/fetch-status.js";
import { logger } from "../src/common/logger.js";

// Older Agreement definitions keep an action's page under validation.page, or
// configure the payment on the CREATE_AGREEMENT_PAYMENT input. Neither shape
// compiles any more, so agreements pinned to them cannot load. A validation
// page that disagrees with its action's page is left as stored and counted.
// A version is reset once its definition passes the checks run on arrival.
// A missing service URL is this deployment's setting, not the definition's
// fault, so it is reported but does not keep a version unusable.

const actionsOf = (definition) =>
  Object.values(definition.states ?? {}).flatMap((state) =>
    Object.values(state?.on ?? {}),
  );

const hasConflictingPage = (action) =>
  action?.validation?.page !== undefined &&
  action.page !== undefined &&
  action.page !== action.validation.page;

const movePages = (definition) => {
  let moved = 0;

  for (const action of actionsOf(definition)) {
    if (action?.validation?.page !== undefined) {
      action.page ??= action.validation.page;
      delete action.validation.page;
      moved++;
    }
  }

  return moved;
};

const dropPaymentInput = (definition) => {
  const process = definition.processDefinitions?.CREATE_AGREEMENT_PAYMENT;

  if (process?.input?.payment === undefined) {
    return 0;
  }

  delete process.input.payment;
  if (Object.keys(process.input).length === 0) {
    delete process.input;
  }

  return 1;
};

const passesCheck = ({ code, version, definition }) => {
  try {
    checkAgreementDefinition(definition, code, version);
    return true;
  } catch {
    return false;
  }
};

const normaliseDefinitions = async (definitions) => {
  const counts = {
    changed: 0,
    pages: 0,
    payments: 0,
    conflicts: 0,
    failing: 0,
    unchecked: 0,
  };
  const passing = new Set();
  const missingUrls = new Set();
  const writes = [];

  for await (const document of definitions.find({})) {
    const { definition } = document;

    if (actionsOf(definition).some(hasConflictingPage)) {
      counts.conflicts++;
    } else {
      const pages = movePages(definition);
      const payments = dropPaymentInput(definition);

      if (pages + payments > 0) {
        counts.changed++;
        counts.pages += pages;
        counts.payments += payments;
        writes.push({
          updateOne: {
            filter: { _id: document._id },
            update: { $set: { definition } },
          },
        });
      }
    }

    if (passesCheck(document)) {
      passing.add(`${document.code}@${document.version}`);
      const missing = missingEndpointServiceUrls([definition]);
      if (missing.length > 0) {
        counts.unchecked++;
        missing.forEach((envVar) => missingUrls.add(envVar));
      }
    } else {
      counts.failing++;
    }
  }

  if (writes.length > 0) {
    await definitions.bulkWrite(writes);
  }

  return { counts, passing, missingUrls };
};

const agreementPath = "definitions.agreement";

const resetPassingVersions = async (configVersions, passing) => {
  const unusable = await configVersions
    .find({ [`${agreementPath}.fetchStatus`]: FetchStatus.PermanentError })
    .project({ grantCode: 1, version: 1 })
    .toArray();
  const { set } = buildFetchStateUpdate({
    path: agreementPath,
    fetchStatus: FetchStatus.Fetched,
    fetchError: null,
    at: new Date().toISOString(),
  });
  let reset = 0;

  for (const { _id, grantCode, version } of unusable) {
    if (passing.has(`${grantCode}@${version}`)) {
      const { modifiedCount } = await configVersions.updateOne(
        { _id, [`${agreementPath}.fetchStatus`]: FetchStatus.PermanentError },
        { $set: set },
      );
      reset += modifiedCount;
    }
  }

  return reset;
};

export const up = async (db) => {
  const definitions = db.collection("agreements__definitions");
  const { counts, passing, missingUrls } =
    await normaliseDefinitions(definitions);
  const reset = await resetPassingVersions(
    db.collection("config_versions"),
    passing,
  );

  logger.info(
    `Normalised ${counts.changed} agreement definitions: moved ${counts.pages} validation pages onto their actions, dropped ${counts.payments} payment inputs, left ${counts.conflicts} with a conflicting page`,
  );
  logger.info(
    `${counts.failing} stored agreement definitions still fail their checks, reset ${reset} permanent_error agreement versions to fetched`,
  );
  if (counts.unchecked > 0) {
    logger.warn(
      `${counts.unchecked} stored agreement definitions were not checked against their endpoint services, missing ${[...missingUrls].join(", ")}`,
    );
  }
};
