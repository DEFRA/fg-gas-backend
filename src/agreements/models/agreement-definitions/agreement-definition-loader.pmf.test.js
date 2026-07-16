import { describe, expect, it } from "vitest";
import { loadAgreementDefinition } from "./agreement-definition-loader.js";

const resolvePmfDefinition = () =>
  loadAgreementDefinition({
    code: "pigs-might-fly",
    configVersion: "0.0.1",
  });

describe("loading agreement behaviour for code pigs-might-fly", () => {
  it("selects the PMF definition's accept action configuration", async () => {
    const definition = await resolvePmfDefinition();

    expect(
      definition.resolveAction({
        state: "offered",
        action: "accept",
      }).transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("selects the PMF definition's offered page configuration", async () => {
    const definition = await resolvePmfDefinition();

    expect(definition.resolvePage("offered")).toMatchObject({
      title: "Review your agreement offer",
    });
  });

  it("allows the offered page while the agreement is offered", async () => {
    const definition = await resolvePmfDefinition();

    expect(() =>
      definition.assertPageAllowed({
        page: "offered",
        state: "offered",
      }),
    ).not.toThrow();
  });

  it("allows the accept page while the agreement is offered", async () => {
    const definition = await resolvePmfDefinition();

    expect(() =>
      definition.assertPageAllowed({
        page: "accept",
        state: "offered",
      }),
    ).not.toThrow();
  });

  it("rejects the offered page once the agreement has been accepted", async () => {
    const definition = await resolvePmfDefinition();

    expect(() =>
      definition.assertPageAllowed({
        page: "offered",
        state: "accepted",
      }),
    ).toThrow(
      'Page "offered" is not valid for agreement code "pigs-might-fly" in state "accepted"',
    );
  });
});
