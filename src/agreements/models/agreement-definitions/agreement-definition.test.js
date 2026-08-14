import Boom from "@hapi/boom";
import { describe, expect, it } from "vitest";
import { AgreementDefinition } from "./agreement-definition.js";

const validDefinition = {
  code: "test-code",
  configVersion: "0.0.1",
  agreementNumberPrefix: "TST",
  create: {
    target: "offered",
    application: "$.input.application",
    values: { actions: [], items: [] },
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
  it("creates an Agreement in its configured initial state", async () => {
    const definition = new AgreementDefinition(validDefinition, {
      generateAgreementNumber: () => "TST123456789",
    });
    const execution = {
      correlationId: "creation-correlation-id",
      executedAt: "2026-08-06T12:00:00.000Z",
    };

    const agreement = await definition.createAgreement({
      input: {
        code: "test-code",
        clientRef: "xnp-rr3-nfa",
        identifiers: { sbi: "300000069" },
        application: { applicant: "Test Farmer" },
      },
      execution,
    });

    expect(agreement).toMatchObject({
      agreementNumber: "TST123456789",
      version: 1,
      code: "test-code",
      clientRef: "xnp-rr3-nfa",
      configVersion: "0.0.1",
      identifiers: { sbi: "300000069" },
      application: { applicant: "Test Farmer" },
      actions: [],
      items: [],
      state: "offered",
      correlationId: execution.correlationId,
      createdAt: execution.executedAt,
      updatedAt: execution.executedAt,
    });
    expect(definition.getEndpoints()).toEqual([]);
  });

  it("rejects Creation Input for another Agreement Definition", async () => {
    const definition = new AgreementDefinition(validDefinition);

    await expect(
      definition.createAgreement({
        input: { code: "other-code" },
        execution: {
          correlationId: "creation-correlation-id",
          executedAt: "2026-08-06T12:00:00.000Z",
        },
      }),
    ).rejects.toThrow(
      'Agreement Creation Input code "other-code" does not match Agreement Definition "test-code"',
    );
  });

  it("requires a supplied Agreement Correlation ID", async () => {
    const definition = new AgreementDefinition(validDefinition);

    await expect(
      definition.createAgreement({
        input: { code: "test-code" },
        execution: { executedAt: "2026-08-06T12:00:00.000Z" },
      }),
    ).rejects.toThrow(
      "Agreement creation requires an Agreement Correlation ID",
    );
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

  it("resolves the configured action for an external target status", () => {
    const configuration = structuredClone(validDefinition);
    configuration.states.offered.on.withdraw = { target: "withdrawn" };
    configuration.states.withdrawn = { page: "offered" };
    const definition = new AgreementDefinition(configuration);

    expect(
      definition.resolveActionForStatus({
        state: "offered",
        status: "withdrawn",
      }).transition,
    ).toEqual({
      from: "offered",
      action: "withdraw",
      target: "withdrawn",
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
