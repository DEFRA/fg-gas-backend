import { describe, expect, it } from "vitest";
import { calculateAgreementDatesEffect } from "./calculate-agreement-dates-effect.js";

describe("calculateAgreementDatesEffect", () => {
  it("calculates a whole-month Agreement period", async () => {
    const result = await calculateAgreementDatesEffect(
      { executedAt: "2026-07-17T11:30:00.000Z" },
      { params: { durationMonths: 12 } },
    );

    expect(result).toEqual({
      output: {
        startDate: "2026-08-01",
        endDate: "2027-07-31",
      },
    });
  });

  it.each([undefined, 0, 1.5])(
    "rejects the invalid duration %s",
    async (durationMonths) => {
      await expect(
        calculateAgreementDatesEffect(
          { executedAt: "2026-07-17T11:30:00.000Z" },
          { params: { durationMonths } },
        ),
      ).rejects.toThrow(
        "Agreement date calculation requires a positive durationMonths",
      );
    },
  );
});
