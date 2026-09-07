import { db } from "../../common/mongo-client.js";

export const paymentsCollection = "payments__payments";

export const countPayments = (session) =>
  db.collection(paymentsCollection).countDocuments({}, { session });

export const countPrimaryPayments = () =>
  db
    .collection(paymentsCollection)
    .countDocuments({}, { readPreference: "primary" });

const toDocument = (payment) => ({
  _id: payment.id,
  ...structuredClone(payment),
});

export const insertPayment = async (payment, session) =>
  db.collection(paymentsCollection).insertOne(toDocument(payment), { session });
