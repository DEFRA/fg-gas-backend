import { db } from "../../common/mongo-client.js";

export const paymentsCollection = "payments__payments";

const toDocument = (payment) => ({
  _id: payment.id,
  ...structuredClone(payment),
});

export const insertPayment = async (payment, session) =>
  db.collection(paymentsCollection).insertOne(toDocument(payment), { session });

export const findPaymentBySource = (source, session) =>
  db.collection(paymentsCollection).findOne(
    {
      "source.type": source.type,
      "source.agreementNumber": source.agreementNumber,
      "source.version": source.version,
    },
    { session },
  );
