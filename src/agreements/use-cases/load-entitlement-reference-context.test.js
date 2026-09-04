import { beforeEach, describe, expect, it, vi } from "vitest";
import { findAgreementBySourceIdentity } from "../repositories/agreement.repository.js";
import { loadEntitlementReferenceContext } from "./load-entitlement-reference-context.js";

vi.mock("../repositories/agreement.repository.js");

const identity = { code: "woodland", clientRef: "app-123" };

describe("loadEntitlementReferenceContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a plain Agreement reference context", async () => {
    class Agreement {
      constructor() {
        this.actions = [{ code: "PA3", version: "1.2.3" }];
      }
    }

    findAgreementBySourceIdentity.mockResolvedValue(new Agreement());

    const context = await loadEntitlementReferenceContext(identity);

    expect(context).toEqual({
      agreement: { actions: [{ code: "PA3", version: "1.2.3" }] },
    });
    expect(Object.getPrototypeOf(context.agreement)).toBe(Object.prototype);
  });

  it("forwards the caller session to the Agreement query", async () => {
    const session = { id: "transaction-session" };
    findAgreementBySourceIdentity.mockResolvedValue({});

    await loadEntitlementReferenceContext(identity, session);

    expect(findAgreementBySourceIdentity).toHaveBeenCalledWith(
      identity,
      session,
    );
  });

  it("returns a null Agreement when no Agreement data exists", async () => {
    findAgreementBySourceIdentity.mockResolvedValue(null);

    await expect(loadEntitlementReferenceContext(identity)).resolves.toEqual({
      agreement: null,
    });
  });
});
