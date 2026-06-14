import { db } from "../../common/mongo-client.js";

const claimIdCounterName = "claimIds";
const defaultInvoiceNumberConfig = {
  requestPadding: 3,
  requestPrefix: "V",
  suffix: "QX",
};

export const formatClaimId = (sequence) =>
  `R${String(sequence).padStart(8, "0")}`;

export const generateClaimId = async (session) => {
  const counter = await db.collection("counters").findOneAndUpdate(
    { _id: claimIdCounterName },
    { $inc: { seq: 1 } },
    {
      returnDocument: "after",
      session,
      upsert: true,
    },
  );

  return formatClaimId(counter.seq);
};

const resolveInvoiceNumberConfig = (invoiceNumber) => ({
  ...defaultInvoiceNumberConfig,
  ...invoiceNumber,
});

export const generateInvoiceNumber = (
  claimId,
  paymentRequestNumber,
  config,
) => {
  const { requestPadding, requestPrefix, suffix } =
    resolveInvoiceNumberConfig(config);

  return `${claimId}-${requestPrefix}${String(paymentRequestNumber).padStart(
    requestPadding,
    "0",
  )}${suffix}`;
};
