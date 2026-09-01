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
    address: { line1: "Farm House", postalCode: "YO1 1AA" },
  },
  customer: { name: { first: "Alex", last: "Farmer" } },
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
    expect(validateMappedWoodlandVersion(mapped)).toEqual([]);
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
