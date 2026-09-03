import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByClaimCode,
  existsByClientClaimRef,
  insert,
} from "../repositories/claim.repository.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../use-cases/resolve-current-grant.use-case.js";
import { listClaimableEntitlements, submitClaim } from "./claims.service.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../common/with-audit.js", () => ({
  buildAuditEvent: vi.fn(),
  withAudit: (fn) => fn,
}));
vi.mock("../../common/mongo-errors.js", () => ({
  isMongoDuplicateKeyError: vi.fn((error) => error?.duplicate),
}));
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/claim.repository.js");
vi.mock("../repositories/entitlement.repository.js");
vi.mock("../use-cases/find-application-by-client-ref-and-code.use-case.js");
vi.mock(
  "../use-cases/resolve-current-grant.use-case.js",
  async (importOriginal) => ({
    ...(await importOriginal()),
    resolveCurrentGrantUseCase: vi.fn(),
  }),
);

const code = "woodland";
const clientRef = "client-1";
const claimCode = "ENT_1";
const session = {};
const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};
const payload = {
  metadata: {
    code,
    grantCode: code,
    clientRef,
    claimCode,
    clientClaimRef: "claim-1",
  },
  claim: { claimAmountPence: 100 },
};

const grant = (materialised = true) =>
  createTestGrant({
    entitlementTemplates: [
      {
        claimCode,
        name: "Claimable entitlement",
        materialised,
        maxEntitlements: 1,
        fields: {
          area: {
            input: true,
            label: "Area",
            unitType: "decimal",
            decimalPlaces: 2,
            unit: "HA",
          },
        },
        availableAt: [position],
        claim: { claimableAt: [position], limits: { maximumClaims: 1 } },
      },
    ],
  });

const application = (overrides = {}) =>
  createTestApplication({
    code,
    clientRef,
    configVersion: "1.0.0",
    ...overrides,
  });

describe("claims.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation((callback) => callback(session));
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application());
    lockForUpdate.mockResolvedValue(application());
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant() });
    findExistingEntitlements.mockResolvedValue([]);
    existsByClientClaimRef.mockResolvedValue(false);
    countByClaimCode.mockResolvedValue(0);
    insert.mockResolvedValue(new ObjectId("64b0c0c0c0c0c0c0c0c0c0c0"));
  });

  it("lists materialised and persisted claimable entitlements", async () => {
    const persisted = {
      id: "entitlement-1",
      code,
      clientRef,
      claimCode,
      instanceNumber: 2,
    };
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([persisted]);

    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([
      expect.objectContaining({
        source: "persisted",
        code: claimCode,
        entitlementId: "entitlement-1",
        instanceNumber: 2,
      }),
    ]);

    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(true) });
    findExistingEntitlements.mockResolvedValue([]);
    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([
      expect.objectContaining({
        source: "materialised",
        entitlementId: null,
        instanceNumber: null,
      }),
    ]);
  });

  it("does not offer a persisted template with no entitlement", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
  });

  it("excludes targets whose claim limit has been reached", async () => {
    countByClaimCode.mockResolvedValue(1);

    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
    expect(countByClaimCode).toHaveBeenCalledWith({
      code,
      clientRef,
      claimCode,
    });
  });

  it("persists a materialised claim after lock-free and transactional replay checks", async () => {
    await expect(submitClaim({ code, clientRef, payload })).resolves.toEqual({
      created: true,
      claimId: "64b0c0c0c0c0c0c0c0c0c0c0",
    });
    expect(existsByClientClaimRef).toHaveBeenNthCalledWith(
      1,
      { code, clientRef, clientClaimRef: "claim-1" },
      undefined,
    );
    expect(existsByClientClaimRef).toHaveBeenNthCalledWith(
      2,
      { code, clientRef, clientClaimRef: "claim-1" },
      session,
    );
  });

  it("rejects a persisted template when its entitlement is absent", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow(
      /Entitlement with claimCode/,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  // The claim limit for a persisted entitlement is counted by claim code, which
  // is equivalent to counting per entitlement only because a claimable template
  // is limited to one instance. The claim request cannot name an instance.
  it("applies the limit to a persisted entitlement, counted by claim code", async () => {
    const persisted = {
      id: "entitlement-1",
      code,
      clientRef,
      claimCode,
      instanceNumber: 1,
    };
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([persisted]);
    countByClaimCode.mockResolvedValue(1);
    await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow(
      /Maximum number of claims/,
    );
    expect(countByClaimCode).toHaveBeenCalledWith(
      { code, clientRef, claimCode },
      session,
    );
  });

  it("refuses to submit when a claim code does not identify a single entitlement", async () => {
    const instance = (instanceNumber) => ({
      id: `entitlement-${instanceNumber}`,
      code,
      clientRef,
      claimCode,
      instanceNumber,
    });
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([instance(1), instance(2)]);

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 500 } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("retries after a configuration change before the application lock", async () => {
    lockForUpdate
      .mockResolvedValueOnce(application({ configVersion: "1.1.0" }))
      .mockResolvedValueOnce(application());
    await expect(
      submitClaim({ code, clientRef, payload }),
    ).resolves.toMatchObject({ created: true });
    expect(resolveCurrentGrantUseCase).toHaveBeenCalledTimes(2);
  });

  it("reports a configuration change that survives every retry as a conflict", async () => {
    lockForUpdate.mockResolvedValue(application({ configVersion: "1.1.0" }));

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("reads a replay outside the aborted transaction after a duplicate race", async () => {
    const duplicate = Object.assign(new Error("duplicate"), {
      duplicate: true,
    });
    insert.mockRejectedValue(duplicate);
    existsByClientClaimRef
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await expect(submitClaim({ code, clientRef, payload })).resolves.toEqual({
      created: false,
    });
    expect(existsByClientClaimRef).toHaveBeenLastCalledWith(
      { code, clientRef, clientClaimRef: "claim-1" },
      undefined,
    );
  });

  it("allows the final claim slot", async () => {
    const twoClaims = grant(true);
    twoClaims.entitlementTemplates[0].claim.limits.maximumClaims = 2;
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: twoClaims });
    countByClaimCode.mockResolvedValue(1);
    await expect(
      submitClaim({ code, clientRef, payload }),
    ).resolves.toMatchObject({ created: true });
  });
});
