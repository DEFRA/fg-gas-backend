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
vi.mock("./load-current-agreement-action-context.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1"',
  idempotencyKey: "9ea924aa-45e9-43a7-888e-c25054ea658c",
  access: {
    source: "defra",
    code: "pigs-might-fly",
    sbi: "106284736",
  },
};

const agreement = new Agreement({
  agreementNumber: options.agreementNumber,
  version: 1,
  code: "pigs-might-fly",
  clientRef: "client",
  configVersion: "1.1.0",
  correlationId: "correlation",
  identifiers: { sbi: "106284736", frn: "1101234567" },
  application: { whitePigsCount: 2, berkshirePigsCount: 1 },
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  actions: [
    {
      id: "action:1",
      code: "largeWhite",
      description: "Large White Pig",
      totalAmountPence: 2000,
    },
    {
      id: "action:2",
      code: "berkshire",
      description: "Berkshire",
      totalAmountPence: 1800,
    },
  ],
  items: [],
  totalAmountPence: 3800,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 3800,
        lineItems: [
          { actionId: "action:1", amountPence: 2000 },
          { actionId: "action:2", amountPence: 1800 },
        ],
      },
    ],
  },
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
  marketingYear: "2026",
  invoiceLine: {
    schemeCode: "CMOR1",
    accountCode: "SOS710",
    fundCode: "DRD10",
  },
};

const action = {
  transition: { from: "offered", action: "accept", target: "accepted" },
  validate: vi.fn().mockReturnValue({ valid: true }),
};
const agreementDefinition = { runProcesses: vi.fn() };
const session = {};

