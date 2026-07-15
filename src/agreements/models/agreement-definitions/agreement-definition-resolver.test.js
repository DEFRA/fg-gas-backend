import Boom from "@hapi/boom";
import { describe, expect, it, vi } from "vitest";
import {
  assertAgreementPageAllowedForStatus,
  resolveAgreementActionForVersion,
  resolveAgreementPageForStatus,
  resolveAgreementPageForVersion,
  resolveAgreementPageMode,
} from "./agreement-definition-resolver.js";
import { getAgreementDefinitionByCodeAndVersion } from "./index.js";

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

describe("resolveAgreementActionForVersion", () => {
  it("returns the Agreement Action configured for the persisted definition version", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    const action = resolveAgreementActionForVersion({
      code: "test-code",
      state: "offered",
      action: "accept",
      configVersion: "0.0.1",
    });

    expect(action.transition).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("preserves the resolved state and action when extensible config contains conflicting metadata", () => {
    const definition = structuredClone(validDefinition);
    definition.states.offered.on.accept.from = "accepted";
    definition.states.offered.on.accept.name = "withdraw";
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(definition);

    const action = resolveAgreementActionForVersion({
      code: "test-code",
      state: "offered",
      action: "accept",
      configVersion: "0.0.1",
    });

    expect(action.transition).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
  });

  it("rejects an unavailable definition version", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(undefined);

    expect(() =>
      resolveAgreementActionForVersion({
        code: "test-code",
        state: "offered",
        action: "accept",
        configVersion: "0.0.0",
      }),
    ).toThrow(
      'Agreement definition "test-code" version "0.0.0" is unavailable',
    );
  });

  it("treats a persisted state absent from its definition as an integrity failure", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    try {
      resolveAgreementActionForVersion({
        code: "test-code",
        state: "future-state",
        action: "accept",
        configVersion: "0.0.1",
      });
      expect.unreachable("expected action resolution to fail");
    } catch (error) {
      expect(error.output.statusCode).toBe(500);
      expect(error.message).toBe(
        'Agreement code "test-code" has unknown persisted state "future-state"',
      );
    }
  });
});

describe("resolveAgreementPageForVersion", () => {
  it("loads the exact definition version before resolving the page", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    expect(
      resolveAgreementPageForVersion({
        code: "test-code",
        page: "offered",
        configVersion: "0.0.1",
      }),
    ).toEqual(validDefinition.pages.offered);

    expect(getAgreementDefinitionByCodeAndVersion).toHaveBeenCalledWith(
      "test-code",
      "0.0.1",
    );
  });

  it("rejects an unavailable definition version before resolving the page", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(undefined);

    expect(() =>
      resolveAgreementPageForVersion({
        code: "test-code",
        page: "offered",
        configVersion: "0.0.0",
      }),
    ).toThrow(
      'Agreement definition "test-code" version "0.0.0" is unavailable',
    );
  });
});

describe("resolveAgreementPageForStatus", () => {
  it("returns the page configured for the lifecycle state", () => {
    const definition = structuredClone(validDefinition);
    definition.states.offered.page = "accept";
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(definition);

    expect(
      resolveAgreementPageForStatus({
        code: "test-code",
        status: "offered",
        configVersion: "0.0.1",
      }),
    ).toEqual({
      pageId: "accept",
    });
  });

  it("treats a state without a configured page as a definition defect", () => {
    const definition = structuredClone(validDefinition);
    definition.states.offered.page = "missing";
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(definition);

    expect(() =>
      resolveAgreementPageForStatus({
        code: "test-code",
        status: "offered",
        configVersion: "0.0.1",
      }),
    ).toThrow('state "offered" has no configured page');
  });
});

describe("assertAgreementPageAllowedForStatus", () => {
  it("does not throw when the page is the state's own page", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus(
        "test-code",
        "offered",
        "offered",
        "0.0.1",
      ),
    ).not.toThrow();
  });

  it("does not throw when the page is an action's validation page for the state", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus(
        "test-code",
        "accept",
        "offered",
        "0.0.1",
      ),
    ).not.toThrow();
  });

  it("throws forbidden when the page is not valid for the current status", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus(
        "test-code",
        "offered",
        "accepted",
        "0.0.1",
      ),
    ).toThrow(
      'Page "offered" is not valid for agreement code "test-code" in state "accepted"',
    );
    try {
      assertAgreementPageAllowedForStatus(
        "test-code",
        "offered",
        "accepted",
        "0.0.1",
      );
      expect.unreachable(
        "expected assertAgreementPageAllowedForStatus to throw",
      );
    } catch (error) {
      expect(error.output.statusCode).toBe(Boom.forbidden().output.statusCode);
    }
  });

  it("throws not found for an unknown status", () => {
    getAgreementDefinitionByCodeAndVersion.mockReturnValue(validDefinition);

    expect(() =>
      assertAgreementPageAllowedForStatus(
        "test-code",
        "offered",
        "unknown-status",
        "0.0.1",
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
