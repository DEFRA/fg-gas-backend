const defaultInvoiceNumberConfig = {
  requestPadding: 3,
  requestPrefix: "V",
  suffix: "QX",
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
