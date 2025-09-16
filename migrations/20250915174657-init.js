/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db, client) => {
  await db.collection("grants").insertOne({
    code: "laying-hen-housing",
    metadata: {
      description: "Laying Hen Housing for Health and Welfare",
      startDate: "2026-01-01T00:00:00Z",
    },
    actions: [
      {
        name: "get-prices",
        url: "https://httpbin.org/anything",
        method: "GET",
      },
      {
        name: "calc-totals",
        url: "https://httpbin.org/post",
        method: "POST",
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        surname: {
          type: "string",
        },
        age: {
          type: "integer",
          minimum: 0,
        },
        isAgent: {
          type: "boolean",
        },
        address: {
          type: "object",
          properties: {
            street: {
              type: "string",
            },
            city: {
              type: "string",
            },
            postCode: {
              type: "string",
            },
          },
          required: ["street", "city", "postCode"],
        },
      },
      required: ["name", "surname", "age", "isAgent"],
      dependentRequired: {
        isAgent: ["address"],
      },
    },
  });
};

/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const down = async (db, client) => {
  // Remove the laying hen housing grant definition
  await db.collection("grants").deleteOne({ code: "laying-hen-housing" });
};
