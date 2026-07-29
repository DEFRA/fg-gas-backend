import { db } from "../../common/mongo-client.js";
import { Payable } from "../models/payable.js";

export const payablesCollection = "agreements__payables";

const toDocument = (payable) => ({
  _id: payable.id,
  ...structuredClone(payable),
});

export const insertPayable = async (payable, session) =>
  db.collection(payablesCollection).insertOne(toDocument(payable), { session });

export const findPayableBySource = async (
  { agreementNumber, version },
  session,
) => {
  const document = await db.collection(payablesCollection).findOne(
    {
      "source.agreementNumber": agreementNumber,
      "source.version": version,
    },
    { session, readPreference: "primary" },
  );

  return document ? new Payable(document) : null;
};
