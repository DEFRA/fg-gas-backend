export const up = async (db) => {
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
        url: "https://land-grants-api.%ENVIRONMENT%.cdp-int.defra.cloud/actions/validate",
      },
    ],
    phases: [
      {
        code: "PRE_AWARD",
        name: "Pre-award",
        description: "Pre-award phase",
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          additionalProperties: false,
          required: ["scheme", "parcels", "applicant"],
          properties: {
            scheme: {
              type: "string",
              title: "Defra scheme name",
            },
            totalAnnualPaymentPence: {
              type: "integer",
              minimum: 0,
              title: "Total annual payment in pence",
            },
            applicationValidationRunId: {
              type: "integer",
              title: "Land Grants Application validation run Id",
            },
            parcels: {
              type: "array",
              title: "Land parcels with their actions",
              minItems: 0,
              items: {
                $ref: "#/$defs/Parcel",
              },
            },
            applicant: {
              type: "object",
              title:
                "Applicant information including business and customer details",
              $ref: "#/$defs/Applicant",
            },
          },
          $defs: {
            Parcel: {
              type: "object",
              additionalProperties: false,
              required: ["sheetId", "parcelId", "actions"],
              properties: {
                sheetId: {
                  type: "string",
                  title: "OS Sheet ID",
                  pattern: "[A-Z]{2}[0-9]{4}",
                },
                parcelId: {
                  type: "string",
                  title: "Land parcel ID, unique within a OS Sheet ID",
                  pattern: "^\\d+$",
                },
                area: {
                  type: "object",
                  title: "Parcel area",
                  additionalProperties: false,
                  properties: {
                    unit: {
                      type: "string",
                      title: "Unit of measurement",
                      enum: ["kg", "m", "100m", "count", "ha", "m2", "sqm"],
                    },
                    quantity: {
                      type: "number",
                      title: "Area quantity",
                    },
                  },
                },
                actions: {
                  type: "array",
                  title: "Actions applied to this parcel",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/Action",
                  },
                },
              },
            },
            Action: {
              type: "object",
              additionalProperties: false,
              required: ["code"],
              properties: {
                code: {
                  type: "string",
                  title: "Code for the action to be taken on the land parcel",
                },
                description: {
                  type: "string",
                  title: "Action description",
                },
                durationYears: {
                  type: "integer",
                  minimum: 1,
                  title: "Duration in years",
                },
                eligible: {
                  type: "object",
                  title: "Eligible area or quantity",
                  additionalProperties: false,
                  properties: {
                    unit: {
                      type: "string",
                      title: "Unit of measurement",
                      enum: ["kg", "m", "100m", "count", "ha", "m2", "sqm"],
                    },
                    quantity: {
                      type: "number",
                      title: "Eligible quantity",
                    },
                  },
                },
                appliedFor: {
                  type: "object",
                  title: "Applied for area or quantity",
                  additionalProperties: false,
                  properties: {
                    unit: {
                      type: "string",
                      title: "Unit of measurement",
                      enum: ["kg", "m", "100m", "count", "ha", "m2", "sqm"],
                    },
                    quantity: {
                      type: "number",
                      title: "Quantity applied for",
                    },
                  },
                },
                paymentRates: {
                  type: "object",
                  title: "Payment rate information",
                  additionalProperties: false,
                  properties: {
                    ratePerUnitPence: {
                      type: "integer",
                      minimum: 0,
                      title: "Rate per unit in pence",
                    },
                    agreementLevelAmountPence: {
                      type: "integer",
                      minimum: 0,
                      title: "Agreement level amount in pence",
                    },
                  },
                },
                annualPaymentPence: {
                  type: "integer",
                  minimum: 0,
                  title: "Annual payment in pence",
                },
              },
            },
            Applicant: {
              type: "object",
              additionalProperties: false,
              properties: {
                business: {
                  type: "object",
                  description: "Business information for the applicant",
                  properties: {
                    name: {
                      type: "string",
                      description: "Business name",
                    },
                    email: {
                      type: "object",
                      properties: {
                        address: {
                          type: "string",
                          format: "email",
                          description: "Business email address",
                        },
                      },
                      required: ["address"],
                    },
                    phone: {
                      type: "object",
                      properties: {
                        mobile: {
                          type: "string",
                          pattern: "^[0-9]+$",
                          description: "Mobile phone number",
                        },
                      },
                      required: ["mobile"],
                    },
                    address: {
                      type: "object",
                      description: "Business address information",
                      properties: {
                        line1: {
                          type: "string",
                          description: "Address line 1",
                        },
                        line2: {
                          type: "string",
                          description: "Address line 2",
                        },
                        line3: {
                          type: ["string", "null"],
                          description: "Address line 3",
                        },
                        line4: {
                          type: ["string", "null"],
                          description: "Address line 4",
                        },
                        line5: {
                          type: ["string", "null"],
                          description: "Address line 5",
                        },
                        street: {
                          type: ["string", "null"],
                          description: "Street name",
                        },
                        city: {
                          type: "string",
                          description: "City name",
                        },
                        postalCode: {
                          type: "string",
                          pattern: "^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$",
                          description: "UK postal code",
                        },
                      },
                      required: ["line1", "line2", "city", "postalCode"],
                    },
                  },
                  required: ["name", "email", "phone", "address"],
                },
                customer: {
                  type: "object",
                  description: "Customer/individual information",
                  properties: {
                    name: {
                      type: "object",
                      description: "Customer name details",
                      properties: {
                        title: {
                          type: "string",
                          description: "Name title (e.g., Mr., Mrs., Dr.)",
                        },
                        first: {
                          type: "string",
                          description: "First name",
                        },
                        middle: {
                          type: ["string", "null"],
                          description: "Middle name",
                        },
                        last: {
                          type: "string",
                          description: "Last name",
                        },
                      },
                      required: ["title", "first", "last"],
                    },
                  },
                  required: ["name"],
                },
              },
              required: ["business", "customer"],
            },
          },
        },
        stages: [
          {
            code: "REVIEW_APPLICATION",
            name: "Review Application",
            description: "Review the application for eligibility",
            statuses: [
              {
                code: "APPLICATION_RECEIVED",
              },
              {
                code: "IN_REVIEW",
                validFrom: ["APPLICATION_RECEIVED"],
              },
              {
                code: "AGREEMENT_GENERATING",
                validFrom: ["IN_REVIEW"],
                processes: ["GENERATE_OFFER"],
              },
              {
                code: "REJECTED",
                validFrom: ["IN_REVIEW"],
              },
              {
                code: "APPLICATION_REJECTED",
                validFrom: ["IN_REVIEW"],
              },
            ],
          },
          {
            code: "REVIEW_OFFER",
            name: "Review Offer",
            description: "Review the offer made to the applicant",
            statuses: [
              {
                code: "AGREEMENT_DRAFTED",
                validFrom: [
                  "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
                ],
                processes: ["STORE_AGREEMENT_CASE"],
              },
            ],
          },
          {
            code: "CUSTOMER_AGREEMENT_REVIEW",
            name: "Customer Agreement Review",
            description: "Customer reviews the agreement offer",
            statuses: [
              {
                code: "AGREEMENT_OFFERED",
                validFrom: ["PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED"],
              },
            ],
          },
        ],
      },
      {
        code: "POST_AGREEMENT_MONITORING",
        name: "Post Agreement Monitoring",
        stages: [
          {
            code: "MONITORING",
            name: "Monitoring",
            statuses: [
              {
                code: "AGREEMENT_ACCEPTED",
                validFrom: [
                  "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
                ],
                processes: ["STORE_AGREEMENT_CASE"],
              },
              {
                code: "COMPLETE_AGREEMENT",
                validFrom: ["AGREEMENT_ACCEPTED"],
              },
            ],
          },
        ],
      },
    ],
    externalStatusMap: {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                {
                  code: "IN_REVIEW",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
                },
                {
                  code: "AGREEMENT_GENERATING",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
                },
                {
                  code: "APPLICATION_REJECTED",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_REJECTED",
                },
                {
                  code: "offered",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
                },
              ],
            },
            {
              code: "REVIEW_OFFER",
              statuses: [
                {
                  code: "rejected",
                  source: "AS",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_REJECTED",
                },
              ],
            },
            {
              code: "CUSTOMER_AGREEMENT_REVIEW",
              statuses: [
                {
                  code: "AGREEMENT_OFFERED",
                  source: "CW",
                  mappedTo:
                    "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
                },
                {
                  code: "accepted",
                  source: "AS",
                  mappedTo:
                    "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                },
                {
                  code: "withdrawn",
                  source: "AS",
                  mappedTo:
                    "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:OFFER_WITHDRAWN",
                },
              ],
            },
          ],
        },
        {
          code: "POST_AGREEMENT_MONITORING",
          stages: [
            {
              code: "MONITORING",
              statuses: [
                {
                  code: "AGREEMENT_ACCEPTED",
                  source: "CW",
                  mappedTo:
                    "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                },
                {
                  code: "COMPLETE_AGREEMENT",
                  source: "CW",
                  mappedTo:
                    "POST_AGREEMENT_MONITORING:MONITORING:COMPLETE_AGREEMENT",
                },
              ],
            },
          ],
        },
      ],
    },
  });
};
