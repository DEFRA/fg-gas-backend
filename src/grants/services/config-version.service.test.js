import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { storedDefinitionVersions } from "../../common/config-broker/definition-stores.js";
import { ConfigVersion } from "../models/config-version.js";
import {
  findLatestActive,
  findVersionDocument,
  findVersionsByGrantCode,
} from "../repositories/config-version.repository.js";
import {
  findByCode,
  findStoredGrantDocument,
  findStoredGrantSummary,
} from "../repositories/grant.repository.js";
import {
  findConfigVersionFiles,
  findConfigVersions,
  findGrantDefinitionSummary,
  findGrantLifecycle,
  findGrantVersionEntitlements,
  findStoredGrantDefinition,
} from "./config-version.service.js";

vi.mock("../../common/config-broker/definition-stores.js");
vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");

const VERSIONS = [
  {
    version: "2.0.0",
    status: "draft",
    receivedAt: "2026-10-15T10:04:00.000Z",
  },
  {
    version: "1.2.0",
    status: "active",
    receivedAt: "2026-10-10T16:25:00.000Z",
  },
];

const ROW = {
  _id: "row-1",
  grantCode: "woodland",
  version: "2.0.0",
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  definitions: {
    grant: { s3Key: "woodland/2.0.0/gas.json", fetchStatus: "fetched" },
    agreement: {
      s3Key: "woodland/2.0.0/agreement.json",
      fetchStatus: "pending",
    },
    payment: {
      s3Key: "woodland/2.0.0/payment.json",
      fetchStatus: "permanent_error",
    },
  },
};

describe("findConfigVersions", () => {
  it("answers every version newest first, naming the newest active one current", async () => {
    findVersionsByGrantCode.mockResolvedValue(VERSIONS);
    findLatestActive.mockResolvedValue(
      ConfigVersion.createMock({ grantCode: "woodland", version: "1.2.0" }),
    );

    expect(await findConfigVersions("woodland")).toEqual({
      code: "woodland",
      current: "1.2.0",
      versions: VERSIONS,
    });
    expect(findLatestActive).toHaveBeenCalledWith("woodland");
  });

  it("names no current version when none is active", async () => {
    findVersionsByGrantCode.mockResolvedValue([VERSIONS[0]]);
    findLatestActive.mockResolvedValue(null);

    expect((await findConfigVersions("woodland")).current).toBeNull();
  });

  it("answers null for a grant with no versions", async () => {
    findVersionsByGrantCode.mockResolvedValue([]);
    findLatestActive.mockResolvedValue(null);

    expect(await findConfigVersions("woodland")).toBeNull();
  });
});

describe("findConfigVersionFiles", () => {
  beforeEach(() => {
    findVersionDocument.mockResolvedValue(ROW);
    storedDefinitionVersions.mockImplementation(async (type) =>
      type === "agreement" ? new Set() : new Set(["2.0.0"]),
    );
  });

  it("answers the version and whether each of its files is stored, as plain data", async () => {
    const found = await findConfigVersionFiles({
      code: "woodland",
      version: "2.0.0",
    });

    expect(found).toStrictEqual({
      code: "woodland",
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
      files: {
        grant: { stored: true, fetchStatus: "fetched" },
        agreement: { stored: false, fetchStatus: "pending" },
        payment: { stored: true, fetchStatus: "permanent_error" },
      },
    });
    expect(storedDefinitionVersions).toHaveBeenCalledWith("grant", "woodland", [
      "2.0.0",
    ]);
    expect(storedDefinitionVersions).toHaveBeenCalledWith(
      "agreement",
      "woodland",
      ["2.0.0"],
    );
  });

  it("asks only about the files the version has", async () => {
    findVersionDocument.mockResolvedValue({
      ...ROW,
      definitions: { grant: ROW.definitions.grant },
    });

    const found = await findConfigVersionFiles({
      code: "woodland",
      version: "2.0.0",
    });

    expect(Object.keys(found.files)).toEqual(["grant"]);
    expect(storedDefinitionVersions).toHaveBeenCalledTimes(1);
    expect(storedDefinitionVersions).toHaveBeenCalledWith("grant", "woodland", [
      "2.0.0",
    ]);
  });

  it("answers null for an unknown version", async () => {
    findVersionDocument.mockResolvedValue(null);

    expect(
      await findConfigVersionFiles({ code: "woodland", version: "9.9.9" }),
    ).toBeNull();
  });

  it("refuses a row the read model cannot accept, never skipping it", async () => {
    findVersionDocument.mockResolvedValue({ ...ROW, receivedAt: null });

    await expect(
      findConfigVersionFiles({ code: "woodland", version: "2.0.0" }),
    ).rejects.toThrow("Invalid ConfigVersionFiles");
  });
});

