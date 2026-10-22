import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { isMongoDuplicateKeyError } from "../../common/mongo-errors.js";

export const paymentDefinitionsCollection = "payments__definitions";

export const findPaymentDefinition = async (code, version) => {
  const document = await db
    .collection(paymentDefinitionsCollection)
    .findOne({ code, version }, { readPreference: "primary" });

  return document?.definition ?? null;
};

// A version stored first by someone else is left as it is.
export const insertPaymentDefinition = async ({
  code,
  version,
  definition,
}) => {
  try {
    await db
      .collection(paymentDefinitionsCollection)
      .insertOne({ code, version, definition });
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw error;
    }
  }
};

export const findStoredVersions = async (code, versions) => {
  const documents = await db
    .collection(paymentDefinitionsCollection)
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
