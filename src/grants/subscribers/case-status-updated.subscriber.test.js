import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveApplicationUseCase } from "../use-cases/approve-application.use-case.js";
import { caseStatusUpdatedSubscriber } from "./case-status-updated.subscriber.js";

vi.mock("../use-cases/approve-application.use-case.js");

describe("case status updated subscriber", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should approve a case/application", async () => {
    const message = {
      data: {
        currentStatus: "APPROVED",
      },
    };
    await caseStatusUpdatedSubscriber.onMessage(message);
    expect(approveApplicationUseCase).toHaveBeenCalled();
  });

  it("should not approve a case/application if currentStatus is not approved", async () => {
    const message = {
      data: {
        currentStatus: "WITHDRAWN",
      },
    };
    await caseStatusUpdatedSubscriber.onMessage(message);
    expect(approveApplicationUseCase).not.toHaveBeenCalled();
  });
});
