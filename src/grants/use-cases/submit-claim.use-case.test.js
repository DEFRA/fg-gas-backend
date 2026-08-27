import Boom from "@hapi/boom";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByClaimCode,
  duplicateClientClaimRef,
  findByClientClaimRef,
  insert,
} from "../repositories/claim.repository.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";
import { submitClaimUseCase } from "./submit-claim.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../common/logger.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/claim.repository.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findByClientClaimRef: vi.fn(),
    countByClaimCode: vi.fn(),
    insert: vi.fn(),
  };
});
vi.mock("./resolve-current-grant.use-case.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCurrentGrantUseCase: vi.fn(),
  };
});

const grantCode = "woodland";
const clientRef = "wmp-6hb-j8e";
const claimCode = "ENT_CS_CAPITAL_PA3";
const session = {};

const claimableAt = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

const payload = {
  metadata: {
    grantCode,
    clientRef,
    claimCode,
    clientClaimRef: "WMP-6HB-J8E-C0001",
    sbi: "113593357",
    crn: "1100943757",
    frn: "1100943757",
    configVersion: "1.14.0",
    submittedAt: "2026-08-07T11:16:05.745Z",
  },
  answers: {
    claimAmountPence: 150000,
  },
};

const createGrantWithClaimableAt = (overrides = {}) =>
  createTestGrant({
    entitlementTemplates: [
      {
        claimCode,
        name: "PA3 entitlement",
        materialised: false,
        fields: {
          totalHectares: {
            input: true,
            label: "Total area of eligible woodland",
            unitType: "decimal",
            decimalPlaces: 4,
            unit: "HA",
          },
        },
        availableAt: [claimableAt],
        claim: {
          claimableAt: [claimableAt],
          limits: { maximumClaims: 1, allowsPartialClaims: false },
          requiresApproval: false,
          requiresEvidence: false,
        },
        ...overrides,
      },
    ],
  });

describe("submitClaimUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation(async (cb) => cb(session));
    lockForUpdate.mockResolvedValue(
      createTestApplication({ clientRef, code: grantCode }),
    );
    resolveCurrentGrantUseCase.mockResolvedValue({
      grant: createGrantWithClaimableAt(),
    });
    findByClientClaimRef.mockResolvedValue(null);
    countByClaimCode.mockResolvedValue(0);
    insert.mockResolvedValue(new ObjectId("64b0c0c0c0c0c0c0c0c0c0c0"));
  });

  it("persists a claim and returns the created claimId", async () => {
    const result = await submitClaimUseCase({
      grantCode,
      clientRef,
      payload,
    });

    expect(lockForUpdate).toHaveBeenCalledWith(
      { clientRef, code: grantCode },
      session,
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: grantCode,
        clientRef,
        claimCode,
        clientClaimRef: payload.metadata.clientClaimRef,
        metadata: payload.metadata,
        answers: payload.answers,
      }),
      session,
    );
    expect(result).toEqual({
      created: true,
      claimId: "64b0c0c0c0c0c0c0c0c0c0c0",
    });
  });

  it("returns created false when the clientClaimRef already exists", async () => {
    findByClientClaimRef.mockResolvedValue({
      clientClaimRef: payload.metadata.clientClaimRef,
    });

    const result = await submitClaimUseCase({
      grantCode,
      clientRef,
      payload,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false });
  });

  it("returns created false when insert hits the unique index", async () => {
    insert.mockResolvedValue(duplicateClientClaimRef);

    const result = await submitClaimUseCase({
      grantCode,
      clientRef,
      payload,
    });

    expect(result).toEqual({ created: false });
  });

  it("throws 400 when the path grantCode does not match the payload", async () => {
    await expect(
      submitClaimUseCase({
        grantCode: "other-grant",
        clientRef,
        payload,
      }),
    ).rejects.toThrow(
      Boom.badRequest(
        "The grant code provided in the path parameters does not match the grant code specified in the payload metadata.",
      ),
    );

    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("throws 400 when the path clientRef does not match the payload", async () => {
    await expect(
      submitClaimUseCase({
        grantCode,
        clientRef: "other-ref",
        payload,
      }),
    ).rejects.toThrow(
      Boom.badRequest(
        "The client reference provided in the path parameters does not match the client reference specified in the payload metadata.",
      ),
    );
  });

  it("throws 404 when the application does not exist", async () => {
    lockForUpdate.mockResolvedValue(null);

    await expect(
      submitClaimUseCase({ grantCode, clientRef, payload }),
    ).rejects.toThrow(
      Boom.notFound(
        `Application with clientRef "${clientRef}" and code "${grantCode}" not found`,
      ),
    );
  });

  it("throws 404 when the grant is not found", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: null });

    await expect(
      submitClaimUseCase({ grantCode, clientRef, payload }),
    ).rejects.toThrow(
      Boom.notFound(`Grant with code "${grantCode}" not found`),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws 404 when the claimCode is not a template on the grant", async () => {
    await expect(
      submitClaimUseCase({
        grantCode,
        clientRef,
        payload: {
          ...payload,
          metadata: { ...payload.metadata, claimCode: "UNKNOWN" },
        },
      }),
    ).rejects.toThrow(
      Boom.notFound(
        'Entitlement template with claimCode "UNKNOWN" not found for grant "woodland"',
      ),
    );
  });

  it("throws 409 when the application is not in a claimable state", async () => {
    lockForUpdate.mockResolvedValue(
      createTestApplication({
        clientRef,
        code: grantCode,
        currentStatus: "IN_REVIEW",
      }),
    );

    await expect(
      submitClaimUseCase({ grantCode, clientRef, payload }),
    ).rejects.toThrow(
      Boom.conflict(
        "Application is not in a valid state to accept claims for this entitlement.",
      ),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws 422 when the maximum claims limit has been reached", async () => {
    countByClaimCode.mockResolvedValue(1);

    await expect(
      submitClaimUseCase({
        grantCode,
        clientRef,
        payload: {
          ...payload,
          metadata: {
            ...payload.metadata,
            clientClaimRef: "WMP-6HB-J8E-C0002",
          },
        },
      }),
    ).rejects.toThrow(
      Boom.badData(
        "Maximum number of claims for this entitlement has been reached.",
      ),
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
