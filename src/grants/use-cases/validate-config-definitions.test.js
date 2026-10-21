import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDefinitionChecks,
  registerDefinitionCheck,
} from "../../common/config-broker/definition-checks.js";
import { logger } from "../../common/logger.js";
import { validateConfigDefinitions } from "./validate-config-definitions.js";

const { mockFetchConfigFile, mockCheckAgreement, mockCompilePayment } =
  vi.hoisted(() => ({
    mockFetchConfigFile: vi.fn(),
    mockCheckAgreement: vi.fn(),
    mockCompilePayment: vi.fn(),
  }));

vi.mock("../../common/logger.js");

vi.mock("../../common/s3-client.js", () => ({
  fetchConfigFile: (...args) => mockFetchConfigFile(...args),
}));

vi.mock("../../agreements/use-cases/compile-agreement-definition.js", () => ({
  checkAgreementDefinition: (...args) => mockCheckAgreement(...args),
}));

const grantDefinition = {
  code: "woodland",
  metadata: { description: "Woodland", startDate: "2023-01-01T00:00:00Z" },
  actions: [],
  amendablePositions: [],
  phases: [
    {
      code: "PRE_AWARD",
      stages: [
        {
          code: "ASSESSMENT",
          statuses: [{ code: "APPLICATION_RECEIVED", validFrom: [] }],
        },
      ],
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    },
  ],
};

const readDefinition = (path) =>
  JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url)));

const validate = (s3Keys) =>
  validateConfigDefinitions({
    grantCode: "woodland",
    version: "1.2.0",
    s3Bucket: "configs-bucket",
    s3Keys,
  });

beforeEach(() => {
  vi.clearAllMocks();
  clearDefinitionChecks();
  registerDefinitionCheck("payment", ({ definition, grantCode }) =>
    mockCompilePayment(definition, grantCode),
  );
  mockFetchConfigFile.mockResolvedValue(grantDefinition);
});

describe("validateConfigDefinitions", () => {
  it("checks the grant definition", async () => {
    await validate({ grant: "woodland/1.2.0/gas/gas.json" });

    expect(mockFetchConfigFile).toHaveBeenCalledWith(
      "configs-bucket",
      "woodland/1.2.0/gas/gas.json",
    );
  });

  it("asks each context to check its own definition", async () => {
    await validate({
      grant: "woodland/1.2.0/gas/gas.json",
      agreement: "woodland/1.2.0/gas/agreement.json",
      payment: "woodland/1.2.0/gas/payment.json",
    });

    expect(mockCheckAgreement).toHaveBeenCalledWith(
      grantDefinition,
      "woodland",
      "1.2.0",
    );
    expect(mockCompilePayment).toHaveBeenCalledWith(
      grantDefinition,
      "woodland",
    );
  });

  it("skips the definitions the manifest does not carry", async () => {
    await validate({ grant: "woodland/1.2.0/gas/gas.json" });

    expect(mockFetchConfigFile).toHaveBeenCalledTimes(1);
    expect(mockCheckAgreement).not.toHaveBeenCalled();
    expect(mockCompilePayment).not.toHaveBeenCalled();
  });

  it("rejects a grant definition that cannot be built", async () => {
    mockFetchConfigFile.mockResolvedValue({ code: "woodland" });

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).rejects.toThrow();
  });

  it("logs and rejects a grant definition that points at no position", async () => {
    mockFetchConfigFile.mockResolvedValue({
      ...grantDefinition,
      amendablePositions: ["PRE_AWARD:ASSESSMENT:MISSING"],
    });

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).rejects.toMatchObject({ isBoom: true });

    expect(logger.error).toHaveBeenCalledWith(
      { event: { action: "config-definition-check-failed" } },
      expect.stringContaining(
        'amendable position "PRE_AWARD:ASSESSMENT:MISSING"',
      ),
    );
  });

  it.each([
    "compose/seed/pigs-might-fly/1.0.0/gas/gas.json",
    "compose/seed/woodland/1.39.1/gas/gas.json",
    "test/fixtures/pmf-grant-definition.json",
    "test/fixtures/wmp/woodland.json",
    "test/fixtures/grasslands/grasslands.json",
  ])("accepts the grant definition in %s", async (path) => {
    mockFetchConfigFile.mockResolvedValue(readDefinition(path));

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a grant definition that runs a process GAS has no handler for", async () => {
    const [phase] = grantDefinition.phases;
    const [stage] = phase.stages;
    mockFetchConfigFile.mockResolvedValue({
      ...grantDefinition,
      phases: [
        {
          ...phase,
          stages: [
            {
              ...stage,
              statuses: [
                { code: "APPLICATION_RECEIVED", validFrom: [] },
                {
                  code: "IN_REVIEW",
                  validFrom: [
                    { code: "APPLICATION_RECEIVED", processes: ["UNHANDLED"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).rejects.toThrow('runs unknown process "UNHANDLED"');
  });

  it("rejects a grant definition whose questions the answers validator cannot compile", async () => {
    const [phase] = grantDefinition.phases;
    mockFetchConfigFile.mockResolvedValue({
      ...grantDefinition,
      phases: [
        {
          ...phase,
          questions: { type: "object", unknownKeyword: true },
        },
      ],
    });

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).rejects.toThrow(/questions cannot be compiled: .*unknownKeyword/);
  });

  it("rejects when the agreement definition cannot be used", async () => {
    const failure = new Error("bad agreement definition");
    mockCheckAgreement.mockImplementation(() => {
      throw failure;
    });

    await expect(
      validate({
        grant: "woodland/1.2.0/gas/gas.json",
        agreement: "woodland/1.2.0/gas/agreement.json",
      }),
    ).rejects.toBe(failure);
  });

  it("rejects when the payment definition cannot be used", async () => {
    const failure = new Error("bad payment definition");
    mockCompilePayment.mockImplementation(() => {
      throw failure;
    });

    await expect(
      validate({
        grant: "woodland/1.2.0/gas/gas.json",
        payment: "woodland/1.2.0/gas/payment.json",
      }),
    ).rejects.toBe(failure);
  });

  // The error type is how the caller later tells a bad definition from a bad S3.
  it("lets a fetch failure through unchanged", async () => {
    const failure = new Error("S3 is unavailable");
    mockFetchConfigFile.mockRejectedValue(failure);

    await expect(
      validate({ grant: "woodland/1.2.0/gas/gas.json" }),
    ).rejects.toBe(failure);
  });

  it("stops at the first definition it cannot use", async () => {
    mockCheckAgreement.mockImplementation(() => {
      throw new Error("bad agreement definition");
    });

    await expect(
      validate({
        grant: "woodland/1.2.0/gas/gas.json",
        agreement: "woodland/1.2.0/gas/agreement.json",
        payment: "woodland/1.2.0/gas/payment.json",
      }),
    ).rejects.toThrow();

    expect(mockCompilePayment).not.toHaveBeenCalled();
  });
});
