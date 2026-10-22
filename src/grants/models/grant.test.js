import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { EntitlementTemplate } from "./entitlement-template.js";
import { Grant } from "./grant.js";

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

  describe("fromDefinition", () => {
    const definition = () => ({
      code: "test-grant",
      metadata: {
        description: "Test Grant",
        startDate: "2023-01-01T00:00:00Z",
      },
      actions: [],
      amendablePositions: ["PRE_AWARD:ASSESSMENT:IN_REVIEW"],
      phases: [
        {
          code: "PRE_AWARD",
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [
                { code: "APPLICATION_RECEIVED", validFrom: [] },
                {
                  code: "IN_REVIEW",
                  validFrom: [{ code: "APPLICATION_RECEIVED", processes: [] }],
                },
                {
                  code: "OFFERED",
                  validFrom: [
                    {
                      code: "PRE_AWARD:ASSESSMENT:IN_REVIEW",
                      processes: ["GENERATE_OFFER"],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          code: "POST_AGREEMENT",
          stages: [
            {
              code: "MONITORING",
              statuses: [
                {
                  code: "ACCEPTED",
                  validFrom: [],
                  processes: ["ACCEPT_AGREEMENT"],
                },
              ],
            },
          ],
        },
      ],
      externalStatusMap: {
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [
                  { code: "IN_REVIEW", source: "CW", mappedTo: "::IN_REVIEW" },
                  { code: "OFFER", source: "CW", mappedTo: "OFFERED" },
                  {
                    code: "accepted",
                    source: "AS",
                    mappedTo: "POST_AGREEMENT:MONITORING:ACCEPTED",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const dependencies = {
      isKnownProcess: (process) =>
        ["GENERATE_OFFER", "ACCEPT_AGREEMENT"].includes(process),
      compileQuestions: () => {},
    };

    const fromDefinition = (published, overrides = {}) =>
      Grant.fromDefinition(published, "1.2.0", {
        ...dependencies,
        ...overrides,
      });

    const withStatus = (published, status) => {
      published.phases[0].stages[0].statuses.push(status);
      return published;
    };

    const withMapping = (published, mappedTo) => {
      published.externalStatusMap.phases[0].stages[0].statuses.push({
        code: "EXTERNAL",
        source: "CW",
        mappedTo,
      });
      return published;
    };

    it("builds a Grant from a published definition", () => {
      const grant = fromDefinition(definition());

      expect(grant).toBeInstanceOf(Grant);
      expect(grant.code).toBe("test-grant");
      expect(grant.metadata.description).toBe("Test Grant");
    });

    it("stamps the version it is given", () => {
      expect(fromDefinition(definition()).version).toBe("1.2.0");
    });

    // The config catalog owns the version, so a definition cannot set its own.
    it("ignores a version carried on the definition", () => {
      const grant = fromDefinition({ ...definition(), version: "9.9.9" });

      expect(grant.version).toBe("1.2.0");
    });

    it("defaults amendablePositions to none when a definition has no list", () => {
      const { amendablePositions, ...withoutList } = definition();

      expect(fromDefinition(withoutList).amendablePositions).toEqual([]);
    });

    it("defaults entitlementTemplates to an empty collection", () => {
      expect(fromDefinition(definition()).entitlementTemplates).toEqual([]);
    });

    it("accepts a start date written as Mongo extended JSON", () => {
      const published = definition();
      published.metadata.startDate = { $date: "2100-01-01T00:00:00Z" };

      expect(() => fromDefinition(published)).not.toThrow();
    });

    it("accepts empty external status maps and pages", () => {
      expect(() =>
        fromDefinition({ ...definition(), externalStatusMap: {}, pages: {} }),
      ).not.toThrow();
    });

    it("accepts empty phases, stages and statuses in the external status map", () => {
      const published = definition();
      published.externalStatusMap.phases.push(
        { code: "POST_AGREEMENT", stages: [] },
        { code: "PRE_AWARD_EXTRA", stages: [{ code: "REVIEW", statuses: [] }] },
      );

      expect(() => fromDefinition(published)).not.toThrow();
    });

    it("accepts keys the runtime does not read", () => {
      expect(() =>
        fromDefinition({ ...definition(), _id: "abc" }),
      ).not.toThrow();
    });

    it("rejects a definition that does not match the schema", () => {
      const published = definition();
      published.actions = [
        { name: "validate", method: "DELETE", url: "http://localhost" },
      ];

      expect(() => fromDefinition(published)).toThrow(
        /Invalid grant definition "test-grant": .*"ActionMethod" must be one of \[GET, POST\]/,
      );
    });

    it("rejects a definition the Grant model considers invalid", () => {
      const published = definition();
      published.claims = {
        onClaimApproval: {
          currentPosition: {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "MISSING",
          },
          targetPosition: {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "IN_REVIEW",
          },
        },
      };

      expect(() => fromDefinition(published)).toThrow(
        /claims.onClaimApproval.currentPosition/,
      );
    });

    it("rejects a phase code used twice", () => {
      const published = definition();
      published.phases.push({
        code: "PRE_AWARD",
        stages: [{ code: "HOLD", statuses: [{ code: "HELD", validFrom: [] }] }],
      });

      expect(() => fromDefinition(published)).toThrow(
        'Grant "test-grant" phase "PRE_AWARD" is defined more than once',
      );
    });

    const withNamedStatus = (name) =>
      withStatus(definition(), {
        code: "HELD",
        name,
        validFrom: [{ code: "APPLICATION_RECEIVED", processes: [] }],
      });

    it("accepts a status with a name", () => {
      expect(() => fromDefinition(withNamedStatus("Held"))).not.toThrow();
    });

    it.each([
      ["empty", ""],
      ["not text", { en: "Held" }],
    ])("rejects a status whose name is %s", (_, name) => {
      expect(() => fromDefinition(withNamedStatus(name))).toThrow(
        'Invalid grant definition "test-grant"',
      );
    });

    it("rejects a validFrom that does not exist", () => {
      const published = withStatus(definition(), {
        code: "HELD",
        validFrom: [
          { code: "PRE_AWARD:OTHER:APPLICATION_RECEIVED", processes: [] },
        ],
      });

      expect(() => fromDefinition(published)).toThrow(
        'Grant "test-grant" status "PRE_AWARD:ASSESSMENT:HELD" is valid from "PRE_AWARD:OTHER:APPLICATION_RECEIVED" which does not match any position in "phases"',
      );
    });

    it("rejects a status whose own processes would never run", () => {
      const published = withStatus(definition(), {
        code: "HELD",
        validFrom: [{ code: "APPLICATION_RECEIVED", processes: [] }],
        processes: ["GENERATE_OFFER"],
      });

      expect(() => fromDefinition(published)).toThrow(
        'Grant "test-grant" status "PRE_AWARD:ASSESSMENT:HELD" has its own processes, which would never run because it has validFrom',
      );
    });

    it("rejects a validFrom process that is not known", () => {
      const published = withStatus(definition(), {
        code: "HELD",
        validFrom: [{ code: "APPLICATION_RECEIVED", processes: ["UNKNOWN"] }],
      });

      expect(() => fromDefinition(published)).toThrow(
        'Grant "test-grant" status "PRE_AWARD:ASSESSMENT:HELD" runs unknown process "UNKNOWN"',
      );
    });

    it.each([
      ["a phase code", "PRE_AWARD"],
      ["a missing status", "PRE_AWARD:ASSESSMENT:MISSING"],
    ])("rejects an amendable position that is %s", (_label, position) => {
      const published = definition();
      published.amendablePositions.push(position);

      expect(() => fromDefinition(published)).toThrow(
        `Grant "test-grant" amendable position "${position}" does not match any position in "phases"`,
      );
    });

    it("rejects an external status mapped to a position that does not exist", () => {
      const published = withMapping(definition(), "::MISSING");

      expect(() => fromDefinition(published)).toThrow(
        'Grant "test-grant" CW status "EXTERNAL" at "PRE_AWARD:ASSESSMENT" is mapped to "::MISSING" which does not match any position in "phases"',
      );
    });

    it("lets a failure that is not about the definition through unchanged", () => {
      const failure = new Error("process registry unavailable");
      const isKnownProcess = () => {
        throw failure;
      };

      expect(() => fromDefinition(definition(), { isKnownProcess })).toThrow(
        failure,
      );
    });

    it("rejects questions that cannot be compiled", () => {
      const published = definition();
      published.phases[1].questions = { type: "object" };
      const compileQuestions = (questions) => {
        if (!questions.$schema) {
          throw new Error("no $schema");
        }
      };

      expect(() => fromDefinition(published, { compileQuestions })).toThrow(
        'Grant "test-grant" phase "POST_AGREEMENT" questions cannot be compiled: no $schema',
      );
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

  describe("claims", () => {
    const currentPosition = {
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "APPLICATION_RECEIVED",
    };
    const targetPosition = {
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "IN_REVIEW",
    };
    const claims = {
      onClaimApproval: { currentPosition, targetPosition },
    };

    it("keeps the configured claim approval transition", () => {
      const grant = createTestGrant({ claims });

      expect(grant.claims).toEqual(claims);
    });

    it.each([
      ["currentPosition", "phase"],
      ["currentPosition", "stage"],
      ["currentPosition", "status"],
      ["targetPosition", "phase"],
      ["targetPosition", "stage"],
      ["targetPosition", "status"],
    ])(
      "throws when claims.onClaimApproval.%s is missing %s",
      (positionName, missingPart) => {
        const incompletePosition = {
          ...(positionName === "currentPosition"
            ? currentPosition
            : targetPosition),
        };
        delete incompletePosition[missingPart];

        expect(() =>
          createTestGrant({
            claims: {
              onClaimApproval: {
                currentPosition,
                targetPosition,
                [positionName]: incompletePosition,
              },
            },
          }),
        ).toThrow(
          `Grant "test-grant" claims.onClaimApproval.${positionName}.${missingPart} must be a non-empty string`,
        );
      },
    );

    it.each([
      ["currentPosition", "phase"],
      ["currentPosition", "stage"],
      ["currentPosition", "status"],
      ["targetPosition", "phase"],
      ["targetPosition", "stage"],
      ["targetPosition", "status"],
    ])(
      "throws when claims.onClaimApproval.%s has an empty %s",
      (positionName, emptyPart) => {
        const position =
          positionName === "currentPosition" ? currentPosition : targetPosition;

        expect(() =>
          createTestGrant({
            claims: {
              onClaimApproval: {
                currentPosition,
                targetPosition,
                [positionName]: { ...position, [emptyPart]: " " },
              },
            },
          }),
        ).toThrow(
          `Grant "test-grant" claims.onClaimApproval.${positionName}.${emptyPart} must be a non-empty string`,
        );
      },
    );

    it.each(["currentPosition", "targetPosition"])(
      "throws when %s does not exist in phases",
      (positionName) => {
        expect(() =>
          createTestGrant({
            claims: {
              onClaimApproval: {
                currentPosition,
                targetPosition,
                [positionName]: { ...currentPosition, status: "UNKNOWN" },
              },
            },
          }),
        ).toThrow(
          new RegExp(
            `claims.onClaimApproval.${positionName} "PRE_AWARD:ASSESSMENT:UNKNOWN" does not match any position`,
          ),
        );
      },
    );

    it("throws when the target does not allow the configured current position", () => {
      expect(() =>
        createTestGrant({
          claims,
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "ASSESSMENT",
                  statuses: [
                    { code: "APPLICATION_RECEIVED", validFrom: [] },
                    {
                      code: "IN_REVIEW",
                      validFrom: [{ code: "SOME_OTHER_STATUS" }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ).toThrow(
        'claims.onClaimApproval target position "PRE_AWARD:ASSESSMENT:IN_REVIEW" is not a valid transition from "PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED"',
      );
    });

    it("returns the target for an exact current-position match", () => {
      const grant = createTestGrant({ claims });

      expect(grant.claimApprovalTransitionFor(currentPosition)).toEqual(
        targetPosition,
      );
    });

    it("returns null when no claim approval transition is configured", () => {
      expect(
        createTestGrant().claimApprovalTransitionFor(currentPosition),
      ).toBeNull();
    });

    it.each([
      ["phase", "UNKNOWN"],
      ["stage", "UNKNOWN"],
      ["status", "IN_REVIEW"],
    ])("returns null when the %s does not match", (part, value) => {
      const grant = createTestGrant({ claims });

      expect(
        grant.claimApprovalTransitionFor({
          ...currentPosition,
          [part]: value,
        }),
      ).toBeNull();
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
        availableAt: [
          {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "APPLICATION_RECEIVED",
          },
        ],
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
                availableAt: [
                  {
                    ...entitlementTemplates[0].availableAt[0],
                    [segment]: "UNKNOWN",
                  },
                ],
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
      ["phase only", [{ phase: "PRE_AWARD" }]],
      ["phase and stage", [{ phase: "PRE_AWARD", stage: "ASSESSMENT" }]],
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
      ["phase", [{ phase: "UNKNOWN" }], "UNKNOWN"],
      [
        "stage",
        [{ phase: "PRE_AWARD", stage: "UNKNOWN" }],
        "PRE_AWARD:UNKNOWN",
      ],
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

    it("throws when a claimableAt position does not exist in phases", () => {
      expect(() =>
        createTestGrant({
          entitlementTemplates: [
            {
              ...entitlementTemplates[0],
              claim: {
                ...entitlementTemplates[0].claim,
                claimableAt: [
                  {
                    phase: "PRE_AWARD",
                    stage: "ASSESSMENT",
                    status: "UNKNOWN",
                  },
                ],
              },
            },
          ],
        }),
      ).toThrow(
        /is claimable at position "PRE_AWARD:ASSESSMENT:UNKNOWN" which does not match any position/,
      );
    });

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
        availableAt: [
          {
            phase: "PRE_AWARD",
            stage: "ASSESSMENT",
            status: "IN_REVIEW",
          },
        ],
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
                  {
                    code: "PARTIAL",
                    source: "CW",
                    mappedTo: "REVIEW_OFFER:OFFERED",
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
      it("should return invalid when mapped to neither a status nor a full position", () => {
        const result = grantWithExternalMap.mapExternalStateToInternalState(
          "PRE_AWARD",
          "REVIEW_APPLICATION",
          "PARTIAL",
          "CW",
        );

        expect(result).toEqual({ valid: false });
      });

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
  describe("describeLifecycle", () => {
    const status = (code, validFrom, processes) => ({
      code,
      validFrom,
      processes,
    });
    const from = (code, processes = []) => ({ code, processes });
    const lifecycleOf = (phases, overrides = {}) =>
      createTestGrant({ phases, ...overrides }).describeLifecycle();
    const oneStage = (statuses) => [
      { code: "P", stages: [{ code: "S", statuses }] },
    ];
    const waysInto = (lifecycle, to) =>
      lifecycle.waysIn.filter((wayIn) => wayIn.to === to);

    it("describes the phases with their status names, initial, amendable and claim approval positions", () => {
      const lifecycle = lifecycleOf(
        [
          {
            code: "PRE_AWARD",
            name: "Pre award",
            stages: [
              {
                code: "APPLICATION",
                name: "Application",
                statuses: [
                  { ...status("RECEIVED", []), name: "Received" },
                  status("AMEND", [from("RECEIVED", ["NOTIFY"])]),
                ],
              },
            ],
            questions: {},
          },
          {
            code: "CLAIM",
            stages: [
              {
                code: "AWAITING",
                statuses: [
                  status("OPEN", [from("PRE_AWARD:APPLICATION:AMEND")]),
                ],
              },
            ],
          },
        ],
        {
          amendablePositions: ["PRE_AWARD:APPLICATION:AMEND"],
          claims: {
            onClaimApproval: {
              currentPosition: {
                phase: "PRE_AWARD",
                stage: "APPLICATION",
                status: "AMEND",
              },
              targetPosition: {
                phase: "CLAIM",
                stage: "AWAITING",
                status: "OPEN",
              },
            },
          },
        },
      );

      expect(lifecycle).toEqual({
        phases: [
          {
            code: "PRE_AWARD",
            name: "Pre award",
            stages: [
              {
                code: "APPLICATION",
                name: "Application",
                statuses: [
                  { code: "RECEIVED", name: "Received" },
                  { code: "AMEND", name: null },
                ],
              },
            ],
          },
          {
            code: "CLAIM",
            name: null,
            stages: [
              {
                code: "AWAITING",
                name: null,
                statuses: [{ code: "OPEN", name: null }],
              },
            ],
          },
        ],
        initialPosition: "PRE_AWARD:APPLICATION:RECEIVED",
        amendablePositions: ["PRE_AWARD:APPLICATION:AMEND"],
        waysIn: [
          { to: "PRE_AWARD:APPLICATION:RECEIVED", kind: "any", processes: [] },
          {
            to: "PRE_AWARD:APPLICATION:AMEND",
            kind: "move",
            from: "PRE_AWARD:APPLICATION:RECEIVED",
            matchedBy: "status",
            processes: ["NOTIFY"],
          },
          {
            to: "CLAIM:AWAITING:OPEN",
            kind: "move",
            from: "PRE_AWARD:APPLICATION:AMEND",
            matchedBy: "position",
            processes: [],
          },
        ],
        externalMappings: [],
        claimApproval: {
          from: "PRE_AWARD:APPLICATION:AMEND",
          to: "CLAIM:AWAITING:OPEN",
        },
      });
    });

    it.each([
      [
        "a stage with no status",
        { phases: oneStage([]) },
        '"phases[0].stages[0].statuses" must contain at least 1 items',
      ],
      [
        "processes written as a single string",
        { phases: oneStage([{ code: "A", processes: "SKIPPED" }]) },
        '"phases[0].stages[0].statuses[0].processes" must be an array',
      ],
      [
        "a validFrom entry with no processes",
        { phases: oneStage([status("A", [{ code: "B" }])]) },
        '"phases[0].stages[0].statuses[0].validFrom[0].processes" is required',
      ],
      [
        "an external status mapped to nothing",
        {
          phases: oneStage([status("A", [])]),
          externalStatusMap: {
            phases: [
              {
                code: "P",
                stages: [
                  { code: "S", statuses: [{ code: "UNMAPPED", source: "CW" }] },
                ],
              },
            ],
          },
        },
        '"externalStatusMap.phases[0].stages[0].statuses[0].mappedTo" is required',
      ],
    ])("refuses a stored grant with %s", (_label, overrides, detail) => {
      const grant = createTestGrant(overrides);

      expect(() => grant.describeLifecycle()).toThrow(
        `Grant "test-grant" has a lifecycle GAS cannot read: ${detail}`,
      );
    });

    it("admits a full code from that position alone and a bare code from that status anywhere, saying which matched", () => {
      const lifecycle = lifecycleOf([
        {
          code: "P",
          stages: [
            { code: "S", statuses: [status("A", []), status("B", [])] },
            {
              code: "T",
              statuses: [
                status("A", []),
                status("FULL", [from("P:S:A")]),
                status("BARE", [from("A")]),
                status("TWO_PART", [from("S:A")]),
              ],
            },
          ],
        },
      ]);

      const move = (to, from, matchedBy) => ({
        to,
        kind: "move",
        from,
        matchedBy,
        processes: [],
      });

      expect(waysInto(lifecycle, "P:T:FULL")).toEqual([
        move("P:T:FULL", "P:S:A", "position"),
      ]);
      expect(waysInto(lifecycle, "P:T:BARE")).toEqual([
        move("P:T:BARE", "P:S:A", "status"),
        move("P:T:BARE", "P:T:A", "status"),
      ]);
      expect(waysInto(lifecycle, "P:T:TWO_PART")).toEqual([
        {
          to: "P:T:TWO_PART",
          kind: "unmatched",
          code: "S:A",
          matchedBy: "position",
          processes: [],
        },
      ]);
    });

    it("lists each source under the first entry it matches, and an entry that matches nothing as unmatched", () => {
      const lifecycle = lifecycleOf(
        oneStage([
          status("A", []),
          status("B", []),
          status("X", [
            from("X", ["SELF"]),
            from("A", ["FIRST"]),
            from("P:S:A", ["SHADOWED"]),
            from("GONE", ["LOST"]),
            from("B"),
          ]),
        ]),
      );

      expect(waysInto(lifecycle, "P:S:X")).toEqual([
        expect.objectContaining({
          kind: "move",
          from: "P:S:A",
          processes: ["FIRST"],
        }),
        expect.objectContaining({
          kind: "unmatched",
          code: "GONE",
          processes: ["LOST"],
        }),
        expect.objectContaining({ kind: "move", from: "P:S:B", processes: [] }),
      ]);
    });

    it("reads an empty or missing validFrom as from any status, with the status's own processes", () => {
      const lifecycle = lifecycleOf(
        oneStage([
          status("A", [], ["START"]),
          { code: "B", processes: ["OPEN"] },
          { code: "C" },
        ]),
      );

      expect(lifecycle.waysIn).toEqual([
        { to: "P:S:A", kind: "any", processes: ["START"] },
        { to: "P:S:B", kind: "any", processes: ["OPEN"] },
        { to: "P:S:C", kind: "any", processes: [] },
      ]);
    });

    it("leaves out what the runtime never reaches under a repeated phase code", () => {
      const lifecycle = lifecycleOf(
        [
          { code: "P", stages: [{ code: "S", statuses: [status("A", [])] }] },
          {
            code: "P",
            stages: [{ code: "HIDDEN", statuses: [status("B", [from("A")])] }],
          },
        ],
        {
          externalStatusMap: {
            phases: [
              { code: "P", stages: [{ code: "S", statuses: [] }] },
              {
                code: "P",
                stages: [
                  {
                    code: "S",
                    statuses: [{ code: "LATER", source: "CW", mappedTo: "A" }],
                  },
                ],
              },
            ],
          },
        },
      );

      expect(lifecycle.phases[1].stages[0].statuses).toEqual([
        { code: "B", name: null },
      ]);
      expect(waysInto(lifecycle, "P:HIDDEN:B")).toEqual([]);
      expect(lifecycle.externalMappings).toEqual([]);
    });

    it("describes each external status mapping the runtime would apply, with where it lands", () => {
      const mapping = (code, mappedTo, source = "CW") => ({
        code,
        source,
        mappedTo,
      });
      const lifecycle = lifecycleOf(oneStage([status("A", [])]), {
        externalStatusMap: {
          phases: [
            {
              code: "P",
              stages: [
                {
                  code: "S",
                  statuses: [
                    mapping("IN_STAGE", "::A"),
                    mapping("BARE", "A"),
                    mapping("FULL", "Q:R:A"),
                    mapping("TWO_PART", "S:A"),
                    mapping("NO_STAGE", "P::A"),
                    mapping("BARE", "ignored"),
                    mapping("BARE", "A", "AS"),
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(lifecycle.externalMappings).toEqual([
        {
          source: "CW",
          code: "IN_STAGE",
          whileIn: "P:S",
          mappedTo: "::A",
          to: "P:S:A",
        },
        {
          source: "CW",
          code: "BARE",
          whileIn: "P:S",
          mappedTo: "A",
          to: "P:S:A",
        },
        {
          source: "CW",
          code: "FULL",
          whileIn: "P:S",
          mappedTo: "Q:R:A",
          to: "Q:R:A",
        },
        {
          source: "CW",
          code: "TWO_PART",
          whileIn: "P:S",
          mappedTo: "S:A",
          to: null,
        },
        {
          source: "CW",
          code: "NO_STAGE",
          whileIn: "P:S",
          mappedTo: "P::A",
          to: "P::A",
        },
        {
          source: "AS",
          code: "BARE",
          whileIn: "P:S",
          mappedTo: "A",
          to: "P:S:A",
        },
      ]);
    });

    it("has no external status mappings or claim approval when the grant has none", () => {
      const lifecycle = lifecycleOf(oneStage([status("A", [])]));

      expect(lifecycle.externalMappings).toEqual([]);
      expect(lifecycle.claimApproval).toBeNull();
    });

    it.each([
      "compose/seed/pigs-might-fly/1.0.0/gas/gas.json",
      "compose/seed/woodland/1.39.1/gas/gas.json",
    ])(
      "lists a move exactly where isValidTransition allows one, in %s",
      (seed) => {
        const definition = JSON.parse(
          readFileSync(new URL(`../../../${seed}`, import.meta.url), "utf8"),
        );
        const grant = new Grant({ ...definition, version: "1.0.0" });
        const { phases, waysIn } = grant.describeLifecycle();
        const positions = phases.flatMap((phase) =>
          phase.stages.flatMap((stage) =>
            stage.statuses.map(
              ({ code }) => `${phase.code}:${stage.code}:${code}`,
            ),
          ),
        );
        const anyStatus = new Set(
          waysIn.filter(({ kind }) => kind === "any").map(({ to }) => to),
        );

        const allowed = positions
          .filter((to) => !anyStatus.has(to))
          .flatMap((to) => {
            const [phase, stage, code] = to.split(":");

            return positions
              .filter((from) => from !== to)
              .flatMap((from) => {
                const { valid, processes } = grant.isValidTransition(
                  phase,
                  stage,
                  code,
                  from,
                );

                return valid
                  ? [{ to, kind: "move", from, processes: processes ?? [] }]
                  : [];
              });
          });
        const moves = waysIn
          .filter(({ kind }) => kind === "move")
          .map(({ matchedBy: _, ...move }) => move);

        expect(allowed.length).toBeGreaterThan(0);
        expect(moves).toHaveLength(allowed.length);
        expect(moves).toEqual(expect.arrayContaining(allowed));
      },
    );
  });
});
