import { MongoServerError } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { AgreementReference } from "../models/agreement-reference.js";
import { findVersionByActionIdempotencyKey } from "../repositories/agreement.repository.js";
import { executeAgreementActionUseCase } from "./execute-agreement-action.use-case.js";
import { loadCurrentAgreementContext } from "./load-current-agreement-context.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../repositories/agreement.repository.js");
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

const duplicateKeyError = (keyPattern) =>
  new MongoServerError({
    message: "Duplicate key",
    code: 11000,
    keyPattern,
  });

describe("executeAgreementActionUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentAgreementContext.mockResolvedValue({
      currentAgreement: { reference },
    });
    findVersionByActionIdempotencyKey.mockResolvedValue(null);
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

  it("does not translate an unrelated duplicate key into a stale version response", async () => {
    const error = duplicateKeyError({ _id: 1 });
    withTransaction.mockRejectedValue(error);

    await expect(executeAgreementActionUseCase(options)).rejects.toBe(error);
    expect(loadCurrentAgreementContext).not.toHaveBeenCalled();
  });
});
