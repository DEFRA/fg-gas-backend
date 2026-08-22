import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PaymentDefinition } from "./payment-definition.js";

const invoiceLine = {
  schemeCode: "CMOR1",
  description: "Large White Pig",
  amountPence: 3800,
  accountCode: "SOS710",
  fundCode: "DRD10",
};

const duePayment = {
  dueDate: "2026-11-06",
  totalAmountPence: 3800,
  invoiceLines: [invoiceLine],
};

const validDefinition = {
  code: "gas",
  sbi: "106284736",
  frn: "1101234567",
  originalInvoiceNumber: "",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  duePayments: [duePayment],
};

const validResolvedPayment = Object.fromEntries(
  Object.entries(validDefinition).filter(([key]) => key !== "code"),
);

const pmfDefinition = JSON.parse(
  readFileSync(
    new URL(
      "../../../compose/seed/pigs-might-fly/1.0.0/gas/payment.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const pmfAgreement = {
  identifiers: { sbi: "106284736", frn: "1101234567" },
  agreementNumber: "PMF123456789",
  state: "accepted",
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      totalAmountPence: 2000,
    },
    {
      id: "action:2",
      code: "berkshire",
      description: "Berkshire",
      totalAmountPence: 1800,
    },
  ],
  items: [{ id: "item:1", code: "pigArk", description: "Pig ark" }],
  totalAmountPence: 3800,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 3800,
        lineItems: [
          { actionId: "action:1", amountPence: 2000 },
          {
            itemId: "item:1",
            amountPence: 1800,
          },
        ],
      },
    ],
  },
};

const pmfExecution = { executedAt: "2026-08-06T10:15:00.000Z" };

const expectedPmfPayment = {
  sbi: "106284736",
  frn: "1101234567",
  originalInvoiceNumber: "",
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  totalAmountPence: 3800,
  currency: "GBP",
  marketingYear: "2026",
  duePayments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        {
          schemeCode: "CMOR1",
          description: "Large White Pig",
          amountPence: 2000,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
        {
          schemeCode: "CMOR1",
          description: "Pig ark",
          amountPence: 1800,
          accountCode: "SOS710",
          fundCode: "DRD10",
        },
      ],
    },
  ],
};

const captureError = (action) => {
  try {
    action();
  } catch (error) {
    return error;
  }
};

const expectConfigurationError = (action, message) => {
  const error = captureError(action);

  expect(error).toMatchObject({
    isBoom: true,
    output: { statusCode: 500 },
  });
  if (message) {
    expect(error.message).toContain(message);
  }
};

const expectResolutionError = async (definition, context = {}, message) => {
  let error;

  try {
    await definition.resolve(context);
  } catch (caught) {
    error = caught;
  }

  expect(error).toMatchObject({
    isBoom: true,
    output: { statusCode: 500 },
  });
  if (message) {
    expect(error.message).toContain(message);
  }
};

