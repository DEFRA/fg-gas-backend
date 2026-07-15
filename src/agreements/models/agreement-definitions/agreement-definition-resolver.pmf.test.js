import { describe, expect, it } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementActionForVersion,
  resolveAgreementPageForVersion,
} from "./agreement-definition-resolver.js";

describe("resolving agreement behaviour for code pigs-might-fly", () => {
  it("selects the PMF definition's accept action configuration", () => {
    expect(
      resolveAgreementActionForVersion({
        code: "pigs-might-fly",
        state: "offered",
        action: "accept",
        configVersion: "0.0.1",
      }).transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("selects the PMF definition's offered page configuration", () => {
    expect(
      resolveAgreementPageForVersion({
        code: "pigs-might-fly",
        page: "offered",
        configVersion: "0.0.1",
      }),
    ).toMatchObject({ title: "Review your agreement offer" });
  });

  it("allows the offered page while the agreement is offered", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus({
        code: "pigs-might-fly",
        page: "offered",
        status: "offered",
        configVersion: "0.0.1",
      }),
    ).not.toThrow();
  });

  it("allows the accept page while the agreement is offered", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus({
        code: "pigs-might-fly",
        page: "accept",
        status: "offered",
        configVersion: "0.0.1",
      }),
    ).not.toThrow();
  });

  it("rejects the offered page once the agreement has been accepted", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus({
        code: "pigs-might-fly",
        page: "offered",
        status: "accepted",
        configVersion: "0.0.1",
      }),
    ).toThrow(
      'Page "offered" is not valid for agreement code "pigs-might-fly" in state "accepted"',
    );
  });
});
