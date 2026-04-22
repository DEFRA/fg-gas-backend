import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateAnswersAgainstSchema } from "./schema-validation.service.js";

// Schema is the single source of truth in the fixture — load, don't inline,
// so test + runtime share the exact same shape.
const woodlandGrant = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../test/fixtures/wmp/woodland.json", import.meta.url),
    ),
    "utf8",
  ),
);
const woodlandSchema = woodlandGrant.phases[0].questions;

// Inlined from test/fixtures/wmp/wmp-sample-application-request.json.answers.
const sampleAnswers = {
  businessDetailsUpToDate: true,
  landRegisteredWithRpa: true,
  landManagementControl: true,
  publicBodyTenant: false,
  landHasGrazingRights: false,
  appLandHasExistingWmp: true,
  existingWmps: "www",
  intendToApplyHigherTier: true,
  hectaresTenOrOverYearsOld: 42,
  hectaresUnderTenYearsOld: 25,
  centreGridReference: "scheSP 4178 2432",
  fcTeamCode: "SOUTH_WEST",
  applicant: {
    business: {
      name: "High Fell Farm",
      reference: "0300000100",
      email: { address: "contact+300000100@example.test" },
      phone: { landline: "02011223344" },
      address: {
        line1: "1 Moorfield",
        line2: "Glossop",
        line3: "High Peak",
        line4: "Derbyshire",
        line5: "",
        street: "1 Moorfield",
        city: "Chesham",
        postalCode: "SK13 5CB",
        uprn: "681124619099",
        buildingName: "Holloway",
        buildingNumberRange: null,
        county: null,
        dependentLocality: null,
        doubleDependentLocality: null,
        flatName: "04",
        pafOrganisationName: null,
      },
    },
    customer: {
      name: { title: "Mr", first: "Bob", middle: null, last: "Sledd" },
    },
  },
  detailsConfirmedAt: "2026-04-16T10:08:04.579Z",
  totalHectaresAppliedFor: 195.246,
  guidanceRead: true,
  includedAllEligibleWoodland: true,
  applicationConfirmation: true,
  landParcels: [
    { parcelId: "SD7560-9193", areaHa: 25.3874 },
    { parcelId: "SD5848-9205", areaHa: 169.8586 },
  ],
  totalAgreementPaymentPence: 166200,
  payments: {
    agreement: [
      {
        code: "PA3",
        description: "Woodland management plan",
        activePaymentTier: 2,
        quantityInActiveTier: 5.4,
        activeTierRatePence: 3000,
        activeTierFlatRatePence: 150000,
        quantity: 55.4,
        agreementTotalPence: 166200,
        unit: "ha",
      },
    ],
  },
};

const validate = (answers) =>
  validateAnswersAgainstSchema("ref-1", woodlandSchema, answers);

const withAnswers = (overrides) => ({ ...sampleAnswers, ...overrides });

const omitField = (field) => {
  const { [field]: _omitted, ...rest } = sampleAnswers;
  return rest;
};