describe("executeAgreementActionUseCase with a staged Payment intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAgreementByNumber.mockResolvedValue(agreement);
    findVersionByIdempotencyKey.mockResolvedValue(null);
    loadCurrentAgreementActionContext.mockResolvedValue({
      action,
      agreement,
      agreementDefinition,
    });
    agreementDefinition.runProcesses.mockResolvedValue({
      outputs: { "create-agreement-payment": {} },
      intents: [
        {
          type: "create-agreement-payment",
          request: {
            agreementValues: {
              startDate: agreement.startDate,
              endDate: agreement.endDate,
              actions: agreement.actions,
              items: agreement.items,
              totalAmountPence: agreement.totalAmountPence,
              paymentSchedule: agreement.paymentSchedule,
            },
            paymentConfiguration: mapping,
          },
        },
      ],
    });
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 1 });
    withTransaction.mockImplementation((callback) => callback(session));
    allocateNextSequence.mockResolvedValue(1);
    action.validate.mockReturnValue({ valid: true });
  });

  it("runs the configured Process and commits its Payment intent atomically", async () => {
    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });

    expect(agreementDefinition.runProcesses).toHaveBeenCalledWith(
      expect.objectContaining({
        location: {
          type: "transition",
          state: "offered",
          transition: "accept",
        },
        context: expect.objectContaining({
          agreement,
          transition: { values: options.values },
        }),
      }),
    );
    expect(insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          type: "agreement",
          agreementNumber: options.agreementNumber,
          version: 2,
        },
        correlationId: agreement.correlationId,
        totalAmountPence: 3800,
        payments: [
          expect.objectContaining({
            dueDate: "2026-11-06",
            invoiceLines: [
              expect.objectContaining({
                description: "Large White Pig",
                amountPence: 2000,
              }),
              expect.objectContaining({
                description: "Berkshire",
                amountPence: 1800,
              }),
            ],
          }),
        ],
      }),
      session,
    );
    expect(saveOutboxEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            data: expect.objectContaining({ claimId: "R00000001" }),
          }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            type: "io.onsite.agreement.create-payment",
          }),
        }),
      ]),
      session,
    );
  });

  it("commits the Payment with the Agreement, Version and lifecycle event", async () => {
    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
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

  it("commits the payment event with the lifecycle event in one write", async () => {
    await executeAgreementActionUseCase(options);

    expect(saveOutboxEvents).toHaveBeenCalledTimes(1);
    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications).toHaveLength(2);
    expect(publications[0].event.type).toMatch(/agreement\.status\.updated$/);
    expect(publications[1].event.type).toBe(
      "io.onsite.agreement.create-payment",
    );
  });

  it("builds the payment event from the committed Payment", async () => {
    await executeAgreementActionUseCase(options);

    const [publications] = saveOutboxEvents.mock.calls[0];
    const [payment] = insertPayment.mock.calls[0];
    const { data } = publications[1].event;

    expect(data.claimId).toBe(payment.paymentHubClaimId);
    expect(data.grants[0]).toMatchObject({
      agreementNumber: options.agreementNumber,
      invoiceNumber: payment.invoiceNumber,
      correlationId: payment.correlationId,
      totalAmountPence: "3800",
    });
    expect(data.grants[0].payments[0].invoiceLines[0].amountPence).toBe("2000");
  });

  it("groups the payment event by Agreement Number", async () => {
    await executeAgreementActionUseCase(options);

    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications[1].segregationRef).toBe(options.agreementNumber);
    expect(publications[1].event.messageGroupId).toBe(options.agreementNumber);
  });

  it("targets the Payment Service topic", async () => {
    await executeAgreementActionUseCase(options);

    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications[1].target).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_payment_fifo.fifo",
    );
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
    expect(payment.payments[0]).toMatchObject({
      dueDate: "2026-11-06",
      totalAmountPence: 3800,
      status: "pending",
      correlationId: expect.any(String),
    });
    expect(payment.payments[0].invoiceLines[0]).toMatchObject({
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
    expect(payment.payments[0].invoiceLines[0].amountPence).toBe(2000);
  });

  it("does not copy a Calculator Result onto the Agreement or Version", async () => {
    await executeAgreementActionUseCase(options);

    const [accepted] = replaceCurrentAgreement.mock.calls[0];
    const [version] = insertAgreementVersion.mock.calls[0];

    expect(accepted.paymentCalculation).toBeUndefined();
    expect(version.snapshot.paymentCalculation).toBeUndefined();
    expect(version.snapshot).toEqual(accepted);
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

  it("leaves the Agreement offered when the Payment configuration is invalid", async () => {
    agreementDefinition.runProcesses.mockResolvedValue({
      outputs: {},
      intents: [
        {
          type: "create-agreement-payment",
          request: {
            agreementValues: agreement,
            paymentConfiguration: undefined,
          },
        },
      ],
    });
    withTransaction.mockImplementation(async (callback) => callback(session));

    await expect(executeAgreementActionUseCase(options)).rejects.toThrow(
      "createPayment requires payment configuration from the Agreement Definition",
    );
    expect(insertPayment).not.toHaveBeenCalled();
    expect(saveOutboxEvents).not.toHaveBeenCalled();
  });

  it("leaves the Agreement offered when the stored Payment facts do not balance", async () => {
    agreementDefinition.runProcesses.mockResolvedValue({
      outputs: {},
      intents: [
        {
          type: "create-agreement-payment",
          request: {
            agreementValues: { ...agreement, totalAmountPence: 1 },
            paymentConfiguration: mapping,
          },
        },
      ],
    });

    await expect(executeAgreementActionUseCase(options)).rejects.toThrow(
      "Invalid Payment",
    );
    expect(insertPayment).not.toHaveBeenCalled();
    expect(saveOutboxEvents).not.toHaveBeenCalled();
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
      location: "/agreements/current",
    });
  });

  it("does not create a Payment when a completed action is replayed", async () => {
    findVersionByIdempotencyKey.mockResolvedValue({
      actionExecution: { name: "accept" },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
    expect(agreementDefinition.runProcesses).not.toHaveBeenCalled();
    expect(insertPayment).not.toHaveBeenCalled();
    expect(allocateNextSequence).not.toHaveBeenCalled();
  });

  it("does not create a Payment for an action without a Payment intent", async () => {
    agreementDefinition.runProcesses.mockResolvedValue({ outputs: {} });

    await executeAgreementActionUseCase(options);

    expect(insertPayment).not.toHaveBeenCalled();
    expect(allocateNextSequence).not.toHaveBeenCalled();

    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications).toHaveLength(1);
    expect(publications[0].event.type).toMatch(/agreement\.status\.updated$/);
  });
});
