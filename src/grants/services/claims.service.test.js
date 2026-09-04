import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { buildAuditEvent } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  countByEntitlement,
  existsByClientClaimRef,
  insert,
} from "../repositories/claim.repository.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../use-cases/resolve-current-grant.use-case.js";
import { listClaimableEntitlements, submitClaim } from "./claims.service.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../common/with-audit.js", () => ({
  buildAuditEvent: vi.fn((event) => event),
  withAudit:
    (fn, dataBuilder) =>
    async (...args) => {
      let result;
      try {
        result = await fn(...args);
        return result;
      } finally {
        dataBuilder(args, result);
      }
    },
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
const entitlementId = "entitlement-1";
const persistedEntitlement = {
  id: entitlementId,
  code,
  clientRef,
  claimCode,
  instanceNumber: 1,
};
const payload = {
  metadata: {
    code,
    grantCode: code,
    clientRef,
    claimCode,
    entitlementId,
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
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([persistedEntitlement]);
    existsByClientClaimRef.mockResolvedValue(false);
    countByEntitlement.mockResolvedValue(0);
    insert.mockResolvedValue(new ObjectId("64b0c0c0c0c0c0c0c0c0c0c0"));
  });

  it.each([
    ["grant code", { grantCode: "other-grant" }, /grant code provided/],
    ["client reference", { clientRef: "other-ref" }, /client reference/],
    // The path/payload guard runs before any promise is returned, so this
    // throws synchronously rather than rejecting.
  ])("refuses a payload whose %s does not match the path", (_l, o, m) => {
    const mismatched = {
      ...payload,
      metadata: { ...payload.metadata, ...o },
    };

    expect(() => submitClaim({ code, clientRef, payload: mismatched })).toThrow(
      m,
    );
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("refuses when the grant cannot be resolved", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: null });

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("refuses an entitlement id that does not belong to the application", async () => {
    const other = {
      ...payload,
      metadata: { ...payload.metadata, entitlementId: "entitlement-missing" },
    };

    await expect(
      submitClaim({ code, clientRef, payload: other }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a claim code that does not match the entitlement named", async () => {
    const other = {
      ...payload,
      metadata: { ...payload.metadata, claimCode: "ENT_OTHER" },
    };

    await expect(
      submitClaim({ code, clientRef, payload: other }),
    ).rejects.toMatchObject({ output: { statusCode: 422 } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses when the application disappears before the lock", async () => {
    lockForUpdate.mockResolvedValue(null);

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });

  it("refuses a claim at a position the entitlement is not claimable at", async () => {
    lockForUpdate.mockResolvedValue(
      application({ currentStage: "AWARD", currentStatus: "OFFER_ACCEPTED" }),
    );

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("offers nothing for a template that configures no claim block", async () => {
    const noClaim = grant();
    delete noClaim.entitlementTemplates[0].claim;
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: noClaim });

    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
  });

  it("audits a submitted claim against the inserted claim id", async () => {
    await submitClaim({ code, clientRef, payload });

    expect(buildAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "CLAIM",
        action: "SUBMIT",
        entityid: "64b0c0c0c0c0c0c0c0c0c0c0",
        details: expect.objectContaining({ code, clientRef, claimCode }),
      }),
    );
  });

  it("builds no audit event when the claim write fails", async () => {
    insert.mockRejectedValue(new Error("write failed"));

    await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow(
      "write failed",
    );
    expect(buildAuditEvent).not.toHaveBeenCalled();
  });

  it("returns the existing claim when a concurrent submission won in-session", async () => {
    existsByClientClaimRef
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(submitClaim({ code, clientRef, payload })).resolves.toEqual({
      created: false,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns a decimal field in its real units, not as stored", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([
      { ...persistedEntitlement, data: { area: 100000 } },
    ]);

    const [claimable] = await listClaimableEntitlements({ code, clientRef });

    expect(claimable.data.area).toEqual({
      value: 1000,
      decimalPlaces: 2,
      minValue: null,
      maxValue: null,
    });
  });

  it.each([
    [100000, 4, 10],
    [1561025, 4, 156.1025],
    [7, 2, 0.07],
    [0, 4, 0],
    [123, 0, 123],
    [-12345, 4, -1.2345],
  ])("unscales %i at % idp to %f", async (stored, decimalPlaces, expected) => {
    const scaled = grant(false);
    scaled.entitlementTemplates[0].fields.area.decimalPlaces = decimalPlaces;
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: scaled });
    findExistingEntitlements.mockResolvedValue([
      { ...persistedEntitlement, data: { area: stored } },
    ]);

    const [claimable] = await listClaimableEntitlements({ code, clientRef });

    expect(claimable.data.area.value).toBe(expected);
  });

  it("refuses a claim whose template configures no claim block", async () => {
    const noClaim = grant(false);
    delete noClaim.entitlementTemplates[0].claim;
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: noClaim });

    await expect(
      submitClaim({ code, clientRef, payload }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns a non-decimal field unscaled", async () => {
    const withString = grant(false);
    withString.entitlementTemplates[0].fields.actionCode = {
      input: false,
      value: "PA3",
      unitType: "string",
    };
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: withString });
    findExistingEntitlements.mockResolvedValue([
      { ...persistedEntitlement, data: { area: 100000, actionCode: "PA3" } },
    ]);

    const [claimable] = await listClaimableEntitlements({ code, clientRef });

    expect(claimable.data.actionCode).toEqual({ value: "PA3" });
  });

  it("lists persisted claimable entitlements", async () => {
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
  });

  it("does not list materialised claimable entitlements", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(true) });
    findExistingEntitlements.mockResolvedValue([]);
    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
  });

  it("does not offer a persisted template with no entitlement", async () => {
    resolveCurrentGrantUseCase.mockResolvedValue({ grant: grant(false) });
    findExistingEntitlements.mockResolvedValue([]);
    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
  });

  it("excludes a persisted target whose own claim limit has been reached", async () => {
    countByEntitlement.mockResolvedValue(1);

    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([]);
    expect(countByEntitlement).toHaveBeenCalledWith({
      code,
      clientRef,
      entitlementId,
    });
  });

  // Sibling entitlements under one claim code hold separate budgets, so one
  // reaching its limit must not hide the other.
  it("keeps offering a sibling entitlement that has claims of its own left", async () => {
    findExistingEntitlements.mockResolvedValue([
      persistedEntitlement,
      { ...persistedEntitlement, id: "entitlement-2", instanceNumber: 2 },
    ]);
    countByEntitlement.mockImplementation(async ({ entitlementId: id }) =>
      id === entitlementId ? 1 : 0,
    );

    await expect(
      listClaimableEntitlements({ code, clientRef }),
    ).resolves.toEqual([
      expect.objectContaining({ entitlementId: "entitlement-2" }),
    ]);
  });

  it("persists a claim after lock-free and transactional replay checks", async () => {
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

  it("rejects a claim when the application holds no entitlements", async () => {
    findExistingEntitlements.mockResolvedValue([]);

    await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow(
      /Entitlement "entitlement-1" not found/,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  // The limit is per entitlement now the claim names its target, so a second
  // entitlement under the same claim code carries its own budget. This is the
  // case the single-instance guard used to make impossible.
  it("counts the claim limit against the named entitlement only", async () => {
    findExistingEntitlements.mockResolvedValue([
      persistedEntitlement,
      { ...persistedEntitlement, id: "entitlement-2", instanceNumber: 2 },
    ]);
    countByEntitlement.mockResolvedValue(1);

    await expect(submitClaim({ code, clientRef, payload })).rejects.toThrow(
      /Maximum number of claims/,
    );
    expect(countByEntitlement).toHaveBeenCalledWith(
      { code, clientRef, entitlementId },
      session,
    );
  });

  it("accepts a claim against a second entitlement for the same claim code", async () => {
    findExistingEntitlements.mockResolvedValue([
      persistedEntitlement,
      { ...persistedEntitlement, id: "entitlement-2", instanceNumber: 2 },
    ]);

    await expect(
      submitClaim({
        code,
        clientRef,
        payload: {
          ...payload,
          metadata: { ...payload.metadata, entitlementId: "entitlement-2" },
        },
      }),
    ).resolves.toMatchObject({ created: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ entitlementId: "entitlement-2" }),
      session,
    );
  });

  it("records the entitlement the claim was submitted against", async () => {
    await submitClaim({ code, clientRef, payload });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ entitlementId }),
      session,
    );
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
    countByEntitlement.mockResolvedValue(1);
    await expect(
      submitClaim({ code, clientRef, payload }),
    ).resolves.toMatchObject({ created: true });
  });
});
