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
import { executeAgreementActionUseCase } from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementActionContext } from "./load-current-agreement-action-context.js";

vi.mock("../../common/save-outbox-events.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
vi.mock("./load-current-agreement-action-context.js");

const options = {
  actionName: "accept",
  agreementNumber: "PMF823153883",
  values: { confirm: "confirmed" },
  ifMatch: '"PMF823153883:1:1.1.0"',
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
  ],
  items: [],
  totalAmountPence: 2000,
  paymentSchedule: {
    instalments: [
      {
        id: "instalment:1",
        dueDate: "2026-11-06",
        totalAmountPence: 2000,
        lineItems: [{ actionId: "action:1", amountPence: 2000 }],
      },
    ],
  },
  state: "offered",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
});

const publication = {
  target: "payment-service-topic",
  segregationRef: options.agreementNumber,
  event: { type: "io.onsite.agreement.create-payment" },
};

// Agreements never sees inside a Commit Operation, so its tests never need to
// build one. The whole contract is a commit function taking the committed
// Agreement facts and the session, and returning a publication and a Claim ID.
const stageCommit = (
  commit = vi.fn().mockResolvedValue({ publication, claimId: "R00000001" }),
) => ({ commit });

const action = { validate: vi.fn().mockReturnValue({ valid: true }) };
const agreementDefinition = { executeAction: vi.fn() };

const transitionAgreement = (values = undefined) =>
  agreement.transition({
    target: "accepted",
    transitionedAt: "2026-08-20T10:00:00.000Z",
    values,
  });

const session = {};

const stagedBy = (commitOperations, values = undefined) =>
  agreementDefinition.executeAction.mockResolvedValue({
    agreement: transitionAgreement(values),
    commitOperations,
  });

const lifecycleEvents = (publications) =>
  publications.filter(({ event }) =>
    event.type.endsWith("agreement.status.updated"),
  );

describe("executeAgreementActionUseCase with a staged Commit Operation", () => {
  let operation;

  beforeEach(() => {
    vi.clearAllMocks();
    operation = stageCommit();
    findAgreementByNumber.mockResolvedValue(agreement);
    findVersionByIdempotencyKey.mockResolvedValue(null);
    loadCurrentAgreementActionContext.mockResolvedValue({
      action,
      agreement,
      agreementDefinition,
      etag: `"${agreement.agreementNumber}:${agreement.version}:${agreement.configVersion}"`,
    });
    stagedBy([operation]);
    replaceCurrentAgreement.mockResolvedValue({ modifiedCount: 1 });
    withTransaction.mockImplementation((callback) => callback(session));
    action.validate.mockReturnValue({ valid: true });
  });

  it("commits the staged operation with the materialised Agreement facts", async () => {
    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });

    expect(operation.commit).toHaveBeenCalledWith(
      {
        agreementNumber: options.agreementNumber,
        version: 2,
        correlationId: agreement.correlationId,
      },
      session,
    );
  });

  // The transition bumps the version, so the facts the operation commits with
  // are only known after the Agreement has been materialised — never at the
  // point the operation was staged.
  it("commits the version written to the Agreement and its Version", async () => {
    await executeAgreementActionUseCase(options);

    const [accepted] = replaceCurrentAgreement.mock.calls[0];
    const [version] = insertAgreementVersion.mock.calls[0];
    const [facts] = operation.commit.mock.calls[0];

    expect(accepted.version).toBe(2);
    expect(version.snapshot).toEqual(accepted);
    expect(facts.version).toBe(accepted.version);
  });

  it("commits after the Agreement Version and before the outbox write", async () => {
    const order = [];
    insertAgreementVersion.mockImplementation(() => order.push("version"));
    operation.commit.mockImplementation(async () => {
      order.push("commit");
      return { publication, claimId: "R00000001" };
    });
    saveOutboxEvents.mockImplementation(() => order.push("outbox"));

    await executeAgreementActionUseCase(options);

    expect(order).toEqual(["version", "commit", "outbox"]);
  });

  it("does not commit before the transaction starts", async () => {
    withTransaction.mockImplementation((callback) => {
      expect(operation.commit).not.toHaveBeenCalled();
      expect(insertAgreementVersion).not.toHaveBeenCalled();
      return callback(session);
    });

    await executeAgreementActionUseCase(options);

    expect(operation.commit).toHaveBeenCalled();
  });

  it("writes the returned publication with the lifecycle events in one write", async () => {
    await executeAgreementActionUseCase(options);

    expect(saveOutboxEvents).toHaveBeenCalledTimes(1);
    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications).toHaveLength(3);
    expect(lifecycleEvents(publications)).toHaveLength(2);
    expect(publications).toContain(publication);
    expect(saveOutboxEvents).toHaveBeenCalledWith(expect.anything(), session);
  });

  it("carries the returned Claim ID on the accepted lifecycle event", async () => {
    operation.commit.mockResolvedValue({ publication, claimId: "R00000042" });

    await executeAgreementActionUseCase(options);

    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(lifecycleEvents(publications)).toHaveLength(2);
    lifecycleEvents(publications).forEach(({ event }) => {
      expect(event.data).toMatchObject({
        status: "accepted",
        claimId: "R00000042",
      });
    });
  });

  it("publishes only lifecycle events when the Action stages nothing", async () => {
    stagedBy([]);

    await executeAgreementActionUseCase(options);

    const [publications] = saveOutboxEvents.mock.calls[0];

    expect(publications).toHaveLength(2);
    expect(lifecycleEvents(publications)).toHaveLength(2);
    expect(publications[0].event.data).not.toHaveProperty("claimId");
  });

  it("does not commit when a completed action is replayed", async () => {
    findVersionByIdempotencyKey.mockResolvedValue({
      actionExecution: { name: "accept" },
    });

    await expect(executeAgreementActionUseCase(options)).resolves.toEqual({
      location: "/agreements/current",
    });
    expect(agreementDefinition.executeAction).not.toHaveBeenCalled();
    expect(operation.commit).not.toHaveBeenCalled();
  });

  it("writes no outbox events when the commit fails", async () => {
    operation.commit.mockRejectedValue(new Error("commit failed"));

    await expect(executeAgreementActionUseCase(options)).rejects.toThrow(
      "commit failed",
    );
    expect(saveOutboxEvents).not.toHaveBeenCalled();
  });

  // The commit is deliberately not wrapped: a raced acceptance that beats the
  // optimistic version check surfaces as a duplicate key error from inside the
  // commit, and isConcurrentActionConflict has to be able to read keyPattern.
  it("resolves a raced acceptance from the committed unique index", async () => {
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

  it("does not copy a Calculator Result onto the Agreement or Version", async () => {
    await executeAgreementActionUseCase(options);

    const [accepted] = replaceCurrentAgreement.mock.calls[0];
    const [version] = insertAgreementVersion.mock.calls[0];

    expect(accepted.paymentCalculation).toBeUndefined();
    expect(version.snapshot.paymentCalculation).toBeUndefined();
    expect(version.snapshot).toEqual(accepted);
  });
});
