export const calculateAgreementDatesEffect = async (
  context,
  { params = {} },
) => {
  if (!Number.isInteger(params.durationMonths) || params.durationMonths < 1) {
    throw new Error(
      "Agreement date calculation requires a positive durationMonths",
    );
  }

  const startDate = firstDayOfNextMonth(new Date(context.executedAt));

  return {
    output: {
      startDate: toDateOnly(startDate),
      endDate: toDateOnly(lastDayOfAgreement(startDate, params.durationMonths)),
    },
  };
};

const toDateOnly = (date) => date.toISOString().slice(0, 10);

const firstDayOfNextMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));

const lastDayOfAgreement = (startDate, durationMonths) =>
  new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + durationMonths,
      0,
    ),
  );
