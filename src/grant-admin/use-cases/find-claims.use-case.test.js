import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaimsView } from "../services/build-claims-view.js";
import { findClaimsUseCase } from "./find-claims.use-case.js";
import { resolveEntitlementsUseCase } from "./resolve-entitlements.use-case.js";

vi.mock("./resolve-entitlements.use-case.js");
vi.mock("../services/build-claims-view.js");

const code = "grant-1";
const clientRef = "application-1";

const application = { clientRef };
const grant = { code };
const available = [{ claimCode: "ENT_PA3" }];

const view = {
  banner: { title: { text: "Elmwood Land Co", type: "string" }, summary: {} },
  availableEntitlements: available,
  claimableEntitlements: [],
  claims: [],
};

describe("find claims use case", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEntitlementsUseCase.mockResolvedValue({
      application,
      grant,
      atPosition: available,
      available,
      existing: [],
    });
    buildClaimsView.mockResolvedValue(view);
  });

  it("returns the claims view built from the resolved entitlements", async () => {
    const result = await findClaimsUseCase({ code, clientRef });

    expect(resolveEntitlementsUseCase).toHaveBeenCalledWith({
      code,
      clientRef,
    });
    expect(buildClaimsView).toHaveBeenCalledWith({
      grant,
      application,
      available,
    });
    expect(result).toEqual(view);
  });
});
