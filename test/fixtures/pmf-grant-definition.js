export const grant1 = {
  code: "pigs-might-fly",
  metadata: {
    description: "Pigs Might Fly",
    startDate: "2100-01-01T00:00:00.000Z",
  },
  actions: [
    {
      name: "calculate-pig-totals",
      method: "POST",
      url: `https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/grantFundingCalculator`,
    },
  ],
  questions: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {},
  },
};
