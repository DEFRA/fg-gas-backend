import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEntitlementReferenceContext } from "../../agreements/use-cases/load-entitlement-reference-context.js";
import { buildAuditEvent } from "../../events/with-audit.js";
import { withTransaction } from "../../common/with-transaction.js";
import { Entitlement } from "../models/entitlement.js";
import { lockForUpdate } from "../repositories/application.repository.js";
import { countByEntitlement } from "../repositories/claim.repository.js";
import {
  findExistingEntitlements,
  insertEntitlement,
  updateEntitlementData,
} from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../use-cases/find-application-by-client-ref-and-code.use-case.js";
import {
  pinnedVersionOf,
  resolveCurrentGrantUseCase,
} from "../use-cases/resolve-current-grant.use-case.js";
import {
  createEntitlement,
  getApplicationClaimsOverview,
  getEntitlementCreationDetails,
  getEntitlementTemplateDetails,
  updateEntitlement,
} from "./entitlement.service.js";

vi.mock("../../agreements/use-cases/load-entitlement-reference-context.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../models/entitlement.js", async (importOriginal) => ({
  ...(await importOriginal()),
  Entitlement: { create: vi.fn(), fromDocument: vi.fn() },
}));
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/claim.repository.js");
vi.mock("../repositories/entitlement.repository.js");
vi.mock("../use-cases/find-application-by-client-ref-and-code.use-case.js");
vi.mock("../use-cases/resolve-current-grant.use-case.js");
vi.mock("../../events/with-audit.js", () => ({
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
  hasValidInputData: vi.fn(() => true),
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

const findHeldRoles = vi.fn();

const requiredRoles = { allOf: ["ROLE_WMP_CLAIMS"], anyOf: [] };
const restrictedGrant = { ...grant, claims: { requiredRoles } };

describe("EntitlementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findHeldRoles.mockReset();
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
    template.hasValidInputData.mockReturnValue(true);
    countByEntitlement.mockResolvedValue(0);
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
      getApplicationClaimsOverview({
        code: command.code,
        clientRef: command.clientRef,
        findHeldRoles,
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
      claimsRequiredRoles: null,
      access: "full",
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

  it("returns the template an existing entitlement was made under", async () => {
    findExistingEntitlements.mockResolvedValue([
      { id: "entitlement-1", claimCode: command.claimCode },
    ]);
    template.isAvailableAt.mockReturnValue(false);

    await expect(
      getEntitlementTemplateDetails({
        code: command.code,
        clientRef: command.clientRef,
        entitlementId: "entitlement-1",
      }),
    ).resolves.toMatchObject({
      claimCode: command.claimCode,
      fields: template.fields,
      createdCount: 1,
    });
  });

  it("returns not found for an entitlement the application does not have", async () => {
    await expect(
      getEntitlementTemplateDetails({
        code: command.code,
        clientRef: command.clientRef,
        entitlementId: "entitlement-unknown",
      }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: { errorCode: "ENTITLEMENT_NOT_FOUND" },
      },
    });
  });

  it("refuses with INVALID_CLAIM_CODE when the grant no longer has the entitlement's template", async () => {
    findExistingEntitlements.mockResolvedValue([
      { id: "entitlement-1", claimCode: "RETIRED" },
    ]);

    await expect(
      getEntitlementTemplateDetails({
        code: command.code,
        clientRef: command.clientRef,
        entitlementId: "entitlement-1",
      }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: { errorCode: "INVALID_CLAIM_CODE" },
      },
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
        details: {
          code: "GAS",
          clientRef: "client-1",
          claimCode: "TREE",
          name: "Tree planting",
          actor: null,
          values: [{ field: "hectares", to: 3 }],
        },
      }),
    );
    expect(result).toMatchObject({ id: "entitlement-1" });
  });

  it("names the person who created the entitlement in its audit event", async () => {
    await createEntitlement({ ...command, actor: "Ada Lovelace" });

    expect(buildAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        details: expect.objectContaining({ actor: "Ada Lovelace" }),
      }),
    );
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

  it("rethrows a resolution failure that is not an unresolved reference", async () => {
    const needsAgreement = {
      ...template,
      fields: {
        hectares: { input: true, label: "Hectares", unitType: "decimal" },
        actionVersion: {
          input: false,
          value: "jsonata: $.agreement.actions[",
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
    loadEntitlementReferenceContext.mockResolvedValue({ agreement: {} });

    await expect(createEntitlement(command)).rejects.not.toMatchObject({
      output: { payload: { errorCode: "ENTITLEMENT_DATA_UNRESOLVED" } },
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

  describe("updateEntitlement", () => {
    const stored = {
      id: "entitlement-1",
      clientRef: command.clientRef,
      code: command.code,
      claimCode: command.claimCode,
      instanceNumber: 1,
      configVersion: "1.0.0",
      data: { hectares: 30000, fixed: "yes" },
      createdAt: "2026-09-02T00:00:00.000Z",
    };

    const update = {
      code: command.code,
      clientRef: command.clientRef,
      entitlementId: "entitlement-1",
      data: { hectares: { value: 45000 } },
    };

    beforeEach(async () => {
      const actual = await vi.importActual("../models/entitlement.js");

      findExistingEntitlements.mockResolvedValue([stored]);
      Entitlement.fromDocument.mockImplementation(
        actual.Entitlement.fromDocument,
      );
    });

    it("changes the input fields and keeps the fixed ones", async () => {
      const result = await updateEntitlement(update);

      expect(updateEntitlementData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "entitlement-1",
          data: { hectares: 45000, fixed: "yes" },
          updatedAt: expect.any(String),
        }),
        "session",
      );
      expect(result).toEqual({
        id: "entitlement-1",
        clientRef: command.clientRef,
        code: command.code,
        claimCode: command.claimCode,
        instanceNumber: 1,
        configVersion: "1.0.0",
        data: { hectares: 45000, fixed: "yes" },
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: expect.any(String),
      });
    });

    it("updates for an operator holding the grant's required claims roles", async () => {
      resolveCurrentGrantUseCase.mockResolvedValue({ grant: restrictedGrant });
      findHeldRoles.mockResolvedValue(["ROLE_WMP_CLAIMS"]);

      await expect(
        updateEntitlement(update, findHeldRoles),
      ).resolves.toMatchObject({
        id: stored.id,
        data: { hectares: 45000, fixed: "yes" },
      });
      expect(findHeldRoles).toHaveBeenCalledTimes(1);
      expect(updateEntitlementData).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: stored.id,
          data: { hectares: 45000, fixed: "yes" },
        }),
        "session",
      );
    });

    it("passes on a role lookup failure before starting an update transaction", async () => {
      resolveCurrentGrantUseCase.mockResolvedValue({ grant: restrictedGrant });
      const failure = Boom.serverUnavailable(
        "Caseworking roles could not be determined",
      );
      failure.output.payload.errorCode = "CASEWORKING_ROLES_UNAVAILABLE";
      findHeldRoles.mockRejectedValue(failure);

      await expect(updateEntitlement(update, findHeldRoles)).rejects.toBe(
        failure,
      );
      expect(withTransaction).not.toHaveBeenCalled();
      expect(updateEntitlementData).not.toHaveBeenCalled();
      expect(buildAuditEvent).not.toHaveBeenCalled();
    });

    it("updates under the application lock, wherever the application stands", async () => {
      template.isAvailableAt.mockReturnValue(false);

      await updateEntitlement(update);

      expect(lockForUpdate).toHaveBeenCalledWith(
        { clientRef: "client-1", code: "GAS" },
        "session",
      );
      expect(countByEntitlement).toHaveBeenCalledWith(
        { code: "GAS", clientRef: "client-1", entitlementId: "entitlement-1" },
        "session",
      );
    });

    it("audits the update, naming the person who made it", async () => {
      await updateEntitlement({ ...update, actor: "Ada Lovelace" });

      expect(buildAuditEvent).toHaveBeenCalledWith({
        entity: "ENTITLEMENT",
        action: "UPDATE",
        entityid: "entitlement-1",
        details: {
          code: "GAS",
          clientRef: "client-1",
          claimCode: "TREE",
          name: "Tree planting",
          actor: "Ada Lovelace",
          values: [{ field: "hectares", from: 30000, to: 45000 }],
        },
      });
    });

    it("refuses once a claim has been made against the entitlement", async () => {
      countByEntitlement.mockResolvedValue(1);

      await expect(updateEntitlement(update)).rejects.toMatchObject({
        output: {
          statusCode: 409,
          payload: {
            errorCode: "ENTITLEMENT_CLAIMED",
            message:
              "Tree planting has a claim against it and cannot be changed.",
          },
        },
      });
      expect(updateEntitlementData).not.toHaveBeenCalled();
    });

    it("refuses data that does not match the template", async () => {
      template.hasValidInputData.mockReturnValue(false);
      template.invalidInputFieldNames.mockReturnValue(["hectares"]);

      await expect(updateEntitlement(update)).rejects.toMatchObject({
        output: {
          statusCode: 422,
          payload: { errorCode: "INVALID_ENTITLEMENT_DATA" },
        },
      });
      expect(updateEntitlementData).not.toHaveBeenCalled();
    });

    it("refuses when the grant no longer has the entitlement's template", async () => {
      grant.findEntitlementTemplate.mockReturnValueOnce(undefined);

      await expect(updateEntitlement(update)).rejects.toMatchObject({
        output: {
          statusCode: 422,
          payload: { errorCode: "INVALID_CLAIM_CODE" },
        },
      });
      expect(updateEntitlementData).not.toHaveBeenCalled();
    });

    it("passes on a failure that is not about the data", async () => {
      grant.findEntitlementTemplate.mockReturnValueOnce({
        ...template,
        claimCode: "ANOTHER",
      });

      await expect(updateEntitlement(update)).rejects.toThrow(
        /is not the template of entitlement/,
      );
      expect(updateEntitlementData).not.toHaveBeenCalled();
    });

    it("audits nothing when the write fails", async () => {
      updateEntitlementData.mockRejectedValueOnce(new Error("write failed"));

      await expect(updateEntitlement(update)).rejects.toThrow("write failed");
      expect(buildAuditEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "UPDATE" }),
      );
    });

    it("returns not found for an entitlement the application does not have", async () => {
      await expect(
        updateEntitlement({ ...update, entitlementId: "entitlement-unknown" }),
      ).rejects.toMatchObject({
        output: {
          statusCode: 404,
          payload: { errorCode: "ENTITLEMENT_NOT_FOUND" },
        },
      });
    });

    it("refuses when the grant configuration changed before the lock", async () => {
      lockForUpdate.mockResolvedValue({
        ...application,
        currentConfigVersion: "2.0.0",
      });

      await expect(updateEntitlement(update)).rejects.toMatchObject({
        output: {
          statusCode: 409,
          payload: { errorCode: "CONFIGURATION_CHANGED" },
        },
      });
    });
  });
  // Whether an operator may see or change an application's Claims is Grants' to
  // decide, from the roles the grant requires.
  describe("access by claims roles", () => {
    const holding = (...roles) => findHeldRoles.mockResolvedValue(roles);
    const forbidden = { output: { statusCode: 403 } };

    beforeEach(() => {
      resolveCurrentGrantUseCase.mockResolvedValue({ grant: restrictedGrant });
    });

    describe("getApplicationClaimsOverview", () => {
      const overview = () =>
        getApplicationClaimsOverview({
          code: command.code,
          clientRef: command.clientRef,
          findHeldRoles,
        });

      it("answers full access, and the roles it was decided on, to an operator holding them", async () => {
        holding("ROLE_WMP_CLAIMS");

        await expect(overview()).resolves.toMatchObject({
          access: "full",
          claimsRequiredRoles: requiredRoles,
        });
      });

      it("answers view-only access to an operator holding other roles", async () => {
        holding("ROLE_OTHER");

        await expect(overview()).resolves.toMatchObject({
          access: "view-only",
        });
      });

      it("refuses an operator holding no roles", async () => {
        holding();

        await expect(overview()).rejects.toMatchObject(forbidden);
      });

      it("passes on a failure to determine the operator's roles", async () => {
        findHeldRoles.mockRejectedValue(Boom.serverUnavailable());

        await expect(overview()).rejects.toMatchObject({
          output: { statusCode: 503 },
        });
      });

      it("does not ask for the roles when the grant requires none", async () => {
        resolveCurrentGrantUseCase.mockResolvedValue({ grant });

        await expect(overview()).resolves.toMatchObject({ access: "full" });
        expect(findHeldRoles).not.toHaveBeenCalled();
      });
    });

    describe("getEntitlementCreationDetails", () => {
      const details = (claimCode = command.claimCode) =>
        getEntitlementCreationDetails({ ...command, claimCode, findHeldRoles });

      it("shows the creation option to an operator who may change claims", async () => {
        holding("ROLE_WMP_CLAIMS");

        await expect(details()).resolves.toMatchObject({
          claimCode: command.claimCode,
        });
      });

      it("refuses an operator who may only view claims", async () => {
        holding("ROLE_OTHER");

        await expect(details()).rejects.toMatchObject(forbidden);
      });

      it("refuses before saying whether the claim code exists", async () => {
        holding("ROLE_OTHER");

        await expect(details("ENT_UNKNOWN")).rejects.toMatchObject(forbidden);
      });
    });

    describe("createEntitlement", () => {
      it("creates for an operator who may change claims", async () => {
        holding("ROLE_WMP_CLAIMS");

        await createEntitlement(command, findHeldRoles);

        expect(insertEntitlement).toHaveBeenCalled();
      });

      it.each([[["ROLE_OTHER"]], [[]]])(
        "refuses an operator holding %j before touching anything",
        async (roles) => {
          holding(...roles);

          await expect(
            createEntitlement(command, findHeldRoles),
          ).rejects.toMatchObject(forbidden);
          expect(withTransaction).not.toHaveBeenCalled();
          expect(insertEntitlement).not.toHaveBeenCalled();
        },
      );

      it("does not ask for the roles when the grant requires none", async () => {
        resolveCurrentGrantUseCase.mockResolvedValue({ grant });

        await createEntitlement(command, findHeldRoles);

        expect(findHeldRoles).not.toHaveBeenCalled();
      });

      it("fails when it cannot tell which roles the operator holds", async () => {
        findHeldRoles.mockRejectedValue(Boom.serverUnavailable());

        await expect(
          createEntitlement(command, findHeldRoles),
        ).rejects.toMatchObject({ output: { statusCode: 503 } });
        expect(insertEntitlement).not.toHaveBeenCalled();
      });

      // A retry resolves the grant afresh, and the configuration may have changed
      // under it, so the check follows the grant each attempt creates under.
      it("checks a retry against the grant it is about to create under", async () => {
        resolveCurrentGrantUseCase
          .mockResolvedValueOnce({ grant })
          .mockResolvedValueOnce({ grant: restrictedGrant });
        insertEntitlement.mockResolvedValueOnce(false);
        holding("ROLE_OTHER");

        await expect(
          createEntitlement(command, findHeldRoles),
        ).rejects.toMatchObject(forbidden);
        expect(withTransaction).toHaveBeenCalledTimes(1);
        expect(findHeldRoles).toHaveBeenCalledTimes(1);
      });
    });

    describe("updateEntitlement", () => {
      const update = {
        code: command.code,
        clientRef: command.clientRef,
        entitlementId: "entitlement-1",
        data: { hectares: { value: 45000 } },
      };

      it("refuses an operator who may only view claims, before any write", async () => {
        holding("ROLE_OTHER");

        await expect(
          updateEntitlement(update, findHeldRoles),
        ).rejects.toMatchObject(forbidden);
        expect(withTransaction).not.toHaveBeenCalled();
        expect(updateEntitlementData).not.toHaveBeenCalled();
      });

      it("does not ask for the roles when the grant requires none", async () => {
        resolveCurrentGrantUseCase.mockResolvedValue({ grant });
        findExistingEntitlements.mockResolvedValue([]);

        // Past the access check, there is no such entitlement to change.
        await expect(
          updateEntitlement(update, findHeldRoles),
        ).rejects.toMatchObject({ output: { statusCode: 404 } });
        expect(findHeldRoles).not.toHaveBeenCalled();
      });
    });
  });
});