describe("findGrantDefinitionSummary", () => {
  it("answers the stored grant's facts and size", async () => {
    const summary = {
      description: "Woodland creation",
      startDate: "2025-04-01",
      adminRole: null,
      storedBytes: 512,
    };
    findStoredGrantSummary.mockResolvedValue(summary);

    expect(
      await findGrantDefinitionSummary({ code: "woodland", version: "2.0.0" }),
    ).toEqual(summary);
    expect(findStoredGrantSummary).toHaveBeenCalledWith("woodland", "2.0.0");
  });

  it("answers every fact null when the grant file is not stored", async () => {
    findStoredGrantSummary.mockResolvedValue(null);

    expect(
      await findGrantDefinitionSummary({ code: "woodland", version: "2.0.0" }),
    ).toEqual({
      description: null,
      startDate: null,
      adminRole: null,
      storedBytes: null,
    });
  });
});

describe("findStoredGrantDefinition", () => {
  it("answers the stored grant document and its size", async () => {
    const document = { code: "woodland", version: "2.0.0" };
    findStoredGrantDocument.mockResolvedValue({ document, storedBytes: 512 });

    expect(
      await findStoredGrantDefinition(
        { code: "woodland", version: "2.0.0" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ definition: document, storedBytes: 512 });
    expect(findStoredGrantDocument).toHaveBeenCalledWith("woodland", "2.0.0", {
      maxBytes: 1024,
    });
  });

  it("answers a document over maxBytes by its size alone", async () => {
    findStoredGrantDocument.mockResolvedValue({
      document: null,
      storedBytes: 2048,
    });

    expect(
      await findStoredGrantDefinition(
        { code: "woodland", version: "2.0.0" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ definition: null, storedBytes: 2048 });
  });

  it("answers no definition and no size when the grant file is not stored", async () => {
    findStoredGrantDocument.mockResolvedValue(null);

    expect(
      await findStoredGrantDefinition(
        { code: "woodland", version: "2.0.0" },
        { maxBytes: 1024 },
      ),
    ).toEqual({ definition: null, storedBytes: null });
  });
});

describe("findGrantLifecycle", () => {
  const ref = { code: "woodland", version: "2.0.0" };

  it("answers the stored grant's lifecycle as Grants resolves it", async () => {
    const grant = createTestGrant();
    findByCode.mockResolvedValue(grant);

    expect(await findGrantLifecycle(ref)).toEqual({
      lifecycle: grant.describeLifecycle(),
      problem: null,
    });
    expect(findByCode).toHaveBeenCalledWith("woodland", "2.0.0");
  });

  it("answers null when the grant file is not stored", async () => {
    findByCode.mockResolvedValue(null);

    expect(await findGrantLifecycle(ref)).toBeNull();
  });

  it("answers why a stored grant that cannot be described has no lifecycle", async () => {
    findByCode.mockResolvedValue(
      createTestGrant({
        phases: [{ code: "P", stages: [{ code: "S", statuses: [] }] }],
      }),
    );

    expect(await findGrantLifecycle(ref)).toEqual({
      lifecycle: null,
      problem:
        'Grant "test-grant" has a lifecycle GAS cannot read: "phases[0].stages[0].statuses" must contain at least 1 items',
    });
  });

  it.each([
    ["an invalid", Boom.badImplementation("x".repeat(600))],
    ["a malformed", new TypeError("x".repeat(600))],
  ])(
    "answers %s stored grant's defect, cut to 500 characters",
    async (_, error) => {
      findByCode.mockRejectedValue(error);

      expect(await findGrantLifecycle(ref)).toEqual({
        lifecycle: null,
        problem: "x".repeat(500),
      });
    },
  );

  it("fails on a fault in describing a grant that loaded", async () => {
    const grant = createTestGrant();
    const fault = new TypeError("describing broke");
    vi.spyOn(grant, "describeLifecycle").mockImplementation(() => {
      throw fault;
    });
    findByCode.mockResolvedValue(grant);

    await expect(findGrantLifecycle(ref)).rejects.toBe(fault);
  });

  it("fails on anything that is not a defect of the stored grant", async () => {
    const error = new Error("connection lost");
    findByCode.mockRejectedValue(error);

    await expect(findGrantLifecycle(ref)).rejects.toBe(error);
  });
});

describe("findGrantVersionEntitlements", () => {
  const ref = { code: "woodland", version: "2.0.0" };
  const ACCEPTED = {
    phase: "POST_AWARD",
    stage: "AGREEMENT",
    status: "ACCEPTED",
  };

  const storing = async (overrides) => {
    const { toGrant } = await vi.importActual(
      "../repositories/grant.repository.js",
    );
    findByCode.mockImplementation(async () =>
      toGrant({
        code: "woodland",
        version: "2.0.0",
        metadata: { description: "Woodland", startDate: "2025-04-01" },
        actions: [],
        phases: [
          {
            code: "POST_AWARD",
            stages: [
              {
                code: "AGREEMENT",
                statuses: [
                  { code: "OFFERED" },
                  { code: "ACCEPTED", name: "Accepted" },
                ],
              },
            ],
          },
        ],
        ...overrides,
      }),
    );
  };

  it("answers null when the grant file is not stored", async () => {
    findByCode.mockResolvedValue(null);

    expect(await findGrantVersionEntitlements(ref)).toBeNull();
    expect(findByCode).toHaveBeenCalledWith("woodland", "2.0.0");
  });

  it("answers each template as the model normalised it, with its defaults applied", async () => {
    await storing({
      entitlementTemplates: [
        {
          claimCode: "MAINTENANCE",
          name: "Maintenance payment",
          description: null,
          availableAt: [ACCEPTED],
          claim: { claimableAt: [{ phase: "POST_AWARD" }] },
        },
        {
          claimCode: "CAPITAL",
          name: "Capital items",
          availableAt: [ACCEPTED],
          claim: null,
        },
      ],
      claims: { requiredRoles: { allOf: ["Grants.Claims.Read"] } },
    });

    expect(await findGrantVersionEntitlements(ref)).toStrictEqual({
      entitlementTemplates: [
        {
          claimCode: "MAINTENANCE",
          name: "Maintenance payment",
          description: undefined,
          materialised: true,
          fields: undefined,
          maxEntitlements: 1,
          availableAt: [ACCEPTED],
          help: undefined,
          claim: {
            claimableAt: [{ phase: "POST_AWARD" }],
            limits: { maximumClaims: 1, allowsPartialClaims: false },
            requiresApproval: false,
            requiresEvidence: false,
          },
        },
        {
          claimCode: "CAPITAL",
          name: "Capital items",
          description: undefined,
          materialised: true,
          fields: undefined,
          maxEntitlements: 1,
          availableAt: [ACCEPTED],
          help: undefined,
          claim: undefined,
        },
      ],
      claims: { requiredRoles: { allOf: ["Grants.Claims.Read"] } },
      statusNames: { "POST_AWARD:AGREEMENT:ACCEPTED": "Accepted" },
    });
  });

  it("answers no templates and no claims for a grant with neither", async () => {
    await storing({ entitlementTemplates: undefined, claims: null });

    expect(await findGrantVersionEntitlements(ref)).toStrictEqual({
      entitlementTemplates: [],
      claims: null,
      statusNames: { "POST_AWARD:AGREEMENT:ACCEPTED": "Accepted" },
    });
  });

  it("names each named status by its full position, in every phase", async () => {
    await storing({
      phases: [
        {
          code: "PRE_AWARD",
          name: "Pre-award",
          stages: [
            {
              code: "ASSESSMENT",
              statuses: [
                { code: "RECEIVED", name: "Received" },
                { code: "IN_PROGRESS" },
              ],
            },
          ],
        },
        {
          code: "POST_AWARD",
          stages: [
            {
              code: "AGREEMENT",
              statuses: [{ code: "RECEIVED", name: "Offer received" }],
            },
          ],
        },
      ],
    });

    expect((await findGrantVersionEntitlements(ref)).statusNames).toEqual({
      "PRE_AWARD:ASSESSMENT:RECEIVED": "Received",
      "POST_AWARD:AGREEMENT:RECEIVED": "Offer received",
    });
  });

  it("refuses a stored template the model cannot load", async () => {
    await storing({
      entitlementTemplates: [
        {
          claimCode: "MAINTENANCE",
          name: "Maintenance payment",
          materialised: null,
          availableAt: [ACCEPTED],
        },
      ],
    });

    await expect(findGrantVersionEntitlements(ref)).rejects.toThrow(
      'Invalid entitlement template "MAINTENANCE"',
    );
  });
});
