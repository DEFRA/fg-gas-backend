import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { Application } from "../models/application.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application-series.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import { replaceApplicationUseCase } from "./replace-application.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("./create-application.use-case.js");
vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application-series.repository.js");
vi.mock("../repositories/grant.repository.js");

const testApplication = {
  metadata: {
    clientRef: "new-client-ref",
    previousClientRef: "previous-client-ref",
    sbi: "123456789",
    frn: "987654321",
    crn: "CRN123456",
    defraId: "DEFRA123456",
    submittedAt: "2000-01-01T12:00:00Z",
  },
  answers: {
    question1: "answer1",
  },
};

describe("replaceApplicationUseCase", () => {
  beforeEach(() => {
    findByCode.mockResolvedValue({
      amendablePositions: ["PRE_AWARD:REVIEW_OFFER:APPLICATION_AMEND"],
    });
  });

  it("creates a new application and updates the series when replacement is allowed", async () => {
    const prevApplication = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "APPLICATION_AMEND",
      code: "test-grant",
      clientRef: "ref-123",
      phases: [],
    });

    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));

    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(prevApplication);
    createApplicationUseCase.mockResolvedValue("new-application-id");

    const mockXref = { addClientRef: vi.fn() };
    findByClientRefAndCode.mockResolvedValue(mockXref);
    update.mockResolvedValue({});

    await replaceApplicationUseCase("test-grant", testApplication);

    expect(createApplicationUseCase).toHaveBeenCalledWith(
      "test-grant",
      testApplication,
      mockSession,
    );
    expect(findByClientRefAndCode).toHaveBeenCalledWith(
      "previous-client-ref",
      "test-grant",
      mockSession,
    );
    expect(mockXref.addClientRef).toHaveBeenCalledWith(
      "new-client-ref",
      "new-application-id",
    );
    expect(update).toHaveBeenCalledWith(mockXref, mockSession);
  });

  it("throws a conflict error when replacement is not allowed", async () => {
    const testApplication = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "APPLICATION_AMEND",
      code: "test-grant",
      clientRef: "ref-123",
      phases: [],
    });
    const prevApplication = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "NOT_ALLOWED",
      code: "test-grant",
      clientRef: "ref-123",
      phases: [],
    });
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(prevApplication);

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 409 },
      message: expect.stringContaining("new clientRef"),
    });

    expect(createApplicationUseCase).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("throws when the previous application is not found", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefAndCodeUseCase.mockRejectedValue(
      Boom.notFound(
        'Application with clientRef "previous-client-ref" not found',
      ),
    );

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toThrow(
      'Application with clientRef "previous-client-ref" not found',
    );

    expect(createApplicationUseCase).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("throws when createApplicationUseCase fails", async () => {
    const testApplication = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "REVIEW_APPLICATION",
      code: "test-grant",
      clientRef: "ref-123",
      phases: [],
    });

    const prevApplication = new Application({
      currentPhase: "PRE_AWARD",
      currentStage: "REVIEW_OFFER",
      currentStatus: "APPLICATION_AMEND",
      code: "test-grant",
      clientRef: "ref-123",
      phases: [],
    });

    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    findApplicationByClientRefAndCodeUseCase.mockResolvedValue(prevApplication);
    createApplicationUseCase.mockRejectedValue(
      new Error("Failed to create application"),
    );

    await expect(
      replaceApplicationUseCase("test-grant", testApplication),
    ).rejects.toThrow("Failed to create application");

    expect(update).not.toHaveBeenCalled();
  });
});
