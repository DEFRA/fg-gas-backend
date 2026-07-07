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
              type: "integer",
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
                      code: {
                        type: "string",
                      },
                      description: {
                        type: "string",
                      },
                      activePaymentTier: {
                        type: "number",
                        minimum: 0,
                      },
                      quantityInActiveTier: {
                        type: "number",
                        minimum: 0,
                      },
                      activeTierRatePence: {
                        type: "integer",
                        minimum: 0,
                      },
                      activeTierFlatRatePence: {
                        type: "integer",
                        minimum: 0,
                      },
                      quantity: {
                        type: "number",
                        minimum: 0,
                      },
                      agreementTotalPence: {
                        type: "integer",
                        minimum: 0,
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
            name: "Reviewing application",
            description:
              "Application received and being reviewed; agreement generation triggered on approval",
            statuses: [
              {
                code: "STATUS_APPLICATION_RECEIVED",
                validFrom: [],
              },
              {
                code: "STATUS_AGREEMENT_GENERATING",
                validFrom: [
                  {
                    code: "STATUS_APPLICATION_RECEIVED",
                    processes: ["GENERATE_OFFER"],
                  },
                ],
              },
            ],
          },
          {
            code: "STAGE_PREPARING_AGREEMENT",
            name: "Preparing agreement",
            description:
              "Agreement document being drafted and made ready for the applicant",
            statuses: [
              {
                code: "STATUS_AGREEMENT_READY_FOR_APPLICANT",
                validFrom: [
                  {
                    code: "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_AGREEMENT_GENERATING",
                    processes: ["STORE_AGREEMENT_CASE"],
                  },
                ],
              },
            ],
          },
          {
            code: "STAGE_AGREEMENT_WITH_APPLICANT",
            name: "Agreement with applicant",
            description:
              "Agreement is with the applicant, awaiting their response",
            statuses: [
              {
                code: "STATUS_AGREEMENT_OFFERED",
                validFrom: [
                  {
                    code: "PHASE_PRE_AWARD:STAGE_PREPARING_AGREEMENT:STATUS_AGREEMENT_READY_FOR_APPLICANT",
                    processes: [],
                  },
                ],
              },
            ],
          },
          {
            code: "STAGE_AGREEMENT_ACCEPTED",
            name: "Agreement accepted",
            description:
              "Applicant has accepted the agreement; downstream processes triggered",
            statuses: [
              {
                code: "STATUS_AGREEMENT_ACCEPTED",
                validFrom: [
                  {
                    code: "PHASE_PRE_AWARD:STAGE_AGREEMENT_WITH_APPLICANT:STATUS_AGREEMENT_OFFERED",
                    processes: ["ACCEPT_AGREEMENT"],
                  },
                ],
              },
            ],
          },
          {
            code: "STAGE_APPLICATION_COMPLETED",
            name: "Application completed",
            description: "All approvals received; application is complete",
            statuses: [
              {
                code: "STATUS_APPLICATION_COMPLETED",
                validFrom: [
                  {
                    code: "PHASE_PRE_AWARD:STAGE_AGREEMENT_ACCEPTED:STATUS_AGREEMENT_ACCEPTED",
                    processes: [],
                  },
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
                  code: "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_AGREEMENT_GENERATING",
                  source: "CW",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_REVIEWING_APPLICATION:STATUS_AGREEMENT_GENERATING",
                },
                {
                  code: "offered",
                  source: "AS",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_PREPARING_AGREEMENT:STATUS_AGREEMENT_READY_FOR_APPLICANT",
                },
              ],
            },
            {
              code: "STAGE_PREPARING_AGREEMENT",
              statuses: [
                {
                  code: "PHASE_PRE_AWARD:STAGE_AGREEMENT_WITH_APPLICANT:STATUS_AGREEMENT_OFFERED",
                  source: "CW",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_AGREEMENT_WITH_APPLICANT:STATUS_AGREEMENT_OFFERED",
                },
              ],
            },
            {
              code: "STAGE_AGREEMENT_WITH_APPLICANT",
              statuses: [
                {
                  code: "accepted",
                  source: "AS",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_AGREEMENT_ACCEPTED:STATUS_AGREEMENT_ACCEPTED",
                },
              ],
            },
            {
              code: "STAGE_AGREEMENT_ACCEPTED",
              statuses: [
                {
                  code: "PHASE_PRE_AWARD:STAGE_APPLICATION_COMPLETED:STATUS_APPLICATION_COMPLETED",
                  source: "CW",
                  mappedTo:
                    "PHASE_PRE_AWARD:STAGE_APPLICATION_COMPLETED:STATUS_APPLICATION_COMPLETED",
                },
              ],
            },
          ],
        },
      ],
    },
  });
};
