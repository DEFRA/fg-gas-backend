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
        path: "/paymentSchedule",
        service: "GRANT_FUNDING_CALCULATOR",
      },
      request: {
        body: { agreementStartDate: "$.execution.executedAt" },
      },
      output: {
        startDate: "$.response.payment.agreementStartDate",
        endDate: "$.response.payment.agreementEndDate",
        actions: {
          items: {
            ref: "@.pigType",
            code: "@.pigType",
            unit: "head",
            ratePence: "@.unitPricePence",
            totalAmountPence: "@.amountPence",
          },
        },
        items: [],
        totalAmountPence: "$.response.payment.agreementTotalPence",
        paymentSchedule: expect.any(Object),
      },
    });
    expect(
      pmfAgreementDefinition.processDefinitions["calculate-offer"].output
        .actions.items,
    ).not.toHaveProperty("id");
  });

  it("keeps the temporary non-deployable acceptance bridge on immutable Application", () => {
    const acceptance = pmfAgreementDefinition.states.offered.on.accept;
    const request = acceptance.effects[0].params.endpoint.endpointParams.BODY;

    expect(JSON.stringify(request)).toContain("$.agreement.application");
    expect(JSON.stringify(request)).not.toContain("agreement.payload");
  });

  it("binds PMF pages only to stored Agreement values", () => {
    const pages = JSON.stringify(pmfAgreementDefinition.pages);

    expect(pages).toContain("$.agreement.actions");
    expect(pages).toContain("$.agreement.paymentSchedule.instalments");
    expect(pages).toContain("$.agreement.startDate");
    expect(pages).not.toContain("paymentCalculation");
    expect(pages).not.toContain("supplementaryData");
    expect(pages).not.toContain("agreement.payload");
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
