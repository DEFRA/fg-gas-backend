import { Decimal128 } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  mapLegacyWoodlandVersion,
  validateMappedWoodlandVersion,
} from "./map-legacy-woodland-version.js";

const agreement = {
  agreementNumber: "WMP665383470",
  clientRef: "legacy-client",
  createdAt: new Date("2026-04-01T10:00:00.000Z"),
};

const grant = {
  agreementNumber: agreement.agreementNumber,
  code: "woodland",
  clientRef: agreement.clientRef,
};

const applicant = {
  business: {
    name: "Oakridge Estate",
    address: {
      line1: "Farm House",
      line2: "Estate Road",
      line3: "North Estate",
      line4: "York",
      line5: "North Yorkshire",
      street: "Estate Road",
      city: "York",
      postalCode: "YO1 1AA",
    },
  },
  customer: {
    name: { title: "Ms", first: "Alex", middle: "J", last: "Farmer" },
  },
};

const sourceVersion = {
  agreementName: "Oakridge Estate WMP",
  correlationId: "version-correlation-id",
  clientRef: agreement.clientRef,
  code: "woodland",
  identifiers: {
    sbi: "300000069",
    frn: "1234567890",
    crn: "1100014934",
  },
  scheme: "WMP",
  status: "accepted",
  signatureDate: new Date("2026-05-10T12:00:00.000Z"),
  updatedAt: new Date("2026-05-10T12:00:00.000Z"),
  schemeData: { oldWoodlandAreaHa: 18, newWoodlandAreaHa: 2 },
  applicant,
  application: {
    parcel: [
      {
        parcelId: "SD7560-9193",
        area: {
          unit: "ha",
          quantity: Decimal128.fromString("25.3874"),
        },
        actions: [
          {
            code: "PA3",
            appliedFor: {
              unit: "ha",
              quantity: Decimal128.fromString("55.4"),
            },
          },
        ],
      },
    ],
  },
  payment: {
    agreementStartDate: "2026-06-01",
    agreementEndDate: "2029-05-31",
    frequency: "OneOff",
    annualTotalPence: 166200,
    agreementTotalPence: 166200,
    parcelItems: {},
    agreementLevelItems: {
      1: {
        code: "PA3",
        description: "Woodland management plan",
        version: "1",
        annualPaymentPence: 166200,
      },
    },
    payments: [
      {
        totalPaymentPence: 166200,
        paymentDate: null,
        correlationId: "payment-correlation-id",
        lineItems: [{ agreementLevelItemId: 1, paymentPence: 166200 }],
      },
    ],
  },
};

const map = (version = sourceVersion) =>
  mapLegacyWoodlandVersion({
    agreement,
    grant,
    sourceVersion: version,
    version: 2,
    configVersion: "1.0.0",
  });

