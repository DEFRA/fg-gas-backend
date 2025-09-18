import { describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import {
  publishApplicationApproved,
  publishCreateAgreementCommand,
} from "../publishers/application-event.publisher.js";
import { findByClientRefAndCode } from "../repositories/application.repository.js";
import { approveApplicationUseCase } from "./approve-application.use-case.js";

vi.mock("./find-application-by-client-ref.use-case.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../repositories/application.repository.js");

describe("approveApplicationUseCase", () => {
  it("publishes application approved event", async () => {
    const data = {
      clientRef: "test-client-ref",
      code: "test-grant",
      currentStatus: "foo",
      answers: { question1: "answer1" },
    };
    const mock = Application.new(data);
    findByClientRefAndCode.mockResolvedValue(mock);

    await approveApplicationUseCase({
      caseRef: "112",
      workflowCode: "ACBG",
    });

    expect(findByClientRefAndCode).toHaveBeenCalledWith({
      clientRef: "112",
      code: "ACBG",
    });

    expect(publishApplicationApproved).toHaveBeenCalledWith({
      clientRef: "test-client-ref",
      code: "test-grant",
      previousStatus: "PRE_AWARD:ASSESSMENT:RECEIVED",
      currentStatus: "PRE_AWARD:ASSESSMENT:APPROVED",
    });

    expect(publishCreateAgreementCommand).toHaveBeenCalledWith(mock);
  });

  it("throws when application is not found", async () => {
    findByClientRefAndCode.mockRejectedValue(null);

    await expect(
      approveApplicationUseCase({
        caseRef: "non-existent-client-ref",
        workflowCode: "ACBG",
      }),
    ).rejects.toThrowError(
      'Application with caseRef "non-existent-client-ref" and workflowCode "ACBG" not found',
    );
    expect(publishCreateAgreementCommand).not.toBeCalled();
  });
});
