import { beforeEach, describe, expect, it, vi } from "vitest";
import { agreementCreationOutcomes } from "../models/agreement-creation-result.js";
import { publishAgreementCreation } from "./publish-agreement-creation.use-case.js";
import { publishAgreementLifecycle } from "./publish-agreement-lifecycle.use-case.js";

vi.mock("./publish-agreement-lifecycle.use-case.js");

describe("publish agreement creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates created Creation results to lifecycle publication", async () => {
    const creation = {
      outcome: agreementCreationOutcomes.CREATED,
      agreement: { id: "agreement-id" },
      item: { agreementItemId: "agreement-item-id" },
      version: { id: "version-id" },
    };

    await publishAgreementCreation(creation, "session");

    expect(publishAgreementLifecycle).toHaveBeenCalledWith(
      {
        agreement: creation.agreement,
        item: creation.item,
        version: creation.version,
      },
      "session",
    );
  });

  it("does not publish for an idempotent Creation result", async () => {
    await publishAgreementCreation(
      {
        outcome: agreementCreationOutcomes.ALREADY_CREATED,
        agreementId: "agreement-id",
        sbi: "123456789",
      },
      "session",
    );

    expect(publishAgreementLifecycle).not.toHaveBeenCalled();
  });
});
