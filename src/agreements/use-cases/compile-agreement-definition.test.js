import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EndpointServiceUrlError } from "../services/integrations/resolve-endpoint-service-url.js";
import { logger } from "../../common/logger.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import {
  checkAgreementDefinition,
  compileAgreementDefinition,
} from "./compile-agreement-definition.js";

vi.mock("../../common/logger.js");

const { mockValidateEndpointServiceUrls } = vi.hoisted(() => ({
  mockValidateEndpointServiceUrls: vi.fn(),
}));

// Only the URL check is mocked: it is the one thing that fails because of our deployment
// rather than the definition, which is the distinction this module exists to make.
vi.mock("../services/integrations/resolve-endpoint-service-url.js", async () => {
  const actual = await vi.importActual(
    "../services/integrations/resolve-endpoint-service-url.js",
  );

  return {
    ...actual,
    validateEndpointServiceUrls: (...args) =>
      mockValidateEndpointServiceUrls(...args),
  };
});

const CODE = "pigs-might-fly";

const definition = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../compose/seed/pigs-might-fly/1.0.0/gas/agreement.json",
        import.meta.url,
      ),
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("compileAgreementDefinition", () => {
  it("builds a definition and applies the version from the catalog", () => {
    const compiled = compileAgreementDefinition(definition(), CODE, "1.2.0");

    expect(compiled).toBeInstanceOf(AgreementDefinition);
    expect(compiled.configVersion).toBe("1.2.0");
  });

  it("rejects a definition whose code is not the grant being released", () => {
    expect(() =>
      compileAgreementDefinition(definition(), "some-other-grant", "1.2.0"),
    ).toThrow(/does not match "some-other-grant"/);
  });

  // The catalog owns the version, so a producer setting it would be claiming something
  // it does not get to decide.
  it("rejects a definition that declares its own configVersion", () => {
    expect(() =>
      compileAgreementDefinition(
        { ...definition(), configVersion: "9.9.9" },
        CODE,
        "1.2.0",
      ),
    ).toThrow(/must not declare configVersion/);
  });
});

describe("checkAgreementDefinition", () => {
  it("accepts a definition that builds", () => {
    expect(() =>
      checkAgreementDefinition(definition(), CODE, "1.2.0"),
    ).not.toThrow();
  });

  // Our settings being wrong must not mark a good published version as broken.
  it("ignores a missing endpoint service URL, and says so", () => {
    mockValidateEndpointServiceUrls.mockImplementation(() => {
      throw new EndpointServiceUrlError("no url configured for service x");
    });

    expect(() =>
      checkAgreementDefinition(definition(), CODE, "1.2.0"),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipped Agreement definition checks"),
    );
  });

  it("passes on a failure that is the definition's own fault", () => {
    expect(() =>
      checkAgreementDefinition(definition(), "some-other-grant", "1.2.0"),
    ).toThrow(/does not match/);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
