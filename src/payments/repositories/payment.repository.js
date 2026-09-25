import { db } from "../../common/mongo-client.js";
import { Payment, PaymentSourceType } from "../models/payment.js";

export const paymentsCollection = "payments__payments";

const toDocument = (payment) => ({
  _id: payment.id,
  ...structuredClone(payment),
});

export const insertPayment = async (payment, session) =>
  db.collection(paymentsCollection).insertOne(toDocument(payment), { session });

const sourceFilter = (source) => {
  if (source.type === PaymentSourceType.CLAIM) {
    return {
      "source.type": source.type,
      "source.code": source.code,
      "source.clientRef": source.clientRef,
      "source.clientClaimRef": source.clientClaimRef,
    };
  }

  if (source.type === PaymentSourceType.AGREEMENT) {
    return {
      "source.type": source.type,
      "source.agreementNumber": source.agreementNumber,
      "source.version": source.version,
    };
  }

  throw new Error(`Unsupported Payment source type: ${source.type}`);
};

export const findPaymentBySource = async (source, session) => {
  const document = await db
    .collection(paymentsCollection)
    .findOne(sourceFilter(source), { session });

  return document ? new Payment(document) : null;
};
