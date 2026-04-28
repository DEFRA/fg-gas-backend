/**
 * Replace the woodland grant with the current schema.
 *
 * Changes vs. the previous adjustments migration:
 * - totalHectaresAppliedFor -> totalHectaresForSelectedParcels
 *   (renamed property + all references in `required` and the fgSum* targets)
 *
 * The earlier 20260423180000-woodland-schema-adjustments migration has
 * already been applied in dev/ext, so editing it would not re-run there.
 * This migration takes the same delete + insert approach against the
 * current schema.
 */

export const up = async (db) => {
  await db.collection("grants").deleteOne({ code: "woodland" });

  await db.collection("grants").insertOne({
    code: "woodland",
    metadata: {
      description: "Woodland Management Plan",
      startDate: new Date("2100-01-01T00:00:00.000Z"),
    },
    actions: [],
    amendablePositions: [],
    phases: [
      {
        code: "PHASE_PRE_AWARD",
        name: "Pre-award",
        description: "Pre-award phase",
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            businessDetailsUpToDate: {
              type: "boolean",
              const: true,
            },
            landRegisteredWithRpa: {
              type: "boolean",
              const: true,
            },
            landManagementControl: {
              type: "boolean",
            },
            publicBodyTenant: {
              type: "boolean",
            },
            landHasGrazingRights: {
              type: "boolean",
            },
            appLandHasExistingWmp: {
              type: "boolean",
            },
            intendToApplyHigherTier: {
              type: "boolean",
            },
            woodlandName: {
              type: "string",
            },
            hectaresTenOrOverYearsOld: {
              type: "number",
              minimum: 0.4,
            },
            hectaresUnderTenYearsOld: {
              type: "number",
              minimum: 0,
            },
            centreGridReference: {
              type: "string",
            },
            fcTeamCode: {
              type: "string",
              enum: [
                "EAST_AND_EAST_MIDLANDS",
                "NORTH_WEST_AND_WEST_MIDLANDS",
                "SOUTH_EAST_AND_LONDON",
                "SOUTH_WEST",
                "YORKSHIRE_AND_NORTH_EAST",
              ],
            },
            applicant: {
              type: "object",
              properties: {
                business: {
                  type: "object",
                },
                customer: {
                  type: "object",
                },
              },
              required: ["business", "customer"],
            },
            detailsConfirmedAt: {
              type: "string",
              format: "date-time",
            },
            totalHectaresForSelectedParcels: {
              type: "number",
              minimum: 0.5,
            },
            guidanceRead: {
              type: "boolean",
              const: true,
            },
            includedAllEligibleWoodland: {
              type: "boolean",
            },
            applicationConfirmation: {
              type: "boolean",
              const: true,
            },
            landParcels: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parcelId: {
                    type: "string",
                  },
                  areaHa: {
                    type: "number",
                    exclusiveMinimum: 0,
                  },
                },
                required: ["parcelId", "areaHa"],
              },
              minItems: 1,
            },
            totalAgreementPaymentPence: {
              type: "number",
              exclusiveMinimum: 0,
            },
            payments: {
              type: "object",
              properties: {
                agreement: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      description: { type: "string" },
                      activePaymentTier: {
                        type: "number",
                        exclusiveMinimum: 0,
                      },
                      quantityInActiveTier: {
                        type: "number",
                        exclusiveMinimum: 0,
                      },
                      activeTierRatePence: {
                        type: "number",
                        minimum: 0,
                      },
                      activeTierFlatRatePence: {
                        type: "number",
                        exclusiveMinimum: 0,
                      },
                      quantity: { type: "number", exclusiveMinimum: 0 },
                      agreementTotalPence: {
                        type: "number",
                        exclusiveMinimum: 0,
                      },
                      unit: {
                        type: "string",
                        enum: ["ha", "%"],
                      },
                    },
                    required: [
                      "code",
                      "description",
                      "activePaymentTier",
                      "quantityInActiveTier",
                      "activeTierRatePence",
                      "activeTierFlatRatePence",
                      "quantity",
                      "agreementTotalPence",
                      "unit",
                    ],
                  },
                },
              },
            },
          },
          required: [
            "businessDetailsUpToDate",
            "guidanceRead",
            "landRegisteredWithRpa",
            "landManagementControl",
            "publicBodyTenant",
            "landHasGrazingRights",
            "appLandHasExistingWmp",
            "intendToApplyHigherTier",
            "includedAllEligibleWoodland",
            "woodlandName",
            "totalHectaresForSelectedParcels",
            "hectaresTenOrOverYearsOld",
            "hectaresUnderTenYearsOld",
            "centreGridReference",
            "fcTeamCode",
            "applicationConfirmation",
            "landParcels",
          ],
          if: {
            properties: {
              appLandHasExistingWmp: {
                const: true,
              },
            },
          },
          then: {
            required: ["existingWmps"],
            properties: {
              existingWmps: {
                type: "string",
              },
            },
          },
          else: {
            properties: {
              existingWmps: false,
            },
          },
          fgSumMax: {
            fields: ["hectaresTenOrOverYearsOld", "hectaresUnderTenYearsOld"],
            targetField: "totalHectaresForSelectedParcels",
          },
          fgSumMin: {
            fields: ["hectaresTenOrOverYearsOld", "hectaresUnderTenYearsOld"],
            minimum: 0.5,
          },
          fgSumEquals: {
            fields: ["landParcels[].areaHa"],
            targetField: "totalHectaresForSelectedParcels",
          },
        },
        stages: [
          {
            code: "STAGE_REVIEWING_APPLICATION",
            name: "Reviewing Application",
            description:
              "Internal review of woodland management plan application",
            statuses: [
              {
                code: "STATUS_APPLICATION_RECEIVED",
                validFrom: [],
              },
              {
                code: "STATUS_IN_REVIEW",
                validFrom: [
                  { code: "STATUS_APPLICATION_RECEIVED", processes: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
    externalStatusMap: {
      phases: [
        {
          code: "PHASE_PRE_AWARD",
          stages: [
            {
              code: "STAGE_REVIEWING_APPLICATION",
              statuses: [
                {
                  code: "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_IN_REVIEW",
                  source: "CW",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_IN_REVIEW",
                },
              ],
            },
          ],
        },
      ],
    },
  });
};
