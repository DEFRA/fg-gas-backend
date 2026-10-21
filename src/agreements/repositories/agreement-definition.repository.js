import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";

export const agreementDefinitionsCollection = "agreements__definitions";

export const findAgreementDefinition = async (code, version) => {
  const document = await db
    .collection(agreementDefinitionsCollection)
    .findOne({ code, version }, { readPreference: "primary" });

  return document?.definition ?? null;
};

export const insertAgreementDefinition = async ({
  code,
  version,
  definition,
}) => {
  await db
    .collection(agreementDefinitionsCollection)
    .insertOne({ code, version, definition });
};

export const findStoredVersions = async (code, versions) => {
  const documents = await db
    .collection(agreementDefinitionsCollection)
    .find(
      { code, version: { $in: versions } },
      {
        projection: { _id: 0, version: 1 },
        maxTimeMS: config.adminReadTimeoutMs,
      },
    )
    .toArray();

  return documents.map(({ version }) => version);
};
