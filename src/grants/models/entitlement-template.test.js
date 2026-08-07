import { describe, expect, it } from "vitest";
import { EntitlementTemplate } from "./entitlement-template.js";

const validProps = {
  code: "ENT_CS_CAPITAL_PA3",
  name: "PA3 Woodland Management Plan entitlement",
  description:
    "The maximum eligible woodland area that can be claimed under PA3.",
  appliesTo: { level: "AGREEMENT", itemCode: null },
  limit: { field: "limitQuantity", unit: "HA" },
  creation: {
    availableAt: ["PHASE_PRE_AWARD:STAGE_PREPARE_CLAIM:STATUS_PREPARING_CLAIM"],
    onCreated: {
      targetPosition: "PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM",
    },
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        limitQuantity: { type: "number", minimum: 3, maximum: 10000 },
      },
    },
    form: {
      content: [{ component: "input", field: "limitQuantity" }],
    },
  },
  claim: {
    availableAt: ["PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM"],
    limits: { maximumClaims: 1, allowsPartialClaims: false },
    onCreated: {
      targetPosition: "PHASE_CLAIM:STAGE_CLAIM_COMPLETE:STATUS_CLAIM_COMPLETE",
    },
    payment: {
      calculationAction: "calculate-capital-claim",
      trigger: "ON_CLAIM_CREATED",
    },
  },
};

describe("EntitlementTemplate", () => {
  it("constructs from valid props", () => {
    const template = new EntitlementTemplate(validProps);

    expect(template).toEqual(validProps);
  });

  it("throws Boom.badImplementation when a required field is missing", () => {
    expect(
      () => new EntitlementTemplate({ code: "ENT_MISSING_FIELDS" }),
    ).toThrow(/Invalid entitlement template "ENT_MISSING_FIELDS"/);
  });

  it("strips unknown fields", () => {
    const template = new EntitlementTemplate({
      ...validProps,
      somethingUnexpected: true,
    });

    expect(template).not.toHaveProperty("somethingUnexpected");
  });

  describe("optional blocks", () => {
    // Everything needed to create an entitlement, and nothing else: no
    // description, no limit (not a quantitative entitlement), no onCreated (no
    // transition on creation) and no claim block at all.
    const minimalProps = {
      code: "ENT_MINIMAL",
      name: "Minimal entitlement",
      appliesTo: { level: "AGREEMENT" },
      creation: {
        availableAt: ["PHASE:STAGE:STATUS"],
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
        form: { content: [{ component: "heading", text: "Confirm" }] },
      },
    };

    it("constructs from the minimal set of fields needed to create an entitlement", () => {
      const template = new EntitlementTemplate(minimalProps);

      expect(template.code).toBe("ENT_MINIMAL");
      expect(template.description).toBeUndefined();
      expect(template.limit).toBeUndefined();
      expect(template.claim).toBeUndefined();
    });

    it("reports no target positions when nothing transitions", () => {
      const template = new EntitlementTemplate(minimalProps);

      expect(template.creationTargetPosition).toBeUndefined();
      expect(template.claimTargetPosition).toBeUndefined();
      expect(template.referencedPositions()).toEqual(["PHASE:STAGE:STATUS"]);
    });

    it("is never claimable when it has no claim block", () => {
      const template = new EntitlementTemplate(minimalProps);

      expect(template.isAvailableForClaimAt("PHASE:STAGE:STATUS")).toBe(false);
    });

    it("defaults claim limits to a single whole claim", () => {
      const template = new EntitlementTemplate({
        ...minimalProps,
        claim: { availableAt: ["PHASE:STAGE:STATUS"] },
      });

      expect(template.claim.limits).toEqual({
        maximumClaims: 1,
        allowsPartialClaims: false,
      });
    });

    it("accepts a claim block with no payment", () => {
      const template = new EntitlementTemplate({
        ...minimalProps,
        claim: { availableAt: ["PHASE:STAGE:STATUS"] },
      });

      expect(template.claim.payment).toBeUndefined();
    });
  });

  describe("input schema references", () => {
    it("rejects a limit.field that no inputSchema property defines", () => {
      expect(
        () =>
          new EntitlementTemplate({
            ...validProps,
            limit: { field: "notAProperty", unit: "HA" },
          }),
      ).toThrow(
        /"limit.field" \("notAProperty"\) does not match any property in "creation.inputSchema"/,
      );
    });

    it("rejects a form component bound to a field no inputSchema property defines", () => {
      expect(
        () =>
          new EntitlementTemplate({
            ...validProps,
            creation: {
              ...validProps.creation,
              form: { content: [{ component: "input", field: "notAField" }] },
            },
          }),
      ).toThrow(
        /"creation.form" field \("notAField"\) does not match any property in "creation.inputSchema"/,
      );
    });

    it("requires the form to render at least one component", () => {
      expect(
        () =>
          new EntitlementTemplate({
            ...validProps,
            creation: { ...validProps.creation, form: { content: [] } },
          }),
      ).toThrow(/"creation.form.content" must contain at least 1 items/);
    });
  });

  describe("isAvailableForCreationAt", () => {
    it("returns true when the position is in creation.availableAt", () => {
      const template = new EntitlementTemplate(validProps);

      expect(
        template.isAvailableForCreationAt(
          "PHASE_PRE_AWARD:STAGE_PREPARE_CLAIM:STATUS_PREPARING_CLAIM",
        ),
      ).toBe(true);
    });

    it("returns false when the position is not in creation.availableAt", () => {
      const template = new EntitlementTemplate(validProps);

      expect(template.isAvailableForCreationAt("UNKNOWN:UNKNOWN:UNKNOWN")).toBe(
        false,
      );
    });
  });

  describe("isAvailableForClaimAt", () => {
    it("returns true when the position is in claim.availableAt", () => {
      const template = new EntitlementTemplate(validProps);

      expect(
        template.isAvailableForClaimAt(
          "PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM",
        ),
      ).toBe(true);
    });

    it("returns false when the position is not in claim.availableAt", () => {
      const template = new EntitlementTemplate(validProps);

      expect(template.isAvailableForClaimAt("UNKNOWN:UNKNOWN:UNKNOWN")).toBe(
        false,
      );
    });
  });

  describe("creationTargetPosition / claimTargetPosition", () => {
    it("exposes the configured onCreated target positions", () => {
      const template = new EntitlementTemplate(validProps);

      expect(template.creationTargetPosition).toBe(
        "PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM",
      );
      expect(template.claimTargetPosition).toBe(
        "PHASE_CLAIM:STAGE_CLAIM_COMPLETE:STATUS_CLAIM_COMPLETE",
      );
    });
  });

  describe("referencedPositions", () => {
    it("returns every position referenced by creation and claim", () => {
      const template = new EntitlementTemplate(validProps);

      expect(template.referencedPositions()).toEqual([
        "PHASE_PRE_AWARD:STAGE_PREPARE_CLAIM:STATUS_PREPARING_CLAIM",
        "PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM",
        "PHASE_CLAIM:STAGE_AWAITING_CLAIM:STATUS_AWAITING_CLAIM",
        "PHASE_CLAIM:STAGE_CLAIM_COMPLETE:STATUS_CLAIM_COMPLETE",
      ]);
    });
  });
});
