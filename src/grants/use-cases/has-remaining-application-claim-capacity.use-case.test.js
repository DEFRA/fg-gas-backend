import { beforeEach, describe, expect, it, vi } from "vitest";
import { countByEntitlement } from "../repositories/claim.repository.js";
import { hasRemainingApplicationClaimCapacityUseCase } from "./has-remaining-application-claim-capacity.use-case.js";

vi.mock("../repositories/claim.repository.js");

const application = { code: "test-grant", clientRef: "application-1" };
const claimable = (id, hasRemainingCapacity) => ({
  entitlement: { id },
  hasRemainingCapacity,
});

describe("hasRemainingApplicationClaimCapacityUseCase", () => {
  const session = {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when any entitlement still has claim capacity", async () => {
    countByEntitlement.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const claimables = [
      claimable("entitlement-1", vi.fn().mockReturnValue(true)),
      claimable("entitlement-2", vi.fn().mockReturnValue(false)),
    ];

    await expect(
      hasRemainingApplicationClaimCapacityUseCase(
        { application, claimables },
        session,
      ),
    ).resolves.toBe(true);

    expect(countByEntitlement).toHaveBeenCalledWith(
      {
        code: application.code,
        clientRef: application.clientRef,
        entitlementId: "entitlement-1",
      },
      session,
    );
    expect(countByEntitlement).toHaveBeenCalledWith(
      {
        code: application.code,
        clientRef: application.clientRef,
        entitlementId: "entitlement-2",
      },
      session,
    );
  });

  it("returns false when every entitlement is fully claimed", async () => {
    countByEntitlement.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const claimables = [
      claimable("entitlement-1", vi.fn().mockReturnValue(false)),
      claimable("entitlement-2", vi.fn().mockReturnValue(false)),
    ];

    await expect(
      hasRemainingApplicationClaimCapacityUseCase(
        { application, claimables },
        session,
      ),
    ).resolves.toBe(false);
  });
});
