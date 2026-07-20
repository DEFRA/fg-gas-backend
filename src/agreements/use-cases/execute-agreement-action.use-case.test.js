import { MongoServerError } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementDefinition } from "../models/agreement-definitions/agreement-definition.js";
import { pmfAgreementDefinition } from "../models/agreement-definitions/pmf.js";
import { AgreementReference } from "../models/agreement-reference.js";
import { AgreementVersion } from "../models/agreement-version.js";
import { Agreement } from "../models/agreement.js";
import { CurrentAgreement } from "../models/current-agreement.js";
import {
  findVersionByActionIdempotencyKey,
  saveVersion,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { executeAgreementActionUseCase } from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementContextByItem } from "./load-current-agreement-context.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");
vi.mock("./load-current-agreement-context.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  agreementItemId: "29b829c4-4e38-405c-9f00-427ee94120a5",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1"',
  idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
};

const reference = new AgreementReference({
  agreementNumber: options.agreementNumber,
  code: "pigs-might-fly",
  clientRef: "xnp-rr3-nfa",
  sbi: "300000069",
});

const agreement = new Agreement({
  id: "a889f23f-8256-4150-b82d-ee0e33a345f5",
  agreementNumber: options.agreementNumber,
  code: reference.code,
  identifiers: { sbi: reference.sbi },
  items: [
    {
      agreementItemId: options.agreementItemId,
      agreementCode: reference.code,
      clientRef: reference.clientRef,
      identifiers: { sbi: reference.sbi },
      configVersion: pmfAgreementDefinition.configVersion,
      state: "offered",
    },
    {
      agreementItemId: "another-item-id",
      agreementCode: reference.code,
      clientRef: "another-client-ref",
      identifiers: { sbi: reference.sbi },
      configVersion: pmfAgreementDefinition.configVersion,
      state: "offered",
    },
  ],
});

const currentAgreement = new CurrentAgreement({
  reference,
  version: new AgreementVersion({
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    version: 1,
    snapshot: agreement,
  }),
});

const agreementDefinition = new AgreementDefinition(pmfAgreementDefinition);
const session = { id: "session" };

const duplicateKeyError = (keyPattern) =>
  new MongoServerError({
    message: "Duplicate key",
    code: 11000,
    keyPattern,
  });

const runEffects = async (_effects, context) => ({
  ...context,
  item: {
    ...context.item,
    acceptedAt: context.executedAt,
    claimId: "R00000001",
    correlationId: "payment-correlation-id",
    originalInvoiceNumber: "R00000001-V001Q1",
    payment: { payments: [{ amount: 300 }] },
  },
  outboxEvents: [
    {
      event: {
        type: "cloud.defra.local.fg-gas-backend.agreement.status.updated",
        data: {
          agreementNumber: context.agreement.agreementNumber,
          clientRef: context.item.clientRef,
          code: context.item.agreementCode,
          version: context.version,
          status: context.target,
          date: context.executedAt,
        },
      },
      target: "some:arn",
    },
  ],
});

describe("executeAgreementActionUseCase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation((callback) => callback(session));
    loadCurrentAgreementContextByItem.mockResolvedValue({
      agreementDefinition,
      currentAgreement,
    });
    findVersionByActionIdempotencyKey.mockResolvedValue(null);
    runAgreementEffects.mockImplementation(runEffects);
  });

  it("records the accepted Agreement version and returns its current-page location", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T11:29:00.000Z"));

    const result = await executeAgreementActionUseCase(options);

    expect(result).toEqual({
      location:
        "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });
    expect(runAgreementEffects).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        agreement: currentAgreement.snapshot,
        item: currentAgreement.item,
        target: "accepted",
        version: 2,
      }),
    );
    expect(saveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
        version: 2,
        actionExecution: {
          name: options.actionName,
          agreementItemId: options.agreementItemId,
          idempotencyKey: options.idempotencyKey,
        },
      }),
      session,
    );
    expect(saveOutboxEvents).toHaveBeenCalledWith(
      [
        {
          event: expect.objectContaining({
            type: "cloud.defra.local.fg-gas-backend.agreement.status.updated",
            data: {
              agreementNumber: agreement.agreementNumber,
              clientRef: reference.clientRef,
              code: reference.code,
              status: "accepted",
              version: 2,
              date: "2026-07-17T11:29:00.000Z",
            },
          }),
          target: "some:arn",
        },
      ],
      session,
    );
    const savedVersion = saveVersion.mock.calls[0][0];
    expect(savedVersion.snapshot.items).toEqual([
      expect.objectContaining({
        agreementItemId: options.agreementItemId,
        state: "accepted",
        acceptedAt: "2026-07-17T11:29:00.000Z",
        claimId: "R00000001",
        correlationId: "payment-correlation-id",
        originalInvoiceNumber: "R00000001-V001Q1",
        payment: { payments: [{ amount: 300 }] },
      }),
      expect.objectContaining({
        agreementItemId: "another-item-id",
        state: "offered",
      }),
    ]);
    expect(currentAgreement.snapshot.items[0].state).toBe("offered");
  });

  it("returns the configured page without recording a version when validation fails", async () => {
    const result = await executeAgreementActionUseCase({
      ...options,
      values: {},
    });

    expect(result).toMatchObject({
      agreementNumber: options.agreementNumber,
      state: "offered",
      version: 1,
      page: { name: "accept" },
      values: {},
      errors: [
        {
          name: "confirm",
          message: "Confirm this agreement offer before accepting it",
        },
      ],
    });
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("rejects an action prepared from a stale Agreement version", async () => {
    await expect(
      executeAgreementActionUseCase({ ...options, ifMatch: '"stale"' }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 412,
        headers: {
          location:
            "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
        },
      },
    });
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("returns the original location when a completed action is retried", async () => {
    findVersionByActionIdempotencyKey.mockResolvedValue({
      actionExecution: { name: options.actionName },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location:
        "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key previously used for another action", async () => {
    findVersionByActionIdempotencyKey.mockResolvedValue({
      actionExecution: { name: "decline" },
    });

    await expect(executeAgreementActionUseCase(options)).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("returns 412 with the current Agreement location when another version wins", async () => {
    withTransaction.mockRejectedValue(
      duplicateKeyError({ agreementId: 1, version: 1 }),
    );

    await expect(executeAgreementActionUseCase(options)).rejects.toMatchObject({
      output: {
        statusCode: 412,
        headers: {
          location:
            "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
        },
      },
    });
  });

  it("returns the original location when the same action won concurrently", async () => {
    withTransaction.mockRejectedValue(
      duplicateKeyError({ agreementId: 1, version: 1 }),
    );
    findVersionByActionIdempotencyKey.mockResolvedValue({
      actionExecution: { name: options.actionName },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location:
        "/agreements/PMF823153883?code=pigs-might-fly&clientRef=xnp-rr3-nfa&sbi=300000069",
    });
  });

  it("does not translate an unrelated duplicate key into a stale version response", async () => {
    const error = duplicateKeyError({ _id: 1 });
    withTransaction.mockRejectedValue(error);

    await expect(executeAgreementActionUseCase(options)).rejects.toBe(error);
    expect(loadCurrentAgreementContextByItem).not.toHaveBeenCalled();
  });

  it("does not translate a non-Mongo error into a stale version response", async () => {
    const error = new Error("database unavailable");
    withTransaction.mockRejectedValue(error);

    await expect(executeAgreementActionUseCase(options)).rejects.toBe(error);
    expect(loadCurrentAgreementContextByItem).not.toHaveBeenCalled();
  });
});
