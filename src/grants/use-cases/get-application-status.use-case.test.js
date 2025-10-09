import { describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { getApplicationStatusUseCase } from "./get-application-status.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case");
describe("get application status use case", () => {
  it("should get the status of an application", async () => {
    const code = "grant-1";
    const clientRef = "ref-124";
    const application = createTestApplication({
      clientRef,
      code,
    });
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);

    await expect(
      getApplicationStatusUseCase({ code, clientRef }),
    ).resolves.toEqual({
      phase: "PRE_AWARD",
      stage: "ASSESSMENT",
      status: "RECEIVED",
      clientRef,
      grantCode: code,
    });

    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenLastCalledWith(
      clientRef,
      code,
    );
  });
});
