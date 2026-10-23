import { storedDefinitionVersions } from "../../common/config-broker/definition-stores.js";
import { ConfigVersionFiles } from "../models/config-version-files.js";
import { findVersionsByGrantCode } from "../repositories/config-version.repository.js";

const versionsByType = (docs) => {
  const byType = new Map();

  for (const doc of docs) {
    for (const type of ConfigVersionFiles.typesIn(doc)) {
      byType.set(type, [...(byType.get(type) ?? []), doc.version]);
    }
  }

  return byType;
};

// Each store is asked once, about every version that has its file.
const storedByType = async (code, docs) =>
  new Map(
    await Promise.all(
      [...versionsByType(docs)].map(async ([type, versions]) => [
        type,
        await storedDefinitionVersions(type, code, versions),
      ]),
    ),
  );

// Every version of the grant, or only those named; newest version first.
export const loadConfigVersionFiles = async ({ code, versions }) => {
  const docs = await findVersionsByGrantCode(code, versions);
  const stored = await storedByType(code, docs);

  return docs.map((doc) =>
    ConfigVersionFiles.fromDocument(
      doc,
      new Set(
        ConfigVersionFiles.typesIn(doc).filter((type) =>
          stored.get(type).has(doc.version),
        ),
      ),
    ),
  );
};
