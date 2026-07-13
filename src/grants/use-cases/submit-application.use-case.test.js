import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGrant } from "../../../test/helpers/grants.js";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { withTransaction } from "../../common/with-transaction.js";
import { Application, ApplicationPhase } from "../models/application.js";
import { save } from "../repositories/application.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import {
  auditDataBuilder,
  submitApplicationUseCase,
} from "./submit-application.use-case.js";

vi.mock("../repositories/outbox.repository.js");
vi.mock("../services/resolve-config-version.service.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/application-series.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");
vi.mock("../../common/with-transaction.js");

describe("submitApplicationUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2000, 1, 1, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an application", async () => {
    save.mockResolvedValue({ insertedId: "1234" });
    insertMany.mockResolvedValueOnce({
      insertedId: "1",
    });
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    resolveAndFetchGrant.mockResolvedValue({
      grant: createTestGrant(),
      resolvedVersion: "1.0.0",
    });

    await submitApplicationUseCase("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: "2000-01-01T12:00:00Z",
        configVersion: "1.0.0",
      },
      answers: {
        question1: "answer1",
      },
    });

    const application = save.mock.calls[0][0];
    expect(application).toBeInstanceOf(Application);
    expect(application.currentPhase).toBe(ApplicationPhase.PreAward);
    expect(application.clientRef).toBe("test-client-ref");
    expect(application.originalConfigVersion).toBe("1.0.0");
  });

  it("throws when answers do not match the schema", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    resolveAndFetchGrant.mockResolvedValue({
      grant: createTestGrant(),
      resolvedVersion: "1.0.0",
    });

    await expect(() =>
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
          configVersion: "1.0.0",
        },
        answers: {
          question1: 42,
        },
      }),
    ).rejects.toThrow(
      'Application with clientRef "test-client-ref" has invalid answers',
    );
  });

  it("throws when answers do not match schema format", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    resolveAndFetchGrant.mockResolvedValue({
      grant: createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                answer1: {
                  type: "string",
                  format: "date-time",
                },
                answer2: {
                  type: "string",
                  format: "date",
                },
                answer3: {
                  type: "string",
                  format: "time",
                },
                answer4: {
                  type: "string",
                  format: "duration",
                },
                answer5: {
                  type: "string",
                  format: "email",
                },
                answer6: {
                  type: "string",
                  format: "uri",
                },
              },
            },
          },
        ],
      }),
      resolvedVersion: "1.0.0",
    });

    await expect(() =>
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "application-1",
          submittedAt: new Date("2021-01-01T00:00:00.000Z"),
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
          configVersion: "1.0.0",
        },
        answers: {
          answer1: "invalid",
          answer2: "invalid",
          answer3: "invalid",
          answer4: "invalid",
          answer5: "invalid",
          answer6: "invalid",
        },
      }),
    ).rejects.toThrow(
      `Application with clientRef "application-1" has invalid answers: ${[
        'answer1 must match format "date-time"',
        'answer2 must match format "date"',
        'answer3 must match format "time"',
        'answer4 must match format "duration"',
        'answer5 must match format "email"',
        'answer6 must match format "uri"',
      ].join(", ")}`,
    );
  });

  it("throws when an unsupported format is used in schema", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    resolveAndFetchGrant.mockResolvedValue({
      grant: createTestGrant({
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "ASSESSMENT",
                statuses: [{ code: "RECEIVED" }],
              },
            ],
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                answer1: {
                  type: "string",
                  format: "uuid",
                },
              },
            },
          },
        ],
      }),
      resolvedVersion: "1.0.0",
    });

    await expect(
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "application-1",
          submittedAt: new Date("2021-01-01T00:00:00.000Z"),
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
          configVersion: "1.0.0",
        },
        answers: {
          answer1: "value",
        },
      }),
    ).rejects.toThrow(
      'Application with clientRef "application-1" cannot be validated',
    );
  });

  it("throws when grant is not found", async () => {
    const mockSession = {};
    withTransaction.mockImplementation(async (cb) => cb(mockSession));
    resolveAndFetchGrant.mockRejectedValue(
      new Error('Grant with code "non-existent-grant" not found'),
    );

    await expect(
      submitApplicationUseCase("non-existent-grant", {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
          configVersion: "1.0.0",
        },
        answers: {
          question1: "answer1",
        },
      }),
    ).rejects.toThrow('Grant with code "non-existent-grant" not found');
  });
});

describe("auditDataBuilder", () => {
  const submission = {
    metadata: {
      clientRef: "test-client-ref",
      sbi: "123456789",
      frn: "987654321",
      crn: "CRN123456",
    },
  };
  const args = [{ code: "test-grant", submission }];

  it("emits SUBMIT_APPLICATION on the APPLICATION entity with clientRef as entityid", () => {
    const event = auditDataBuilder(args);
    expect(event.entities[0]).toEqual({
      entity: auditEntities.APPLICATION,
      action: auditActions.SUBMIT_APPLICATION,
      entityid: submission.metadata.clientRef,
    });
  });

  it("sets details to clientRef and code", () => {
    const event = auditDataBuilder(args);
    expect(event.details).toEqual({
      clientRef: submission.metadata.clientRef,
      code: "test-grant",
    });
  });

  it("omits code from details when code is not available", () => {
    const event = auditDataBuilder([{ submission }]);
    expect(event.details).toEqual({
      clientRef: submission.metadata.clientRef,
    });
  });

  it("sets accounts from submission metadata sbi, frn and crn", () => {
    const event = auditDataBuilder(args);
    expect(event.accounts).toEqual({
      sbi: submission.metadata.sbi,
      frn: submission.metadata.frn,
      crn: submission.metadata.crn,
    });
  });

  it("sets messageGroupId to submission-{clientRef}", () => {
    const event = auditDataBuilder(args);
    expect(event.messageGroupId).toBe(
      `submission-${submission.metadata.clientRef}`,
    );
  });
});
