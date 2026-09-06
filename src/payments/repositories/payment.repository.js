import { db } from "../../common/mongo-client.js";

export const paymentsCollection = "payments__payments";

const toDocument = (payment) => ({
  _id: payment.id,
  ...structuredClone(payment),
});

export const insertPayment = async (payment, session) =>
  db.collection(paymentsCollection).insertOne(toDocument(payment), { session });
