import { Position } from "../models/position.js";
import {
  findLatestActive,
  findVersionsByGrantCode,
} from "../repositories/config-version.repository.js";
import {
  findByCode,
  findStoredGrantDocument,
  findStoredGrantSummary,
} from "../repositories/grant.repository.js";
import { loadConfigVersionFiles } from "../use-cases/load-config-version-files.js";
import { isDefinitionDefect } from "./definition-defect.js";

const PROBLEM_MAX_LENGTH = 500;

export const findConfigVersions = async (code) => {
  const [versions, current] = await Promise.all([
    findVersionsByGrantCode(code),
    findLatestActive(code),
  ]);

  if (versions.length === 0) {
    return null;
  }

  return { code, current: current?.version ?? null, versions };
};

export const findConfigVersionFiles = async ({ code, version }) =>
  (await loadConfigVersionFiles({ code, version }))?.toView() ?? null;

const NOT_STORED = {
  description: null,
  startDate: null,
  adminRole: null,
  storedBytes: null,
};

export const findGrantDefinitionSummary = async ({ code, version }) =>
  (await findStoredGrantSummary(code, version)) ?? NOT_STORED;

const NO_DOCUMENT = { document: null, storedBytes: null };

/**
 * The stored grant document and its size, never fetched. A document over
 * `maxBytes` is answered by its size alone; one not stored has neither.
 */
export const findStoredGrantDefinition = async (
  { code, version },
  { maxBytes },
) => {
  const { document, storedBytes } =
    (await findStoredGrantDocument(code, version, { maxBytes })) ?? NO_DOCUMENT;

  return { definition: document, storedBytes };
};

export { fetchConfigDefinitionsUseCase as fetchConfigDefinitions } from "../use-cases/fetch-config-definitions.use-case.js";

export {
  GRANT_VERSION_NOT_FOUND,
  configVersionNotFound,
} from "./config-version-not-found.js";

const asProblem = (error) => ({
  lifecycle: null,
  problem: error.message.slice(0, PROBLEM_MAX_LENGTH),
});

const storedGrantOf = (code, version) =>
  findByCode(code, version).then(
    (grant) => ({ grant }),
    (error) => {
      if (!isDefinitionDefect(error)) {
        throw error;
      }

      return { defect: error };
    },
  );

const lifecycleOf = (grant) => {
  try {
    return { lifecycle: grant.describeLifecycle(), problem: null };
  } catch (error) {
    if (!error.isBoom) {
      throw error;
    }

    return asProblem(error);
  }
};

/**
 * The version's lifecycle as Grants resolves it, or why the stored grant cannot
 * give one. Null when not stored.
 */
export const findGrantLifecycle = async ({ code, version }) => {
  const { grant, defect } = await storedGrantOf(code, version);

  if (defect) {
    return asProblem(defect);
  }

  return grant && lifecycleOf(grant);
};

const namedStatusesOf = (phase, stage) =>
  stage.statuses
    .filter(({ name }) => name != null)
    .map(({ code, name }) => [
      new Position({
        phase: phase.code,
        stage: stage.code,
        status: code,
      }).toString(),
      name,
    ]);

// "<PHASE:STAGE:STATUS>" to name, for the statuses the definition names.
const statusNamesOf = (phases) =>
  Object.fromEntries(
    phases.flatMap((phase) =>
      phase.stages.flatMap((stage) => namedStatusesOf(phase, stage)),
    ),
  );

// Templates as the domain model normalised them. Throws for a stored grant the
// model refuses.
export const findGrantVersionEntitlements = async ({ code, version }) => {
  const grant = await findByCode(code, version);

  return (
    grant && {
      entitlementTemplates: grant.entitlementTemplates,
      claims: grant.claims ?? null,
      statusNames: statusNamesOf(grant.phases),
    }
  );
};
