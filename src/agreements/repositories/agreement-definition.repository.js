import { db } from "../../common/mongo-client.js";

export const agreementDefinitionsCollection = "agreements__definitions";

// Returns the stored definition itself, not the record wrapping it, so callers
// never see the document shape.
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
