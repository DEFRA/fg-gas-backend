import Boom from "@hapi/boom";
import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

const validDefinition = {
  code: "test-code",
  configVersion: "0.0.1",
  agreementNumberPrefix: "TST",
  create: {
    target: "offered",
    effects: [{ name: "snapshot", params: {} }],
  },
  states: {
    offered: {
      page: "offered",
      on: {
        accept: {
          target: "accepted",
          validation: {
            page: "accept",
            required: [
              {
                name: "confirm",
                value: "confirmed",
                href: "#confirm",
                message: "Confirm",
              },
            ],
          },
          effects: [{ name: "publish" }],
        },
      },
    },
    accepted: { page: "offered" },
  },
  pages: {
    offered: {
      title: "Offered page",
      components: [{ component: "heading", level: 1, text: "Offered" }],
    },
    accept: {
      title: "Accept page",
      components: [{ component: "heading", level: 1, text: "Accept" }],
    },
  },
};

describe("AgreementDefinition", () => {
  it("creates an Agreement in its configured initial state", () => {
    const definition = new AgreementDefinition(validDefinition);

    const agreement = definition.createAgreement({
      clientRef: "xnp-rr3-nfa",
      identifiers: { sbi: "300000069" },
      payload: { applicant: "Test Farmer" },
    });

    expect(agreement.agreementNumber).toMatch(/^TST/);
    expect(agreement).toMatchObject({
      version: 1,
      code: "test-code",
      clientRef: "xnp-rr3-nfa",
      configVersion: "0.0.1",
      identifiers: { sbi: "300000069" },
      payload: { applicant: "Test Farmer" },
      state: "offered",
      correlationId: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(definition.getCreationEffects()).toEqual(
      validDefinition.create.effects,
    );
    expect(definition.getEndpoints()).toEqual([]);
  });

  it("resolves an action from the persisted state", () => {
    const definition = new AgreementDefinition(validDefinition);

    expect(
      definition.resolveAction({ state: "offered", action: "accept" })
        .transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("preserves the requested state and action over extensible metadata", () => {
    const configuration = structuredClone(validDefinition);
    configuration.states.offered.on.accept.from = "accepted";
    configuration.states.offered.on.accept.name = "withdraw";
    const definition = new AgreementDefinition(configuration);

    expect(
      definition.resolveAction({ state: "offered", action: "accept" })
        .transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("treats an unknown persisted state as an integrity failure", () => {
    const definition = new AgreementDefinition(validDefinition);

    try {
      definition.resolveAction({ state: "future-state", action: "accept" });
      expect.unreachable("expected action resolution to fail");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
      expect(error.message).toBe(
        'Agreement code "test-code" has unknown persisted state "future-state"',
      );
    }
  });

  it("returns an isolated configured page", () => {
    const definition = new AgreementDefinition(validDefinition);

    const page = definition.resolvePage("offered");
    page.title = "Changed";

    expect(definition.resolvePage("offered")).toEqual(
      validDefinition.pages.offered,
    );
  });

  it("returns the page configured for a lifecycle state", () => {
    const configuration = structuredClone(validDefinition);
    configuration.states.offered.page = "accept";
    const definition = new AgreementDefinition(configuration);

    expect(definition.resolvePageForState("offered")).toEqual({
      pageId: "accept",
    });
  });

  it("treats a state without a configured page as a definition defect", () => {
    const configuration = structuredClone(validDefinition);
    configuration.states.offered.page = "missing";
    const definition = new AgreementDefinition(configuration);

    expect(() => definition.resolvePageForState("offered")).toThrow(
      'state "offered" has no configured page',
    );
  });

  it("allows the state page and its action validation pages", () => {
    const definition = new AgreementDefinition(validDefinition);

    expect(() =>
      definition.assertPageAllowed({ page: "offered", state: "offered" }),
    ).not.toThrow();
    expect(() =>
      definition.assertPageAllowed({ page: "accept", state: "offered" }),
    ).not.toThrow();
  });

  it("forbids pages unavailable in the current state", () => {
    const definition = new AgreementDefinition(validDefinition);

    try {
      definition.assertPageAllowed({ page: "accept", state: "accepted" });
      expect.unreachable("expected page assertion to fail");
    } catch (error) {
      expect(error.output.statusCode).toBe(Boom.forbidden().output.statusCode);
      expect(error.message).toBe(
        'Page "accept" is not valid for agreement code "test-code" in state "accepted"',
      );
    }
  });

  it("reports an unknown state", () => {
    const definition = new AgreementDefinition(validDefinition);

    expect(() =>
      definition.assertPageAllowed({
        page: "offered",
        state: "unknown-state",
      }),
    ).toThrow('Unknown state "unknown-state" for agreement code "test-code"');
  });
});