describe("PaymentDefinition", () => {
  it("constructs a valid definition and exposes its code", () => {
    expect(new PaymentDefinition(validDefinition).code).toBe("gas");
  });

  it("resolves original invoice number literals and references", async () => {
    const literal = new PaymentDefinition(validDefinition);
    const reference = new PaymentDefinition({
      ...validDefinition,
      originalInvoiceNumber: "$.originalInvoiceNumber",
    });

    await expect(literal.resolve({})).resolves.toMatchObject({
      originalInvoiceNumber: "",
    });
    await expect(
      reference.resolve({ originalInvoiceNumber: "INV-123" }),
    ).resolves.toMatchObject({ originalInvoiceNumber: "INV-123" });
  });

  it("resolves literals, references, JSONata and nested collections", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      sbi: "$.agreement.sbi",
      frn: "jsonata:$.agreement.frn",
      totalAmountPence: "$.totalAmountPence",
      duePayments: {
        itemsRef: "$.schedule",
        items: {
          dueDate: "@.date",
          totalAmountPence: "@.amountPence",
          invoiceLines: {
            itemsRef: "@.lines",
            items: {
              schemeCode: "@.schemeCode",
              description: "@.description",
              amountPence: "@.amountPence",
              accountCode: "@.accountCode",
              fundCode: "@.fundCode",
            },
          },
        },
      },
    });
    const context = {
      agreement: { sbi: "106284736", frn: "1101234567" },
      totalAmountPence: 3800,
      schedule: [
        {
          date: "2026-11-06",
          amountPence: 3800,
          lines: [invoiceLine],
        },
      ],
    };

    await expect(definition.resolve(context)).resolves.toEqual({
      ...validResolvedPayment,
      sbi: "106284736",
      frn: "1101234567",
    });
  });

  it("rejects missing required fields", () => {
    const { scheme: _scheme, ...definition } = validDefinition;

    expectConfigurationError(
      () => new PaymentDefinition(definition),
      '"scheme" is required',
    );
  });

  it("requires an original invoice number mapping", () => {
    const { originalInvoiceNumber: _originalInvoiceNumber, ...definition } =
      validDefinition;

    expectConfigurationError(
      () => new PaymentDefinition(definition),
      '"originalInvoiceNumber" is required',
    );
  });

  it.each([null, undefined, [], "gas", 1])(
    "rejects a non-object definition: %j",
    (definition) => {
      expectConfigurationError(() => new PaymentDefinition(definition));
    },
  );

  it.each(["unexpected", "paymentId", "agreementVersion", "claimId"])(
    "rejects unknown top-level field %s",
    (field) => {
      expectConfigurationError(
        () => new PaymentDefinition({ ...validDefinition, [field]: "value" }),
        `"${field}" is not allowed`,
      );
    },
  );

  it("rejects malformed JSONata at construction", () => {
    expectConfigurationError(
      () =>
        new PaymentDefinition({
          ...validDefinition,
          totalAmountPence: "jsonata:($",
        }),
      "Invalid Payment definition",
    );
  });

  it.each([{ itemsRef: "$.schedule" }, { items: { dueDate: "@.date" } }])(
    "rejects malformed collection mappings",
    (duePayments) => {
      expectConfigurationError(
        () => new PaymentDefinition({ ...validDefinition, duePayments }),
      );
    },
  );

  it.each([
    [[{ ...duePayment, status: "pending" }], "duePayments.status"],
    [
      [
        {
          ...duePayment,
          invoiceLines: [{ ...invoiceLine, deliveryBody: "RP00" }],
        },
      ],
      "duePayments.invoiceLines.deliveryBody",
    ],
    [
      {
        itemsRef: "$.schedule",
        items: { ...duePayment, correlationId: "$.correlationId" },
      },
      "duePayments.correlationId",
    ],
    [
      {
        itemsRef: "$.schedule",
        items: {
          ...duePayment,
          invoiceLines: {
            itemsRef: "@.lines",
            items: { ...invoiceLine, invoiceNumber: "@.invoiceNumber" },
          },
        },
      },
      "duePayments.invoiceLines.invoiceNumber",
    ],
  ])("rejects unknown nested mapping fields", (duePayments, path) => {
    expectConfigurationError(
      () => new PaymentDefinition({ ...validDefinition, duePayments }),
      path,
    );
  });

  it("wraps unresolved references as configuration errors", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      sbi: "$.missing",
    });

    await expectResolutionError(definition, {}, "Unresolved process mapping");
  });

  it("wraps JSONata evaluation failures as configuration errors", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      sbi: 'jsonata:$error("failed")',
    });

    await expectResolutionError(definition, {}, "Failed to evaluate");
  });

  it("rejects numeric strings for pence", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      totalAmountPence: "3800",
    });

    await expectResolutionError(definition);
  });

  it("rejects a non-string resolved original invoice number", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      originalInvoiceNumber: "$.originalInvoiceNumber",
    });

    await expectResolutionError(
      definition,
      { originalInvoiceNumber: 123 },
      '"originalInvoiceNumber" must be a string',
    );
  });

  it("rejects unknown fields produced at resolution", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      duePayments: "$.duePayments",
    });

    await expectResolutionError(definition, {
      duePayments: [{ ...duePayment, status: "pending" }],
    });
  });

  it("rejects a due payment that does not balance", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      duePayments: [
        {
          ...duePayment,
          invoiceLines: [{ ...invoiceLine, amountPence: 3799 }],
        },
      ],
    });

    await expectResolutionError(
      definition,
      {},
      "payment due 2026-11-06 does not balance with its invoice lines",
    );
  });

  it("rejects a Payment total that does not balance", async () => {
    const definition = new PaymentDefinition({
      ...validDefinition,
      totalAmountPence: 3799,
    });

    await expectResolutionError(
      definition,
      {},
      "totalAmountPence does not balance with duePayments",
    );
  });
});

describe("PMF payment definition (real config)", () => {
  it("constructs the compose seed", () => {
    const definition = new PaymentDefinition(pmfDefinition);

    expect(definition.code).toBe("pigs-might-fly");
  });

  it("resolves an accepted PMF Agreement", async () => {
    const definition = new PaymentDefinition(pmfDefinition);

    await expect(
      definition.resolve({ agreement: pmfAgreement, execution: pmfExecution }),
    ).resolves.toEqual(expectedPmfPayment);
  });

  it("rejects a PMF Agreement missing its SBI", async () => {
    const definition = new PaymentDefinition(pmfDefinition);
    const agreement = structuredClone(pmfAgreement);
    delete agreement.identifiers.sbi;

    await expectResolutionError(
      definition,
      { agreement, execution: pmfExecution },
      "Unresolved process mapping",
    );
  });

  it("rejects a PMF Agreement with no scheduled instalments", async () => {
    const definition = new PaymentDefinition(pmfDefinition);
    const agreement = structuredClone(pmfAgreement);
    agreement.paymentSchedule.instalments = [];

    await expectResolutionError(definition, {
      agreement,
      execution: pmfExecution,
    });
  });

  it("rejects a PMF line with no matching action or item description", async () => {
    const definition = new PaymentDefinition(pmfDefinition);
    const agreement = structuredClone(pmfAgreement);
    agreement.paymentSchedule.instalments[0].lineItems = [
      { actionId: "action:missing", amountPence: 3800 },
    ];

    await expectResolutionError(
      definition,
      { agreement, execution: pmfExecution },
      "Unresolved process mapping",
    );
  });

  it("resolves duplicate business codes by stable action IDs", async () => {
    const definition = new PaymentDefinition(pmfDefinition);
    const agreement = structuredClone(pmfAgreement);
    agreement.actions[0].code = "shared";
    agreement.actions[1].code = "shared";
    agreement.paymentSchedule.instalments[0].lineItems = [
      { actionId: "action:1", amountPence: 2000 },
      { actionId: "action:2", amountPence: 1800 },
    ];

    const payment = await definition.resolve({
      agreement,
      execution: pmfExecution,
    });

    expect(
      payment.duePayments[0].invoiceLines.map(({ description }) => description),
    ).toEqual(["Large White Pig", "Berkshire"]);
  });
});
