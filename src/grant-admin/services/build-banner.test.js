import { describe, expect, it } from "vitest";
import { buildBanner } from "./build-banner.js";

const grant = { metadata: { description: "Woodland Management Plan" } };

const application = {
  clientRef: "wood-1001",
  code: "woodland",
  currentStatus: "STATUS_PREPARING_CLAIM",
  identifiers: { sbi: "113598882" },
  phases: [
    {
      code: "PHASE_PRE_AWARD",
      answers: { applicant: { business: { name: "Elmwood Land Co" } } },
    },
  ],
};

const build = (overrides = {}) =>
  buildBanner({ grant, application, ...overrides });

describe("buildBanner", () => {
  it("titles the header with the applicant's business", () => {
    expect(build().title).toEqual({
      text: "Elmwood Land Co",
      type: "string",
    });
  });

  it("summarises the scheme, reference and sbi", () => {
    expect(build().summary).toEqual({
      scheme: {
        label: "Scheme",
        text: "Woodland Management Plan",
        type: "string",
      },
      applicationId: {
        label: "Application ID",
        text: "wood-1001",
        type: "string",
      },
      sbi: { label: "SBI", text: "113598882", type: "string" },
    });
  });

  // The applicant is declared in an early phase, and this page is for
  // applications that have moved on to claiming.
  it("reads the applicant from an earlier phase", () => {
    expect(
      build({
        application: {
          ...application,
          currentPhase: "PHASE_CLAIM",
          phases: [
            ...application.phases,
            { code: "PHASE_CLAIM", answers: { something: "else" } },
          ],
        },
      }).title.text,
    ).toBe("Elmwood Land Co");
  });

  it("has no title when the application names no business", () => {
    const result = build({
      application: { ...application, phases: [{ code: "P", answers: {} }] },
    });

    expect(result.title).toBeUndefined();
    expect(result.summary.sbi.text).toBe("113598882");
  });

  // Shown empty is worse than not shown at all.
  it("leaves out a field the application has no value for", () => {
    const result = build({
      application: { ...application, identifiers: {} },
    });

    expect(result.summary.sbi).toBeUndefined();
    expect(result.summary.applicationId.text).toBe("wood-1001");
  });

  it("leaves out the scheme when the grant carries no description", () => {
    expect(build({ grant: {} }).summary.scheme).toBeUndefined();
  });
});
