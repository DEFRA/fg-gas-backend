import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementAction,
  resolveAgreementCreation,
  resolveAgreementPage,
  resolveAgreementPageMode,
} from "./agreement-definition-resolver.js";
import { getAgreementDefinitionByCode } from "./index.js";

vi.mock("./index.js");

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
    accepted: {
      page: "accepted",
    },
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

describe("resolveAgreementCreation", () => {
  it("returns the creation configuration for a known code", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(resolveAgreementCreation("test-code")).toEqual({
      agreementNumberPrefix: "TST",
      target: "offered",
      effects: [{ name: "snapshot", params: {} }],
    });
  });

  it("does not expose the definition's states or pages", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    const result = resolveAgreementCreation("test-code");

    expect(result.states).toBeUndefined();
    expect(result.pages).toBeUndefined();
  });

  it("throws not found for an unknown agreement code", () => {
    getAgreementDefinitionByCode.mockReturnValue(undefined);

    expect(() => resolveAgreementCreation("unknown-code")).toThrow(
      'Unknown agreement code: "unknown-code"',
    );
  });

  it("throws a 500-class error when the definition has an invalid effect shape", () => {
    getAgreementDefinitionByCode.mockReturnValue({
      ...validDefinition,
      create: { target: "offered", effects: [{ output: "missingName" }] },
    });

    expect(() => resolveAgreementCreation("test-code")).toThrow(
      /Invalid agreement definition "test-code"/,
    );
    try {
      resolveAgreementCreation("test-code");
      expect.unreachable("expected resolveAgreementCreation to throw");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
    }
  });

  it("does not return the same object reference across separate calls, so a caller cannot mutate the shared definition", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    const first = resolveAgreementCreation("test-code");
    first.effects[0].params.mutated = true;

    const second = resolveAgreementCreation("test-code");

    expect(second.effects[0].params.mutated).toBeUndefined();
    expect(validDefinition.create.effects[0].params.mutated).toBeUndefined();
  });
});

describe("resolveAgreementAction", () => {
  it("returns the action configuration for a known state and action", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(resolveAgreementAction("test-code", "offered", "accept")).toEqual({
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
    });
  });

  it("throws not found for an unknown state", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      resolveAgreementAction("test-code", "unknown-state", "accept"),
    ).toThrow('Unknown state "unknown-state" for agreement code "test-code"');
  });

  it("throws not found for an unknown action", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      resolveAgreementAction("test-code", "offered", "unknown-action"),
    ).toThrow(
      'Unknown action "unknown-action" for state "offered" on agreement code "test-code"',
    );
  });

  it("throws not found for an action on a state with no transitions", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      resolveAgreementAction("test-code", "accepted", "accept"),
    ).toThrow(
      'Unknown action "accept" for state "accepted" on agreement code "test-code"',
    );
  });

  it("does not return the same object reference across separate calls, so a caller cannot mutate the shared definition", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    const first = resolveAgreementAction("test-code", "offered", "accept");
    first.effects[0].mutated = true;

    const second = resolveAgreementAction("test-code", "offered", "accept");

    expect(second.effects[0].mutated).toBeUndefined();
    expect(
      validDefinition.states.offered.on.accept.effects[0].mutated,
    ).toBeUndefined();
  });
});

describe("resolveAgreementPage", () => {
  it("returns the page configuration for a known page", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(resolveAgreementPage("test-code", "offered")).toEqual({
      title: "Offered page",
      components: [{ component: "heading", level: 1, text: "Offered" }],
    });
  });

  it("throws not found for a missing page", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() => resolveAgreementPage("test-code", "unknown-page")).toThrow(
      'Unknown page "unknown-page" for agreement code "test-code"',
    );
  });

  it("does not return the same object reference across separate calls, so a caller cannot mutate the shared definition", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    const first = resolveAgreementPage("test-code", "offered");
    first.components[0].mutated = true;

    const second = resolveAgreementPage("test-code", "offered");

    expect(second.components[0].mutated).toBeUndefined();
    expect(validDefinition.pages.offered.components[0].mutated).toBeUndefined();
  });
});

describe("assertAgreementPageAllowedForStatus", () => {
  it("does not throw when the page is the state's own page", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus("test-code", "offered", "offered"),
    ).not.toThrow();
  });

  it("does not throw when the page is an action's validation page for the state", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus("test-code", "accept", "offered"),
    ).not.toThrow();
  });

  it("throws forbidden when the page is not valid for the current status", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus("test-code", "offered", "accepted"),
    ).toThrow(
      'Page "offered" is not valid for agreement code "test-code" in state "accepted"',
    );
    try {
      assertAgreementPageAllowedForStatus("test-code", "offered", "accepted");
      expect.unreachable(
        "expected assertAgreementPageAllowedForStatus to throw",
      );
    } catch (error) {
      expect(error.output.statusCode).toBe(Boom.forbidden().output.statusCode);
    }
  });

  it("throws not found for an unknown status", () => {
    getAgreementDefinitionByCode.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus(
        "test-code",
        "offered",
        "unknown-status",
      ),
    ).toThrow('Unknown state "unknown-status" for agreement code "test-code"');
  });
});

describe("resolveAgreementPageMode", () => {
  it("returns the mode when it is supported", () => {
    expect(resolveAgreementPageMode("view")).toBe("view");
  });

  it("throws not found for an unsupported mode", () => {
    expect(() => resolveAgreementPageMode("document")).toThrow(
      'Unsupported mode "document"',
    );
  });

  it("throws not found when no mode is provided", () => {
    expect(() => resolveAgreementPageMode(undefined)).toThrow(
      'Unsupported mode "undefined"',
    );
  });
});
