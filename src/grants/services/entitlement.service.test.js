import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEntitlementReferenceContext } from "../../agreements/use-cases/load-entitlement-reference-context.js";
import { buildAuditEvent } from "../../common/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { Entitlement } from "../models/entitlement.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import {
  findExistingEntitlements,
  insertEntitlement,
} from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";
import {
  createEntitlement,
  getEntitlementCreationDetails,
  getEntitlementOverview,
} from "./entitlement.service.js";

vi.mock("../../agreements/use-cases/load-entitlement-reference-context.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../models/entitlement.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/entitlement.repository.js");
vi.mock("../use-cases/find-application-by-client-ref-and-code.use-case.js");
vi.mock("../use-cases/resolve-current-grant.use-case.js");
vi.mock("../../common/with-audit.js", () => ({
  buildAuditEvent: vi.fn((event) => event),
  // Mirrors the real proxy: the data builder runs in a finally, so a failed
  // write reaches it with an undefined result.
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

const command = {
  code: "GAS",
  clientRef: "client-1",
  claimCode: "TREE",
  data: { hectares: { value: 3 } },
};

const application = {
  clientRef: command.clientRef,
  code: command.code,
  currentConfigVersion: "1.0.0",
  currentPosition: () => ({ phase: "ASSESSMENT" }),
  referenceContext: () => ({ answers: { hectares: 3 } }),
};

const template = {
  claimCode: command.claimCode,
  name: "Tree planting",
  description: "A tree planting entitlement",
  materialised: false,
  fields: { hectares: { input: true }, fixed: { input: false, value: "yes" } },
  maxEntitlements: 1,
  availableAt: [{ phase: "ASSESSMENT" }],
  help: undefined,
  claim: undefined,
  isAvailableAt: vi.fn(() => true),
  inputFieldNames: vi.fn(() => ["hectares"]),
  invalidInputFieldNames: vi.fn(() => []),
  assessEntitlementCreation: vi.fn(() => ({
    allowed: true,
    nextInstanceNumber: 1,
  })),
};

const grant = {
  pages: { claims: { details: { banner: { title: { text: "Claims" } } } } },
  findEntitlementTemplate: vi.fn((claimCode) =>
    claimCode === template.claimCode ? template : undefined,
  ),
  findEntitlementTemplatesAvailableAt: vi.fn(() => [template]),
};

describe("EntitlementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);
    resolveCurrentGrantUseCase.mockResolvedValue({ grant });
    pinnedVersionOf.mockImplementation(
      (candidate) =>
        candidate.currentConfigVersion ?? candidate.originalConfigVersion,
    );
    lockForUpdate.mockResolvedValue(application);
    findExistingEntitlements.mockResolvedValue([]);
    insertEntitlement.mockResolvedValue(true);
    Entitlement.create.mockImplementation((props) => ({
      ...props,
      id: "entitlement-1",
      createdAt: "2026-09-02T00:00:00.000Z",
    }));
    loadEntitlementReferenceContext.mockResolvedValue({ agreement: null });
    withTransaction.mockImplementation((fn) => fn("session"));
    template.assessEntitlementCreation.mockReturnValue({
      allowed: true,
      nextInstanceNumber: 1,
    });
    template.isAvailableAt.mockReturnValue(true);
    template.inputFieldNames.mockReturnValue(["hectares"]);
    template.invalidInputFieldNames.mockReturnValue([]);
  });

  it("returns a plain overview DTO", async () => {
    const existing = {
      id: "entitlement-1",
      clientRef: command.clientRef,
      code: command.code,
      claimCode: command.claimCode,
      instanceNumber: 1,
      configVersion: "1.0.0",
      data: { hectares: 3 },
      createdAt: "2026-09-02T00:00:00.000Z",
    };
    findExistingEntitlements.mockResolvedValue([existing]);

    await expect(
      getEntitlementOverview({
        code: command.code,
        clientRef: command.clientRef,
      }),
    ).resolves.toEqual({
      entitlements: [existing],
      creationOptions: [
        expect.objectContaining({
          claimCode: command.claimCode,
          createdCount: 1,
          remainingCapacity: 0,
        }),
      ],
      applicationContext: { answers: { hectares: 3 } },
      claimsPage: grant.pages.claims,
    });
  });

  it("returns the creation option for an available template", async () => {
    await expect(getEntitlementCreationDetails(command)).resolves.toMatchObject(
      {
        claimCode: command.claimCode,
        name: template.name,
        createdCount: 0,
        remainingCapacity: 1,
      },
    );
  });

  it("rethrows a non-404 failure from the application lookup", async () => {
    findApplicationByClientRefAndCodeUseCase.mockRejectedValue(
      Boom.badGateway("upstream down"),
    );

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
  });

  it("maps a claim code the grant does not define to INVALID_CLAIM_CODE", async () => {
    grant.findEntitlementTemplate.mockReturnValue(undefined);

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_CLAIM_CODE",
          message: expect.stringContaining("is not defined for grant code"),
        },
      },
    });
  });

  it("maps a template the application cannot use to INVALID_CLAIM_CODE", async () => {
    template.assessEntitlementCreation.mockReturnValue({
      allowed: false,
      reason: "WRONG_POSITION",
    });

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_CLAIM_CODE",
          message: expect.stringContaining("is not available for application"),
        },
      },
    });
  });

  it("names the missing and unexpected fields when submitted data does not match", async () => {
    template.assessEntitlementCreation.mockReturnValue({
      allowed: false,
      reason: "INVALID_ENTITLEMENT_DATA",
    });

    await expect(
      createEntitlement({ ...command, data: { unexpected: { value: 1 } } }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_ENTITLEMENT_DATA",
          message: expect.stringContaining(
            "missing fields: hectares; unexpected fields: unexpected",
          ),
        },
      },
    });
  });

  it("names invalid values when submitted field names match the template", async () => {
    template.assessEntitlementCreation.mockReturnValue({
      allowed: false,
      reason: "INVALID_ENTITLEMENT_DATA",
    });
    template.invalidInputFieldNames.mockReturnValue(["hectares"]);

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_ENTITLEMENT_DATA",
          message: expect.stringContaining(
            "Field 'hectares' has an invalid value",
          ),
        },
      },
    });
  });

  it("maps a full template to ENTITLEMENT_LIMIT_EXCEEDED", async () => {
    template.assessEntitlementCreation.mockReturnValue({
      allowed: false,
      reason: "CAPACITY_REACHED",
    });

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: { errorCode: "ENTITLEMENT_LIMIT_EXCEEDED" },
      },
    });
  });

  it("maps an application that disappears before the lock to 404", async () => {
    lockForUpdate.mockResolvedValue(null);

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { errorCode: "APPLICATION_NOT_FOUND" },
      },
    });
  });

  it("takes a literal fixed field without consulting the agreement", async () => {
    await createEntitlement(command);

    expect(loadEntitlementReferenceContext).not.toHaveBeenCalled();
    expect(Entitlement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hectares: 3, fixed: "yes" } }),
    );
  });

  it("resolves no fixed data when the template has only input fields", async () => {
    const inputOnly = {
      ...template,
      fields: { hectares: { input: true, label: "Hectares" } },
    };
    resolveCurrentGrantUseCase.mockResolvedValue({
      grant: { ...grant, findEntitlementTemplate: vi.fn(() => inputOnly) },
    });

    await createEntitlement(command);

    expect(loadEntitlementReferenceContext).not.toHaveBeenCalled();
    expect(Entitlement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hectares: 3 } }),
    );
  });

  it("rejects creation details once the option is at capacity", async () => {
    findExistingEntitlements.mockResolvedValue([
      { claimCode: command.claimCode },
    ]);

    await expect(getEntitlementCreationDetails(command)).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  it("returns not found when the entitlement is unavailable", async () => {
    template.isAvailableAt.mockReturnValue(false);

    await expect(getEntitlementCreationDetails(command)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });

  it("creates under the application lock and audits the inserted entitlement", async () => {
    const result = await createEntitlement(command);

    expect(resolveCurrentGrantUseCase).toHaveBeenCalledWith("GAS", "1.0.0");
    expect(lockForUpdate).toHaveBeenCalledWith(
      { clientRef: "client-1", code: "GAS" },
      "session",
    );
    expect(findExistingEntitlements).toHaveBeenCalledWith(
      "client-1",
      "GAS",
      "session",
    );
    expect(insertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        claimCode: "TREE",
        data: { hectares: 3, fixed: "yes" },
      }),
      "session",
    );
    expect(buildAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "ENTITLEMENT",
        action: "CREATE",
        entityid: "entitlement-1",
      }),
    );
    expect(result).toMatchObject({ id: "entitlement-1" });
  });

  it("retries the entire transaction when a competing slot wins", async () => {
    insertEntitlement.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await createEntitlement(command);

    expect(withTransaction).toHaveBeenCalledTimes(2);
    expect(resolveCurrentGrantUseCase).toHaveBeenCalledTimes(2);
  });

  it("reports a slot conflict that survives every retry as a limit conflict", async () => {
    insertEntitlement.mockResolvedValue(false);

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: { errorCode: "ENTITLEMENT_LIMIT_EXCEEDED" },
      },
    });
  });

  it("reports a configuration change that survives every retry as a conflict", async () => {
    lockForUpdate.mockResolvedValue({
      ...application,
      currentConfigVersion: "9.0.0",
    });

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: { errorCode: "CONFIGURATION_CHANGED" },
      },
    });
  });

  it("builds no audit event when the write fails", async () => {
    insertEntitlement.mockResolvedValue(false);

    await expect(createEntitlement(command)).rejects.toThrow();
    expect(buildAuditEvent).not.toHaveBeenCalled();
  });

  // resolve-refs is deliberately not mocked here, so the jsonata reference is
  // really evaluated against a context whose agreement is null.
  it("maps a fixed field the application's data cannot answer to 422", async () => {
    const needsAgreement = {
      ...template,
      fields: {
        hectares: { input: true, label: "Hectares", unitType: "decimal" },
        actionVersion: {
          input: false,
          value: "jsonata: $.agreement.actions[code='PA3'].version",
          unitType: "string",
        },
      },
    };
    resolveCurrentGrantUseCase.mockResolvedValue({
      grant: {
        ...grant,
        findEntitlementTemplate: vi.fn(() => needsAgreement),
        findEntitlementTemplatesAvailableAt: vi.fn(() => [needsAgreement]),
      },
    });
    loadEntitlementReferenceContext.mockResolvedValue({ agreement: null });

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: { errorCode: "ENTITLEMENT_DATA_UNRESOLVED" },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
  });

  it("maps a missing application to the Admin contract error", async () => {
    findApplicationByClientRefAndCodeUseCase.mockRejectedValue(
      Boom.notFound("Application missing"),
    );

    await expect(createEntitlement(command)).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { errorCode: "APPLICATION_NOT_FOUND" },
      },
    });
  });
});
