import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementByNumber,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  replaceCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { buildAgreementPageModel } from "../services/build-agreement-page-model.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { executeAgreementActionUseCase } from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";
import { loadAgreementForAction } from "./load-current-agreement.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/build-agreement-page-model.js");
vi.mock("../services/effects/agreement-effect-runner.js");
vi.mock("./load-current-agreement-action-context.js");
vi.mock("./load-current-agreement.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1"',
  idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
  access: {
    source: "defra",
    code: "pigs-might-fly",
    sbi: "300000069",
  },
};
const agreement = new Agreement({
  agreementNumber: options.agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "client",
  configVersion: "1.0.1",
  correlationId: "correlation",
  identifiers: { sbi: "300000069" },
  payload: {},
  state: "offered",
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:00.000Z",
});
const action = {
  effects: [
    {
      name: "snapshot",
      params: { acceptedAt: "$.executedAt" },
    },
    { name: "publish", params: { event: "lifecycle" } },
  ],
  transition: { target: "accepted" },
  validate: vi.fn().mockReturnValue({ valid: true }),
};
const agreementDefinition = { getEndpoints: vi.fn().mockReturnValue([]) };
const session = {};

describe("executeAgreementActionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAgreementByNumber.mockResolvedValue(agreement);
    loadAgreementForAction.mockResolvedValue(agreement);
    findVersionByIdempotencyKey.mockResolvedValue(null);
    loadCurrentAgreementActionContext.mockResolvedValue({
      action,
      agreement,
      agreementDefinition,
    });
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      agreement: { ...context.agreement, acceptedAt: context.executedAt },
      outboxMessageTypes: ["lifecycle"],
    }));
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 1 });
    withTransaction.mockImplementation((callback) => callback(session));
    action.validate.mockReturnValue({ valid: true });
  });

  it("atomically replaces current Agreement, records Version and publications", async () => {
    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
    expect(replaceCurrentAgreement).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "accepted",
        version: 2,
        acceptedAt: expect.any(String),
      }),
      1,
      session,
    );
    expect(insertAgreementVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementNumber: options.agreementNumber,
        version: 2,
        actionExecution: {
          name: "accept",
          idempotencyKey: options.idempotencyKey,
        },
      }),
      session,
    );
    expect(saveOutboxEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          event: expect.objectContaining({
            data: expect.objectContaining({
              agreementNumber: options.agreementNumber,
              version: 2,
              status: "accepted",
            }),
          }),
        }),
      ],
      session,
    );
  });

  it("returns a completed idempotent action before running effects", async () => {
    findVersionByIdempotencyKey.mockResolvedValue({
      actionExecution: { name: "accept" },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
    expect(runAgreementEffects).not.toHaveBeenCalled();
  });

  it("rejects stale ETags", async () => {
    await expect(
      executeAgreementActionUseCase({ ...options, ifMatch: '"stale"' }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 412,
        headers: {
          location: "/agreements/current",
          etag: '"PMF823153883:1"',
        },
      },
    });
  });

  it("returns field errors applied to the configured validation page", async () => {
    action.validate.mockReturnValue({
      valid: false,
      page: "review",
      errors: [
        {
          name: "declaration",
          href: "#declaration",
          message: "Agree to the declaration",
        },
      ],
    });
    buildAgreementPageModel.mockResolvedValue({
      agreement: { agreementNumber: options.agreementNumber, version: 1 },
      page: { name: "review", title: "Review" },
      components: [
        {
          component: "checkboxes",
          name: "declaration",
          items: [{ value: "agreed", text: "I agree" }, { divider: "or" }],
        },
      ],
      actions: [],
    });

    await expect(
      executeAgreementActionUseCase({ ...options, values: {} }),
    ).resolves.toEqual({
      agreement: { agreementNumber: options.agreementNumber, version: 1 },
      page: { name: "review", title: "Review" },
      components: [
        {
          component: "checkboxes",
          name: "declaration",
          errorMessage: { text: "Agree to the declaration" },
          items: [
            { value: "agreed", text: "I agree", checked: false },
            { divider: "or" },
          ],
        },
      ],
      actions: [],
      values: {},
      errors: [{ href: "#declaration", text: "Agree to the declaration" }],
    });
    expect(runAgreementEffects).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("preserves array-valued checkbox selections by configured value", async () => {
    action.validate.mockReturnValue({
      valid: false,
      page: "preferences",
      errors: [
        {
          name: "contactMethods",
          href: "#contact-methods",
          message: "Choose the required contact method",
        },
      ],
    });
    buildAgreementPageModel.mockResolvedValue({
      agreement: { agreementNumber: options.agreementNumber, version: 1 },
      page: { name: "preferences", title: "Preferences" },
      components: [
        {
          component: "checkboxes",
          name: "contactMethods",
          items: [
            { value: "email", text: "Email" },
            { value: "post", text: "Post" },
            { value: "sms", text: "Text message" },
          ],
        },
      ],
      actions: [],
    });

    const result = await executeAgreementActionUseCase({
      ...options,
      values: { contactMethods: ["email", "sms"] },
    });

    expect(result.components[0].items).toEqual([
      { value: "email", text: "Email", checked: true },
      { value: "post", text: "Post", checked: false },
      { value: "sms", text: "Text message", checked: true },
    ]);
  });

  it("applies submitted values to matching form components", async () => {
    action.validate.mockReturnValue({
      valid: false,
      page: "details",
      errors: [
        {
          name: "reference",
          href: "#reference",
          message: "Enter a valid reference",
        },
      ],
    });
    buildAgreementPageModel.mockResolvedValue({
      agreement: { agreementNumber: options.agreementNumber, version: 1 },
      page: { name: "details", title: "Details" },
      components: [
        { component: "text-input", name: "reference" },
        { component: "text-input", name: "unsubmitted" },
      ],
      actions: [],
    });

    const result = await executeAgreementActionUseCase({
      ...options,
      values: { reference: "submitted-reference" },
    });

    expect(result.components).toEqual([
      {
        component: "text-input",
        name: "reference",
        value: "submitted-reference",
        errorMessage: { text: "Enter a valid reference" },
      },
      { component: "text-input", name: "unsubmitted" },
    ]);
  });

  it("applies submitted state and errors within the resolved component tree", async () => {
    action.validate.mockReturnValue({
      valid: false,
      page: "review",
      errors: [
        {
          name: "terms",
          href: "#terms",
          message: "Accept the terms",
        },
      ],
    });
    buildAgreementPageModel.mockResolvedValue({
      agreement: { agreementNumber: options.agreementNumber, version: 1 },
      page: { name: "review", title: "Review" },
      components: [
        {
          component: "fieldset",
          metadata: { name: "terms", value: "configured-metadata" },
          attributes: { value: "configured-attribute" },
          content: [
            {
              component: "checkboxes",
              name: "terms",
              items: [{ value: "accepted", text: "Accept" }],
            },
          ],
        },
      ],
      actions: [],
    });

    const result = await executeAgreementActionUseCase({
      ...options,
      values: {
        terms: "accepted",
        undefined: "submitted-undefined",
      },
    });

    expect(result.components[0].metadata).toEqual({
      name: "terms",
      value: "configured-metadata",
    });
    expect(result.components[0].attributes).toEqual({
      value: "configured-attribute",
    });
    expect(result.components[0].content[0]).toEqual({
      component: "checkboxes",
      name: "terms",
      errorMessage: { text: "Accept the terms" },
      items: [{ value: "accepted", text: "Accept", checked: true }],
    });
  });

  it("returns an idempotent result when the same action completes concurrently", async () => {
    findVersionByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actionExecution: { name: "accept" } });
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 0 });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
    expect(findAgreementByNumber).not.toHaveBeenCalled();
  });

  it("returns an idempotent result after a concurrent version conflict", async () => {
    findVersionByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actionExecution: { name: "accept" } });
    withTransaction.mockRejectedValue(
      new MongoServerError({
        message: "Duplicate key",
        code: 11000,
        keyPattern: { agreementNumber: 1, version: 1 },
      }),
    );

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
  });

  it("rejects a concurrent stale replacement", async () => {
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 0 });

    await expect(executeAgreementActionUseCase(options)).rejects.toMatchObject({
      output: { statusCode: 412 },
    });
    expect(insertAgreementVersion).not.toHaveBeenCalled();
  });

  it("returns not found when the Agreement disappears during conflict resolution", async () => {
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 0 });
    findAgreementByNumber.mockResolvedValue(null);

    await expect(executeAgreementActionUseCase(options)).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { message: "Agreement not found" },
      },
    });
  });
});
