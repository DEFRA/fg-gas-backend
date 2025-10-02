import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Application,
  ApplicationPhase,
  ApplicationStage,
  ApplicationStatus,
} from "../models/application.ts";
import { Grant } from "../models/grant.ts";
import { publishApplicationCreated } from "../publishers/application-event.publisher.js";
import { publishCreateNewCase } from "../publishers/case-event.publisher.js";
import { save } from "../repositories/application.repository.js";
import { findGrantByCodeUseCase } from "./find-grant-by-code.use-case.js";
import { submitApplicationUseCase } from "./submit-application.use-case.js";

vi.mock("./find-grant-by-code.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../publishers/application-event.publisher.js");
vi.mock("../publishers/case-event.publisher.js");

describe("submitApplicationUseCase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2000, 1, 1, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an application", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
            },
          },
        },
      }),
    );

    await submitApplicationUseCase("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: "2000-01-01T12:00:00Z",
      },
      answers: {
        question1: "answer1",
      },
    });

    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "test-client-ref",
      code: "test-grant",
      createdAt: "2000-02-01T13:00:00.000Z",
      updatedAt: "2000-02-01T13:00:00.000Z",
      submittedAt: "2000-01-01T12:00:00Z",
      agreements: {},
      identifiers: {
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
      },
      answers: {
        question1: "answer1",
      },
    });

    expect(save).toHaveBeenCalledWith(application);
  });

  it("publishes ApplicationCreatedEvent", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
            },
          },
        },
      }),
    );

    await submitApplicationUseCase("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: "2000-01-01T12:00:00Z",
      },
      answers: {
        question1: "answer1",
      },
    });

    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "test-client-ref",
      code: "test-grant",
      createdAt: "2000-02-01T13:00:00.000Z",
      updatedAt: "2000-02-01T13:00:00.000Z",
      submittedAt: "2000-01-01T12:00:00Z",
      agreements: {},
      identifiers: {
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
      },
      answers: {
        question1: "answer1",
      },
    });

    expect(publishApplicationCreated).toHaveBeenCalledWith({
      clientRef: application.clientRef,
      code: application.code,
      status: application.getFullyQualifiedStatus(),
    });
  });

  it("publishes CreateNewCaseEvent", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
            },
          },
        },
      }),
    );

    await submitApplicationUseCase("test-grant", {
      metadata: {
        clientRef: "test-client-ref",
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
        submittedAt: "2000-01-01T12:00:00Z",
      },
      answers: {
        question1: "answer1",
      },
    });

    const application = new Application({
      currentPhase: ApplicationPhase.PreAward,
      currentStage: ApplicationStage.Assessment,
      currentStatus: ApplicationStatus.Received,
      clientRef: "test-client-ref",
      code: "test-grant",
      createdAt: "2000-02-01T13:00:00.000Z",
      updatedAt: "2000-02-01T13:00:00.000Z",
      submittedAt: "2000-01-01T12:00:00Z",
      agreements: {},
      identifiers: {
        sbi: "123456789",
        frn: "987654321",
        crn: "CRN123456",
        defraId: "DEFRA123456",
      },
      answers: {
        question1: "answer1",
      },
    });

    expect(publishCreateNewCase).toHaveBeenCalledWith(application);
  });

  it("throws when answers do not match the schema", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            question1: {
              type: "string",
            },
          },
        },
      }),
    );

    await expect(
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "test-client-ref",
          sbi: "123456789",
          frn: "987654321",
          crn: "CRN123456",
          defraId: "DEFRA123456",
          submittedAt: "2000-01-01T12:00:00Z",
        },
        answers: {
          question1: 42, // Invalid type
        },
      }),
    ).rejects.toThrow(
      'Application with clientRef "test-client-ref" has invalid answers',
    );
  });

  it("throws when answers do not match schema format", async () => {
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
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
      }),
    );

    await expect(
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "application-1",
          submittedAt: new Date("2021-01-01T00:00:00.000Z"),
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
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
    findGrantByCodeUseCase.mockResolvedValue(
      new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2023-01-01T00:00:00Z",
        },
        actions: [],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            answer1: {
              type: "string",
              format: "uuid", // Invalid format
            },
          },
        },
      }),
    );

    await expect(
      submitApplicationUseCase("test-grant", {
        metadata: {
          clientRef: "application-1",
          submittedAt: new Date("2021-01-01T00:00:00.000Z"),
          sbi: "sbi-1",
          frn: "frn-1",
          crn: "crn-1",
          defraId: "defraId-1",
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
    findGrantByCodeUseCase.mockRejectedValue(
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
        },
        answers: {
          question1: "answer1",
        },
      }),
    ).rejects.toThrow('Grant with code "non-existent-grant" not found');
  });
});
