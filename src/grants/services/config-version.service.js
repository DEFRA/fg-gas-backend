import {
  findLatestActive,
  findVersionsByGrantCode,
} from "../repositories/config-version.repository.js";
import {
  findStoredGrantDocument,
  findStoredGrantSummary,
} from "../repositories/grant.repository.js";
import { loadConfigVersionFiles } from "../use-cases/load-config-version-files.js";

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
