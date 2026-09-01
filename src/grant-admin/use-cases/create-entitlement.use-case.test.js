import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreementBySourceIdentity } from "../../agreements/repositories/agreement.repository.js";
import { insertEntitlement } from "../repositories/entitlement.repository.js";
import { createEntitlementUseCase } from "./create-entitlement.use-case.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

vi.mock("./resolve-entitlements.use-case.js");
vi.mock("../repositories/entitlement.repository.js");
vi.mock("../../agreements/repositories/agreement.repository.js");

const code = "woodland";
const clientRef = "wmp-abc-123";
const claimCode = "ENT_CS_CAPITAL_PA3";

const template = {
  claimCode,
  name: "PA3 entitlement",
  materialised: false,
  maxEntitlements: 1,
  fields: {
    totalHectares: { input: true, unitType: "decimal" },
    actionCode: { input: false, value: "PA3", unitType: "string" },
    actionVersion: {
      input: false,
      value: "jsonata: $.agreement.actions[code='PA3'].version",
      unitType: "string",
    },
  },
  inputFieldNames() {
    return Object.entries(this.fields)
      .filter(([, field]) => field.input)
      .map(([name]) => name);
  },
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
    findAgreementBySourceIdentity.mockResolvedValue({
      actions: [{ code: "PA3", version: "1.2.3" }],
    });
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
      instanceNumber: 1,
      configVersion: "1.1.0",
      data: {
        totalHectares: 455000,
        actionCode: "PA3",
        actionVersion: "1.2.3",
      },
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

  it("refuses data containing a field that is not an input in the template", async () => {
    givenEntitlements();

    await expect(
      createEntitlementUseCase({
        ...request,
        data: { ...request.data, arbitrary: { value: "value" } },
      }),
    ).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_ENTITLEMENT_DATA",
          message: `Entitlement data for claim code '${claimCode}' does not match the template: unexpected fields: arbitrary.`,
        },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
  });

  it("refuses data missing an input field from the template", async () => {
    const templateWithTwoInputs = {
      ...template,
      fields: {
        ...template.fields,
        reference: { input: true, unitType: "string" },
      },
    };
    givenEntitlements({ offerable: [templateWithTwoInputs] });

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: {
        statusCode: 422,
        payload: {
          errorCode: "INVALID_ENTITLEMENT_DATA",
          message: `Entitlement data for claim code '${claimCode}' does not match the template: missing fields: reference.`,
        },
      },
    });
    expect(insertEntitlement).not.toHaveBeenCalled();
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

  it("allocates the lowest unclaimed entitlement instance number", async () => {
    givenEntitlements({
      offerable: [{ ...template, maxEntitlements: 3 }],
      existing: [
        { claimCode, instanceNumber: 1 },
        { claimCode, instanceNumber: 3 },
      ],
    });

    const entitlement = await createEntitlementUseCase(request);

    expect(entitlement.instanceNumber).toEqual(2);
  });

  it("retries after another request claims the selected slot", async () => {
    givenEntitlements({ offerable: [{ ...template, maxEntitlements: 2 }] });
    insertEntitlement.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    resolveEntitlementsUseCase.mockResolvedValueOnce({
      application,
      grant,
      offerable: [{ ...template, maxEntitlements: 2 }],
      existing: [],
    });
    resolveEntitlementsUseCase.mockResolvedValueOnce({
      application,
      grant,
      offerable: [{ ...template, maxEntitlements: 2 }],
      existing: [{ claimCode, instanceNumber: 1 }],
    });

    const entitlement = await createEntitlementUseCase(request);

    expect(entitlement.instanceNumber).toEqual(2);
    expect(insertEntitlement).toHaveBeenCalledTimes(2);
  });

  it("returns the capacity error when its one retry also loses the slot", async () => {
    givenEntitlements();
    insertEntitlement.mockResolvedValue(false);

    await expect(createEntitlementUseCase(request)).rejects.toMatchObject({
      output: {
        statusCode: 409,
        payload: { errorCode: "ENTITLEMENT_LIMIT_EXCEEDED" },
      },
    });
    expect(insertEntitlement).toHaveBeenCalledTimes(2);
  });
});
