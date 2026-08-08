import { describe, expect, it } from "vitest";
import { agreementValueSchema } from "./agreement-value.schema.js";

const validate = (value) =>
  agreementValueSchema.validate(value, { abortEarly: false });

const fpttAgreementValues = {
  application: {
    parcel: [{ sourceField: "is deliberately grant-specific" }],
  },
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  parcels: [
    {
      id: "SD8545-9935",
      sheetId: "SD8545",
      parcelId: "9935",
      area: { quantity: 0.0321, unit: "ha" },
    },
  ],
  actions: [
    {
      id: "action:1",
      code: "CMOR1",
      parcel: "SD8545-9935",
      quantity: 0.0321,
      unit: "ha",
      ratePence: 1060,
      annualAmountPence: 34,
    },
    {
      id: "action:2",
      code: "CMOR1",
      annualAmountPence: 27200,
    },
  ],
  items: [],
  annualAmountPence: 32553,
  totalAmountPence: 32553,
  paymentSchedule: {
    frequency: "Quarterly",
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-15",
        totalAmountPence: 6810,
        lineItems: [
          { actionId: "action:1", amountPence: 10 },
          { actionId: "action:2", amountPence: 6800 },
        ],
      },
    ],
  },
};

const pmfAgreementValues = {
  application: {
    isPigFarmer: true,
    totalPigs: 5,
    pigBreeds: ["largeWhite"],
    whitePigsCount: 5,
    britishLandracePigsCount: 0,
    berkshirePigsCount: 0,
    otherPigsCount: 0,
  },
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      quantity: 5,
      unit: "head",
      ratePence: 6400,
      totalAmountPence: 32000,
    },
  ],
  items: [],
  totalAmountPence: 32000,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 32000,
        lineItems: [{ actionId: "action:1", amountPence: 32000 }],
      },
    ],
  },
};

const wmpAgreementValues = {
  application: {
    schemeData: { oldWoodlandAreaHa: 12.5, newWoodlandAreaHa: 3.25 },
  },
  startDate: "2026-09-01",
  endDate: "2029-08-31",
  parcels: [
    {
      id: "SK0971-7555",
      sheetId: "SK0971",
      parcelId: "7555",
      area: { quantity: 5.2182, unit: "ha" },
    },
    {
      id: "SK0971-9194",
      sheetId: "SK0971",
      parcelId: "9194",
      area: { quantity: 2.1703, unit: "ha" },
    },
  ],
  actions: [],
  items: [
    {
      id: "item:1",
      code: "WMP1",
      quantity: 15.75,
      unit: "ha",
      totalAmountPence: 157500,
    },
  ],
  totalAmountPence: 157500,
};

