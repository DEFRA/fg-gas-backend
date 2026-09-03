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
    annualTotalPence: 166200,
    agreementTotalPence: 166200,
    agreementLevelItems: {
      1: {
        code: "PA3",
        description: "Woodland management plan",
        version: "1",
        annualPaymentPence: 166200,
      },
    },
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
      items: [{ quantity: 0, unit: "ha", totalAmountPence: 0 }],
    });
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

  it("uses legacy parcel actions to resolve items without creating GAS actions", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        { code: "PA3", appliedFor: { quantity: 55.4, unit: "ha" } },
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

  it("keeps item quantities separate from producer parcel-area applications", () => {
    const version = {
      ...sourceVersion,
      actionApplications: [
        {
          code: "PA3",
          sheetId: "SD7560",
          parcelId: "SD7560-9193",
          appliedFor: { quantity: 25.3874, unit: "ha" },
        },
        {
          code: "PA3",
          sheetId: "SD5848",
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
