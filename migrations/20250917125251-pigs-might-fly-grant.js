export const up = async (db) => {
  await db.collection("grants").insertOne({
    code: "pigs-might-fly",
    metadata: {
      description: "Pigs Might Fly",
      startDate: new Date("2100-01-01T00:00:00.000Z"),
    },
    actions: [
      {
        name: "calculate-pig-totals",
        method: "POST",
        url: "https://fg-gss-pmf.%ENVIRONMENT%.cdp-int.defra.cloud/grantFundingCalculator",
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        isPigFarmer: {
          type: "boolean",
        },
      },
      required: ["isPigFarmer"],
      unevaluatedProperties: false,
      if: {
        properties: {
          isPigFarmer: {
            type: "boolean",
            const: true,
          },
        },
      },
      then: {
        properties: {
          totalPigs: {
            type: "integer",
            minimum: 1,
            maximum: 1000,
          },
          whitePigsCount: {
            type: "integer",
            minimum: 1,
          },
          britishLandracePigsCount: {
            type: "integer",
            minimum: 1,
          },
          berkshirePigsCount: {
            type: "integer",
            minimum: 1,
          },
          otherPigsCount: {
            type: "integer",
            minimum: 1,
          },
        },
        required: ["totalPigs"],
        fgSumEquals: {
          fields: [
            "whitePigsCount",
            "berkshirePigsCount",
            "britishLandracePigsCount",
            "otherPigsCount",
          ],
          targetField: "totalPigs",
        },
      },
    },
  });
};

export const down = async (db) => {
  await db.collection("grants").deleteOne({
    code: "pigs-might-fly",
  });
};
