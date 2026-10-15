import { describe, expect, it } from "vitest";
import { EntitlementTemplate } from "./entitlement-template.js";
import { PositionScope } from "./position-scope.js";
import { Position } from "./position.js";

const entitlementTemplateFrom = (definition) =>
  EntitlementTemplate.fromDefinition(definition);

const validProps = {
  claimCode: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description:
    "The maximum eligible woodland area that can be claimed under PA3.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
    actionVersion: {
      input: false,
      value: "jsonata: $.agreement.actions[code='PA3'].version",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: [
    {
      phase: "PHASE_PRE_AWARD",
      stage: "STAGE_PREPARE_CLAIM",
      status: "STATUS_PREPARING_CLAIM",
    },
  ],
  claim: {
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    requiresApproval: false,
    requiresEvidence: false,
  },
};

const availableAtPosition = validProps.availableAt[0];
const applicationPosition = new Position(availableAtPosition);

describe("EntitlementTemplate", () => {
  describe("help", () => {
    const withHelp = (help) => entitlementTemplateFrom({ ...validProps, help });

    it("keeps guidance written as paragraphs and lists", () => {
      const help = {
        summary: "How is the claim amount calculated?",
        content: [
          { text: "Threshold payments for eligible land in hectares (ha):" },
          { items: ["0.5ha to 50ha: flat rate of \u00a31,500"] },
        ],
      };

      expect(withHelp(help).help).toEqual(help);
    });

    it("is absent when the definition carries none", () => {
      expect(entitlementTemplateFrom(validProps).help).toBeUndefined();
    });

    it("reads null as absent", () => {
      expect(withHelp(null).help).toBeUndefined();
    });

    it("rejects a block that is both a paragraph and a list", () => {
      expect(() =>
        withHelp({
          summary: "Both",
          content: [{ text: "a", items: ["b"] }],
        }),
      ).toThrow(/Invalid entitlement template/);
    });

    it("rejects guidance with nothing in it", () => {
      expect(() => withHelp({ summary: "Empty", content: [] })).toThrow(
        /Invalid entitlement template/,
      );
    });
  });

  it("constructs from valid props", () => {
    const template = entitlementTemplateFrom(validProps);

    expect(template).toEqual(validProps);
  });

  it("throws Boom.badImplementation when a required field is missing", () => {
    expect(() =>
      entitlementTemplateFrom({ claimCode: "ENT_MISSING_FIELDS" }),
    ).toThrow(/Invalid entitlement template "ENT_MISSING_FIELDS"/);
  });

  it("strips unknown fields", () => {
    const template = entitlementTemplateFrom({
      ...validProps,
      somethingUnexpected: true,
    });

    expect(template).not.toHaveProperty("somethingUnexpected");
  });

  it("keeps a jsonata value as an opaque string", () => {
    const template = entitlementTemplateFrom(validProps);

    expect(template.fields.actionVersion.value).toBe(
      "jsonata: $.agreement.actions[code='PA3'].version",
    );
  });

  describe("materialised", () => {
    // Everything a materialised template needs: it is projected from position
    // and claim history, so it collects nothing and stores nothing.
    const materialisedProps = {
      claimCode: "ENT_TRACTOR",
      name: "Tractor entitlement",
      availableAt: [
        {
          phase: "PHASE_CLAIM",
          stage: "STAGE_AWAITING_CLAIM",
          status: "STATUS_AWAITING_CLAIM",
        },
      ],
    };

    it("constructs from the minimal set of fields a materialised template needs", () => {
      const template = entitlementTemplateFrom(materialisedProps);

      expect(template.claimCode).toBe("ENT_TRACTOR");
      expect(template.description).toBeUndefined();
      expect(template.fields).toBeUndefined();
      expect(template.claim).toBeUndefined();
    });

    it("materialises by default", () => {
      const template = entitlementTemplateFrom(materialisedProps);

      expect(template.materialised).toBe(true);
    });

    it("defaults to a single entitlement", () => {
      const template = entitlementTemplateFrom(materialisedProps);

      expect(template.maxEntitlements).toBe(1);
    });

    it("defaults claim limits to a single whole claim", () => {
      const template = entitlementTemplateFrom({
        ...materialisedProps,
        claim: {},
      });

      expect(template.claim).toEqual({
        limits: { maximumClaims: 1, allowsPartialClaims: false },
        requiresApproval: false,
        requiresEvidence: false,
      });
    });

    it("rejects a persisted template that collects no input", () => {
      expect(() =>
        entitlementTemplateFrom({
          ...materialisedProps,
          materialised: false,
        }),
      ).toThrow(
        /"fields" must define at least one field with "input" true when "materialised" is false/,
      );
    });

    it("rejects a persisted template whose fields are all derived", () => {
      expect(() =>
        entitlementTemplateFrom({
          ...validProps,
          fields: { actionCode: validProps.fields.actionCode },
        }),
      ).toThrow(
        /"fields" must define at least one field with "input" true when "materialised" is false/,
      );
    });

    // The MongoDB driver stores an undefined key as null, so a template that
    // omits its optional keys comes back from Mongo with nulls in their place.
    // Rehydrating has to treat those as absent rather than as bad values.
    it("rehydrates a template whose optional keys came back from Mongo as null", () => {
      const template = entitlementTemplateFrom({
        ...materialisedProps,
        description: null,
        fields: null,
        claim: null,
      });

      expect(template.description).toBeUndefined();
      expect(template.fields).toBeUndefined();
      expect(template.claim).toBeUndefined();
    });

    it("accepts a materialised template that collects no input", () => {
      const template = entitlementTemplateFrom({
        ...materialisedProps,
        materialised: true,
      });

      expect(template.materialised).toBe(true);
    });
  });

  describe("fields", () => {
    const withField = (name, field) =>
      entitlementTemplateFrom({
        ...validProps,
        fields: { ...validProps.fields, [name]: field },
      });

    it("requires a label on a field that collects input", () => {
      expect(() =>
        withField("totalHectares", {
          input: true,
          unitType: "decimal",
          decimalPlaces: 4,
          unit: "HA",
        }),
      ).toThrow(/"fields.totalHectares.label" is required/);
    });

    it("rejects a label on a field the definition fixes", () => {
      expect(() =>
        withField("actionCode", {
          input: false,
          value: "PA3",
          label: "Action code",
          unitType: "string",
        }),
      ).toThrow(/"fields.actionCode.label" is not allowed/);
    });

    it("requires a value on a field the definition fixes", () => {
      expect(() =>
        withField("actionCode", { input: false, unitType: "string" }),
      ).toThrow(/"fields.actionCode.value" is required/);
    });

    it("rejects a value on a field that collects input", () => {
      expect(() =>
        withField("totalHectares", {
          input: true,
          label: "Total area of eligible woodland",
          value: 1,
          unitType: "decimal",
          decimalPlaces: 4,
          unit: "HA",
        }),
      ).toThrow(/"fields.totalHectares.value" is not allowed/);
    });

    it("rejects an unknown unit type", () => {
      expect(() =>
        withField("totalHectares", {
          input: true,
          label: "Total area of eligible woodland",
          unitType: "furlong",
        }),
      ).toThrow(/"fields.totalHectares.unitType" must be one of/);
    });

    it("requires decimalPlaces and unit on a decimal field", () => {
      expect(() =>
        withField("totalHectares", {
          input: true,
          label: "Total area of eligible woodland",
          unitType: "decimal",
        }),
      ).toThrow(/"fields.totalHectares.decimalPlaces" is required/);
    });

    it("rejects a length constraint on a decimal field", () => {
      expect(() =>
        withField("totalHectares", {
          input: true,
          label: "Total area of eligible woodland",
          unitType: "decimal",
          decimalPlaces: 4,
          unit: "HA",
          maxLength: 10,
        }),
      ).toThrow(/"fields.totalHectares.maxLength" is not allowed/);
    });

    it("rejects a numeric constraint on a string field", () => {
      expect(() =>
        withField("actionCode", {
          input: false,
          value: "PA3",
          unitType: "string",
          maxValue: 10,
        }),
      ).toThrow(/"fields.actionCode.maxValue" is not allowed/);
    });

    it("treats a null bound as no bound", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.fields.totalHectares.maxValue).toBeNull();
      expect(template.fields.actionCode.maxLength).toBeNull();
    });

    it("accepts a decimal field with no bounds at all", () => {
      const template = withField("totalHectares", {
        input: true,
        label: "Total area of eligible woodland",
        unitType: "decimal",
        decimalPlaces: 4,
        unit: "HA",
      });

      expect(template.fields.totalHectares.minValue).toBeUndefined();
      expect(template.fields.totalHectares.maxValue).toBeUndefined();
    });

    it("rejects an empty fields block", () => {
      expect(() =>
        entitlementTemplateFrom({ ...validProps, fields: {} }),
      ).toThrow(/"fields" must have at least 1 key/);
    });
  });

  describe("positions", () => {
    const claimableAt = [
      { phase: "PHASE_CLAIM", stage: "STAGE_AWAITING_CLAIM" },
    ];

    it("holds availableAt as PositionScopes", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.availableAt).toEqual(validProps.availableAt);
      expect(template.availableAt[0]).toBeInstanceOf(PositionScope);
    });

    it("holds claimableAt as PositionScopes and keeps the rest of the claim", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        claim: { ...validProps.claim, claimableAt },
      });

      expect(template.claim).toEqual({ ...validProps.claim, claimableAt });
      expect(template.claim.claimableAt[0]).toBeInstanceOf(PositionScope);
    });

    it("rejects a plain object given as an availableAt entry", () => {
      expect(() => new EntitlementTemplate(validProps)).toThrow(
        `Invalid entitlement template "${validProps.claimCode}": "availableAt" must contain only PositionScopes`,
      );
    });

    it("rejects a plain object given as a claimableAt entry", () => {
      const availableAt = validProps.availableAt.map(
        (scope) => new PositionScope(scope),
      );

      expect(
        () =>
          new EntitlementTemplate({
            ...validProps,
            availableAt,
            claim: { ...validProps.claim, claimableAt },
          }),
      ).toThrow(
        `Invalid entitlement template "${validProps.claimCode}": "claim.claimableAt" must contain only PositionScopes`,
      );
    });

    it("accepts PositionScopes", () => {
      const availableAt = validProps.availableAt.map(
        (scope) => new PositionScope(scope),
      );
      const scopes = claimableAt.map((scope) => new PositionScope(scope));

      const template = new EntitlementTemplate({
        ...validProps,
        availableAt,
        claim: { ...validProps.claim, claimableAt: scopes },
      });

      expect(template.availableAt).toBe(availableAt);
      expect(template.claim.claimableAt).toBe(scopes);
    });

    it("adds no claimableAt to a claim that declares none", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(Object.keys(template.claim)).not.toContain("claimableAt");
    });
  });

  describe("isAvailableAt", () => {
    it("returns true for the configured position", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.isAvailableAt(applicationPosition)).toBe(true);
    });

    it.each(["phase", "stage", "status"])(
      "returns false when the %s differs",
      (segment) => {
        const template = entitlementTemplateFrom(validProps);

        expect(
          template.isAvailableAt(
            new Position({
              ...availableAtPosition,
              [segment]: "SOMETHING_ELSE",
            }),
          ),
        ).toBe(false);
      },
    );

    it("returns false for a position that is not given", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.isAvailableAt(undefined)).toBe(false);
    });

    // An undeclared part matches anything, so a phase-only template is
    // available everywhere within its phase.
    it("matches any stage and status when only a phase is declared", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        availableAt: [{ phase: availableAtPosition.phase }],
      });

      expect(
        template.isAvailableAt(
          new Position({
            phase: availableAtPosition.phase,
            stage: "ANY_STAGE",
            status: "ANY_STATUS",
          }),
        ),
      ).toBe(true);
    });

    it("still requires the phase to match when only a phase is declared", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        availableAt: [{ phase: availableAtPosition.phase }],
      });

      expect(
        template.isAvailableAt(
          new Position({
            phase: "SOMETHING_ELSE",
            stage: availableAtPosition.stage,
            status: availableAtPosition.status,
          }),
        ),
      ).toBe(false);
    });

    it("matches any status when a phase and stage are declared", () => {
      const { phase, stage } = availableAtPosition;
      const template = entitlementTemplateFrom({
        ...validProps,
        availableAt: [{ phase, stage }],
      });

      expect(
        template.isAvailableAt(
          new Position({ phase, stage, status: "ANY_STATUS" }),
        ),
      ).toBe(true);
      expect(
        template.isAvailableAt(
          new Position({ phase, stage: "OTHER", status: "ANY_STATUS" }),
        ),
      ).toBe(false);
    });

    it("returns true when any listed position matches", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        availableAt: [
          availableAtPosition,
          {
            phase: "PHASE_CLAIM",
            stage: "STAGE_AWAITING_CLAIM",
            status: "STATUS_AWAITING_CLAIM",
          },
        ],
      });

      expect(
        template.isAvailableAt(
          new Position({
            phase: "PHASE_CLAIM",
            stage: "STAGE_AWAITING_CLAIM",
            status: "STATUS_AWAITING_CLAIM",
          }),
        ),
      ).toBe(true);
    });
  });

  describe("isClaimableAt", () => {
    const claimableAtPosition = {
      phase: "PHASE_CLAIM",
      stage: "STAGE_AWAITING_CLAIM",
      status: "STATUS_AWAITING_CLAIM",
    };
    const claimablePosition = new Position(claimableAtPosition);

    const withClaimableAt = (claimableAt) =>
      entitlementTemplateFrom({
        ...validProps,
        claim: { ...validProps.claim, claimableAt },
      });

    it("returns true for a configured claimable position", () => {
      const template = withClaimableAt([claimableAtPosition]);

      expect(template.isClaimableAt(claimablePosition)).toBe(true);
    });

    it("returns false when the application is not at a claimable position", () => {
      const template = withClaimableAt([claimableAtPosition]);

      expect(template.isClaimableAt(applicationPosition)).toBe(false);
    });

    it("returns false when claimableAt is absent", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.isClaimableAt(claimablePosition)).toBe(false);
    });

    it("returns true when any listed claimable position matches", () => {
      const template = withClaimableAt([
        availableAtPosition,
        claimableAtPosition,
      ]);

      expect(template.isClaimableAt(claimablePosition)).toBe(true);
    });
  });

  describe("inputFieldNames", () => {
    it("returns only the fields that collect input", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.inputFieldNames()).toEqual(["totalHectares"]);
    });

    it("returns nothing when the template has no fields", () => {
      const template = entitlementTemplateFrom({
        claimCode: "ENT_TRACTOR",
        name: "Tractor entitlement",
        availableAt: [
          {
            phase: "PHASE_CLAIM",
            stage: "STAGE_AWAITING_CLAIM",
            status: "STATUS_AWAITING_CLAIM",
          },
        ],
      });

      expect(template.inputFieldNames()).toEqual([]);
    });
  });

  describe("hasValidInputData", () => {
    it("accepts every input field with a valid value, wherever the application stands", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(
        template.hasValidInputData({ totalHectares: { value: 12.5 } }),
      ).toBe(true);
    });

    it("refuses a missing, unexpected or invalid field", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(template.hasValidInputData({})).toBe(false);
      expect(
        template.hasValidInputData({
          totalHectares: { value: 12.5 },
          actionCode: { value: "PA4" },
        }),
      ).toBe(false);
      expect(
        template.hasValidInputData({ totalHectares: { value: 0.1 } }),
      ).toBe(false);
    });
  });

  describe("assessEntitlementCreation", () => {
    const submittedData = { totalHectares: { value: 10 } };

    it("allows creation at an available position with the lowest free instance number", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        maxEntitlements: 3,
      });

      expect(
        template.assessEntitlementCreation(
          applicationPosition,
          [
            { claimCode: validProps.claimCode, instanceNumber: 1 },
            { claimCode: validProps.claimCode, instanceNumber: 3 },
            { claimCode: "ENT_OTHER", instanceNumber: 2 },
          ],
          submittedData,
        ),
      ).toEqual({ allowed: true, nextInstanceNumber: 2 });
    });

    it("rejects creation outside its available position", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(
        template.assessEntitlementCreation(
          new Position({ ...availableAtPosition, status: "OTHER_STATUS" }),
          [],
          submittedData,
        ),
      ).toEqual({ allowed: false, reason: "WRONG_POSITION" });
    });

    it("rejects creation from a materialised template", () => {
      const template = entitlementTemplateFrom({
        claimCode: "ENT_TRACTOR",
        name: "Tractor entitlement",
        availableAt: [availableAtPosition],
      });

      expect(
        template.assessEntitlementCreation(applicationPosition, [], {}),
      ).toEqual({ allowed: false, reason: "MATERIALISED_TEMPLATE" });
    });

    it("rejects data with missing or unexpected input fields", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(
        template.assessEntitlementCreation(applicationPosition, [], {}),
      ).toEqual({ allowed: false, reason: "INVALID_ENTITLEMENT_DATA" });
      expect(
        template.assessEntitlementCreation(applicationPosition, [], {
          ...submittedData,
          unexpected: { value: "value" },
        }),
      ).toEqual({ allowed: false, reason: "INVALID_ENTITLEMENT_DATA" });
    });

    it("accepts a decimal value on its inclusive boundaries", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        fields: {
          totalHectares: {
            ...validProps.fields.totalHectares,
            maxValue: 12.5,
          },
        },
      });

      expect(
        template.assessEntitlementCreation(applicationPosition, [], {
          totalHectares: { value: 0.5 },
        }),
      ).toMatchObject({ allowed: true });
      expect(
        template.assessEntitlementCreation(applicationPosition, [], {
          totalHectares: { value: 12.5 },
        }),
      ).toMatchObject({ allowed: true });
    });

    it("rejects decimal values with the wrong type, range or precision", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        fields: {
          totalHectares: {
            ...validProps.fields.totalHectares,
            maxValue: 12.5,
          },
        },
      });

      for (const value of ["12.5", 0.4999, 12.5001, 1.12345]) {
        expect(
          template.assessEntitlementCreation(applicationPosition, [], {
            totalHectares: { value },
          }),
        ).toEqual({ allowed: false, reason: "INVALID_ENTITLEMENT_DATA" });
      }
    });

    it("identifies input fields with invalid values", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(
        template.invalidInputFieldNames({
          totalHectares: { value: "not a decimal" },
        }),
      ).toEqual(["totalHectares"]);
    });

    it("enforces string field type and length constraints", () => {
      const template = entitlementTemplateFrom({
        ...validProps,
        fields: {
          actionCode: {
            input: true,
            label: "Action code",
            unitType: "string",
            minLength: 2,
            maxLength: 4,
          },
        },
      });

      for (const value of ["AB", "ABCD"]) {
        expect(
          template.assessEntitlementCreation(applicationPosition, [], {
            actionCode: { value },
          }),
        ).toMatchObject({ allowed: true });
      }

      for (const value of [12, "A", "ABCDE"]) {
        expect(
          template.assessEntitlementCreation(applicationPosition, [], {
            actionCode: { value },
          }),
        ).toEqual({ allowed: false, reason: "INVALID_ENTITLEMENT_DATA" });
      }
    });

    it("rejects creation when its capacity is reached", () => {
      const template = entitlementTemplateFrom(validProps);

      expect(
        template.assessEntitlementCreation(
          applicationPosition,
          [{ claimCode: validProps.claimCode, instanceNumber: 1 }],
          submittedData,
        ),
      ).toEqual({ allowed: false, reason: "CAPACITY_REACHED" });
    });
  });
});
