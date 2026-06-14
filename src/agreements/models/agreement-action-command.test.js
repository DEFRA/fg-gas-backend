import { describe, expect, it } from "vitest";
import { agreementActionCommandFromRequest } from "./agreement-action-command.js";

describe("Agreement action command", () => {
  it("normalizes an Agreement action request", () => {
    expect(
      agreementActionCommandFromRequest({
        actionName: "accept",
        agreementNumber: "PMF000000001",
        payload: {
          acceptedBy: "admin",
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
      }),
    ).toEqual({
      acceptedBy: "admin",
      actionName: "accept",
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
    });
  });

  it("defaults the actor to applicant", () => {
    expect(
      agreementActionCommandFromRequest({
        actionName: "accept",
        agreementNumber: "PMF000000001",
        payload: {
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
        },
      }),
    ).toEqual({
      acceptedBy: "applicant",
      actionName: "accept",
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
    });
  });
});
