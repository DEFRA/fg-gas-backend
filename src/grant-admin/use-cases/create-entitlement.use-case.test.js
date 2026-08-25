import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertEntitlement } from "../repositories/entitlement.repository.js";
import { createEntitlementUseCase } from "./create-entitlement.use-case.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

vi.mock("./resolve-entitlements.use-case.js");
vi.mock("../repositories/entitlement.repository.js");

const code = "woodland";
const clientRef = "wmp-abc-123";
const claimCode = "ENT_CS_CAPITAL_PA3";

const template = {
  claimCode,
  name: "PA3 entitlement",
  materialised: false,
  maxEntitlements: 1,
};

const application = { clientRef, currentConfigVersion: "1.1.0" };

const grant = {
  code,
  findEntitlementTemplate: (candidate) =>
    [template].find((t) => t.claimCode === candidate),
};

const request = {
  code,
  clientRef,
  claimCode,
  data: { totalHectares: { value: 455000 } },
};

const givenEntitlements = ({ offerable = [template], existing = [] } = {}) =>
  resolveEntitlementsUseCase.mockResolvedValue({
    application,
    grant,
    offerable,
    available: offerable,
    existing,
  });

describe("create entitlement use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists and returns the entitlement", async () => {
    givenEntitlements();

    const entitlement = await createEntitlementUseCase(request);

    expect(resolveEntitlementsUseCase).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(insertEntitlement).toHaveBeenCalledWith(entitlement);
    expect(entitlement).toMatchObject({
      clientRef,
      code,
      claimCode,
      configVersion: "1.1.0",
      data: { totalHectares: 455000 },
    });
    expect(entitlement.id).toBeDefined();
    expect(entitlement.createdAt).toBeDefined();
  });

  it("maps a missing application to the structured 404", async () => {
    resolveEntitlementsUseCase.mockRejectedValue(
      Boom.notFound(
        `Application with clientRef "${clientRef}" and code "${code}" not found`,
      ),
    );

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: {
        statusCode: 404,
        payload: {
          errorCode: "APPLICATION_NOT_FOUND",
          message: `No matching application found for clientRef '${clientRef}' and grantCode '${code}'.`,
        },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
  });

  it("passes other resolution errors through untouched", async () => {
    resolveEntitlementsUseCase.mockRejectedValue(
      Boom.notFound('Grant with code "woodland" not found'),
    );

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    await expect(createEntitlementUseCase(request)).rejects.not.toMatchObject({
      output: { payload: { errorCode: "APPLICATION_NOT_FOUND" } },
    });
  });

  it("refuses a claim code the grant does not define", async () => {
    givenEntitlements();

    await expect(
      createEntitlementUseCase({ ...request, claimCode: "ENT_UNKNOWN" }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_CLAIM_CODE",
          message: `Claim code 'ENT_UNKNOWN' is not defined for grant code '${code}'.`,
        },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
  });

  it("refuses a claim code that is not offerable for the application", async () => {
    givenEntitlements({ offerable: [] });

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_CLAIM_CODE",
          message: `Claim code '${claimCode}' is not available for application '${clientRef}'.`,
        },
      },
    });
  });

  it("refuses a claim code at its entitlement limit", async () => {
    givenEntitlements({ existing: [{ claimCode }] });

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: {
          errorCode: "ENTITLEMENT_LIMIT_EXCEEDED",
          message: `Cannot create entitlement '${claimCode}'. Maximum instance limit of 1 has been reached.`,
        },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
  });

  it("counts only entitlements for the same claim code against the limit", async () => {
    givenEntitlements({ existing: [{ claimCode: "ENT_OTHER" }] });

    const entitlement = await createEntitlementUseCase(request);

    expect(insertEntitlement).toHaveBeenCalledWith(entitlement);
  });
});
