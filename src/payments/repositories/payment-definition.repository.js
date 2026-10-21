import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";

export const paymentDefinitionsCollection = "payments__definitions";

export const findPaymentDefinition = async (code, version) => {
  const document = await db
    .collection(paymentDefinitionsCollection)
    .findOne({ code, version }, { readPreference: "primary" });

  return document?.definition ?? null;
};

export const insertPaymentDefinition = async ({
  code,
  version,
  definition,
}) => {
  await db
    .collection(paymentDefinitionsCollection)
    .insertOne({ code, version, definition });
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
