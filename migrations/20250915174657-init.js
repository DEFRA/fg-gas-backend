/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  // purge the tables
  const collectionNames = (await db.collections()).map((e) => e.collectionName);
  if (collectionNames.includes("grants")) {
    await db.dropCollection("grants");
  }
  if (collectionNames.includes("applications")) {
    await db.dropCollection("applications");
  }

  await db.createCollection("grants");
  await db.createCollection("applications");

  await Promise.all([
    db.createIndex("grants", { code: 1 }, { unique: true }),
    db.createIndex("applications", { clientRef: 1, code: 2 }, { unique: true }),
  ]);

  await db.collection("grants").insertOne({
    code: "pigs-might-fly",
    metadata: {
      description: "Pigs Might Fly",
      startDate: "2100-01-01T00:00:00.000Z",
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
      additionalProperties: false,
      required: ["isPigFarmer", "totalPigs", "pigBreeds"],
      properties: {
        isPigFarmer: {
          type: "boolean",
          title: "Are you a pig farmer?",
        },
        totalPigs: {
          type: "integer",
          title: "How many pigs do you have?",
          minimum: 1,
          maximum: 1000,
        },
        pigBreeds: {
          type: "array",
          items: {
            enum: ["largeWhite", "britishLandrace", "berkshire", "other"],
          },
        },
        whitePigsCount: {
          type: "integer",
        },
        britishLandraceCount: {
          type: "integer",
        },
        berkshireCount: {
          type: "integer",
        },
        otherCount: {
          type: "integer",
        },
      },
      allOf: [
        {
          if: {
            properties: {
              pigBreeds: {
                type: "array",
                contains: { enum: ["largeWhite"] },
              },
            },
          },
          then: {
            required: ["whitePigsCount"],
          },
        },
        {
          if: {
            properties: {
              pigBreeds: {
                type: "array",
                contains: { enum: ["britishLandrace"] },
              },
            },
          },
          then: {
            required: ["britishLandraceCount"],
          },
        },
        {
          if: {
            properties: {
              pigBreeds: {
                type: "array",
                contains: { enum: ["berkshire"] },
              },
            },
          },
          then: {
            required: ["berkshireCount"],
          },
        },
        {
          if: {
            properties: {
              pigBreeds: {
                type: "array",
                contains: { enum: ["other"] },
              },
            },
          },
          then: {
            required: ["otherCount"],
          },
        },
      ],
    },
  });
};

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  await db.collection("grants").deleteOne({ code: "pigs-might-fly" });
};
