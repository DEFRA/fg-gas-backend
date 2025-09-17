/**
 * @param db {import('mongodb').Db}
 * @param client {import('mongodb').MongoClient}
 * @returns {Promise<void>}
 */
export const up = async (db, client) => {
  await db.collection("grants").insertOne({
    code: "frps-private-beta",
    metadata: {
      description: "Future RPS private beta grant",
      startDate: new Date("2100-04-01T00:00:00.000Z"),
    },
    actions: [
      {
        name: "validate-land-parcel-actions",
        method: "POST",
        url: "https://land-grants-api.dev.cdp-int.defra.cloud/actions/validate",
      },
    ],
    questions: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: [
        "scheme",
        "year",
        "hasCheckedLandIsUpToDate",
        "actionApplications",
        "agreementName",
      ],
      properties: {
        scheme: {
          type: "string",
          title: "Defra scheme name",
        },
        year: {
          type: "integer",
          title: "Scheme year",
        },
        agreementName: {
          type: "string",
          title: "Applicant provided name of the agreement",
          minLength: 1,
        },
        hasCheckedLandIsUpToDate: {
          type: "boolean",
          title:
            "Has the applicant checked that their land data is up to date?",
        },
        actionApplications: {
          type: "array",
          title: "Details of the actions applied for",
          minItems: 1,
          items: {
            $ref: "#/$defs/ActionApplication",
          },
        },
      },
      $defs: {
        ActionApplication: {
          type: "object",
          additionalProperties: false,
          required: ["parcelId", "sheetId", "code", "appliedFor"],
          properties: {
            parcelId: {
              type: "string",
              title: "Land parcel ID, unique within a OS Sheet ID",
              pattern: "^\\d+$",
            },
            sheetId: {
              type: "string",
              title: "OS Sheet ID",
              pattern: "[A-Z]{2}[0-9]{4}",
            },
            code: {
              type: "string",
              title: "Code for the action to be taken on the land parcel",
            },
            appliedFor: {
              type: "object",
              additionalProperties: false,
              required: ["unit", "quantity"],
              properties: {
                unit: {
                  type: "string",
                  title: "Unit of measurement",
                  enum: ["kg", "m", "100m", "count", "ha", "m2", "sqm"],
                },
                quantity: {
                  type: "number",
                  title: "Quantity of units applied for",
                },
              },
            },
          },
        },
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
  await db.collection("grants").deleteOne({ code: "frps-private-beta" });
};
