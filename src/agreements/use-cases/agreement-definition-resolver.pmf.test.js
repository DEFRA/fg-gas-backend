import { describe, expect, it } from "vitest";
import {
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
      resolveAgreementAction("pigs-might-fly", "offered", "accept"),
    ).toMatchObject({ target: "accepted" });
  });

  it("selects the PMF definition's offered page configuration", () => {
    expect(resolveAgreementPage("pigs-might-fly", "offered")).toMatchObject({
      title: "Review your agreement offer",
    });
  });
});
