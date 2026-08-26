import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaimsView } from "../services/build-claims-view.js";
import { findClaimUseCase } from "./find-claim.use-case.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

vi.mock("./resolve-entitlements.use-case.js");
vi.mock("../services/build-claims-view.js");

const code = "grant-1";
const clientRef = "application-1";
const claimCode = "ENT_PA3";

const application = { clientRef };
const grant = { code };

const template = {
  claimCode,
  name: "PA3 entitlement",
  materialised: false,
  maxEntitlements: 1,
};

const view = {
  banner: { title: { text: "Elmwood Land Co", type: "string" }, summary: {} },
  availableEntitlements: [template],
  claimableEntitlements: [],
  claims: [],
};

const givenEntitlements = ({ offerable, existing = [] }) => {
  const available = offerable.filter(
    (candidate) =>
      existing.filter((e) => e.claimCode === candidate.claimCode).length <
      candidate.maxEntitlements,
  );

  resolveEntitlementsUseCase.mockResolvedValue({
    application,
    grant,
    offerable,
    available,
    existing,
  });

  return available;
};

describe("find claim use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildClaimsView.mockResolvedValue(view);
  });

  it("returns the claims view with the template for the claim code", async () => {
    const available = givenEntitlements({ offerable: [template] });

    const result = await findClaimUseCase({ code, clientRef, claimCode });

    expect(resolveEntitlementsUseCase).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(buildClaimsView).toHaveBeenCalledWith({
      grant,
      application,
      available,
      existing: [],
    });
    expect(result).toEqual({ ...view, entitlementTemplate: template });
  });

  it("picks the template matching the claim code", async () => {
    const other = { ...template, claimCode: "ENT_OTHER" };
    givenEntitlements({ offerable: [other, template] });

    const result = await findClaimUseCase({ code, clientRef, claimCode });

    expect(result.entitlementTemplate).toEqual(template);
  });

  it("refuses a claim code that has reached maxEntitlements", async () => {
    givenEntitlements({
      offerable: [template],
      existing: [{ claimCode }],
    });

    await expect(
      findClaimUseCase({ code, clientRef, claimCode }),
    ).rejects.toThrow(
      Boom.conflict(
        `Application "${clientRef}" already has 1 of 1 entitlements for claim code "${claimCode}"`,
      ),
    );
  });

  it("allows a claim code that still has capacity", async () => {
    givenEntitlements({
      offerable: [{ ...template, maxEntitlements: 2 }],
      existing: [{ claimCode }],
    });

    const result = await findClaimUseCase({ code, clientRef, claimCode });

    expect(result.entitlementTemplate.maxEntitlements).toBe(2);
  });

  it("ignores entitlements for other claim codes", async () => {
    givenEntitlements({
      offerable: [template],
      existing: [{ claimCode: "ENT_OTHER" }],
    });

    const result = await findClaimUseCase({ code, clientRef, claimCode });

    expect(result.entitlementTemplate).toEqual(template);
  });

  it("refuses a claim code the position does not reach", async () => {
    givenEntitlements({
      offerable: [{ ...template, claimCode: "ENT_OTHER" }],
    });

    await expect(
      findClaimUseCase({ code, clientRef, claimCode }),
    ).rejects.toThrow(
      Boom.notFound(
        `No entitlement available for claim code "${claimCode}" on application "${clientRef}"`,
      ),
    );
  });

  it("refuses a materialised claim code, which is never offerable", async () => {
    givenEntitlements({ offerable: [] });

    await expect(
      findClaimUseCase({ code, clientRef, claimCode }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
  });
});
