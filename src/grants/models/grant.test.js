import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { EntitlementTemplate } from "./entitlement-template.js";

describe("Grant", () => {
  it("can create a Grant model", () => {
    const grant = createTestGrant({
      code: "test-grant",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "APPLICATION_RECEIVED",
              statuses: [
                {
                  code: "APPLICATION_RECEIVED",
                  validFrom: [],
                },
                {
                  code: "IN_REVIEW",
                  validFrom: [
                    {
                      code: "APPLICATION_RECEIVED",
                      processes: ["STORE_AGREEMENT_CASE"],
                    },
                    {
                      code: "APPLICATION_REJECTED",
                      processes: [],
                    },
                    {
                      code: "ON_HOLD",
                      processes: [],
                    },
                  ],
                },
              ],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });

    expect(grant).toEqual({
      code: "test-grant",
      version: "0.0.0",
      metadata: {
        description: "Test Grant Description",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [
        { name: "action1", method: "POST", url: "http://example.com/action1" },
        { name: "action2", method: "GET", url: "http://example.com/action2" },
      ],
      amendablePositions: [],
      externalStatusMap: undefined,
      entitlementTemplates: [],
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "APPLICATION_RECEIVED",
              statuses: [
                {
                  code: "APPLICATION_RECEIVED",
                  validFrom: [],
                },
                {
                  code: "IN_REVIEW",
                  validFrom: [
                    {
                      code: "APPLICATION_RECEIVED",
                      processes: ["STORE_AGREEMENT_CASE"],
                    },
                    {
                      code: "APPLICATION_REJECTED",
                      processes: [],
                    },
                    {
                      code: "ON_HOLD",
                      processes: [],
                    },
                  ],
                },
              ],
            },
          ],
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        },
      ],
    });
  });

  describe("pages", () => {
    const pages = {
      claims: {
        details: {
          banner: {
            title: {
              text: "$.answers.applicant.business.name",
              type: "string",
            },
          },
        },
      },
    };

    it("keeps the pages a definition configures", () => {
      const grant = createTestGrant({ pages });

      expect(grant.pages).toEqual(pages);
    });

    it("has no pages when the definition configures none", () => {
      const grant = createTestGrant({ pages: undefined });

      expect(grant.pages).toBeUndefined();
    });
  });

  describe("entitlementTemplates", () => {
    const entitlementTemplates = [
      {
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
        },
        maxEntitlements: 1,
        availableAt: {
          phase: "PRE_AWARD",
          stage: "ASSESSMENT",
          status: "APPLICATION_RECEIVED",
        },
        claim: {
          limits: { maximumClaims: 1, allowsPartialClaims: false },
          requiresApproval: false,
          requiresEvidence: false,
        },
      },
    ];

    it("wraps entitlementTemplates passed to the constructor as EntitlementTemplate instances", () => {
      const grant = createTestGrant({ entitlementTemplates });

      expect(grant.entitlementTemplates).toEqual(entitlementTemplates);
      expect(grant.entitlementTemplates[0]).toBeInstanceOf(EntitlementTemplate);
    });

    // The repository normalises a missing or null stored field to an empty
    // array, and everything else that builds a Grant simply omits the block, so
    // the model never sees anything but a collection.
    it("is an empty collection when entitlementTemplates is not provided", () => {
      const grant = createTestGrant({ entitlementTemplates: undefined });

      expect(grant.entitlementTemplates).toEqual([]);
    });

    it("throws when an entitlement template has an invalid shape", () => {
      expect(() =>
        createTestGrant({
          entitlementTemplates: [{ claimCode: "INVALID" }],
        }),
      ).toThrow(/Invalid entitlement template "INVALID"/);
    });

    it.each([
      ["phase", "UNKNOWN:ASSESSMENT:APPLICATION_RECEIVED"],
      ["stage", "PRE_AWARD:UNKNOWN:APPLICATION_RECEIVED"],
      ["status", "PRE_AWARD:ASSESSMENT:UNKNOWN"],
    ])(
      "throws when an entitlement template is available at a %s that does not exist in phases",
      (segment, position) => {
        expect(() =>
          createTestGrant({
            entitlementTemplates: [
              {
                ...entitlementTemplates[0],
                availableAt: {
                  ...entitlementTemplates[0].availableAt,
                  [segment]: "UNKNOWN",
                },
              },
            ],
          }),
        ).toThrow(
          new RegExp(
            `is available at position "${position}" which does not match any position`,
          ),
        );
      },
    );

    // A partial availableAt is checked only as deep as it goes, so a phase-only
    // template is valid whenever the phase itself exists.
    it.each([
      ["phase only", { phase: "PRE_AWARD" }],
      ["phase and stage", { phase: "PRE_AWARD", stage: "ASSESSMENT" }],
    ])(
      "accepts an entitlement template available at a %s",
      (_, availableAt) => {
        const grant = createTestGrant({
          entitlementTemplates: [{ ...entitlementTemplates[0], availableAt }],
        });

        expect(grant.entitlementTemplates[0].availableAt).toEqual(availableAt);
      },
    );

    it.each([
      ["phase", { phase: "UNKNOWN" }, "UNKNOWN"],
      ["stage", { phase: "PRE_AWARD", stage: "UNKNOWN" }, "PRE_AWARD:UNKNOWN"],
    ])(
      "throws when a partial position names a %s that does not exist in phases",
      (_, availableAt, position) => {
        expect(() =>
          createTestGrant({
            entitlementTemplates: [{ ...entitlementTemplates[0], availableAt }],
          }),
        ).toThrow(
          new RegExp(
            `is available at position "${position}" which does not match any position`,
          ),
        );
      },
    );

    it("throws when two entitlement templates share a claim code", () => {
      expect(() =>
        createTestGrant({
          entitlementTemplates: [
            entitlementTemplates[0],
            { ...entitlementTemplates[0], name: "A duplicate" },
          ],
        }),
      ).toThrow(
        /Duplicate entitlement template claim code "ENT_CS_CAPITAL_PA3"/,
      );
    });

    describe("findEntitlementTemplate", () => {
      it("returns the entitlement template matching the given claim code", () => {
        const grant = createTestGrant({ entitlementTemplates });

        expect(grant.findEntitlementTemplate("ENT_CS_CAPITAL_PA3")).toEqual(
          entitlementTemplates[0],
        );
      });

      it("returns undefined when no entitlement template matches", () => {
        const grant = createTestGrant({ entitlementTemplates });

        expect(grant.findEntitlementTemplate("UNKNOWN")).toBeUndefined();
      });
    });

    describe("findEntitlementTemplatesAvailableAt", () => {
      // A second template at a different position, so the filter has something
      // to leave behind.
      const inReview = {
        claimCode: "ENT_TRACTOR",
        name: "Tractor entitlement",
        availableAt: {
          phase: "PRE_AWARD",
          stage: "ASSESSMENT",
          status: "IN_REVIEW",
        },
      };

      it("returns only the templates available at the given position", () => {
        const grant = createTestGrant({
          entitlementTemplates: [...entitlementTemplates, inReview],
        });

        const available = grant.findEntitlementTemplatesAvailableAt({
          phase: "PRE_AWARD",
          stage: "ASSESSMENT",
          status: "IN_REVIEW",
        });

        expect(available.map((t) => t.claimCode)).toEqual(["ENT_TRACTOR"]);
      });

      it("returns nothing when no template is available at the position", () => {
        const grant = createTestGrant({ entitlementTemplates });

        expect(
          grant.findEntitlementTemplatesAvailableAt({
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "IN_REVIEW",
          }),
        ).toEqual([]);
      });

      it("returns nothing when the grant has no entitlement templates", () => {
        const grant = createTestGrant({ entitlementTemplates: undefined });

        expect(
          grant.findEntitlementTemplatesAvailableAt({
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "APPLICATION_RECEIVED",
          }),
        ).toEqual([]);
      });
    });
  });

  describe("hasPhases", () => {
    it("returns true when grant has phases", () => {
      const grant = createTestGrant();

      expect(grant.hasPhases).toBe(true);
    });

    it("returns false when grant has empty phases array", () => {
      const grant = createTestGrant({
        phases: [],
      });

      expect(grant.hasPhases).toBe(false);
    });

    it("returns false when grant has no phases", () => {
      const grant = createTestGrant({
        phases: undefined,
      });

      expect(grant.hasPhases).toBe(false);
    });
  });

  describe("getInitialState", () => {
    it("returns the initial state from the first phase, stage, and status", () => {
      const grant = createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
              },
            ],
          },
        ],
      });

      const initialState = grant.getInitialState();

      expect(initialState).toEqual({
        phase: {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
            },
          ],
        },
        stage: {
          code: "ASSESSMENT",
          statuses: [{ code: "RECEIVED" }, { code: "REVIEW" }],
        },
        status: { code: "RECEIVED" },
      });
    });

    it("throws error when grant has no phases", () => {
      const grant = createTestGrant({
        phases: [],
      });

      expect(() => grant.getInitialState()).toThrow(
        'Grant "test-grant" has no phases defined',
      );
    });
  });

  describe("mapExternalStateToInternalState", () => {
    const grantWithExternalMap = createTestGrant({
      code: "test-grant-with-mapping",
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  {
                    code: "IN_PROGRESS",
                    source: "CW",
                    mappedTo: "::IN_PROGRESS",
                  },
                  {
                    code: "APPROVED",
                    source: "CW",
                    mappedTo: "::APPROVED",
                  },
                  {
                    code: "WITHDRAWN",
                    source: "CW",
                    mappedTo: "::APPLICATION_WITHDRAWN",
                  },
                  {
                    code: "offered",
                    source: "AS",
                    mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFERED",
                  },
                  {
                    code: "accepted",
                    source: "AS",
                    mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFER_ACCEPTED",
                  },
                  {
                    code: "SIMPLE_STATUS",
                    source: "CW",
                    mappedTo: "RECEIVED",
                  },
                ],
              },
            ],
          },
          {
            code: "AWARD_AND_MONITORING",
            stages: [
              {
                code: "MONITORING",
                statuses: [
                  {
                    code: "ACTIVE",
                    source: "CW",
                    mappedTo: "::ACTIVE",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    describe("when external status is mapped with :: prefix (keep phase and stage)", () => {
      it("should map CW IN_PROGRESS to same phase and stage", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "IN_PROGRESS",
          "CW",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_APPLICATION",
          targetStatus: "IN_PROGRESS",
        });
      });

      it("should map CW APPROVED to same phase and stage", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "APPROVED",
          "CW",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_APPLICATION",
          targetStatus: "APPROVED",
        });
      });

      it("should map CW WITHDRAWN to APPLICATION_WITHDRAWN status", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "WITHDRAWN",
          "CW",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_APPLICATION",
          targetStatus: "APPLICATION_WITHDRAWN",
        });
      });
    });

    describe("when external status is mapped with full path (PHASE:STAGE:STATUS)", () => {
      it("should map AS offered to PRE_AWARD:REVIEW_OFFER:OFFERED", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "offered",
          "AS",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_OFFER",
          targetStatus: "OFFERED",
        });
      });

      it("should map AS accepted to PRE_AWARD:REVIEW_OFFER:OFFER_ACCEPTED", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "accepted",
          "AS",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_OFFER",
          targetStatus: "OFFER_ACCEPTED",
        });
      });
    });

    describe("when external status is mapped with simple status (no prefix, no colons)", () => {
      it("should map CW SIMPLE_STATUS to RECEIVED with same phase and stage", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "SIMPLE_STATUS",
          "CW",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "PRE_AWARD",
          targetStage: "REVIEW_APPLICATION",
          targetStatus: "RECEIVED",
        });
      });
    });

    describe("when external status is not mapped", () => {
      it("should return invalid when source system doesn't match", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "IN_PROGRESS",
          "UNKNOWN_SYSTEM",
        );

        expect(result).toEqual({ valid: false });
      });

      it("should return invalid when status code doesn't exist", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "UNKNOWN_STATUS",
          "CW",
        );

        expect(result).toEqual({ valid: false });
      });

      it("should return invalid when phase doesn't exist in map", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "UNKNOWN_PHASE",
          "REVIEW_APPLICATION",
          "IN_PROGRESS",
          "CW",
        );

        expect(result).toEqual({ valid: false });
      });

      it("should return invalid when stage doesn't exist in map", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "UNKNOWN_STAGE",
          "IN_PROGRESS",
          "CW",
        );

        expect(result).toEqual({ valid: false });
      });
    });

    describe("when grant has no external status map", () => {
      it("should return invalid", () => {
        const grantWithoutMap = createTestGrant({
          code: "test-grant-no-map",
        });

        const result = grantWithoutMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "IN_PROGRESS",
          "CW",
        );

        expect(result).toEqual({ valid: false });
      });
    });

    describe("different phase and stage scenarios", () => {
      it("should map status in different phase and stage", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "AWARD_AND_MONITORING",
          "MONITORING",
          "ACTIVE",
          "CW",
        );

        expect(result).toEqual({
          valid: true,
          targetPhase: "AWARD_AND_MONITORING",
          targetStage: "MONITORING",
          targetStatus: "ACTIVE",
        });
      });
    });
  });

  describe("isValidTransition", () => {
    const grantWithValidFrom = createTestGrant({
      code: "test-grant-transitions",
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                { code: "RECEIVED" },
                {
                  code: "IN_PROGRESS",
                  validFrom: [
                    {
                      code: "RECEIVED",
                      processes: [],
                    },
                  ],
                },
                {
                  code: "APPROVED",
                  validFrom: [
                    {
                      code: "IN_PROGRESS",
                      processes: ["GENERATE_OFFER"],
                    },
                  ],
                },
                {
                  code: "REJECTED",
                  validFrom: [
                    {
                      code: "IN_PROGRESS",
                      processes: [],
                    },
                  ],
                },
                {
                  code: "WITHDRAWN",
                  validFrom: [
                    {
                      code: "RECEIVED",
                      processes: [],
                    },
                    {
                      code: "IN_PROGRESS",
                      processes: [],
                    },
                    {
                      code: "APPROVED",
                      processes: [],
                    },
                  ],
                },
              ],
            },
            {
              code: "REVIEW_OFFER",
              statuses: [
                {
                  code: "OFFERED",
                  validFrom: [
                    {
                      code: "PRE_AWARD:REVIEW_APPLICATION:APPROVED",
                      processes: ["SEND_OFFER_EMAIL"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    it("should allow transition when current status is in validFrom", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "IN_PROGRESS",
        "RECEIVED",
      );

      expect(result).toEqual({
        valid: true,
        processes: [],
      });
    });

    it("should deny transition when current status is not in validFrom", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "APPROVED",
        "RECEIVED",
      );

      expect(result).toEqual({
        valid: false,
        processes: undefined,
      });
    });

    it("should return processes when transition is valid", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "APPROVED",
        "IN_PROGRESS",
      );

      expect(result).toEqual({
        valid: true,
        processes: ["GENERATE_OFFER"],
      });
    });

    it("should allow transition when validFrom contains multiple statuses", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "WITHDRAWN",
        "APPROVED",
      );

      expect(result).toEqual({
        valid: true,
        processes: [],
      });
    });

    it("should allow transition when validFrom is empty", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "RECEIVED",
        "ANY_STATUS",
      );

      expect(result).toEqual({
        valid: true,
        processes: [],
      });
    });

    it("should handle fully qualified status in validFrom", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_OFFER",
        "OFFERED",
        "PRE_AWARD:REVIEW_APPLICATION:APPROVED",
      );

      expect(result).toEqual({
        valid: true,
        processes: ["SEND_OFFER_EMAIL"],
      });
    });

    it("should match simple status code from fully qualified current status", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "IN_PROGRESS",
        "PRE_AWARD:REVIEW_APPLICATION:RECEIVED",
      );

      expect(result).toEqual({
        valid: true,
        processes: [],
      });
    });

    it("should return invalid when phase does not exist", () => {
      const result = grantWithValidFrom.isValidTransition(
        "UNKNOWN_PHASE",
        "REVIEW_APPLICATION",
        "IN_PROGRESS",
        "RECEIVED",
      );

      expect(result).toEqual({
        valid: false,
        processes: [],
      });
    });

    it("should return invalid when stage does not exist", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "UNKNOWN_STAGE",
        "IN_PROGRESS",
        "RECEIVED",
      );

      expect(result).toEqual({
        valid: false,
        processes: [],
      });
    });

    it("should return invalid when status does not exist", () => {
      const result = grantWithValidFrom.isValidTransition(
        "PRE_AWARD",
        "REVIEW_APPLICATION",
        "UNKNOWN_STATUS",
        "RECEIVED",
      );

      expect(result).toEqual({
        valid: false,
        processes: [],
      });
    });
  });

  describe("findStatuses", () => {
    const grant = createTestGrant({
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [
                { code: "RECEIVED" },
                { code: "IN_PROGRESS" },
                { code: "APPROVED" },
              ],
            },
          ],
        },
      ],
    });

    it("should return map of statuses for a given phase and stage", () => {
      const result = grant.findStatuses({
        phase: "PRE_AWARD",
        stage: "ASSESSMENT",
      });

      expect(result).toEqual({
        RECEIVED: { code: "RECEIVED" },
        IN_PROGRESS: { code: "IN_PROGRESS" },
        APPROVED: { code: "APPROVED" },
      });
    });

    it("should return empty object when phase does not exist", () => {
      const result = grant.findStatuses({
        phase: "UNKNOWN_PHASE",
        stage: "ASSESSMENT",
      });

      expect(result).toEqual({});
    });

    it("should return empty object when stage does not exist", () => {
      const result = grant.findStatuses({
        phase: "PRE_AWARD",
        stage: "UNKNOWN_STAGE",
      });

      expect(result).toEqual({});
    });
  });
});
