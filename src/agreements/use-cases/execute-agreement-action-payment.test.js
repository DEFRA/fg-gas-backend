import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOutboxEvents } from "../../common/save-outbox-events.js";
import { withTransaction } from "../../common/with-transaction.js";
import { allocateNextSequence } from "../../payments/repositories/counter.repository.js";
import { insertPayment } from "../../payments/repositories/payment.repository.js";
import { Agreement } from "../models/agreement.js";
import {
  findAgreementByNumber,
  findVersionByIdempotencyKey,
  insertAgreementVersion,
  replaceCurrentAgreement,
} from "../repositories/agreement.repository.js";
import { runAgreementEffects } from "../services/effects/agreement-effect-runner.js";
import { executeAgreementActionUseCase } from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock(
  "../../payments/repositories/counter.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    allocateNextSequence: vi.fn(),
  }),
);
vi.mock("../../payments/repositories/payment.repository.js");
vi.mock("../services/effects/agreement-effect-runner.js");
vi.mock("./load-current-agreement-action-context.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1"',
  idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
};

const agreement = new Agreement({
  agreementNumber: options.agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "client",
  configVersion: "1.1.0",
  correlationId: "correlation",
  identifiers: { sbi: "106284736", frn: "1101234567" },
  payload: { whitePigsCount: 2, berkshirePigsCount: 1 },
  state: "offered",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
});

