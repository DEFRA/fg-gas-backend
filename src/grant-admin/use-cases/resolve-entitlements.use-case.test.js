import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { findExistingEntitlements } from "../../grants/repositories/entitlement.repository.js";
import { findApplicationByClientRefAndCodeUseCase } from "../../grants/use-cases/find-application-by-client-ref-and-code.use-case.js";
import { resolveCurrentGrantUseCase } from "../../grants/use-cases/resolve-current-grant.use-case.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

vi.mock(
  "../../grants/use-cases/find-application-by-client-ref-and-code.use-case.js",
);
vi.mock("../../grants/repositories/entitlement.repository.js");
vi.mock(
  "../../grants/use-cases/resolve-current-grant.use-case.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      resolveCurrentGrantUseCase: vi.fn(),
    };
  },
);
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

// The application helper sits at PRE_AWARD:ASSESSMENT:APPLICATION_RECEIVED,
// which is the position the grant helper's phases describe.
const position = {
  phase: "PRE_AWARD",
  stage: "ASSESSMENT",
  status: "APPLICATION_RECEIVED",
};

const createTemplate = (overrides = {}) => ({
  claimCode: "ENT_PA3",
  name: "PA3 entitlement",
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
  },
  maxEntitlements: 1,
  availableAt: [position],
  ...overrides,
});

const givenGrantWith = (entitlementTemplates) => {
  const grant = createTestGrant({ entitlementTemplates });
  resolveCurrentGrantUseCase.mockResolvedValue({ grant });
  return grant;
};

describe("resolve entitlements use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      createTestApplication({ clientRef, code }),
    );
    findExistingEntitlements.mockResolvedValue([]);
  });

  it("resolves the grant against the application's pinned config version", async () => {
    const application = createTestApplication({ clientRef, code });
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);
    givenGrantWith([]);

    await resolveEntitlementsUseCase({ code, clientRef });

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

  it("returns the application and grant it resolved", async () => {
    const application = createTestApplication({ clientRef, code });
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);
    const grant = givenGrantWith([]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.application).toBe(application);
    expect(result.grant).toBe(grant);
  });

  it("returns the existing entitlements it read", async () => {
    givenGrantWith([]);
    const existing = [{ claimCode: "ENT_PA3" }];
    findExistingEntitlements.mockResolvedValue(existing);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.existing).toBe(existing);
  });

  it("returns the templates available at the application's current position", async () => {
    givenGrantWith([createTemplate()]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toHaveLength(1);
    expect(result.offerable[0].claimCode).toBe("ENT_PA3");
  });

  // The parts a template leaves out match anything, so a phase-only template is
  // available everywhere within its phase.
  it("returns a template that declares only the phase the application is in", async () => {
    givenGrantWith([
      createTemplate({ availableAt: [{ phase: position.phase }] }),
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toHaveLength(1);
    expect(result.offerable[0].claimCode).toBe("ENT_PA3");
  });

  it("excludes templates available at another status", async () => {
    givenGrantWith([
      createTemplate({
        availableAt: [{ ...position, status: "IN_REVIEW" }],
      }),
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toEqual([]);
  });

  // Phase is the one part a template cannot leave open, so an application in
  // another phase is out regardless of how little the template declares.
  it("excludes templates when the application is in another phase", async () => {
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(
      createTestApplication({
        clientRef,
        code,
        currentPhase: "POST_AWARD",
      }),
    );
    givenGrantWith([
      createTemplate({ availableAt: [{ phase: position.phase }] }),
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toEqual([]);
  });

  // A materialised entitlement is projected rather than created, so it is never
  // something the caller is offered the chance to create.
  it("excludes materialised templates from offerable", async () => {
    givenGrantWith([
      createTemplate({
        claimCode: "ENT_MATERIALISED",
        materialised: true,
        fields: undefined,
      }),
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toEqual([]);
  });

  it("keeps a template that has reached its maximum, with the count that says so", async () => {
    givenGrantWith([createTemplate({ maxEntitlements: 1 })]);
    findExistingEntitlements.mockResolvedValue([{ claimCode: "ENT_PA3" }]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toHaveLength(1);
    expect(result.offerable[0].createdCount).toBe(1);
    expect(result.offerable[0].maxEntitlements).toBe(1);
  });

  it("reports how many entitlements exist against a template", async () => {
    givenGrantWith([createTemplate({ maxEntitlements: 3 })]);
    findExistingEntitlements.mockResolvedValue([
      { claimCode: "ENT_PA3" },
      { claimCode: "ENT_PA3" },
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable[0].createdCount).toBe(2);
  });

  it("reports a count of zero when nothing has been created", async () => {
    givenGrantWith([createTemplate({ maxEntitlements: 1 })]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable[0].createdCount).toBe(0);
  });

  it("counts existing entitlements against their own claim code only", async () => {
    givenGrantWith([createTemplate({ maxEntitlements: 1 })]);
    findExistingEntitlements.mockResolvedValue([
      { claimCode: "ENT_SOMETHING_ELSE" },
      { claimCode: "ENT_SOMETHING_ELSE" },
    ]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toHaveLength(1);
  });

  it("returns nothing available when the grant defines no templates", async () => {
    givenGrantWith([]);

    const result = await resolveEntitlementsUseCase({ code, clientRef });

    expect(result.offerable).toEqual([]);
  });
});
