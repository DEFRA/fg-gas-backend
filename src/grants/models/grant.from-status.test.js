import { describe, expect, it } from "vitest";
import { Grant } from "./grant.js";
import { grantVersionPageSchemas } from "../../grant-admin/schemas/grant-version-page.schema.js";

const phase = "PHASE_PRE_AWARD";
const stage = "STAGE_FC_REVIEWING";
const outcomes = [
  ["STATUS_REJECTION_REQUESTED", "STATUS_AGREEMENT_REJECTED"],
  ["STATUS_WITHDRAWAL_REQUESTED", "STATUS_APPLICATION_WITHDRAWN"],
];
const mappings = () =>
  outcomes.map(([fromStatus, target]) => ({
    code: "terminated",
    source: "AS",
    fromStatus,
    mappedTo: `${phase}:${stage}:${target}`,
  }));
const definition = (statuses = mappings()) => ({
  code: "woodland",
  actions: [],
  metadata: {
    description: "Woodland Management Plan",
    startDate: "2026-01-01T00:00:00Z",
  },
  phases: [
    {
      code: phase,
      questions: { type: "object" },
      stages: [
        {
          code: stage,
          statuses: outcomes.flatMap(([fromStatus, target]) => [
            { code: fromStatus, validFrom: [] },
            { code: target, validFrom: [{ code: fromStatus, processes: [] }] },
          ]),
        },
      ],
    },
  ],
  externalStatusMap: {
    phases: [{ code: phase, stages: [{ code: stage, statuses }] }],
  },
});
const dependencies = { isKnownProcess: () => true, compileQuestions: () => {} };
const lookup = (grant, status, source = "AS") =>
  grant.mapExternalStateToInternalState(
    phase,
    stage,
    "terminated",
    source,
    status,
  );

describe("external mappings conditioned by current GAS status", () => {
  it.each(outcomes)(
    "maps terminated from %s to %s",
    (fromStatus, targetStatus) => {
      const grant = Grant.fromDefinition(definition(), "1.0.0", dependencies);
      expect(lookup(grant, fromStatus)).toEqual({
        valid: true,
        targetPhase: phase,
        targetStage: stage,
        targetStatus,
      });
      expect(
        grant.hasExternalStatusMapping(
          "terminated",
          "AS",
          phase,
          stage,
          fromStatus,
        ),
      ).toBeTruthy();
    },
  );

  it.each([undefined, "STATUS_AGREEMENT_REJECTED", "UNRELATED"])(
    "does not apply a conditioned mapping from %s",
    (currentStatus) => {
      const grant = new Grant(definition());
      expect(lookup(grant, currentStatus)).toEqual({ valid: false });
      expect(
        grant.hasExternalStatusMapping(
          "terminated",
          "AS",
          phase,
          stage,
          currentStatus,
        ),
      ).toBeNull();
    },
  );

  it("still requires the correct source, phase and stage", () => {
    const grant = new Grant(definition());
    expect(lookup(grant, outcomes[0][0], "CW")).toEqual({ valid: false });
    expect(
      grant.mapExternalStateToInternalState(
        "OTHER",
        stage,
        "terminated",
        "AS",
        outcomes[0][0],
      ),
    ).toEqual({ valid: false });
    expect(
      grant.mapExternalStateToInternalState(
        phase,
        "OTHER",
        "terminated",
        "AS",
        outcomes[0][0],
      ),
    ).toEqual({ valid: false });
  });

  it("preserves first-match behaviour for existing unconditioned mappings", () => {
    const [first, second] = mappings().map(
      ({ fromStatus, ...mapping }) => mapping,
    );
    const grant = Grant.fromDefinition(
      definition([first, second]),
      "1.0.0",
      dependencies,
    );
    expect(lookup(grant, outcomes[1][0]).targetStatus).toBe(outcomes[0][1]);
    expect(lookup(grant, undefined).targetStatus).toBe(outcomes[0][1]);
  });

  it.each([
    "",
    null,
    12,
    "PHASE_PRE_AWARD:STAGE_FC_REVIEWING:STATUS_REJECTION_REQUESTED",
  ])("rejects invalid fromStatus %s", (fromStatus) => {
    const entries = mappings();
    entries[0].fromStatus = fromStatus;
    expect(() =>
      Grant.fromDefinition(definition(entries), "1.0.0", dependencies),
    ).toThrow();
  });

  it("rejects a condition that names no status in its stage", () => {
    const entries = mappings();
    entries[0].fromStatus = "MISSING";
    expect(() =>
      Grant.fromDefinition(definition(entries), "1.0.0", dependencies),
    ).toThrow('fromStatus "MISSING"');
  });

  it.each([true, false])(
    "rejects overlapping conditioned mappings (unconditioned: %s)",
    (unconditioned) => {
      const entries = mappings();
      entries[1].fromStatus = entries[0].fromStatus;
      if (unconditioned) delete entries[1].fromStatus;
      expect(() =>
        Grant.fromDefinition(definition(entries), "1.0.0", dependencies),
      ).toThrow("Ambiguous AS status");
      expect(() =>
        lookup(new Grant(definition(entries)), outcomes[0][0]),
      ).toThrow("Ambiguous AS status");
    },
  );

  it("includes both conditions in the admin lifecycle description", () => {
    const grant = Grant.fromDefinition(definition(), "1.0.0", dependencies);
    const lifecycle = grant.describeLifecycle();
    expect(
      grantVersionPageSchemas.phases
        .extract("lifecycle.externalMappings")
        .validate(lifecycle.externalMappings).error,
    ).toBeUndefined();
    expect(lifecycle.externalMappings).toEqual(
      mappings().map(({ mappedTo, ...mapping }) => ({
        ...mapping,
        whileIn: `${phase}:${stage}`,
        mappedTo,
        to: mappedTo,
      })),
    );
  });
});