describe("validateAnswersAgainstSchema — WMP woodland schema", () => {
  describe("happy path", () => {
    it("validates the inlined sample application request", () => {
      expect(validate(sampleAnswers)).toMatchObject({
        totalHectaresAppliedFor: 195.246,
        existingWmps: "www",
        fcTeamCode: "SOUTH_WEST",
        landParcels: [
          { parcelId: "SD7560-9193", areaHa: 25.3874 },
          { parcelId: "SD5848-9205", areaHa: 169.8586 },
        ],
      });
    });
  });

  describe("const-true fields", () => {
    it.each([
      "businessDetailsUpToDate",
      "landRegisteredWithRpa",
      "guidanceRead",
      "applicationConfirmation",
    ])("accepts %s = true", (field) => {
      expect(validate(withAnswers({ [field]: true }))).toMatchObject({
        [field]: true,
      });
    });

    it.each([
      "businessDetailsUpToDate",
      "landRegisteredWithRpa",
      "guidanceRead",
      "applicationConfirmation",
    ])("rejects %s = false", (field) => {
      expect(() => validate(withAnswers({ [field]: false }))).toThrow(
        `${field} must be equal to constant`,
      );
    });
  });

  describe("required fields", () => {
    it.each([
      "businessDetailsUpToDate",
      "totalHectaresAppliedFor",
      "hectaresTenOrOverYearsOld",
      "hectaresUnderTenYearsOld",
      "centreGridReference",
      "fcTeamCode",
    ])("rejects when %s is missing", (field) => {
      expect(() => validate(omitField(field))).toThrow(
        `must have required property '${field}'`,
      );
    });
  });

  describe("fcTeamCode enum", () => {
    it("accepts a valid team code", () => {
      expect(
        validate(withAnswers({ fcTeamCode: "YORKSHIRE_AND_NORTH_EAST" })),
      ).toMatchObject({ fcTeamCode: "YORKSHIRE_AND_NORTH_EAST" });
    });

    it("rejects a non-enum value", () => {
      expect(() => validate(withAnswers({ fcTeamCode: "NORTH_POLE" }))).toThrow(
        "fcTeamCode must be equal to one of the allowed values",
      );
    });
  });

  describe("totalHectaresAppliedFor minimum: 0.5", () => {
    it("accepts at the minimum", () => {
      const answers = withAnswers({
        totalHectaresAppliedFor: 0.5,
        hectaresTenOrOverYearsOld: 0.3,
        hectaresUnderTenYearsOld: 0.2,
        landParcels: [{ parcelId: "P1", areaHa: 0.5 }],
      });
      expect(validate(answers)).toMatchObject({ totalHectaresAppliedFor: 0.5 });
    });

    it("rejects below the minimum", () => {
      expect(() =>
        validate(withAnswers({ totalHectaresAppliedFor: 0.4 })),
      ).toThrow("totalHectaresAppliedFor must be >= 0.5");
    });
  });

  describe("hectares* minimum: 0", () => {
    it("accepts zero hectaresTenOrOverYearsOld", () => {
      expect(
        validate(withAnswers({ hectaresTenOrOverYearsOld: 0 })),
      ).toMatchObject({ hectaresTenOrOverYearsOld: 0 });
    });

    it("accepts zero hectaresUnderTenYearsOld", () => {
      expect(
        validate(withAnswers({ hectaresUnderTenYearsOld: 0 })),
      ).toMatchObject({ hectaresUnderTenYearsOld: 0 });
    });

    it("rejects negative hectaresTenOrOverYearsOld", () => {
      expect(() =>
        validate(withAnswers({ hectaresTenOrOverYearsOld: -1 })),
      ).toThrow("hectaresTenOrOverYearsOld must be >= 0");
    });

    it("rejects negative hectaresUnderTenYearsOld", () => {
      expect(() =>
        validate(withAnswers({ hectaresUnderTenYearsOld: -1 })),
      ).toThrow("hectaresUnderTenYearsOld must be >= 0");
    });
  });

  describe("centreGridReference type", () => {
    it("accepts a string", () => {
      expect(
        validate(withAnswers({ centreGridReference: "SP 4178 2432" })),
      ).toMatchObject({ centreGridReference: "SP 4178 2432" });
    });

    it("rejects a non-string", () => {
      expect(() =>
        validate(withAnswers({ centreGridReference: 12345 })),
      ).toThrow("centreGridReference must be string");
    });
  });

  describe("applicant (optional, but business + customer required when present)", () => {
    it("accepts applicant with business and customer", () => {
      const answers = withAnswers({
        applicant: { business: {}, customer: {} },
      });
      expect(validate(answers)).toMatchObject({
        applicant: { business: {}, customer: {} },
      });
    });

    it("rejects applicant missing customer", () => {
      expect(() =>
        validate(withAnswers({ applicant: { business: {} } })),
      ).toThrow("must have required property 'customer'");
    });
  });

  describe("landParcels (minItems: 1, parcelId + areaHa required)", () => {
    it("rejects an empty array", () => {
      expect(() => validate(withAnswers({ landParcels: [] }))).toThrow(
        "landParcels must NOT have fewer than 1 items",
      );
    });

    it("rejects an item missing parcelId", () => {
      const answers = withAnswers({
        landParcels: [{ areaHa: 195.246 }],
      });
      expect(() => validate(answers)).toThrow(
        "must have required property 'parcelId'",
      );
    });

    it("rejects an item with zero areaHa", () => {
      const answers = withAnswers({
        landParcels: [{ parcelId: "P1", areaHa: 0 }],
      });
      expect(() => validate(answers)).toThrow(
        "landParcels/0/areaHa must be > 0",
      );
    });
  });

  describe("fgSumMax (hectaresTenOrOverYearsOld + hectaresUnderTenYearsOld ≤ totalHectaresAppliedFor)", () => {
    it("accepts when the sum is within the target", () => {
      // sample has 42 + 25 = 67, target 195.246 — already within
      expect(validate(sampleAnswers)).toMatchObject({
        hectaresTenOrOverYearsOld: 42,
        hectaresUnderTenYearsOld: 25,
      });
    });

    it("rejects when the sum exceeds the target", () => {
      const answers = withAnswers({
        hectaresTenOrOverYearsOld: 150,
        hectaresUnderTenYearsOld: 100,
        // 250 > 195.246
      });
      expect(() => validate(answers)).toThrow(
        "fgSumMax validation failed: sum of fields hectaresTenOrOverYearsOld, hectaresUnderTenYearsOld must be less than or equal to totalHectaresAppliedFor",
      );
    });
  });

  describe("fgSumEquals (sum of landParcels[].areaHa === totalHectaresAppliedFor)", () => {
    it("accepts the sample's parcel areas (25.3874 + 169.8586 ≈ 195.246, FP-tolerant)", () => {
      expect(validate(sampleAnswers)).toMatchObject({
        totalHectaresAppliedFor: 195.246,
      });
    });

    it("rejects when parcel areas do not sum to the target", () => {
      const answers = withAnswers({
        landParcels: [
          { parcelId: "P1", areaHa: 100 },
          { parcelId: "P2", areaHa: 50 }, // 150 != 195.246
        ],
      });
      expect(() => validate(answers)).toThrow(
        "fgSumEquals validation failed: sum of fields landParcels[].areaHa must equal totalHectaresAppliedFor",
      );
    });
  });

  describe("if/then/else on appLandHasExistingWmp", () => {
    it("requires existingWmps (as string) when appLandHasExistingWmp is true", () => {
      expect(() => validate(omitField("existingWmps"))).toThrow(
        "must have required property 'existingWmps'",
      );
    });

    it("rejects existingWmps as an array when schema expects string", () => {
      expect(() =>
        validate(withAnswers({ existingWmps: ["WMP-2024-001"] })),
      ).toThrow("existingWmps must be string");
    });

    it("forbids existingWmps when appLandHasExistingWmp is false", () => {
      expect(() =>
        validate(
          withAnswers({
            appLandHasExistingWmp: false,
            existingWmps: "www",
          }),
        ),
      ).toThrow();
    });

    it("accepts omitted existingWmps when appLandHasExistingWmp is false", () => {
      const { existingWmps: _drop, ...rest } = sampleAnswers;
      const answers = { ...rest, appLandHasExistingWmp: false };
      expect(validate(answers)).toMatchObject({
        appLandHasExistingWmp: false,
      });
    });
  });

  describe("additional properties", () => {
    it("passes through unknown properties (schema has no additionalProperties:false)", () => {
      const answers = withAnswers({ unknownField: "kept" });
      expect(validate(answers)).toMatchObject({ unknownField: "kept" });
    });
  });
});
