import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
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

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/build-agreement-page-model.js");
vi.mock("../services/effects/agreement-effect-runner.js");
vi.mock("./load-current-agreement-action-context.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1"',
  idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
};
const agreement = {
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
};
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
      location: "/agreements/PMF823153883",
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
      location: "/agreements/PMF823153883",
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
          location: "/agreements/PMF823153883",
          etag: '"PMF823153883:1"',
        },
      },
    });
  });

  it("returns configured validation without committing", async () => {
    const errors = [{ name: "confirm", href: "#confirm", message: "Confirm" }];
    action.validate.mockReturnValue({ valid: false, page: "accept", errors });
    buildAgreementPageModel.mockResolvedValue({
      agreement: { agreementNumber: "PMF823153883" },
    });

    await expect(
      executeAgreementActionUseCase({ ...options, values: {} }),
    ).resolves.toMatchObject({ values: {}, errors });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("returns an idempotent result when the same action completes concurrently", async () => {
    findVersionByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actionExecution: { name: "accept" } });
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 0 });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/PMF823153883",
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
      location: "/agreements/PMF823153883",
    });
  });

  it("rejects a concurrent stale replacement", async () => {
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 0 });

    await expect(executeAgreementActionUseCase(options)).rejects.toMatchObject({
      output: { statusCode: 412 },
    });
    expect(insertAgreementVersion).not.toHaveBeenCalled();
  });
});
