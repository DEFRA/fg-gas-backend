import { describe, expect, it } from "vitest";
import { toApplicationContext } from "./application-context.js";

const application = {
  clientRef: "wood-1001",
  code: "woodland",
  currentPhase: "PHASE_CLAIM",
  currentStage: "STAGE_PREPARE_CLAIM",
  currentStatus: "STATUS_PREPARING_CLAIM",
  identifiers: { sbi: "113598882", frn: "1100943757" },
  phases: [
    {
      code: "PHASE_PRE_AWARD",
      answers: {
        applicant: { business: { name: "Elmwood Land Co" } },
        woodlandName: "Test Woodland",
      },
    },
    { code: "PHASE_CLAIM", answers: { woodlandName: "Renamed Woodland" } },
  ],
};

describe("toApplicationContext", () => {
  it("carries where the application is and who it identifies", () => {
    expect(toApplicationContext(application)).toMatchObject({
      clientRef: "wood-1001",
      code: "woodland",
      phase: "PHASE_CLAIM",
      stage: "STAGE_PREPARE_CLAIM",
      status: "STATUS_PREPARING_CLAIM",
      identifiers: { sbi: "113598882", frn: "1100943757" },
    });
  });

  // Woodland declares the applicant in PHASE_PRE_AWARD only, and this page is
  // for applications that have moved on to claiming.
  it("reaches answers given in an earlier phase", () => {
    const { answers } = toApplicationContext(application);

    expect(answers.applicant.business.name).toBe("Elmwood Land Co");
  });

  it("takes the newest answer when a later phase restates one", () => {
    const { answers } = toApplicationContext(application);

    expect(answers.woodlandName).toBe("Renamed Woodland");
  });

  it("copes with an application carrying neither phases nor identifiers", () => {
    expect(toApplicationContext({ clientRef: "wood-1001" })).toMatchObject({
      identifiers: {},
      answers: {},
    });
  });
});
