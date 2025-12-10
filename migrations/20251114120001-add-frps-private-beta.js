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
          required: [
            "rulesCalculations",
            "scheme",
            "applicant",
            "application",
            "payments",
          ],
          properties: {
            rulesCalculations: {
              type: "object",
              title: "Rules and calculations validation results",
              additionalProperties: false,
              required: ["id", "message", "valid", "date"],
              properties: {
                id: {
                  type: "integer",
                  title: "Validation run ID",
                },
                message: {
                  type: "string",
                  title: "Validation message",
                },
                valid: {
                  type: "boolean",
                  title: "Validation status",
                },
                date: {
                  type: "string",
                  format: "date-time",
                  title: "Validation date and time",
                },
              },
            },
            scheme: {
              type: "string",
              title: "Defra scheme name",
            },
            totalAnnualPaymentPence: {
              type: "integer",
              minimum: 0,
              title: "Total annual payment in pence",
            },
            application: {
              type: "object",
              title: "Application data",
              additionalProperties: false,
              required: ["parcel", "agreement"],
              properties: {
                parcel: {
                  type: "array",
                  title: "Application parcels",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/ApplicationParcel",
                  },
                },
                agreement: {
                  type: "array",
                  title: "Agreement-level actions",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/ApplicationAgreement",
                  },
                },
              },
            },
            payments: {
              type: "object",
              title: "Payment data",
              additionalProperties: false,
              required: ["parcel", "agreement"],
              properties: {
                parcel: {
                  type: "array",
                  title: "Payment parcels",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/PaymentParcel",
                  },
                },
                agreement: {
                  type: "array",
                  title: "Agreement-level payments",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/PaymentAgreement",
                  },
                },
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
            ApplicationParcel: {
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
                    $ref: "#/$defs/ApplicationAction",
                  },
                },
              },
            },
            ApplicationAction: {
              type: "object",
              additionalProperties: false,
              required: ["code", "durationYears", "version"],
              properties: {
                code: {
                  type: "string",
                  title: "Action code",
                },
                durationYears: {
                  type: "integer",
                  minimum: 1,
                  title: "Duration in years",
                },
                version: {
                  type: "integer",
                  minimum: 1,
                  title: "Action version",
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
              },
            },
            ApplicationAgreement: {
              type: "object",
              additionalProperties: false,
              required: ["code", "durationYears", "version"],
              properties: {
                code: {
                  type: "string",
                  title: "Action code",
                },
                durationYears: {
                  type: "integer",
                  minimum: 1,
                  title: "Duration in years",
                },
                version: {
                  type: "integer",
                  minimum: 1,
                  title: "Action version",
                },
              },
            },
            PaymentParcel: {
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
                  title: "Payment actions for this parcel",
                  minItems: 0,
                  items: {
                    $ref: "#/$defs/PaymentAction",
                  },
                },
              },
            },
            PaymentAction: {
              type: "object",
              additionalProperties: false,
              required: ["code"],
              properties: {
                code: {
                  type: "string",
                  title: "Action code",
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
                paymentRates: {
                  type: "integer",
                  minimum: 0,
                  title: "Payment rate in pence",
                },
                annualPaymentPence: {
                  type: "integer",
                  minimum: 0,
                  title: "Annual payment in pence",
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
              },
            },
            PaymentAgreement: {
              type: "object",
              additionalProperties: false,
              required: ["code"],
              properties: {
                code: {
                  type: "string",
                  title: "Action code",
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
                paymentRates: {
                  type: "integer",
                  minimum: 0,
                  title: "Payment rate in pence",
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
                    reference: {
                      type: "string",
                      description: "Business reference number",
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
                          pattern: "^\\+?[0-9\\s\\-()]+$",
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
                validFrom: [],
              },
              {
                code: "IN_REVIEW",
                validFrom: [
                  "APPLICATION_RECEIVED",
                  "APPLICATION_REJECTED",
                  "ON_HOLD",
                ],
              },
              {
                code: "AGREEMENT_GENERATING",
                validFrom: ["IN_REVIEW"],
                processes: ["GENERATE_OFFER"],
              },
              {
                code: "ON_HOLD",
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
                  "APPLICATION_REJECTED",
                ],
                processes: ["STORE_AGREEMENT_CASE"],
              },
              {
                code: "APPLICATION_REJECTED",
                validFrom: ["AGREEMENT_DRAFTED"],
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
                processes: ["UPDATE_AGREEMENT_CASE"],
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
                  code: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:IN_REVIEW",
                },
                {
                  code: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:AGREEMENT_GENERATING",
                },
                {
                  code: "PRE_AWARD:REVIEW_APPLICATION:ON_HOLD",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_APPLICATION:ON_HOLD",
                },
                {
                  code: "PRE_AWARD:REVIEW_APPLICATION:APPLICATION_REJECTED",
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
                {
                  code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_GENERATING",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_GENERATING",
                },
                {
                  code: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:AGREEMENT_DRAFTED",
                },
                {
                  code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
                  source: "CW",
                  mappedTo:
                    "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
                },
                {
                  code: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
                  source: "CW",
                  mappedTo: "PRE_AWARD:REVIEW_OFFER:APPLICATION_REJECTED",
                },
              ],
            },
            {
              code: "CUSTOMER_AGREEMENT_REVIEW",
              statuses: [
                {
                  code: "accepted",
                  source: "AS",
                  mappedTo:
                    "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                },
                {
                  code: "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
                  source: "CW",
                  mappedTo:
                    "PRE_AWARD:CUSTOMER_AGREEMENT_REVIEW:AGREEMENT_OFFERED",
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
                  code: "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                  source: "CW",
                  mappedTo:
                    "POST_AGREEMENT_MONITORING:MONITORING:AGREEMENT_ACCEPTED",
                },
              ],
            },
          ],
        },
      ],
    },
  });
};
