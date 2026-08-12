import { db } from "../../common/mongo-client.js";

export const agreementDefinitionsCollection = "agreements__definitions";

export const findAgreementDefinition = async (code, version) =>
  db
    .collection(agreementDefinitionsCollection)
    .findOne({ code, version }, { readPreference: "primary" });

export const insertAgreementDefinition = async ({
  code,
  version,
  definition,
}) =>
  db
    .collection(agreementDefinitionsCollection)
    .insertOne({ code, version, definition });
