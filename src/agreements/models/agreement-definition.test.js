import { describe, expect, it } from "vitest";
import {
  agreementCommandNames,
  agreementCommandRoutes,
  agreementImplementations,
  getAgreementCommandRoute,
  getAgreementDefinition,
} from "./agreement-definition.js";

describe("Agreement definition", () => {
  it("defines PMF as a config-backed Agreement", () => {
    expect(getAgreementDefinition("pigs-might-fly")).toEqual({
      agreementCode: "pigs-might-fly",
      implementation: agreementImplementations.CONFIG,
      configVersion: "0.0.1",
      agreementNumber: {
        prefix: "PMF",
        randomDigits: 9,
        uniquenessScope: "agreementNumber",
      },
      commands: {
        create: {
          route: agreementCommandRoutes.INTERNAL,
        },
      },
      lifecycle: {
        initialStatus: "offered",
        initialChangeType: "created",
        changedBy: "system",
        fromStatus: null,
      },
    });
  });

  it("treats unknown Agreement codes as legacy", () => {
    expect(getAgreementDefinition("frps-beta")).toEqual({
      agreementCode: "frps-beta",
      implementation: agreementImplementations.LEGACY,
    });
  });

  it("routes PMF create commands internally", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "pigs-might-fly",
        commandName: agreementCommandNames.CREATE,
      }),
    ).toBe(agreementCommandRoutes.INTERNAL);
  });

  it("routes unknown Agreement commands to legacy", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "pigs-might-fly",
        commandName: "cancel",
      }),
    ).toBe(agreementCommandRoutes.LEGACY);
  });

  it("routes unknown Agreement definitions to legacy", () => {
    expect(
      getAgreementCommandRoute({
        agreementCode: "frps-beta",
        commandName: agreementCommandNames.CREATE,
      }),
    ).toBe(agreementCommandRoutes.LEGACY);
  });
});
