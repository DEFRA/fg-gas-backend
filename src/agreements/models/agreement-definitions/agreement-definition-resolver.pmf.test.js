import { describe, expect, it } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementAction,
  resolveAgreementCreation,
  resolveAgreementPage,
} from "./agreement-definition-resolver.js";

describe("resolving agreement behaviour for code pigs-might-fly", () => {
  it("selects the PMF definition's creation configuration", () => {
    expect(resolveAgreementCreation("pigs-might-fly")).toMatchObject({
      agreementNumberPrefix: "PMF",
      target: "offered",
    });
  });

  it("selects the PMF definition's accept action configuration", () => {
    expect(
      resolveAgreementAction("pigs-might-fly", "offered", "accept").transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("selects the PMF definition's offered page configuration", () => {
    expect(resolveAgreementPage("pigs-might-fly", "offered")).toMatchObject({
      title: "Review your agreement offer",
    });
  });

  it("allows the offered page while the agreement is offered", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus(
        "pigs-might-fly",
        "offered",
        "offered",
      ),
    ).not.toThrow();
  });

  it("allows the accept page while the agreement is offered", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus(
        "pigs-might-fly",
        "accept",
        "offered",
      ),
    ).not.toThrow();
  });

  it("rejects the offered page once the agreement has been accepted", () => {
    expect(() =>
      assertAgreementPageAllowedForStatus(
        "pigs-might-fly",
        "offered",
        "accepted",
      ),
    ).toThrow(
      'Page "offered" is not valid for agreement code "pigs-might-fly" in state "accepted"',
    );
  });
});