describe("mapLegacyWoodlandVersion", () => {
  it("maps a legacy accepted version into the current GAS Agreement domain", () => {
    const mapped = map();

    expect(mapped).toMatchObject({
      agreementNumber: "WMP665383470",
      version: 2,
      code: "woodland",
      configVersion: "1.0.0",
      state: "accepted",
      name: "Oakridge Estate WMP",
      startDate: "2026-06-01",
      endDate: "2029-05-31",
      acceptedAt: "2026-05-10T12:00:00.000Z",
      parcels: [
        {
          id: "SD7560-9193",
          sheetId: "SD7560",
          parcelId: "9193",
          area: { quantity: 25.3874, unit: "ha" },
        },
      ],
      actions: [],
      items: [
        {
          id: "item:1",
          code: "PA3",
          description: "Woodland management plan",
          version: "1",
          quantity: 55.4,
          unit: "ha",
          totalAmountPence: 166200,
        },
      ],
      annualAmountPence: 166200,
      totalAmountPence: 166200,
    });
    expect(mapped.paymentSchedule).toBeUndefined();
    expect(mapped.application).toMatchObject({
      woodlandName: "Oakridge Estate",
      hectaresTenOrOverYearsOld: 18,
      hectaresUnderTenYearsOld: 2,
      landParcels: [{ parcelId: "SD7560-9193", areaHa: 25.3874 }],
      payments: {
        agreement: [
          {
            code: "PA3",
            quantity: 55.4,
            unit: "ha",
            agreementTotalPence: 166200,
          },
        ],
      },
      totalAgreementPaymentPence: 166200,
    });
    expect(validateMappedWoodlandVersion(mapped, sourceVersion)).toEqual([]);
  });

  it("uses legacy metadata and Map fallbacks without changing source values", () => {
    const mapped = mapLegacyWoodlandVersion({
      agreement: {
        agreementNumber: agreement.agreementNumber,
        clientRef: "agreement-client",
      },
      grant: {
        ...grant,
        clientRef: "grant-client",
        createdAt: "2026-04-01T10:00:00.000Z",
      },
      sourceVersion: {
        ...sourceVersion,
        agreementName: "Woodland plan",
        clientRef: undefined,
        code: undefined,
        updatedAt: undefined,
        application: {
          parcel: [
            {
              parcelId: "INVALID",
              area: {
                unit: "ha",
                quantity: Decimal128.fromString("0.00"),
              },
            },
          ],
        },
        payment: {
          ...sourceVersion.payment,
          agreementTotalPence: 0,
          annualTotalPence: 0,
          agreementLevelItems: new Map([
            [
              "1",
              {
                code: "PA3",
                description: "Woodland management plan",
                quantity: Decimal128.fromString("0.00"),
                annualPaymentPence: 0,
              },
            ],
          ]),
        },
      },
      version: 1,
      configVersion: "1.0.0",
    });

    expect(mapped).toMatchObject({
      code: "woodland",
      clientRef: "grant-client",
      name: "Woodland plan",
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T10:00:00.000Z",
      items: [{ quantity: 0, totalAmountPence: 0 }],
    });
    expect(mapped.items[0].unit).toBeUndefined();
  });

  it("reports an incomplete offered version without inventing values", () => {
    const mapped = map({
      agreementName: "Incomplete WMP",
      correlationId: "incomplete-correlation-id",
      clientRef: agreement.clientRef,
      identifiers: sourceVersion.identifiers,
      scheme: "WMP",
      status: "offered",
      applicant: {},
      application: { parcel: [] },
      payment: { agreementTotalPence: 1 },
      updatedAt: "not-a-date",
    });

    expect(validateMappedWoodlandVersion(mapped)).toEqual(
      expect.arrayContaining([
        { path: "parcels", reason: "woodland.parcels.empty" },
        { path: "items", reason: "woodland.items.empty" },
        {
          path: "application",
          reason: "woodland.acceptance-input.unresolved",
        },
        {
          path: "totalAmountPence",
          reason: "woodland.payment-total.mismatch",
        },
      ]),
    );
  });

  it("rejects accepted versions without agreement dates", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        agreementStartDate: null,
        agreementEndDate: null,
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toEqual(
      expect.arrayContaining([
        {
          path: "startDate",
          reason: "woodland.agreement-date.unresolved",
        },
        {
          path: "endDate",
          reason: "woodland.agreement-date.unresolved",
        },
      ]),
    );
  });

  it("rejects calendar-invalid dates without normalising them", () => {
    const version = {
      ...sourceVersion,
      updatedAt: "2026-02-30T12:00:00.000Z",
      payment: {
        ...sourceVersion.payment,
        agreementStartDate: "2026-02-30",
      },
    };
    const mapped = map(version);

    expect(mapped.updatedAt).toBe("2026-02-30T12:00:00.000Z");
    expect(mapped.startDate).toBe("2026-02-30");
    expect(validateMappedWoodlandVersion(mapped, version)).toEqual(
      expect.arrayContaining([
        { path: "updatedAt", reason: "date.calendar" },
        { path: "startDate", reason: "date.calendar" },
      ]),
    );
  });

  it("rejects accepted versions without Woodland scheme areas", () => {
    const version = { ...sourceVersion, schemeData: undefined };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "application",
        reason: "woodland.acceptance-input.unresolved",
      },
    );
  });

  it("rejects negative Woodland areas and quantities", () => {
    const version = {
      ...sourceVersion,
      schemeData: { oldWoodlandAreaHa: -1, newWoodlandAreaHa: -2 },
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            area: { unit: "ha", quantity: -3 },
            actions: [
              {
                ...sourceVersion.application.parcel[0].actions[0],
                appliedFor: { unit: "ha", quantity: -4 },
              },
            ],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toEqual(
      expect.arrayContaining([
        {
          path: "parcels.0.area.quantity",
          reason: "woodland.quantity.invalid",
        },
        {
          path: "items.0.quantity",
          reason: "woodland.quantity.invalid",
        },
        {
          path: "application",
          reason: "woodland.acceptance-input.invalid",
        },
      ]),
    );
  });

  it("maps the older application agreement-item and split parcel shape", () => {
    const mapped = map({
      ...sourceVersion,
      status: "offered",
      signatureDate: undefined,
      application: {
        agreement: [
          {
            code: "PA3",
            description: "Woodland management plan",
            annualPaymentPence: 166200,
          },
        ],
        parcel: [
          {
            sheetId: "SD7560",
            parcelId: "SD7560-9193",
            actions: [],
          },
          {
            sheetId: "SD5848",
            parcelId: "9205",
            actions: [],
          },
        ],
      },
      payment: {
        ...sourceVersion.payment,
        agreementLevelItems: {},
      },
    });

    expect(mapped.parcels).toEqual([
      {
        id: "SD7560-9193",
        sheetId: "SD7560",
        parcelId: "9193",
        area: undefined,
      },
      {
        id: "SD5848-9205",
        sheetId: "SD5848",
        parcelId: "9205",
        area: undefined,
      },
    ]);
    expect(mapped.items[0]).toMatchObject({
      code: "PA3",
      totalAmountPence: 166200,
    });
  });

  it("rejects a parcel without a displayed area", () => {
    const version = {
      ...sourceVersion,
      application: {
        parcel: [{ ...sourceVersion.application.parcel[0], area: undefined }],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "parcels.0.area.quantity",
        reason: "woodland.quantity.unresolved",
      },
    );
  });

  it.each([
    ["missing", undefined],
    ["non-hectare", "acres"],
  ])("rejects a parcel with a %s area unit", (_scenario, unit) => {
    const version = {
      ...sourceVersion,
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            area: { ...sourceVersion.application.parcel[0].area, unit },
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "parcels.0.area.unit",
        reason: "woodland.unit.unsupported",
      },
    );
  });

  it("rejects Decimal128 quantities the GAS number domain cannot preserve", () => {
    const version = {
      ...sourceVersion,
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            area: {
              unit: "ha",
              quantity: Decimal128.fromString("4.757500000000000001"),
            },
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version))).toEqual(
      expect.arrayContaining([
        {
          path: "parcels.0.area.quantity",
          reason: "woodland.quantity.not-exact",
        },
      ]),
    );
  });

  it.each([
    ["missing", undefined],
    ["unsupported", "acres"],
  ])("rejects an item with a %s unit", (_scenario, unit) => {
    const version = {
      ...sourceVersion,
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            actions: [
              {
                ...sourceVersion.application.parcel[0].actions[0],
                appliedFor: {
                  ...sourceVersion.application.parcel[0].actions[0].appliedFor,
                  unit,
                },
              },
            ],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "items.0.unit",
        reason: "woodland.unit.unsupported",
      },
    );
  });

  it("uses legacy parcel actions to resolve items without creating GAS actions", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        {
          code: "PA3",
          sheetId: "SD7560",
          parcelId: "SD7560-9193",
          appliedFor: { quantity: 55.4, unit: "ha" },
        },
      ],
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            actions: [],
          },
        ],
      },
    };
    const mapped = map(version);

    expect(mapped.actions).toEqual([]);
    expect(mapped.items[0]).toMatchObject({ quantity: 55.4, unit: "ha" });
    expect(validateMappedWoodlandVersion(mapped, version)).toEqual([]);
  });

  it("rejects an action application that references an unknown parcel", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        {
          code: "PA3",
          sheetId: "NZ9999",
          parcelId: "9999",
          appliedFor: { quantity: 55.4, unit: "ha" },
        },
      ],
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "actionApplications.0",
        reason: "woodland.action.parcel-unresolved",
      },
    );
  });

  it.each([
    ["quantity", { quantity: 999, unit: "ha" }],
    ["unit", { quantity: 25.3874, unit: "acres" }],
  ])(
    "rejects a parcel action whose %s differs from its parcel",
    (field, appliedFor) => {
      const version = {
        ...sourceVersion,
        actionApplications: [
          {
            code: "PA3",
            sheetId: "SD7560",
            parcelId: "SD7560-9193",
            appliedFor,
          },
        ],
      };

      expect(
        validateMappedWoodlandVersion(map(version), version),
      ).toContainEqual({
        path: `actionApplications.0.appliedFor.${field}`,
        reason: `woodland.action.parcel-${field}-mismatch`,
      });
    },
  );

  it("keeps item quantities separate from producer parcel-area applications", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        {
          code: "PA3",
          sheetId: "SD7560-9193",
          parcelId: "SD7560-9193",
          appliedFor: { quantity: 25.3874, unit: "ha" },
        },
        {
          code: "PA3",
          sheetId: "SD5848-9205",
          parcelId: "SD5848-9205",
          appliedFor: { quantity: 169.8586, unit: "ha" },
        },
      ],
      application: {
        parcel: [
          sourceVersion.application.parcel[0],
          {
            parcelId: "SD5848-9205",
            area: { quantity: 169.8586, unit: "ha" },
            actions: [
              {
                code: "PA3",
                appliedFor: { quantity: 55.4, unit: "ha" },
              },
            ],
          },
        ],
      },
    };
    const mapped = map(version);

    expect(mapped.items[0]).toMatchObject({ quantity: 55.4, unit: "ha" });
    expect(validateMappedWoodlandVersion(mapped, version)).toEqual([]);
  });

  it("rejects an unsupported Woodland payment frequency", () => {
    const version = {
      ...sourceVersion,
      payment: { ...sourceVersion.payment, frequency: "Quarterly" },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.frequency",
        reason: "woodland.payment-frequency.unsupported",
      },
    );
  });

  it.each([
    ["missing", undefined],
    ["non-empty", { 1: { code: "PA3" } }],
  ])("rejects %s parcel-level payment items", (_scenario, parcelItems) => {
    const version = {
      ...sourceVersion,
      payment: { ...sourceVersion.payment, parcelItems },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.parcelItems",
        reason: "woodland.parcel-items.unsupported",
      },
    );
  });

  it.each([
    ["missing", []],
    ["malformed", {}],
    [
      "multiple",
      [sourceVersion.payment.payments[0], sourceVersion.payment.payments[0]],
    ],
  ])("rejects %s Woodland payments", (_scenario, payments) => {
    const version = {
      ...sourceVersion,
      payment: { ...sourceVersion.payment, payments },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments",
        reason: "woodland.payment-schedule.unsupported",
      },
    );
  });

  it("rejects a malformed payment line collection", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [{ ...sourceVersion.payment.payments[0], lineItems: {} }],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems",
        reason: "woodland.payment-line-item.unresolved",
      },
    );
  });

  it("rejects a payment line that references an unknown agreement item", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            lineItems: [{ agreementLevelItemId: 999, paymentPence: 166200 }],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems.0",
        reason: "woodland.payment-line-item.unresolved",
      },
    );
  });

  it("rejects a payment line that references a parcel item", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            lineItems: [
              {
                agreementLevelItemId: 1,
                parcelItemId: 1,
                paymentPence: 166200,
              },
            ],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems.0",
        reason: "woodland.payment-line-item.unresolved",
      },
    );
  });

  it("rejects a payment line amount that differs from its agreement item", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            lineItems: [{ agreementLevelItemId: 1, paymentPence: 1 }],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems.0.paymentPence",
        reason: "woodland.payment-line-item.amount-mismatch",
      },
    );
  });

  it("rejects duplicate payment references to an agreement item", () => {
    const lineItem = sourceVersion.payment.payments[0].lineItems[0];
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            lineItems: [lineItem, lineItem],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems.1",
        reason: "woodland.payment-line-item.unresolved",
      },
    );
  });

  it("rejects an agreement item omitted from the payment lines", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        payments: [{ ...sourceVersion.payment.payments[0], lineItems: [] }],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.payments.0.lineItems",
        reason: "woodland.payment-line-item.unresolved",
      },
    );
  });

  it("rejects a payment whose lines do not sum to its total", () => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        agreementLevelItems: {
          1: {
            ...sourceVersion.payment.agreementLevelItems[1],
            annualPaymentPence: 100,
          },
        },
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            lineItems: [{ agreementLevelItemId: 1, paymentPence: 100 }],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment",
        reason: "woodland.payment-total.mismatch",
      },
    );
  });

  it.each([
    ["missing", undefined],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s Woodland payment amounts", (_scenario, amount) => {
    const version = {
      ...sourceVersion,
      payment: {
        ...sourceVersion.payment,
        annualTotalPence: amount,
        agreementTotalPence: amount,
        agreementLevelItems: {
          1: {
            ...sourceVersion.payment.agreementLevelItems[1],
            annualPaymentPence: amount,
          },
        },
        payments: [
          {
            ...sourceVersion.payment.payments[0],
            totalPaymentPence: amount,
            lineItems: [{ agreementLevelItemId: 1, paymentPence: amount }],
          },
        ],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toContainEqual(
      {
        path: "payment.annualTotalPence",
        reason: "woodland.payment-amount.invalid",
      },
    );
  });

  it("rejects unreconciled source actions, item shapes, and payment totals", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        { code: "UNMAPPED", appliedFor: { quantity: 1, unit: "ha" } },
      ],
      application: {
        ...sourceVersion.application,
        agreement: [
          {
            code: "PA3",
            description: "Different description",
            annualPaymentPence: 166200,
          },
        ],
      },
      payment: {
        ...sourceVersion.payment,
        annualTotalPence: 1,
        payments: [{ totalPaymentPence: 2 }, { totalPaymentPence: 3 }],
      },
    };

    expect(validateMappedWoodlandVersion(map(version), version)).toEqual(
      expect.arrayContaining([
        { path: "payment", reason: "woodland.payment-total.mismatch" },
        {
          path: "payment.payments",
          reason: "woodland.payment-schedule.unsupported",
        },
        { path: "items", reason: "woodland.items.source-mismatch" },
        {
          path: "actionApplications.0",
          reason: "woodland.action.unmapped",
        },
      ]),
    );
  });

  it("reports source data that the Woodland GAS definition cannot use", () => {
    const mapped = map({
      ...sourceVersion,
      status: "terminated",
      signatureDate: undefined,
      schemeData: undefined,
      application: {
        parcel: [
          {
            ...sourceVersion.application.parcel[0],
            actions: [],
          },
        ],
      },
    });

    expect(validateMappedWoodlandVersion(mapped)).toEqual(
      expect.arrayContaining([
        { path: "state", reason: "any.only" },
        {
          path: "items.0.quantity",
          reason: "woodland.quantity.unresolved",
        },
      ]),
    );
  });
});
