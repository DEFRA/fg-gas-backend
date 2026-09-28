import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { auditActions, auditEntities } from "../../events/audit-constants.js";
import { saveEvents } from "../../events/index.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  auditDataBuilder,
  createStatusTransitionUpdateUseCase,
} from "./create-status-transition-update.use-case.js";

vi.mock("../../events/index.js");
vi.mock("../../events/write-audit-event.js");

const transition = {
  clientRef: "some-client-ref",
  code: "some-code",
  newFullyQualifiedStatus: "SOME:STATUS:FOO",
  originalFullyQualifiedStatus: "SOME:STATUS:BARR",
  configVersion: "1.2.3",
};

describe("create status transition update", () => {
  beforeEach(() => {
    saveEvents.mockResolvedValue(undefined);
    writeAuditEvent.mockResolvedValue(undefined);
  });

  it("publishes the status-updated event to the status topic via saveEvents", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase(transition);

    await handler(session);

    expect(saveEvents).toHaveBeenCalledWith(
      [
        {
          target: config.sns.grantApplicationStatusUpdatedTopicArn,
          event: expect.objectContaining({
            data: expect.objectContaining({
              clientRef: transition.clientRef,
              grantCode: transition.code,
              previousStatus: transition.originalFullyQualifiedStatus,
              currentStatus: transition.newFullyQualifiedStatus,
            }),
          }),
        },
      ],
      session,
    );
  });

  it("does not set an explicit segregationRef", async () => {
    const handler = createStatusTransitionUpdateUseCase(transition);

    await handler({});

    expect(saveEvents.mock.calls[0][0][0].segregationRef).toBeUndefined();
  });

  it("should do nothing if the statuses match", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      ...transition,
      originalFullyQualifiedStatus: transition.newFullyQualifiedStatus,
    });

    await handler(session);

    expect(saveEvents).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("publishes the status event before writing the audit event", async () => {
    const order = [];
    saveEvents.mockImplementation(async () => order.push("saveEvents"));
    writeAuditEvent.mockImplementation(async () =>
      order.push("writeAuditEvent"),
    );
    const handler = createStatusTransitionUpdateUseCase(transition);

    await handler({});

    expect(order).toEqual(["saveEvents", "writeAuditEvent"]);
  });

  it("writes an audit event after a successful transition", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase(transition);

    await handler(session);

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entities: [
          expect.objectContaining({
            entity: auditEntities.APPLICATION,
            action: auditActions.STATUS_TRANSITION,
            entityid: "some-client-ref",
          }),
        ],
        details: {
          code: "some-code",
          fromStatus: "SOME:STATUS:BARR",
          toStatus: "SOME:STATUS:FOO",
          entityIdKey: "clientRef",
        },
        segregationRef: "status-transition-some-client-ref",
      }),
      session,
    );
  });

  it("propagates a saveEvents failure", async () => {
    const error = new Error("outbox down");
    saveEvents.mockRejectedValueOnce(error);
    const handler = createStatusTransitionUpdateUseCase(transition);

    await expect(handler({})).rejects.toBe(error);
  });
});

describe("auditDataBuilder", () => {
  const args = [
    {
      clientRef: "some-client-ref",
      code: "some-code",
      previousStatus: "SOME:STATUS:BARR",
      currentStatus: "SOME:STATUS:FOO",
    },
  ];

  it("emits STATUS_TRANSITION on the APPLICATION entity with the correct entityid", () => {
    const event = auditDataBuilder(args);
    expect(event.entities[0]).toEqual({
      entity: auditEntities.APPLICATION,
      action: auditActions.STATUS_TRANSITION,
      entityid: "some-client-ref",
    });
  });

  it("sets details from code, previousStatus, currentStatus and entityIdKey", () => {
    const event = auditDataBuilder(args);
    expect(event.details).toEqual({
      code: "some-code",
      fromStatus: "SOME:STATUS:BARR",
      toStatus: "SOME:STATUS:FOO",
      entityIdKey: "clientRef",
    });
  });
});
