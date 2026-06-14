import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { executeAgreementAction } from "./execute-agreement-action.use-case.js";
import { invokeAgreementActionUseCase } from "./invoke-agreement-action.use-case.js";

vi.mock("../../common/with-transaction.js", () => ({
  withTransaction: vi.fn((runInTransaction) => runInTransaction("session")),
}));
vi.mock("./execute-agreement-action.use-case.js");

describe("accept Agreement use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an Agreement without returning the internal Agreement item id", async () => {
    executeAgreementAction.mockResolvedValue({
      agreementItemId: "internal-agreement-item-id",
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      status: "accepted",
    });

    const result = await invokeAgreementActionUseCase({
      actionName: "accept",
      agreementNumber: "PMF000000001",
      payload: {
        code: "request-code",
        clientRef: "request-client-ref",
        acceptedBy: "applicant",
      },
    });

    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function));
    expect(executeAgreementAction).toHaveBeenCalledWith(
      {
        agreementNumber: "PMF000000001",
        actionName: "accept",
        payload: {
          code: "request-code",
          clientRef: "request-client-ref",
          acceptedBy: "applicant",
        },
      },
      "session",
    );
    expect(result).toEqual({
      agreementNumber: "PMF000000001",
      code: "pigs-might-fly",
      clientRef: "PMF-APP-001",
      status: "accepted",
    });
  });
});
