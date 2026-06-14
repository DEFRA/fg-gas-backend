import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agreementCreationOutcomes,
  createAgreement,
} from "./create-agreement.use-case.js";
import { processCreateAgreementCommandUseCase } from "./process-create-agreement-command.use-case.js";
import { publishAgreementResult } from "./publish-agreement-result.use-case.js";

vi.mock("./create-agreement.use-case.js");
vi.mock("./publish-agreement-result.use-case.js");

describe("process create agreement command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a PMF agreement internally and delegates publication concern", async () => {
    const session = {};
    const createResult = {
      outcome: agreementCreationOutcomes.CREATED,
      agreementId: "agreement-id",
      agreementNumber: "PMF123456789",
      sbi: "123456789",
      version: {
        id: "version-id",
      },
      item: {
        agreementItemId: "agreement-item-id",
        agreementCode: "pigs-might-fly",
        clientRef: "PMF-APP-001",
      },
    };

    createAgreement.mockResolvedValue(createResult);

    const result = await processCreateAgreementCommandUseCase(
      {
        data: {
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
          identifiers: { sbi: "123456789", frn: "frn-1" },
          metadata: { defraId: "defra-id-1" },
          answers: { canPigsFly: true },
        },
      },
      session,
    );

    expect(result).toBe(createResult);
    expect(createAgreement).toHaveBeenCalledWith(
      {
        clientRef: "PMF-APP-001",
        code: "pigs-might-fly",
        identifiers: { sbi: "123456789", frn: "frn-1" },
        metadata: { defraId: "defra-id-1" },
        answers: { canPigsFly: true },
      },
      session,
    );
    expect(publishAgreementResult).toHaveBeenCalledWith(createResult, session);
  });

  it("delegates idempotent Creation results to publication concern", async () => {
    const createResult = {
      outcome: agreementCreationOutcomes.ALREADY_CREATED,
      agreementId: "agreement-id",
      sbi: "123456789",
    };

    createAgreement.mockResolvedValue(createResult);

    const result = await processCreateAgreementCommandUseCase(
      {
        data: {
          clientRef: "PMF-APP-001",
          code: "pigs-might-fly",
          identifiers: { sbi: "123456789" },
          answers: { canPigsFly: true },
        },
      },
      "session",
    );

    expect(result).toBe(createResult);
    expect(publishAgreementResult).toHaveBeenCalledWith(
      createResult,
      "session",
    );
  });
});
