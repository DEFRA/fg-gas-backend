import { config } from "../../common/config.js";
import {
  cappedField,
  storedBytes,
} from "../../common/mongo/capped-projection.js";
import { db } from "../../common/mongo-client.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";

export const agreementDefinitionsCollection = "agreements__definitions";

export const findAgreementDefinition = async (code, version) => {
  const document = await db
    .collection(agreementDefinitionsCollection)
    .findOne({ code, version }, { readPreference: "primary" });

  return document?.definition ?? null;
};

// A version stored first by someone else is left as it is. Inside a
// transaction the duplicate has already aborted it, so it goes to the caller.
export const insertAgreementDefinition = async (
  { code, version, definition },
  session,
) => {
  try {
    await db
      .collection(agreementDefinitionsCollection)
      .insertOne({ code, version, definition }, { session });
  } catch (error) {
    if (session || !isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

export const findStoredVersions = async (code, versions, session) => {
  const documents = await db
    .collection(agreementDefinitionsCollection)
    .find(
      { code, version: { $in: versions } },
      {
        projection: { _id: 0, version: 1 },
        maxTimeMS: config.adminReadTimeoutMs,
        session,
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
