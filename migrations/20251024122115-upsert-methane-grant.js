/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db, client) => {
  const result = await db.collection("grants").updateOne(
    { code: "methane" },
    {
      $set: {
        actions: [],
        code: "methane",
        metadata: {
          description: "Methane",
          startDate: "2100-01-01T00:00:00.000Z",
        },
        phases: [
          {
            code: "PHASE_1",
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                isDiaryFarmer: {
                  const: true,
                },
                isDiaryKeptInEngland: {
                  const: true,
                },
                isDiaryHerdForYear: {
                  const: true,
                },
                feedTMR: {
                  const: true,
                },
                diaryCowsFedCount: {
                  type: "integer",
                  minimum: 10,
                  maximum: 10000,
                },
                monthsDiaryCowHoused: {
                  type: "integer",
                  minimum: 1,
                  maximum: 12,
                },
                msfpOptions: {
                  type: "string",
                  enum: ["Bovaer", "SilvAir"],
                },
                referenceNumber: {
                  type: "string",
                },
              },
              required: [
                "isDiaryFarmer",
                "isDiaryKeptInEngland",
                "isDiaryHerdForYear",
                "feedTMR",
                "diaryCowsFedCount",
                "monthsDiaryCowHoused",
                "msfpOptions",
              ],
              unevaluatedProperties: false,
            },
            stages: [
              {
                code: "STAGE_1",
                statuses: [
                  {
                    code: "NEW",
                  },
                ],
              },
            ],
          },
        ],
      },
      $unset: {
        questions: "",
      },
    },
    { upsert: true },
  );
  console.log("Methane grant migration result:", {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedCount: result.upsertedCount,
    upsertedId: result.upsertedId,
  });
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db, client) => {
  await db.collection("grants").deleteOne({
    code: "methane",
  });
};
