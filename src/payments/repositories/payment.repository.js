import { db } from "../../common/mongo-client.js";
import { Payment, PaymentSourceType } from "../models/payment.js";

export const paymentsCollection = "payments__payments";

const toDocument = (payment) => ({
  _id: payment.id,
  ...structuredClone(payment),
});

export const insertPayment = async (payment, session) =>
  await db
    .collection(paymentsCollection)
    .insertOne(toDocument(payment), { session });

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

// Which of an application's claims have raised a Payment, in one query: the
// caller only needs to know that one exists.
export const findClaimPaymentClientClaimRefs = async (
  { code, clientRef },
  session,
) => {
  const documents = await db
    .collection(paymentsCollection)
    .find(
      {
        "source.type": PaymentSourceType.CLAIM,
        "source.code": code,
        "source.clientRef": clientRef,
      },
      { session, projection: { "source.clientClaimRef": 1 } },
    )
    .toArray();

  return new Set(documents.map((document) => document.source.clientClaimRef));
};

export const findPaymentBySource = async (source, session) => {
  const document = await db
    .collection(paymentsCollection)
    .findOne(sourceFilter(source), { session });

  return document ? new Payment(document) : null;
};
