import { describe, expect, it, vi } from "vitest";
import { createTestApplication } from "../../../test/helpers/applications.js";
import {
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { getApplicationStatusUseCase } from "./get-application-status.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

vi.mock("./find-application-by-client-ref-and-code.use-case");
vi.mock("./resolve-current-grant.use-case.js");
describe("get application status use case", () => {
  it("should get the status of an application", async () => {
    const code = "grant-1";
    const clientRef = "ref-124";
    const application = createTestApplication({
      clientRef,
      code,
    });
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(application);
    resolveCurrentGrantUseCase.mockResolvedValue({
      grant: {},
      resolvedVersion: application.originalConfigVersion,
    });

    await expect(
      getApplicationStatusUseCase({ code, clientRef }),
    ).resolves.toEqual({
      phase: ApplicationPhase.PreAward,
      stage: ApplicationStage.Assessment,
      status: ApplicationStatus.Received,
      clientRef,
      grantCode: code,
      originalConfigVersion: application.originalConfigVersion,
      currentConfigVersion: application.currentConfigVersion,
    });

    expect(findApplicationByClientRefAndCodeUseCase).toHaveBeenLastCalledWith(
      clientRef,
      code,
    );
    expect(resolveCurrentGrantUseCase).toHaveBeenCalledWith(
      code,
      application.originalConfigVersion,
    );
  });
});
