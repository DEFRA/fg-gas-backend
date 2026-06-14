import Boom from "@hapi/boom";
import { generateInvoiceNumber } from "./invoice-number.js";

const tokenPattern = /\{([^}]+)\}/g;

const requiredPaymentClaimFields = [
  "scheme",
  "sourceSystem",
  "deliveryBody",
  "paymentRequestNumber",
  "marketingYear",
];

const resolvePath = (object, path) =>
  path.split(".").reduce((current, part) => current?.[part], object);

const interpolateTemplate = (template, values) =>
  template.replace(tokenPattern, (_, token) => resolvePath(values, token));

const resolveMarketingYear = ({ marketingYear, referenceDate }) => {
  if (marketingYear === "currentYear") {
    return new Date(referenceDate).getFullYear().toString();
  }

  return marketingYear;
};

const hasProcessablePaymentSummary = (payment) =>
  payment?.agreementTotalPence !== undefined && Array.isArray(payment.payments);

const hasRequiredPaymentClaimFields = (paymentClaim) =>
  requiredPaymentClaimFields.every((field) => Boolean(paymentClaim?.[field]));

const hasLineItemTypes = (paymentClaim) =>
  Boolean(paymentClaim?.lineItemTypes?.length);

const hasProcessablePaymentClaimConfig = (paymentClaim) =>
  hasRequiredPaymentClaimFields(paymentClaim) && hasLineItemTypes(paymentClaim);

const assertPaymentIsProcessable = ({ itemState, payment, paymentClaim }) => {
  if (
    itemState.claimId &&
    hasProcessablePaymentSummary(payment) &&
    hasProcessablePaymentClaimConfig(paymentClaim)
  ) {
    return;
  }

  throw Boom.badRequest("Agreement item is missing processable payment data");
};

const assertDefined = ({ value, message }) => {
  if (value !== undefined && value !== null) {
    return;
  }

  throw Boom.badRequest(message);
};

const assertArray = ({ value, message }) => {
  if (Array.isArray(value)) {
    return;
  }

  throw Boom.badRequest(message);
};

const assertAgreementPaymentIsProcessable = (agreementPayment) => {
  assertDefined({
    value: agreementPayment.paymentDate,
    message: "Agreement payment is missing payment date",
  });
  assertDefined({
    value: agreementPayment.totalPaymentPence,
    message: "Agreement payment is missing total payment pence",
  });
  assertArray({
    value: agreementPayment.lineItems,
    message: "Agreement payment is missing line items",
  });
};

const assertLineItemIsProcessable = (lineItem) => {
  assertDefined({
    value: lineItem?.paymentPence,
    message: "Agreement payment line item is missing payment pence",
  });
};

const getLineItemType = ({ lineItem, lineItemTypes }) => {
  const lineItemType = lineItemTypes.find(
    ({ idField }) => lineItem[idField] !== undefined,
  );

  if (lineItemType) {
    return lineItemType;
  }

  throw Boom.badRequest("Agreement payment line item type is not configured");
};

const getLineItem = ({ lineItem, lineItemType, payment }) => {
  const item = resolvePath(payment, lineItemType.itemsPath)?.[
    lineItem[lineItemType.idField]
  ];

  if (item) {
    return item;
  }

  throw Boom.badRequest("Agreement payment line item reference is missing");
};

const getSchemeCode = ({ lineItemType, values }) => {
  const schemeCode = resolvePath(values, lineItemType.schemeCodePath);

  if (schemeCode) {
    return schemeCode;
  }

  throw Boom.badRequest("Agreement payment line item scheme code is missing");
};

const createPaymentInvoice = ({
  lineItem,
  lineItemTypes,
  payment,
  paymentDate,
}) => {
  assertLineItemIsProcessable(lineItem);

  const lineItemType = getLineItemType({ lineItem, lineItemTypes });
  const item = getLineItem({ lineItem, lineItemType, payment });
  const values = { item, lineItem, paymentDate };

  return {
    amountPence: lineItem.paymentPence.toString(),
    description: interpolateTemplate(lineItemType.descriptionTemplate, values),
    schemeCode: getSchemeCode({ lineItemType, values }),
  };
};

const createPayment = ({ agreementPayment, payment, paymentClaim }) => {
  assertAgreementPaymentIsProcessable(agreementPayment);

  return {
    correlationId: agreementPayment.correlationId,
    dueDate: agreementPayment.paymentDate,
    invoiceLines: agreementPayment.lineItems.map((lineItem) =>
      createPaymentInvoice({
        lineItem,
        lineItemTypes: paymentClaim.lineItemTypes,
        payment,
        paymentDate: agreementPayment.paymentDate,
      }),
    ),
    status: "pending",
    totalAmountPence: agreementPayment.totalPaymentPence.toString(),
  };
};

const createPayments = ({ payment, paymentClaim }) =>
  payment.payments.map((agreementPayment) =>
    createPayment({ agreementPayment, payment, paymentClaim }),
  );

export const createPaymentClaimPayload = ({
  agreement,
  item,
  itemState,
  paymentClaim,
  referenceDate,
}) => {
  const { payment } = itemState;
  assertPaymentIsProcessable({ itemState, payment, paymentClaim });

  return {
    claimId: itemState.claimId,
    frn: item.identifiers?.frn,
    grants: [
      {
        agreementNumber: agreement.agreementNumber,
        correlationId: itemState.correlationId,
        currency: payment.currency ?? paymentClaim.defaultCurrency,
        deliveryBody: paymentClaim.deliveryBody,
        invoiceNumber: generateInvoiceNumber(
          itemState.claimId,
          paymentClaim.paymentRequestNumber,
          paymentClaim.invoiceNumber,
        ),
        marketingYear: resolveMarketingYear({
          marketingYear: paymentClaim.marketingYear,
          referenceDate,
        }),
        originalInvoiceNumber: itemState.originalInvoiceNumber,
        paymentRequestNumber: paymentClaim.paymentRequestNumber,
        payments: createPayments({ payment, paymentClaim }),
        sourceSystem: paymentClaim.sourceSystem,
        totalAmountPence: payment.agreementTotalPence.toString(),
      },
    ],
    sbi: agreement.sbi,
    scheme: paymentClaim.scheme,
  };
};