describe("agreementValueSchema", () => {
  it.each([
    ["FPTT", fpttAgreementValues],
    ["PMF", pmfAgreementValues],
    ["WMP", wmpAgreementValues],
  ])("accepts a valid %s-like Agreement value", (_grant, value) => {
    expect(validate(value).error).toBeUndefined();
  });

  it("accepts frozen Agreement party, name and scheme facts", () => {
    const value = structuredClone(wmpAgreementValues);
    value.schemeCode = "WMP";
    value.name = "Oakridge Estate WMP";
    value.applicant = {
      business: {
        name: "Oakridge Estate",
        address: {
          line1: "Farm House",
          city: "York",
          postalCode: "YO1 1AA",
        },
      },
      customer: {
        name: { title: "Ms", first: "Alex", last: "Farmer" },
      },
    };

    expect(validate(value).error).toBeUndefined();
  });

  it("rejects unknown fields inside the frozen Applicant", () => {
    const value = structuredClone(wmpAgreementValues);
    value.applicant = {
      business: {
        name: "Oakridge Estate",
        address: { postalCode: "YO1 1AA", secretReference: "hidden" },
      },
      customer: { name: { first: "Alex", last: "Farmer" } },
    };

    expect(validate(value).error?.message).toContain(
      '"applicant.business.address.secretReference" is not allowed',
    );
  });

  it.each([
    ["actions", "action:1"],
    ["items", "item:1"],
  ])("rejects duplicate IDs within %s", (entryType, duplicateId) => {
    const value = structuredClone(wmpAgreementValues);
    value[entryType] = [
      { id: duplicateId, code: "CODE", parcel: "SK0971-7555" },
      { id: duplicateId, code: "CODE", parcel: "SK0971-7555" },
    ];

    expect(validate(value).error?.message).toContain(
      `"${entryType}[1]" contains a duplicate value`,
    );
  });

  it.each([
    ["actions", "action:0"],
    ["actions", "action:01"],
    ["items", "item:-1"],
    ["items", "action:1"],
  ])("rejects malformed %s IDs", (entryType, id) => {
    const value = structuredClone(wmpAgreementValues);
    value[entryType] = [{ id, code: "CODE" }];

    expect(validate(value).error?.message).toContain(`"${entryType}[0].id"`);
  });

  it("allows duplicate codes and duplicate code/Parcel pairs", () => {
    const value = structuredClone(fpttAgreementValues);
    value.actions[1] = {
      id: "action:2",
      code: "CMOR1",
      parcel: "SD8545-9935",
      quantity: 0.01,
      unit: "ha",
    };

    expect(validate(value).error).toBeUndefined();
  });

  it.each([
    ["9935-SD8545", "the components in the wrong order"],
    ["SD8545-0000", "a Parcel ID that differs from parcelId"],
  ])("rejects a composite Parcel ID with %s", (id) => {
    const value = structuredClone(fpttAgreementValues);
    value.parcels[0].id = id;

    expect(validate(value).error?.message).toContain(
      '"parcels[0].id" must equal "SD8545-9935"',
    );
  });

  it.each(["sheetId", "parcelId"])(
    "requires Parcel component %s to be a string",
    (component) => {
      const value = structuredClone(wmpAgreementValues);
      value.parcels[0][component] = 7555;

      expect(validate(value).error?.message).toContain(
        `"parcels[0].${component}" must be a string`,
      );
    },
  );

  it("rejects duplicate Parcel IDs", () => {
    const value = structuredClone(fpttAgreementValues);
    value.parcels.push(structuredClone(value.parcels[0]));

    expect(validate(value).error?.message).toContain(
      '"parcels[1]" contains a duplicate value',
    );
  });

  it.each([
    ["actions", { quantity: 1 }, "unit"],
    ["actions", { unit: "ha" }, "quantity"],
    ["items", { quantity: 1 }, "unit"],
    ["items", { unit: "ha" }, "quantity"],
  ])(
    "requires quantity and unit together for %s",
    (entryType, measurement, missingField) => {
      const value = structuredClone(wmpAgreementValues);
      value[entryType] = [
        {
          id: entryType === "actions" ? "action:1" : "item:1",
          code: "CODE",
          ...measurement,
        },
      ];

      expect(validate(value).error?.message).toContain(missingField);
    },
  );

  it.each(["quantity", "unit"])("requires Parcel area %s", (missingField) => {
    const value = structuredClone(wmpAgreementValues);
    delete value.parcels[0].area[missingField];

    expect(validate(value).error?.message).toContain(
      `"parcels[0].area.${missingField}" is required`,
    );
  });

  it.each([1.5, "157500", Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-integer or unsafe pence value %s",
    (amount) => {
      const value = structuredClone(wmpAgreementValues);
      value.totalAmountPence = amount;

      expect(validate(value).error?.message).toContain(
        '"totalAmountPence" must be',
      );
    },
  );

  it("rejects an inverted Agreement date range", () => {
    const value = structuredClone(wmpAgreementValues);
    value.startDate = "2029-09-01";

    expect(validate(value).error?.message).toContain(
      "Agreement startDate must be on or before endDate",
    );
  });

  it.each(["actions", "items"])(
    "rejects an inverted %s entry date range",
    (entryType) => {
      const value = structuredClone(wmpAgreementValues);
      value[entryType] = [
        {
          id: entryType === "actions" ? "action:1" : "item:1",
          code: "CODE",
          startDate: "2027-02-01",
          endDate: "2027-01-31",
        },
      ];

      expect(validate(value).error?.message).toContain(
        `${entryType}[0] startDate must be on or before endDate`,
      );
    },
  );

  it.each([
    ["actions", "startDate", "2026-08-31"],
    ["actions", "startDate", "2029-09-01"],
    ["items", "endDate", "2026-08-31"],
    ["items", "endDate", "2029-09-01"],
  ])(
    "rejects an %s entry %s outside the Agreement range",
    (entryType, field, date) => {
      const value = structuredClone(wmpAgreementValues);
      value[entryType] = [
        {
          id: entryType === "actions" ? "action:1" : "item:1",
          code: "CODE",
          [field]: date,
        },
      ];

      expect(validate(value).error?.message).toContain(
        `${entryType}[0].${field} must be within the Agreement date range`,
      );
    },
  );

  it.each(["2026-02-30", "01/09/2026"])(
    "rejects invalid Agreement date %s",
    (startDate) => {
      const value = structuredClone(wmpAgreementValues);
      value.startDate = startDate;

      expect(validate(value).error?.message).toContain('"startDate"');
    },
  );

  it.each(["actions", "items"])(
    "rejects a dangling Parcel reference from %s",
    (entryType) => {
      const value = structuredClone(wmpAgreementValues);
      value[entryType] = [
        {
          id: entryType === "actions" ? "action:1" : "item:1",
          code: "CODE",
          parcel: "SK0971-0000",
        },
      ];

      expect(validate(value).error?.message).toContain(
        `${entryType}[0].parcel references unknown Parcel "SK0971-0000"`,
      );
    },
  );

  it.each(["actions", "items"])(
    "rejects a %s hectare quantity over its Parcel area",
    (entryType) => {
      const value = structuredClone(wmpAgreementValues);
      value[entryType] = [
        {
          id: entryType === "actions" ? "action:1" : "item:1",
          code: "CODE",
          parcel: "SK0971-7555",
          quantity: 5.2183,
          unit: "ha",
        },
      ];

      expect(validate(value).error?.message).toContain(
        `${entryType}[0].quantity must not exceed Parcel "SK0971-7555" area`,
      );
    },
  );

  it("accepts a hectare quantity equal to its Parcel area", () => {
    const value = structuredClone(wmpAgreementValues);
    value.items = [
      {
        id: "item:1",
        code: "CODE",
        parcel: "SK0971-7555",
        quantity: 5.2182,
        unit: "ha",
      },
    ];

    expect(validate(value).error).toBeUndefined();
  });

  it.each([
    ["Action", fpttAgreementValues],
    [
      "Item",
      {
        application: {},
        actions: [],
        items: [{ id: "item:1", code: "CAP1", totalAmountPence: 1000 }],
        totalAmountPence: 1000,
        paymentSchedule: {
          instalments: [
            {
              id: "instalment:1",
              dueDate: "2029-09-01",
              totalAmountPence: 1000,
              lineItems: [{ itemId: "item:1", amountPence: 1000 }],
            },
          ],
        },
      },
    ],
  ])("accepts a valid %s line-item reference", (_entryType, value) => {
    expect(validate(value).error).toBeUndefined();
  });

  it.each([
    ["neither", {}],
    ["both", { actionId: "action:1", itemId: "item:1" }],
  ])(
    "rejects a Payment Schedule line item with %s reference type",
    (_referenceTypes, references) => {
      const value = structuredClone(fpttAgreementValues);
      value.paymentSchedule.instalments[0].lineItems[0] = {
        ...references,
        amountPence: 10,
      };

      expect(validate(value).error?.message).toContain(
        "must contain exclusively one of [actionId, itemId]",
      );
    },
  );

  it.each([
    ["actionId", "action:99"],
    ["itemId", "item:99"],
  ])("rejects a dangling line-item %s", (referenceType, reference) => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments[0].lineItems[0] = {
      [referenceType]: reference,
      amountPence: 10,
    };

    expect(validate(value).error?.message).toContain(
      `line item ${referenceType} references unknown entry "${reference}"`,
    );
  });

  it("accepts a balanced Instalment", () => {
    expect(validate(fpttAgreementValues).error).toBeUndefined();
  });

  it("rejects an unbalanced Instalment", () => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments[0].totalAmountPence = 6809;

    expect(validate(value).error?.message).toContain(
      "totalAmountPence must equal the sum of lineItems amountPence",
    );
  });

  it("accepts empty lineItems when the Instalment total is zero", () => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments[0].totalAmountPence = 0;
    value.paymentSchedule.instalments[0].lineItems = [];

    expect(validate(value).error).toBeUndefined();
  });

  it("rejects empty lineItems when the Instalment total is non-zero", () => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments[0].lineItems = [];

    expect(validate(value).error?.message).toContain(
      "totalAmountPence must equal the sum of lineItems amountPence",
    );
  });

  it("rejects the unknown allocations field", () => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments[0].allocations = [];

    expect(validate(value).error?.message).toContain(
      '"paymentSchedule.instalments[0].allocations" is not allowed',
    );
  });

  it("rejects duplicate Payment Schedule Instalment IDs", () => {
    const value = structuredClone(fpttAgreementValues);
    value.paymentSchedule.instalments.push(
      structuredClone(value.paymentSchedule.instalments[0]),
    );

    expect(validate(value).error?.message).toContain(
      '"paymentSchedule.instalments[1]" contains a duplicate value',
    );
  });

  it.each(["totalAmountPence", "amountPence"])(
    "requires integer pence for Payment Schedule %s",
    (field) => {
      const value = structuredClone(fpttAgreementValues);
      const instalment = value.paymentSchedule.instalments[0];

      if (field === "totalAmountPence") {
        instalment[field] = 1.5;
      } else {
        instalment.lineItems[0][field] = 1.5;
      }

      expect(validate(value).error?.message).toContain("must be an integer");
    },
  );

  it.each([
    ["Agreement", (value) => (value.totalAmountPennies = 10)],
    ["Parcel", (value) => (value.parcels[0].sheet = "SK0971")],
    ["Parcel area", (value) => (value.parcels[0].area.units = "ha")],
    ["Revenue Action", (value) => (value.actions[0].actionCode = "CODE")],
    [
      "Capital Item",
      (value) =>
        value.items.push({ id: "item:1", code: "CODE", itemCode: "CODE" }),
    ],
    [
      "Payment Schedule",
      (value) => (value.paymentSchedule.paymentFrequency = "Quarterly"),
    ],
    [
      "Instalment",
      (value) =>
        (value.paymentSchedule.instalments[0].paymentDate = "2026-01-01"),
    ],
    [
      "line item",
      (value) =>
        (value.paymentSchedule.instalments[0].lineItems[0].amountPennies = 10),
    ],
  ])("rejects an unknown normalised %s field", (_label, addUnknownField) => {
    const value = structuredClone(fpttAgreementValues);
    addUnknownField(value);

    expect(validate(value).error?.message).toContain("is not allowed");
  });

  it("allows arbitrary grant-specific fields inside Application", () => {
    const value = structuredClone(wmpAgreementValues);
    value.application = {
      unknownGrant: {
        nested: [{ sourceField: true, retainedExactly: { answer: 42 } }],
      },
    };

    expect(validate(value).error).toBeUndefined();
  });
});
