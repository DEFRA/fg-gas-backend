import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { executeAgreementAction } from "./execute-agreement-action.use-case.js";
import { invokeAgreementActionUseCase } from "./invoke-agreement-action.use-case.js";
import { renderAgreementUseCase } from "./render-agreement.use-case.js";

vi.mock("../../common/with-transaction.js", () => ({
  withTransaction: vi.fn((runInTransaction) => runInTransaction("session")),
}));
vi.mock("./execute-agreement-action.use-case.js");
vi.mock("./render-agreement.use-case.js");

describe("accept Agreement use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an Agreement and returns the next rendered page model", async () => {
    executeAgreementAction.mockResolvedValue({
      agreementItemId: "internal-agreement-item-id",
      agreementNumber: "PMF000000001",
      clientRef: "PMF-APP-001",
      code: "pigs-might-fly",
      status: "accepted",
    });
    renderAgreementUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        status: "accepted",
      },
      page: {
        id: "accepted",
        title: "Agreement accepted",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Agreement accepted",
        },
      ],
    });

    const result = await invokeAgreementActionUseCase({
      actionName: "accept",
      agreementNumber: "PMF000000001",
      payload: {
        code: "request-code",
        clientRef: "request-client-ref",
        confirm: "confirmed",
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
          confirm: "confirmed",
          acceptedBy: "applicant",
        },
      },
      "session",
    );
    expect(renderAgreementUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF000000001",
      page: "accepted",
    });
    expect(result).toEqual({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        status: "accepted",
      },
      page: {
        id: "accepted",
        title: "Agreement accepted",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Agreement accepted",
        },
      ],
    });
  });

  it("returns the configured action page with validation errors when action validation fails", async () => {
    const validationError = Boom.badRequest(
      "Confirm this agreement offer before accepting it",
    );
    validationError.data = {
      validation: {
        page: "accept",
        fields: [
          {
            href: "#confirm",
            message: "Confirm this agreement offer before accepting it",
            name: "confirm",
          },
        ],
      },
    };
    executeAgreementAction.mockRejectedValue(validationError);
    renderAgreementUseCase.mockResolvedValue({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        status: "offered",
      },
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Accept your agreement offer",
        },
      ],
      actions: [
        {
          action: "/PMF000000001/actions/accept",
          checkbox: {
            name: "confirm",
            value: "confirmed",
            text: "I confirm I have read the information in this section and accept this agreement offer.",
          },
          fields: [
            { name: "code", value: "pigs-might-fly" },
            { name: "clientRef", value: "PMF-APP-001" },
          ],
          text: "Accept agreement offer",
        },
      ],
    });

    await expect(
      invokeAgreementActionUseCase({
        actionName: "accept",
        agreementNumber: "PMF000000001",
        payload: {
          code: "pigs-might-fly",
          clientRef: "PMF-APP-001",
          acceptedBy: "applicant",
        },
      }),
    ).resolves.toEqual({
      source: "config",
      agreement: {
        agreementNumber: "PMF000000001",
        status: "offered",
      },
      page: {
        id: "accept",
        title: "Accept your agreement offer",
      },
      components: [
        {
          component: "heading",
          level: 1,
          text: "Accept your agreement offer",
        },
      ],
      actions: [
        {
          action: "/PMF000000001/actions/accept",
          checkbox: {
            name: "confirm",
            value: "confirmed",
            text: "I confirm I have read the information in this section and accept this agreement offer.",
            errorMessage: {
              text: "Confirm this agreement offer before accepting it",
            },
          },
          fields: [
            { name: "code", value: "pigs-might-fly" },
            { name: "clientRef", value: "PMF-APP-001" },
          ],
          text: "Accept agreement offer",
        },
      ],
      errors: [
        {
          href: "#confirm",
          text: "Confirm this agreement offer before accepting it",
        },
      ],
    });
    expect(renderAgreementUseCase).toHaveBeenCalledWith({
      agreementNumber: "PMF000000001",
      page: "accept",
    });
  });
});
