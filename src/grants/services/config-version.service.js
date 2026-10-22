import { storedDefinitionVersions } from "../../common/config-broker/definition-stores.js";
import { ConfigVersionFiles } from "../models/config-version-files.js";
import {
  findLatestActive,
  findVersionDocument,
  findVersionsByGrantCode,
} from "../repositories/config-version.repository.js";
import {
  findByCode,
  findStoredGrantDocument,
  findStoredGrantSummary,
} from "../repositories/grant.repository.js";
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

const isStored = async (type, code, version) =>
  (await storedDefinitionVersions(type, code, [version])).has(version);

const storedTypesOf = async (doc) => {
  const types = ConfigVersionFiles.typesIn(doc);
  const stored = await Promise.all(
    types.map((type) => isStored(type, doc.grantCode, doc.version)),
  );

  return new Set(types.filter((_, index) => stored[index]));
};

export const findConfigVersionFiles = async ({ code, version }) => {
  const doc = await findVersionDocument(code, version);

  if (!doc) {
    return null;
  }

  return ConfigVersionFiles.fromDocument(
    doc,
    await storedTypesOf(doc),
  ).toView();
};

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
