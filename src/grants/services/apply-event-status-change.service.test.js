import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { Application } from "../models/application.js";
import { Grant } from "../models/grant.js";
import {
  findByClientRefAndCode,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { addAgreementUseCase } from "../use-cases/add-agreement.use-case.js";
import { createAgreementCommandUseCase } from "../use-cases/create-agreement-command.use-case.js";
import { createStatusTransitionUpdateUseCase } from "../use-cases/create-status-transition-update.use-case.js";
import {
  applyExternalStateChange,
  getHandlersForAllProcesses,
} from "./apply-event-status-change.service.js";

vi.mock("../use-cases/create-status-transition-update.use-case.js");
vi.mock("../use-cases/add-agreement.use-case.js");
vi.mock("../use-cases/create-agreement-command.use-case.js");
vi.mock("../repositories/application.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/with-transaction.js", () => ({
  withTransaction: vi.fn((fn) => fn({})),
}));

describe("applyExternalStateChange", () => {
  const mockApplication = new Application({
    clientRef: "APP-123",
    code: "test-grant",
    currentPhase: "PRE_AWARD",
    currentStage: "REVIEW_APPLICATION",
    currentStatus: "RECEIVED",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    submittedAt: "2024-01-01T00:00:00.000Z",
    identifiers: { userId: "user-123" },
    phases: [],
  });

  const mockGrant = new Grant({
    code: "test-grant",
    metadata: {
      description: "Test Grant",
      startDate: "2024-01-01T00:00:00.000Z",
    },
    actions: [],
    phases: [
      {
        code: "PRE_AWARD",
        stages: [
          {
            code: "REVIEW_APPLICATION",
            statuses: [
              { code: "RECEIVED" },
              {
                code: "IN_PROGRESS",
                validFrom: ["RECEIVED"],
              },
              {
                code: "APPROVED",
                validFrom: ["IN_PROGRESS"],
                processes: ["GENERATE_OFFER"],
              },
            ],
          },
        ],
      },
    ],
    externalStatusMap: {
      phases: [
        {
          code: "PRE_AWARD",
          stages: [
            {
              code: "REVIEW_APPLICATION",
              statuses: [
                {
                  code: "IN_PROGRESS",
                  source: "CW",
                  mappedTo: "::IN_PROGRESS",
                },
                {
                  code: "APPROVED",
                  source: "CW",
                  mappedTo: "::APPROVED",
                },
              ],
            },
          ],
        },
      ],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getHandlersForAllProcesses", () => {
    it("should log warning if entry process is a string", () => {
      vi.spyOn(logger, "warn").mockImplementationOnce(() => {});
      expect(getHandlersForAllProcesses("process")).toHaveLength(0);
      expect(logger.warn).toBeCalled();
    });

    it("should return empty array for no entry processes", () => {
      const processes = [];
      expect(getHandlersForAllProcesses(processes)).toHaveLength(0);
      expect(getHandlersForAllProcesses(undefined)).toHaveLength(0);
    });

    it("should return handlers for valid entry process", () => {
      const processes = ["GENERATE_OFFER"];
      const handlers = getHandlersForAllProcesses(processes);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toBe(createAgreementCommandUseCase);
    });

    it("should ignore unknown processes", () => {
      const processes = ["GENERATE_OFFER", "UNKNOWN"];
      const handlers = getHandlersForAllProcesses(processes);
      expect(handlers).toHaveLength(1);
    });
  });

  describe("when application is not found", () => {
    it("should throw Boom.notFound error", async () => {
      findByClientRefAndCode.mockResolvedValue(null);

      await expect(
        applyExternalStateChange({
          clientRef: "NON-EXISTENT",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
        }),
      ).rejects.toThrow(
        Boom.notFound('Application with clientRef "NON-EXISTENT" not found'),
      );

      expect(findByClientRefAndCode).toHaveBeenCalledWith({
        clientRef: "NON-EXISTENT",
        code: "foo",
      });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when grant is not found", () => {
    it("should throw Boom.notFound error", async () => {
      findByClientRefAndCode.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(null);

      await expect(
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
        }),
      ).rejects.toThrow(
        Boom.notFound('Grant with code "test-grant" not found'),
      );

      expect(findByClientRefAndCode).toHaveBeenCalledWith({
        clientRef: "APP-123",
        code: "foo",
      });
      expect(findByCode).toHaveBeenCalledWith("test-grant");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when state transition is valid", () => {
    it("should update application state and persist changes", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });
      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: { caseRef: "CASE-123" },
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          clientRef: "APP-123",
          currentPhase: "PRE_AWARD",
          currentStage: "REVIEW_APPLICATION",
          currentStatus: "IN_PROGRESS",
          updatedAt: expect.any(String),
        }),
        {}, // session
      );
    });

    it("should publish status update event when status changes", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });
      createAgreementCommandUseCase.mockResolvedValue(true);
      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(createStatusTransitionUpdateUseCase).toHaveBeenCalled();
    });

    it("should not publish status update event when status remains the same", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "IN_PROGRESS",
      });

      // Grant with no validFrom on IN_PROGRESS (always valid)
      const grantNoValidFrom = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [{ code: "IN_PROGRESS" }],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(insertMany).not.toHaveBeenCalled();
    });
  });

  describe("when external status is not mapped", () => {
    it("should not update application", async () => {
      findByClientRefAndCode.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(mockGrant);

      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          externalRequestedState: "UNMAPPED_STATUS",
          sourceSystem: "CW",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to UNMAPPED_STATUS",
      );

      expect(update).not.toHaveBeenCalled();
      expect(insertMany).not.toHaveBeenCalled();
    });
  });

  describe("when transition is invalid (not in validFrom)", () => {
    it("should not update application", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });
      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      // Try to go directly from RECEIVED to APPROVED (should only be from IN_PROGRESS)
      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "APPROVED",
          sourceSystem: "CW",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to APPROVED",
      );

      expect(update).not.toHaveBeenCalled();
      expect(insertMany).not.toHaveBeenCalled();
    });
  });

  describe("when source system is different", () => {
    it("should not find mapping and not update application", async () => {
      findByClientRefAndCode.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(mockGrant);

      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "DIFFERENT_SYSTEM",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to IN_PROGRESS",
      );

      expect(update).not.toHaveBeenCalled();
      expect(insertMany).not.toHaveBeenCalled();
    });
  });

  describe("when validFrom is empty array", () => {
    it("should allow transition from any status", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithEmptyValidFrom = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  {
                    code: "IN_PROGRESS",
                    validFrom: [],
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithEmptyValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStatus: "IN_PROGRESS",
        }),
        {}, // session
      );
    });
  });

  describe("when validFrom is not defined", () => {
    it("should allow transition from any status", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithNoValidFrom = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [{ code: "RECEIVED" }, { code: "IN_PROGRESS" }],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStatus: "IN_PROGRESS",
        }),
        {}, // session
      );
    });
  });

  describe("when external status maps to fully qualified status", () => {
    it("should update phase, stage, and status", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithFullyQualifiedMapping = new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2024-01-01T00:00:00.000Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [{ code: "RECEIVED" }],
              },
              {
                code: "REVIEW_OFFER",
                statuses: [
                  {
                    code: "OFFERED",
                    validFrom: ["PRE_AWARD:REVIEW_APPLICATION:RECEIVED"],
                  },
                ],
              },
            ],
          },
        ],
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW_APPLICATION",
                  statuses: [
                    {
                      code: "OFFERED",
                      source: "AS",
                      mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFERED",
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithFullyQualifiedMapping);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "OFFERED",
        sourceSystem: "AS",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPhase: "PRE_AWARD",
          currentStage: "REVIEW_OFFER",
          currentStatus: "OFFERED",
        }),
        {}, // session
      );
    });
  });

  describe("when external status maps to simple status code", () => {
    it("should update only status, keeping phase and stage", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithSimpleMapping = new Grant({
        ...mockGrant,
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW_APPLICATION",
                  statuses: [
                    {
                      code: "IN_PROGRESS",
                      source: "CW",
                      mappedTo: "IN_PROGRESS", // Simple status code without ::
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithSimpleMapping);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPhase: "PRE_AWARD",
          currentStage: "REVIEW_APPLICATION",
          currentStatus: "IN_PROGRESS",
        }),
        {}, // session
      );
    });
  });

  describe("when transition has multiple entry processes", () => {
    it("should execute all entry processes in order", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithMultipleProcesses = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  {
                    code: "IN_PROGRESS",
                    validFrom: ["RECEIVED"],
                    processes: ["GENERATE_OFFER", "STORE_AGREEMENT_CASE"],
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithMultipleProcesses);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: { data: "test" },
      });

      expect(createAgreementCommandUseCase).toHaveBeenCalled();
      expect(addAgreementUseCase).toHaveBeenCalled();

      expect(update).toHaveBeenCalled();
    });
  });

  describe("when transition has no entry processes", () => {
    it("should not execute any processes", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithNoProcesses = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  {
                    code: "IN_PROGRESS",
                    validFrom: ["RECEIVED"],
                    // No processes
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoProcesses);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(createStatusTransitionUpdateUseCase).toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
    });

    it("should handle status with no validFrom constraint", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      addAgreementUseCase.mockReturnValue(true);
      const grantWithStatusNoValidFrom = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  {
                    code: "IN_PROGRESS",
                    // No validFrom, meaning transition is always allowed
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithStatusNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      // Should only create status update outbox, not agreement
      expect(createStatusTransitionUpdateUseCase).toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
    });
  });

  describe("when validFrom contains fully qualified status", () => {
    it("should validate against fully qualified current status", async () => {
      const application = new Application({
        ...mockApplication,
        currentPhase: "PRE_AWARD",
        currentStage: "REVIEW_APPLICATION",
        currentStatus: "APPROVED",
      });

      const grantWithFQValidFrom = new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2024-01-01T00:00:00.000Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [{ code: "APPROVED" }],
              },
              {
                code: "REVIEW_OFFER",
                statuses: [
                  {
                    code: "OFFERED",
                    validFrom: ["PRE_AWARD:REVIEW_APPLICATION:APPROVED"],
                  },
                ],
              },
            ],
          },
        ],
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW_APPLICATION",
                  statuses: [
                    {
                      code: "OFFERED",
                      source: "AS",
                      mappedTo: "PRE_AWARD:REVIEW_OFFER:OFFERED",
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithFQValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "OFFERED",
        sourceSystem: "AS",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPhase: "PRE_AWARD",
          currentStage: "REVIEW_OFFER",
          currentStatus: "OFFERED",
        }),
        {}, // session
      );
    });
  });

  describe("when validFrom contains simple status code", () => {
    it("should validate against just the status part of current status", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithSimpleValidFrom = new Grant({
        ...mockGrant,
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  {
                    code: "IN_PROGRESS",
                    validFrom: ["RECEIVED"], // Simple status code
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithSimpleValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        code: "foo",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStatus: "IN_PROGRESS",
        }),
        {}, // session
      );
    });
  });

  describe("when grant has no externalStatusMap", () => {
    it("should not update application", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithNoMapping = new Grant({
        ...mockGrant,
        externalStatusMap: undefined,
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoMapping);

      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to IN_PROGRESS",
      );

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when externalStatusMap phases is missing", () => {
    it("should not update application", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithNoPhases = new Grant({
        ...mockGrant,
        externalStatusMap: {},
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoPhases);

      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to IN_PROGRESS",
      );

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when target status is not found in grant phases", () => {
    it("should not update application", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

      const grantWithMissingTargetStatus = new Grant({
        code: "test-grant",
        metadata: {
          description: "Test Grant",
          startDate: "2024-01-01T00:00:00.000Z",
        },
        actions: [],
        phases: [
          {
            code: "PRE_AWARD",
            stages: [
              {
                code: "REVIEW_APPLICATION",
                statuses: [
                  { code: "RECEIVED" },
                  // IN_PROGRESS is missing
                ],
              },
            ],
          },
        ],
        externalStatusMap: {
          phases: [
            {
              code: "PRE_AWARD",
              stages: [
                {
                  code: "REVIEW_APPLICATION",
                  statuses: [
                    {
                      code: "IN_PROGRESS",
                      source: "CW",
                      mappedTo: "::IN_PROGRESS", // Maps to non-existent status
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      findByClientRefAndCode.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithMissingTargetStatus);

      await expect(() =>
        applyExternalStateChange({
          clientRef: "APP-123",
          code: "foo",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
          eventData: {},
        }),
      ).rejects.toThrow(
        "Unable to process state change from PRE_AWARD:REVIEW_APPLICATION:RECEIVED to IN_PROGRESS",
      );

      expect(update).not.toHaveBeenCalled();
    });
  });
});
