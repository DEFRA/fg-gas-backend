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

  it("only updates if status not equal to APPROVED", async () => {
    const data = {
      clientRef: "test-client-ref",
      code: "test-grant",
      currentStatus: "APPROVED",
      answers: { question1: "answer1" },
    };
    const mock = Application.new(data);
    mock.currentStatus = "APPROVED";

    findByClientRefAndCode.mockResolvedValue(mock);

    await approveApplicationUseCase({
      caseRef: "112",
      workflowCode: "ACBG",
    });

    expect(findByClientRefAndCode).toHaveBeenCalledWith({
      clientRef: "112",
      code: "ACBG",
    });

    expect(publishApplicationApproved).not.toHaveBeenCalled();
  });

  it("throws when application is not found", async () => {
    findByClientRefAndCode.mockResolvedValue(null);

    await expect(
      approveApplicationUseCase({
        caseRef: "non-existent-client-ref",
        workflowCode: "ACBG",
      }),
    ).rejects.toThrowError(
      'Application with clientRef "non-existent-client-ref" and code "ACBG" not found',
    );
    expect(publishCreateAgreementCommand).not.toBeCalled();
  });
});
