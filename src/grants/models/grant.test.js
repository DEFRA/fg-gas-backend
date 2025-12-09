import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";

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
