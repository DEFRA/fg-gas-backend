import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { Application } from "../models/application.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application-series.repository.js";
import { createApplicationUseCase } from "./create-application.use-case.js";
import { findApplicationByClientRefAndCodeUseCase } from "./find-application-by-client-ref-and-code.use-case.js";
import {
  auditDataBuilder,
  replaceApplicationUseCase,
} from "./replace-application.use-case.js";
import { resolveCurrentGrantUseCase } from "./resolve-current-grant.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../common/write-audit-event.js");
vi.mock("./create-application.use-case.js");
vi.mock("./find-application-by-client-ref-and-code.use-case.js");
vi.mock("../repositories/application-series.repository.js");
vi.mock("./resolve-current-grant.use-case.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCurrentGrantUseCase: vi.fn(),
    persistResolvedVersion: vi.fn(),
  };
});

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
    resolveCurrentGrantUseCase.mockResolvedValue({
      grant: {
        amendablePositions: ["PRE_AWARD:REVIEW_OFFER:APPLICATION_AMEND"],
      },
      resolvedVersion: null,
    });
    writeAuditEvent.mockResolvedValue(undefined);
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

  it("writes an audit event after a successful replace", async () => {
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

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            action: auditActions.REPLACE_APPLICATION,
            entityid: "new-client-ref",
          }),
        ],
        accounts: {
          sbi: testApplication.metadata.sbi,
          frn: testApplication.metadata.frn,
          crn: testApplication.metadata.crn,
        },
        messageGroupId: "submission-new-client-ref",
      }),
      mockSession,
    );
  });
});

describe("auditDataBuilder", () => {
  const applicationId = "new-application-id";
  const args = [{ code: "test-grant", application: testApplication }, {}];

  it("emits REPLACE_APPLICATION on the APPLICATION entity with the correct entityid", () => {
    const event = auditDataBuilder(args, applicationId);
    expect(event.entities[0]).toEqual({
      entity: auditEntities.APPLICATION,
      action: auditActions.REPLACE_APPLICATION,
      entityid: testApplication.metadata.clientRef,
    });
  });

  it("sets accounts from application metadata sbi, frn and crn", () => {
    const event = auditDataBuilder(args, applicationId);
    expect(event.accounts).toEqual({
      sbi: testApplication.metadata.sbi,
      frn: testApplication.metadata.frn,
      crn: testApplication.metadata.crn,
    });
  });

  it("sets messageGroupId to submission-{clientRef}", () => {
    const event = auditDataBuilder(args, applicationId);
    expect(event.messageGroupId).toBe(
      `submission-${testApplication.metadata.clientRef}`,
    );
  });
});
