import { beforeEach, describe, expect, it, vi } from "vitest";
import { findConfigDefinition } from "../../common/config-broker/config-catalog.repository.js";
import { resolveClaimPayment } from "./resolve-claim-payment.js";
import { resolvePaymentDefinition } from "./resolve-payment-definition.js";

vi.mock("../../common/config-broker/config-catalog.repository.js");
vi.mock("./resolve-payment-definition.js");

const code = "woodland";
const configVersion = "1.28.2";
const claim = {
  metadata: { sbi: "113593357", frn: "1100943757" },
  claim: { entitlementId: "entitlement-1", totalClaimAmountPence: 150000 },
};
const resolved = { totalAmountPence: 150000 };

describe("resolveClaimPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findConfigDefinition.mockResolvedValue({
      s3Key: "woodland/1.28.2/gas/payment.json",
    });
    resolvePaymentDefinition.mockResolvedValue(resolved);
  });

  it("resolves the definition against the submitted Claim", async () => {
    await expect(
      resolveClaimPayment({ code, configVersion, claim }),
    ).resolves.toBe(resolved);

    expect(resolvePaymentDefinition).toHaveBeenCalledWith({
      code,
      configVersion,
      context: {
        claim,
        execution: { executedAt: expect.any(String) },
      },
    });
  });

  it("looks the definition up for this grant and version", async () => {
    await resolveClaimPayment({ code, configVersion, claim });

    expect(findConfigDefinition).toHaveBeenCalledWith({
      grantCode: code,
      version: configVersion,
      definitionType: "payment",
    });
  });

  it("resolves nothing when the grant configures no definition", async () => {
    findConfigDefinition.mockResolvedValue(null);

    await expect(
      resolveClaimPayment({ code, configVersion, claim }),
    ).resolves.toBeNull();
    expect(resolvePaymentDefinition).not.toHaveBeenCalled();
  });

  it("resolves nothing without a configuration version", async () => {
    await expect(
      resolveClaimPayment({ code, configVersion: undefined, claim }),
    ).resolves.toBeNull();
    expect(findConfigDefinition).not.toHaveBeenCalled();
    expect(resolvePaymentDefinition).not.toHaveBeenCalled();
  });

  it("propagates a configured definition that cannot be resolved", async () => {
    resolvePaymentDefinition.mockRejectedValue(new Error("bad definition"));

    await expect(
      resolveClaimPayment({ code, configVersion, claim }),
    ).rejects.toThrow("bad definition");
  });
});
