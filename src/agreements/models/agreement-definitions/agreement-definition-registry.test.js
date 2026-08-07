import { describe, expect, it } from "vitest";
import {
  agreementDefinitions,
  findAgreementDefinition,
} from "./agreement-definition-registry.js";

const pmfAgreementDefinition = agreementDefinitions.find(
  ({ code }) => code === "pigs-might-fly",
);

describe("findAgreementDefinition", () => {
  it("configures PMF offer calculation and Application resolution", () => {
    expect(pmfAgreementDefinition.create).toEqual({
      target: "offered",
      application: "$.input.answers",
      processes: ["calculate-offer"],
    });
    expect(pmfAgreementDefinition.create).not.toHaveProperty("effects");
    expect(pmfAgreementDefinition.endpoints).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/grantFundingCalculator" }),
      ]),
    );
    expect(
      pmfAgreementDefinition.processDefinitions["calculate-offer"],
    ).toMatchObject({
      type: "endpoint",
      endpoint: {
        method: "POST",
        path: "/grantFundingCalculator",
        service: "GRANT_FUNDING_CALCULATOR",
      },
      output: {
        actions: {
          items: {
            unit: "head",
            ratePence: "jsonata:$round(@.value * 100)",
            totalAmountPence: "jsonata:$round(@.total * 100)",
          },
        },
        items: [],
        totalAmountPence: "jsonata:$round($.response.grandTotal * 100)",
      },
    });
    expect(
      pmfAgreementDefinition.processDefinitions["calculate-offer"].output
        .actions.items,
    ).not.toHaveProperty("id");
  });

  it("keeps temporary acceptance quantities on immutable Application", () => {
    const acceptance = pmfAgreementDefinition.states.offered.on.accept;
    const request = acceptance.effects[0].params.endpoint.endpointParams.BODY;

    expect(JSON.stringify(request)).toContain("$.agreement.application");
    expect(JSON.stringify(request)).not.toContain("agreement.payload");
  });

  it("returns the code-specific default when another version is requested", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "3.0.0",
      }),
    ).toBe(pmfAgreementDefinition);
  });

  it("returns the code-specific default when no version is requested", () => {
    expect(findAgreementDefinition({ code: "pigs-might-fly" })).toBe(
      pmfAgreementDefinition,
    );
  });

  it("returns undefined when the code is unknown", () => {
    expect(
      findAgreementDefinition({
        code: "unknown-code",
        configVersion: "0.0.1",
      }),
    ).toBeUndefined();
  });

  it("ignores an unavailable version", () => {
    expect(
      findAgreementDefinition({
        code: "pigs-might-fly",
        configVersion: "0.0.0",
      }),
    ).toBe(pmfAgreementDefinition);
  });
});
