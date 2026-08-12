import { describe, expect, it } from "vitest";
import {
  findAgreementProcessOutputSchema,
  transitionAgreementValueCandidateSchema,
} from "./agreement-value-candidate.schema.js";

const validationOptions = {
  abortEarly: false,
  allowUnknown: false,
  convert: false,
};

const applicant = {
  business: {
    name: "High Fell Farm",
    address: { line1: "1 Moorfield", postalCode: "SK13 5CB" },
  },
  customer: { name: { first: "Bob", last: "Sledd" } },
};

const parcel = {
  id: "SD7560-9193",
  sheetId: "SD7560",
  parcelId: "9193",
  area: { quantity: 25.3874, unit: "ha" },
};

const transitionCandidate = {
  application: {},
  actions: [],
  items: [],
};

const validateProcessOutput = (field, value) =>
  findAgreementProcessOutputSchema(field).validate(value, validationOptions);

const validateTransitionCandidate = (field, value) =>
  transitionAgreementValueCandidateSchema.validate(
    { ...transitionCandidate, [field]: value },
    validationOptions,
  );

const sharedFieldCases = [
  ["schemeCode", "SFI", 123],
  ["name", "High Fell agreement", false],
  ["applicant", applicant, {}],
  ["startDate", "2026-09-01", "2026-09-31"],
  ["endDate", "2029-08-31", "31 August 2029"],
  ["parcels", [parcel], [parcel, structuredClone(parcel)]],
  ["annualAmountPence", 166200, 1662.5],
  ["totalAmountPence", 498600, "498600"],
];

const paymentScheduleValues = {
  amountPence: 100,
  correlationId: "payment-1",
  description: "Test payment",
  dueDate: "2026-12-01",
  frequency: "annual",
  totalAmountPence: 100,
};

const paymentSchedule = (overrides = {}) => {
  const values = { ...paymentScheduleValues, ...overrides };

  return {
    frequency: values.frequency,
    instalments: [
      {
        dueDate: values.dueDate,
        totalAmountPence: values.totalAmountPence,
        correlationId: values.correlationId,
        lineItems: [
          {
            actionRef: "action-1",
            amountPence: values.amountPence,
            description: values.description,
          },
        ],
      },
    ],
  };
};

const sharedPaymentFieldCases = [
  ["frequency", { frequency: 12 }],
  ["due date", { dueDate: "2026-12-32" }],
  ["total amount", { totalAmountPence: 100.5 }],
  ["correlation ID", { correlationId: 123 }],
  ["line amount", { amountPence: "100" }],
  ["line description", { description: null }],
];

const persistentIdentityCases = [
  ["Action", "actions", [{ id: "action:1", code: "CSAM1" }]],
  ["Capital Item", "items", [{ id: "item:1", code: "PA3" }]],
  [
    "Payment Schedule Instalment",
    "paymentSchedule",
    {
      instalments: [
        {
          id: "instalment:1",
          dueDate: "2026-12-01",
          totalAmountPence: 100,
          lineItems: [{ actionRef: "action-1", amountPence: 100 }],
        },
      ],
    },
  ],
  [
    "Payment Schedule Line Item",
    "paymentSchedule",
    {
      instalments: [
        {
          dueDate: "2026-12-01",
          totalAmountPence: 100,
          lineItems: [{ actionId: "action:1", amountPence: 100 }],
        },
      ],
    },
  ],
];

describe("Agreement value candidate schemas", () => {
  it.each(sharedFieldCases)(
    "validates shared %s values consistently",
    (field, validValue, invalidValue) => {
      expect(validateProcessOutput(field, validValue).error).toBeUndefined();
      expect(
        validateTransitionCandidate(field, validValue).error,
      ).toBeUndefined();
      expect(validateProcessOutput(field, invalidValue).error).toBeDefined();
      expect(
        validateTransitionCandidate(field, invalidValue).error,
      ).toBeDefined();
    },
  );

  it.each(sharedPaymentFieldCases)(
    "validates shared Payment %s consistently",
    (_name, invalidValues) => {
      const validSchedule = paymentSchedule();
      const invalidSchedule = paymentSchedule(invalidValues);

      expect(
        validateProcessOutput("paymentSchedule", validSchedule).error,
      ).toBeUndefined();
      expect(
        validateTransitionCandidate("paymentSchedule", validSchedule).error,
      ).toBeUndefined();
      expect(
        validateProcessOutput("paymentSchedule", invalidSchedule).error,
      ).toBeDefined();
      expect(
        validateTransitionCandidate("paymentSchedule", invalidSchedule).error,
      ).toBeDefined();
    },
  );

  it.each(persistentIdentityCases)(
    "forbids process-output %s identities but permits transition identities",
    (_name, field, value) => {
      expect(validateProcessOutput(field, value).error).toBeDefined();
      expect(validateTransitionCandidate(field, value).error).toBeUndefined();
    },
  );

  it("allows candidate references in both workflows", () => {
    const actions = [{ ref: "new-action", code: "CSAM1" }];

    expect(validateProcessOutput("actions", actions).error).toBeUndefined();
    expect(
      validateTransitionCandidate("actions", actions).error,
    ).toBeUndefined();
  });

  it("does not expose schemas for non-candidate Agreement fields", () => {
    expect(findAgreementProcessOutputSchema("agreementNumber")).toBeUndefined();
  });
});
