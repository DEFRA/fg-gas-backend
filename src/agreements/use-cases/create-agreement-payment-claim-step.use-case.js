import { resolveJSONPath } from "../../common/resolve-json.js";
import { resolveActionPath } from "./agreement-action-paths.js";
import { prepareAgreementPaymentClaim } from "./prepare-agreement-payment-claim.use-case.js";
import { recordAgreementPaymentClaimPublicationIntent } from "./record-agreement-publication-intent.use-case.js";

const gbpPencePerPound = 100;

const getResolutionRoot = ({ context }) => context;

const addMonths = (date, months) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

const addDays = (date, days) =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );

const toDateString = (date) => date.toISOString().slice(0, 10);

const toAgreementStartDate = ({ referenceDate, schedule }) => {
  if (schedule.start === "firstDayOfNextMonth") {
    return addMonths(referenceDate, 1);
  }

  return referenceDate;
};

const toPaymentDates = ({ referenceDate, schedule }) => {
  const agreementStartDate = toAgreementStartDate({ referenceDate, schedule });
  const agreementEndDate = addDays(
    addMonths(agreementStartDate, schedule.durationMonths),
    -1,
  );
  const paymentDate = addMonths(
    agreementStartDate,
    schedule.paymentOffsetMonths,
  );

  return {
    agreementEndDate: toDateString(agreementEndDate),
    agreementStartDate: toDateString(agreementStartDate),
    paymentDate: toDateString(paymentDate),
  };
};

const resolvePath = ({ path, root }) => resolveJSONPath({ root, path });

const toAgreementLevelItems = async ({ items = [], mapping }) =>
  Object.fromEntries(
    await Promise.all(
      items.map(async (item) => {
        const code = await resolvePath({ path: mapping.itemKey, root: item });

        return [
          code,
          {
            annualPaymentPence:
              (await resolvePath({ path: mapping.itemAmount, root: item })) *
              gbpPencePerPound,
            code,
            description: await resolvePath({
              path: mapping.itemDescription,
              root: item,
            }),
          },
        ];
      }),
    ),
  );

const toPaymentLineItems = ({ agreementLevelItems }) =>
  Object.values(agreementLevelItems).map((item) => ({
    agreementLevelItemId: item.code,
    paymentPence: item.annualPaymentPence,
  }));

const toAgreementPayment = async ({
  fundingCalculation,
  mapping,
  schedule,
  referenceDate,
}) => {
  const dates = toPaymentDates({ referenceDate, schedule });
  const items =
    (await resolvePath({ path: mapping.items, root: fundingCalculation })) ??
    [];
  const agreementLevelItems = await toAgreementLevelItems({ items, mapping });
  const totalPaymentPence =
    (await resolvePath({ path: mapping.total, root: fundingCalculation })) *
    gbpPencePerPound;

  return {
    agreementEndDate: dates.agreementEndDate,
    agreementLevelItems,
    agreementStartDate: dates.agreementStartDate,
    agreementTotalPence: totalPaymentPence,
    currency: "GBP",
    payments: [
      {
        lineItems: toPaymentLineItems({ agreementLevelItems }),
        paymentDate: dates.paymentDate,
        totalPaymentPence,
      },
    ],
  };
};

const resolveConfiguredPayment = ({ context, effect }) =>
  resolveActionPath(getResolutionRoot({ context }), effect.params?.payment);

const resolveFundingCalculation = ({ context, effect }) =>
  resolveActionPath(
    getResolutionRoot({ context }),
    effect.params?.fundingCalculation,
  );

const resolveEffectPayment = async ({ context, effect }) => {
  const configuredPayment = resolveConfiguredPayment({ context, effect });

  if (configuredPayment) {
    return configuredPayment;
  }

  return toAgreementPayment({
    fundingCalculation: resolveFundingCalculation({ context, effect }),
    mapping: effect.params?.mapping,
    referenceDate: new Date(context.executedAt),
    schedule: effect.params?.schedule,
  });
};

export const createAgreementPaymentClaimStep = async ({ context, effect }) => {
  const preparedPaymentClaim = await prepareAgreementPaymentClaim({
    createCorrelationId: context.createCorrelationId,
    generateClaimId: context.generateClaimId,
    payment: await resolveEffectPayment({ context, effect }),
    previousItemState: context.previousItemState,
    session: context.session,
  });
  const publication = recordAgreementPaymentClaimPublicationIntent({
    paymentClaim: effect.params?.paymentClaim,
    publication: context.publication,
  });

  return {
    output: preparedPaymentClaim,
    publication,
  };
};
