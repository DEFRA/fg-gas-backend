import { storedDefinitionVersions } from "../../common/config-broker/definition-stores.js";
import { ConfigVersionFiles } from "../models/config-version-files.js";
import { findVersionDocument } from "../repositories/config-version.repository.js";

const isStored = async (type, code, version) =>
  (await storedDefinitionVersions(type, code, [version])).has(version);

const storedTypesOf = async (doc) => {
  const types = ConfigVersionFiles.typesIn(doc);
  const stored = await Promise.all(
    types.map((type) => isStored(type, doc.grantCode, doc.version)),
  );

  return new Set(types.filter((_, index) => stored[index]));
};

export const loadConfigVersionFiles = async ({ code, version }) => {
  const doc = await findVersionDocument(code, version);

  return doc && ConfigVersionFiles.fromDocument(doc, await storedTypesOf(doc));
};
