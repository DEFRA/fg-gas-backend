import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../models/application.js";
import { Grant } from "../models/grant.js";
import {
  findByClientRef,
  update,
} from "../repositories/application.repository.js";
import { findByCode } from "../repositories/grant.repository.js";
import { insertMany } from "../repositories/outbox.repository.js";
import { applyExternalStateChange } from "./apply-event-status-change.service.js";

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
                entryProcesses: ["GENERATE_AGREEMENT"],
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
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("when application is not found", () => {
    it("should throw Boom.notFound error", async () => {
      findByClientRef.mockResolvedValue(null);

      await expect(
        applyExternalStateChange({
          clientRef: "NON-EXISTENT",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
        }),
      ).rejects.toThrow(
        Boom.notFound('Application with clientRef "NON-EXISTENT" not found'),
      );

      expect(findByClientRef).toHaveBeenCalledWith("NON-EXISTENT");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("when grant is not found", () => {
    it("should throw Boom.notFound error", async () => {
      findByClientRef.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(null);

      await expect(
        applyExternalStateChange({
          clientRef: "APP-123",
          externalRequestedState: "IN_PROGRESS",
          sourceSystem: "CW",
        }),
      ).rejects.toThrow(
        Boom.notFound('Grant with code "test-grant" not found'),
      );

      expect(findByClientRef).toHaveBeenCalledWith("APP-123");
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
      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
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
      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              data: expect.objectContaining({
                clientRef: "APP-123",
                grantCode: "test-grant",
                previousStatus: "PRE_AWARD:REVIEW_APPLICATION:RECEIVED",
                currentStatus: "PRE_AWARD:REVIEW_APPLICATION:IN_PROGRESS",
              }),
            }),
          }),
        ]),
        {},
      );
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(insertMany).not.toHaveBeenCalled();
    });

    it("should execute entry processes when status has them", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "IN_PROGRESS",
      });
      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "APPROVED",
        sourceSystem: "CW",
        eventData: { caseRef: "CASE-123" },
      });

      // Should create outbox records for both status update and agreement
      expect(insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          // Status update outbox record
          expect.objectContaining({
            event: expect.objectContaining({
              type: "cloud.defra.local.fg-gas-backend.application.status.updated",
            }),
          }),
          // Create agreement outbox record
          expect.objectContaining({
            event: expect.objectContaining({
              type: "cloud.defra.local.fg-gas-backend.agreement.create",
              data: expect.objectContaining({
                clientRef: "APP-123",
              }),
            }),
          }),
        ]),
        {},
      );
    });
  });

  describe("when external status is not mapped", () => {
    it("should not update application", async () => {
      findByClientRef.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "UNMAPPED_STATUS",
        sourceSystem: "CW",
        eventData: {},
      });

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
      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(mockGrant);

      // Try to go directly from RECEIVED to APPROVED (should only be from IN_PROGRESS)
      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "APPROVED",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).not.toHaveBeenCalled();
      expect(insertMany).not.toHaveBeenCalled();
    });
  });

  describe("when source system is different", () => {
    it("should not find mapping and not update application", async () => {
      findByClientRef.mockResolvedValue(mockApplication);
      findByCode.mockResolvedValue(mockGrant);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "DIFFERENT_SYSTEM",
        eventData: {},
      });

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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithEmptyValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithFullyQualifiedMapping);

      await applyExternalStateChange({
        clientRef: "APP-123",
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithSimpleMapping);

      await applyExternalStateChange({
        clientRef: "APP-123",
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
                    entryProcesses: ["GENERATE_AGREEMENT", "UNKNOWN_PROCESS"],
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithMultipleProcesses);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: { data: "test" },
      });

      // GENERATE_AGREEMENT outbox record should be created
      expect(insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              type: "cloud.defra.local.fg-gas-backend.agreement.create",
            }),
          }),
        ]),
        {},
      );

      // Application should still be updated even if unknown process exists
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
                    // No entryProcesses
                  },
                ],
              },
            ],
          },
        ],
      });

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoProcesses);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      // Should only create status update outbox, not agreement
      expect(insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              type: "cloud.defra.local.fg-gas-backend.application.status.updated",
            }),
          }),
        ]),
        {},
      );
      expect(update).toHaveBeenCalled();
    });

    it("should handle status with no validFrom constraint", async () => {
      const application = new Application({
        ...mockApplication,
        currentStatus: "RECEIVED",
      });

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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithStatusNoValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      // Should only create status update outbox, not agreement
      expect(insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              type: "cloud.defra.local.fg-gas-backend.application.status.updated",
            }),
          }),
        ]),
        {},
      );
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithFQValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithSimpleValidFrom);

      await applyExternalStateChange({
        clientRef: "APP-123",
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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoMapping);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithNoPhases);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

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

      findByClientRef.mockResolvedValue(application);
      findByCode.mockResolvedValue(grantWithMissingTargetStatus);

      await applyExternalStateChange({
        clientRef: "APP-123",
        externalRequestedState: "IN_PROGRESS",
        sourceSystem: "CW",
        eventData: {},
      });

      expect(update).not.toHaveBeenCalled();
    });
  });
});
