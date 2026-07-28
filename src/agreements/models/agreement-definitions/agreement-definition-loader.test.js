import { describe, expect, it, vi } from "vitest";
import { loadAgreementDefinition } from "./agreement-definition-loader.js";
import { findAgreementDefinition } from "./agreement-definition-registry.js";

vi.mock("./agreement-definition-registry.js");

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

describe("loadAgreementDefinition", () => {
  it("loads the exact config version and returns its domain behaviour", async () => {
    findAgreementDefinition.mockReturnValue(validDefinition);

    const definition = await loadAgreementDefinition({
      code: "test-code",
      configVersion: "0.0.1",
    });

    expect(
      definition.resolveAction({ state: "offered", action: "accept" })
        .transition,
    ).toEqual({
      from: "offered",
      action: "accept",
      target: "accepted",
    });
    expect(findAgreementDefinition).toHaveBeenCalledWith({
      code: "test-code",
      configVersion: "0.0.1",
    });
  });

  it("rejects an unavailable config version", async () => {
    findAgreementDefinition.mockReturnValue(undefined);

    await expect(
      loadAgreementDefinition({
        code: "test-code",
        configVersion: "0.0.0",
      }),
    ).rejects.toThrow(
      'Agreement definition "test-code" version "0.0.0" is unavailable',
    );
  });

  it("loads the default definition as a domain object when no version is supplied", async () => {
    findAgreementDefinition.mockReturnValue(validDefinition);

    const definition = await loadAgreementDefinition({
      code: "test-code",
    });

    expect(
      definition.createAgreement({
        clientRef: "xnp-rr3-nfa",
        identifiers: { sbi: "300000069" },
        payload: {},
        sourceSystem: "GAS",
      }).state,
    ).toBe("offered");
    expect(findAgreementDefinition).toHaveBeenCalledWith({
      code: "test-code",
      configVersion: undefined,
    });
  });

  it("rejects an unavailable default definition as an implementation error", async () => {
    findAgreementDefinition.mockReturnValue(undefined);

    await expect(
      loadAgreementDefinition({
        code: "unknown-code",
      }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
  });
});
