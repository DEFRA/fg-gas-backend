import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { findExistingEntitlements } from "../repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import {
  findAvailableClaimsUseCase,
  resolveLive,
} from "./find-available-claims.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/entitlement.repository.js");
vi.mock("./resolve-current-grant.use-case.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCurrentGrantUseCase: vi.fn(),
  };
});
vi.mock("../../common/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const code = "grant-1";
const clientRef = "application-1";

const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

const createTemplate = (overrides = {}) => ({
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
  description: "The maximum eligible woodland area.",
  materialised: false,
  fields: {
    totalHectares: {
      input: true,
      label: "Total area of eligible woodland",
      unitType: "decimal",
      decimalPlaces: 4,
      unit: "HA",
      minValue: 0.5,
      maxValue: null,
    },
    actionCode: {
      input: false,
      value: "PA3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
    actionVersion: {
      input: false,
      value: "1.2.3",
      unitType: "string",
      minLength: 1,
      maxLength: null,
    },
  },
  maxEntitlements: 1,
  availableAt: position,
  ...overrides,
});

const createEntitlement = (overrides = {}) => ({
  clientRef,
  code,
  claimCode: "ENT_PA3",
  data: {
    totalHectares: 455000,
    actionCode: "PA3",
    actionVersion: "1.2.3",
  },
  ...overrides,
});

const givenGrantWith = (entitlementTemplates) => {
  const grant = createTestGrant({ entitlementTemplates });
  resolveCurrentGrantUseCase.mockResolvedValue({ grant });
  return grant;
};

describe("find available claims use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      createTestApplication({ clientRef, code }),
    );
    findExistingEntitlements.mockResolvedValue([]);
  });

  describe("stubbed mode (IS_STUBBED = true)", () => {
    it("returns the static stubbed response regardless of database state", async () => {
      const result = await findAvailableClaimsUseCase({ code, clientRef });

      expect(result.availableClaims).toHaveLength(1);
      expect(result.availableClaims[0]).toEqual({
        code: "ENT_CS_CAPITAL_PA3",
        name: "PA3 Woodland Management Plan entitlement",
        description:
          "The maximum eligible woodland area that can be claimed under PA3.",
        data: {
          totalHectares: {
            value: 455000,
            decimalPlaces: 4,
            minValue: 0.5,
            maxValue: null,
          },
          actionCode: {
            value: "PA3",
          },
          actionVersion: {
            value: "1.2.3",
          },
        },
      });
    });

    it("does not call application or grant resolution", async () => {
      await findAvailableClaimsUseCase({ code, clientRef });

      expect(findApplicationByClientRefAndCodeUseCase).not.toHaveBeenCalled();
      expect(resolveCurrentGrantUseCase).not.toHaveBeenCalled();
      expect(findExistingEntitlements).not.toHaveBeenCalled();
    });
  });

  describe("live resolution (resolveLive)", () => {
    it("resolves the grant against the application's pinned config version", async () => {
      const application = createTestApplication({ clientRef, code });
      findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);
      givenGrantWith([]);

      await resolveLive(code, clientRef);

      expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenCalledWith(
        clientRef,
        code,
      );
      expect(resolveCurrentGrantUseCase).toHaveBeenCalledWith(
        code,
        application.currentConfigVersion,
      );
      expect(findExistingEntitlements).toHaveBeenCalledWith(clientRef, code);
    });

    it("returns persisted entitlement data merged with template constraints (AC1 + AC2)", async () => {
      givenGrantWith([createTemplate()]);
      findExistingEntitlements.mockResolvedValue([createEntitlement()]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toHaveLength(1);
      expect(result.availableClaims[0]).toEqual({
        code: "ENT_PA3",
        name: "PA3 entitlement",
        description: "The maximum eligible woodland area.",
        data: {
          totalHectares: {
            value: 455000,
            decimalPlaces: 4,
            minValue: 0.5,
            maxValue: null,
          },
          actionCode: {
            value: "PA3",
          },
          actionVersion: {
            value: "1.2.3",
          },
        },
      });
    });

    it("merges decimalPlaces, minValue, maxValue for decimal fields (AC2)", async () => {
      givenGrantWith([
        createTemplate({
          fields: {
            totalHectares: {
              input: true,
              label: "Total area",
              unitType: "decimal",
              decimalPlaces: 2,
              unit: "HA",
              minValue: 1.0,
              maxValue: 9999.99,
            },
          },
        }),
      ]);
      findExistingEntitlements.mockResolvedValue([
        createEntitlement({ data: { totalHectares: 500 } }),
      ]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims[0].data.totalHectares).toEqual({
        value: 500,
        decimalPlaces: 2,
        minValue: 1.0,
        maxValue: 9999.99,
      });
    });

    it("omits decimal constraints for string fields", async () => {
      givenGrantWith([createTemplate()]);
      findExistingEntitlements.mockResolvedValue([createEntitlement()]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims[0].data.actionCode).toEqual({
        value: "PA3",
      });
      expect(
        result.availableClaims[0].data.actionCode.decimalPlaces,
      ).toBeUndefined();
      expect(
        result.availableClaims[0].data.actionCode.minValue,
      ).toBeUndefined();
    });

    it("returns empty availableClaims when no entitlements exist (AC3)", async () => {
      givenGrantWith([createTemplate()]);
      findExistingEntitlements.mockResolvedValue([]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toEqual([]);
    });

    it("returns empty availableClaims when no templates match position (AC3)", async () => {
      givenGrantWith([
        createTemplate({
          availableAt: { ...position, status: "IN_REVIEW" },
        }),
      ]);
      findExistingEntitlements.mockResolvedValue([createEntitlement()]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toEqual([]);
    });

    it("returns empty availableClaims when the grant defines no templates", async () => {
      givenGrantWith([]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toEqual([]);
    });

    it("excludes materialised templates", async () => {
      givenGrantWith([
        createTemplate({
          claimCode: "ENT_MATERIALISED",
          materialised: true,
          fields: undefined,
        }),
      ]);
      findExistingEntitlements.mockResolvedValue([
        createEntitlement({ claimCode: "ENT_MATERIALISED" }),
      ]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toEqual([]);
    });

    it("uses the template fixed value when entitlement data is missing a field", async () => {
      givenGrantWith([createTemplate()]);
      findExistingEntitlements.mockResolvedValue([
        createEntitlement({ data: { totalHectares: 300 } }),
      ]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims[0].data.actionCode.value).toBe("PA3");
      expect(result.availableClaims[0].data.actionVersion.value).toBe("1.2.3");
    });

    it("propagates 404 when application is not found (AC4)", async () => {
      findApplicationByClientRefAndCodeUseCase.mockRejectedValue({
        isBoom: true,
        output: { statusCode: 404 },
      });

      await expect(resolveLive(code, clientRef)).rejects.toMatchObject({
        output: { statusCode: 404 },
      });
    });

    it("returns multiple available claims when multiple entitlements exist", async () => {
      givenGrantWith([createTemplate({ maxEntitlements: 3 })]);
      findExistingEntitlements.mockResolvedValue([
        createEntitlement({
          data: {
            totalHectares: 100,
            actionCode: "PA3",
            actionVersion: "1.0.0",
          },
        }),
        createEntitlement({
          data: {
            totalHectares: 200,
            actionCode: "PA3",
            actionVersion: "1.0.0",
          },
        }),
      ]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toHaveLength(2);
      expect(result.availableClaims[0].data.totalHectares.value).toBe(100);
      expect(result.availableClaims[1].data.totalHectares.value).toBe(200);
    });

    it("only includes entitlements matching a persisted template's claimCode", async () => {
      givenGrantWith([createTemplate()]);
      findExistingEntitlements.mockResolvedValue([
        createEntitlement({ claimCode: "ENT_SOMETHING_ELSE" }),
      ]);

      const result = await resolveLive(code, clientRef);

      expect(result.availableClaims).toEqual([]);
    });
  });
});
