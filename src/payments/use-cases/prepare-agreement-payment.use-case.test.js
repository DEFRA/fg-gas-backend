import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertPayment } from "../repositories/payment.repository.js";
import { createAgreementPaymentUseCase } from "./create-agreement-payment.use-case.js";
import { loadPaymentDefinition } from "./load-payment-definition.js";
import { prepareAgreementPayment } from "./prepare-agreement-payment.use-case.js";

vi.mock("./load-payment-definition.js");
vi.mock("./create-agreement-payment.use-case.js");
vi.mock("../repositories/payment.repository.js");

const paymentConfiguration = { scheme: "SFI" };

const agreement = { agreementNumber: "PMF123", code: "pigs-might-fly" };
const execution = { executedAt: "2026-08-30T10:00:00.000Z" };

const facts = {
  agreementNumber: "PMF123",
  version: 2,
  correlationId: "123e4567-e89b-12d3-a456-426614174000",
};

const session = {};

const prepare = () =>
  prepareAgreementPayment({
    code: "pigs-might-fly",
    configVersion: "1.2.0",
    agreement,
    execution,
  });

describe("prepareAgreementPayment", () => {
  let resolve;

  beforeEach(() => {
    vi.clearAllMocks();
    resolve = vi.fn().mockResolvedValue(paymentConfiguration);
    loadPaymentDefinition.mockResolvedValue({ resolve });
    createAgreementPaymentUseCase.mockResolvedValue({
      payment: { paymentHubClaimId: "R00000007" },
      publication: { target: "payment-service" },
    });
  });

  it("stages one commit operation the caller cannot reach into", async () => {
    const { commitOperations } = await prepare();

    expect(commitOperations).toHaveLength(1);
    expect(Object.keys(commitOperations[0])).toEqual(["commit"]);
    expect(Object.isFrozen(commitOperations[0])).toBe(true);
  });

  it("resolves the Payment definition for the configured version and context", async () => {
    await prepare();

    expect(loadPaymentDefinition).toHaveBeenCalledWith({
      code: "pigs-might-fly",
      configVersion: "1.2.0",
    });
    expect(resolve).toHaveBeenCalledWith({ agreement, execution });
  });

  // Resolving inside commit would hold the caller's transaction open across
  // JSONata evaluation and turn an invalid definition into a mid-transaction
  // failure. Everything fallible happens before the handle exists.
  it("resolves the Payment definition before staging, not on commit", async () => {
    const { commitOperations } = await prepare();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(createAgreementPaymentUseCase).not.toHaveBeenCalled();

    await commitOperations[0].commit(facts, session);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("stages nothing when the Payment definition cannot be resolved", async () => {
    resolve.mockRejectedValue(new Error("Unresolved process mapping"));

    await expect(prepare()).rejects.toThrow("Unresolved process mapping");
    expect(insertPayment).not.toHaveBeenCalled();
  });

  it("commits the resolved configuration with the committed Agreement facts", async () => {
    const { commitOperations } = await prepare();

    await commitOperations[0].commit(facts, session);

    expect(createAgreementPaymentUseCase).toHaveBeenCalledWith(
      {
        agreementNumber: "PMF123",
        version: 2,
        agreementCorrelationId: facts.correlationId,
        paymentConfiguration,
      },
      session,
    );
  });

  it("returns only the publication and the Claim ID to the caller", async () => {
    const { commitOperations } = await prepare();

    await expect(commitOperations[0].commit(facts, session)).resolves.toEqual({
      publication: { target: "payment-service" },
      claimId: "R00000007",
    });
  });
});
