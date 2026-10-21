import { storedDefinitionVersions } from "../../common/config-broker/definition-stores.js";
import { ConfigVersionFiles } from "../models/config-version-files.js";
import {
  findLatestActive,
  findVersionDocument,
  findVersionsByGrantCode,
} from "../repositories/config-version.repository.js";
import {
  findStoredGrantDocument,
  findStoredGrantSummary,
} from "../repositories/grant.repository.js";

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
