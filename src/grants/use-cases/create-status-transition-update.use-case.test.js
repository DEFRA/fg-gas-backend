import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditActions, auditEntities } from "../../common/audit-constants.js";
import { writeAuditEvent } from "../../common/write-audit-event.js";
import { Outbox } from "../models/outbox.js";
import { insertMany } from "../repositories/outbox.repository.js";
import {
  auditDataBuilder,
  createStatusTransitionUpdateUseCase,
} from "./create-status-transition-update.use-case.js";

vi.mock("../repositories/outbox.repository.js");
vi.mock("../../common/write-audit-event.js");

describe("create status transition update", () => {
  beforeEach(() => {
    writeAuditEvent.mockResolvedValue(undefined);
  });

  it("should create a callback handler that executes an outbox publisher command", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      clientRef: "some-client-ref",
      code: "some-code",
      newFullyQualifiedStatus: "SOME:STATUS:FOO",
      originalFullyQualifiedStatus: "SOME:STATUS:BARR",
    });
    await handler(session);
    expect(insertMany).toHaveBeenCalledWith([expect.any(Outbox)], session);
  });

  it("should do nothing if the statuses match", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      clientRef: "some-client-ref",
      code: "some-code",
      newFullyQualifiedStatus: "SOME:STATUS:FOO",
      originalFullyQualifiedStatus: "SOME:STATUS:FOO",
    });
    await handler(session);
    expect(insertMany).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("writes an audit event after a successful transition", async () => {
    const session = {};
    const handler = createStatusTransitionUpdateUseCase({
      clientRef: "some-client-ref",
      code: "some-code",
      newFullyQualifiedStatus: "SOME:STATUS:FOO",
      originalFullyQualifiedStatus: "SOME:STATUS:BARR",
    });
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
        messageGroupId: "status-transition-some-client-ref",
      }),
      session,
    );
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