const mapping = {
  scheme: "SFI",
  sourceSystem: "FPTT",
  deliveryBody: "RP00",
  fesCode: "FALS_FPTT",
  ledger: "AP",
  currency: "GBP",
  invoiceLine: {
    schemeCode: "CMOR1",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
};

const paymentCalculation = {
  agreementStartDate: "2026-08-01",
  agreementEndDate: "2027-07-31",
  agreementTotalPence: 3800,
  payments: [
    {
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      invoiceLines: [
        { description: "Large White Pig", amountPence: 2000 },
        { description: "Berkshire", amountPence: 1800 },
      ],
    },
  ],
};

const action = {
  effects: [],
  transition: { target: "accepted" },
  validate: vi.fn().mockReturnValue({ valid: true }),
};
const agreementDefinition = { getEndpoints: vi.fn().mockReturnValue([]) };
const session = {};

describe("executeAgreementActionUseCase with a createPayment effect", () => {
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
      agreement: {
        ...context.agreement,
        acceptedAt: context.executedAt,
        paymentCalculation,
      },
      outboxMessageTypes: ["lifecycle"],
      paymentRequest: { paymentCalculation, mapping },
    }));
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 1 });
    withTransaction.mockImplementation((callback) => callback(session));
    allocateNextSequence.mockResolvedValue(1);
    action.validate.mockReturnValue({ valid: true });
  });

  it("commits the Payment with the Agreement, Version and lifecycle event", async () => {
    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/PMF823153883",
    });

    expect(insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          type: "agreement",
          agreementNumber: options.agreementNumber,
          version: 2,
        },
        paymentHubClaimId: "R00000001",
        invoiceNumber: "R00000001-V001QX",
        totalAmountPence: 3800,
        scheme: "SFI",
        fesCode: "FALS_FPTT",
      }),
      session,
    );
    expect(replaceCurrentAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ state: "accepted", version: 2 }),
      1,
      session,
    );
    expect(insertAgreementVersion).toHaveBeenCalledWith(
      expect.anything(),
      session,
    );
    expect(saveOutboxEvents).toHaveBeenCalledWith(expect.anything(), session);
  });

  it("commits the lifecycle event only, creating no Payment Service event", async () => {
    await executeAgreementActionUseCase(options);

    const [events] = saveOutboxEvents.mock.calls[0];

    expect(events).toHaveLength(1);
    expect(events[0].event.type).toMatch(/agreement\.status\.updated$/);
  });

  it("stores everything a Payment Service message needs on the Payment", async () => {
    await executeAgreementActionUseCase(options);

    const [payment] = insertPayment.mock.calls[0];

    // A follow-up story builds the message from the Payment alone, so none of
    // these may require loading the Agreement or its definition.
    expect(payment).toMatchObject({
      sbi: "106284736",
      frn: "1101234567",
      paymentHubClaimId: "R00000001",
      scheme: "SFI",
      sourceSystem: "FPTT",
      deliveryBody: "RP00",
      fesCode: "FALS_FPTT",
      paymentRequestNumber: 1,
      invoiceNumber: "R00000001-V001QX",
      originalInvoiceNumber: "",
      ledger: "AP",
      totalAmountPence: 3800,
      currency: "GBP",
      marketingYear: expect.any(String),
      correlationId: expect.any(String),
    });
    expect(payment.source.agreementNumber).toBe(options.agreementNumber);
    expect(payment.instalments[0]).toMatchObject({
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      status: "pending",
      correlationId: expect.any(String),
    });
    expect(payment.instalments[0].invoiceLines[0]).toMatchObject({
      schemeCode: "CMOR1",
      description: "Large White Pig",
      amountPence: 2000,
      accountCode: "SOS710",
      fundCode: "DRD10",
      deliveryBody: "RP00",
    });
  });

  it("keeps pence numeric on the Payment", async () => {
    await executeAgreementActionUseCase(options);

    const [payment] = insertPayment.mock.calls[0];

    expect(payment.totalAmountPence).toBe(3800);
    expect(payment.instalments[0].invoiceLines[0].amountPence).toBe(2000);
  });

  it("stores the validated Payment Calculation on the Agreement and Version", async () => {
    await executeAgreementActionUseCase(options);

    expect(replaceCurrentAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ paymentCalculation }),
      1,
      session,
    );
    expect(insertAgreementVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ paymentCalculation }),
      }),
      session,
    );
  });

  it("allocates the claim ID inside the action transaction", async () => {
    let allocatedBeforeTransaction = true;
    withTransaction.mockImplementation((callback) => {
      allocatedBeforeTransaction = allocateNextSequence.mock.calls.length > 0;
      return callback(session);
    });

    await executeAgreementActionUseCase(options);

    expect(allocatedBeforeTransaction).toBe(false);
    expect(allocateNextSequence).toHaveBeenCalledWith("claimIds", session);
  });

  it("does not write to Mongo before the transaction starts", async () => {
    withTransaction.mockImplementation((callback) => {
      expect(insertPayment).not.toHaveBeenCalled();
      expect(allocateNextSequence).not.toHaveBeenCalled();
      expect(insertAgreementVersion).not.toHaveBeenCalled();
      return callback(session);
    });

    await executeAgreementActionUseCase(options);

    expect(insertPayment).toHaveBeenCalled();
  });

  it("leaves the Agreement offered when the mapping is invalid", async () => {
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboxMessageTypes: ["lifecycle"],
      paymentRequest: { paymentCalculation, mapping: undefined },
    }));
    withTransaction.mockImplementation(async (callback) => callback(session));

    await expect(executeAgreementActionUseCase(options)).rejects.toThrow(
      "createPayment requires a mapping from the Agreement Definition",
    );
    expect(insertPayment).not.toHaveBeenCalled();
  });

  it("leaves the Agreement offered when the calculation does not balance", async () => {
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboxMessageTypes: ["lifecycle"],
      paymentRequest: {
        paymentCalculation: { ...paymentCalculation, agreementTotalPence: 1 },
        mapping,
      },
    }));

    await expect(executeAgreementActionUseCase(options)).rejects.toThrow(
      "Invalid Payment",
    );
    expect(insertPayment).not.toHaveBeenCalled();
  });

  it("resolves a duplicate Payment for the same Agreement Version idempotently", async () => {
    findVersionByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actionExecution: { name: "accept" } });
    withTransaction.mockRejectedValue(
      new MongoServerError({
        message: "Duplicate key",
        code: 11000,
        keyPattern: { "source.agreementNumber": 1, "source.version": 1 },
      }),
    );

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/PMF823153883",
    });
  });

  it("does not create a Payment when a completed action is replayed", async () => {
    findVersionByIdempotencyKey.mockResolvedValue({
      actionExecution: { name: "accept" },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/PMF823153883",
    });
    expect(runAgreementEffects).not.toHaveBeenCalled();
    expect(insertPayment).not.toHaveBeenCalled();
    expect(allocateNextSequence).not.toHaveBeenCalled();
  });

  it("does not create a Payment for an action without the effect", async () => {
    runAgreementEffects.mockImplementation(async (_effects, context) => ({
      ...context,
      outboxMessageTypes: ["lifecycle"],
    }));

    await executeAgreementActionUseCase(options);

    expect(insertPayment).not.toHaveBeenCalled();
    expect(allocateNextSequence).not.toHaveBeenCalled();
  });
});
