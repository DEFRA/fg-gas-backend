import { config } from "../../common/config.js";
import {
  cappedField,
  storedBytes,
} from "../../common/mongo/capped-projection.js";
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

// The definition exactly as stored. One over `maxBytes` is never sent: only
// its size is.
export const findStoredAgreementDefinitionDocument = async (
  code,
  version,
  { maxBytes },
) => {
  const [found] = await db
    .collection(agreementDefinitionsCollection)
    .aggregate(
      [
        { $match: { code, version } },
        {
          $project: {
            _id: 0,
            storedBytes,
            definition: cappedField("$definition", maxBytes),
          },
        },
      ],
      { maxTimeMS: config.adminReadTimeoutMs },
    )
    .toArray();

  return found
    ? { definition: found.definition ?? null, storedBytes: found.storedBytes }
    : null;
};
