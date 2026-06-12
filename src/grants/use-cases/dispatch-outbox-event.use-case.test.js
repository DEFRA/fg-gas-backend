import { describe, expect, it, vi } from "vitest";
import {
  createDispatchOutboxEventUseCase,
  outboxDispatchRoutes,
} from "./dispatch-outbox-event.use-case.js";

const createOutboxEvent = (overrides = {}) => ({
  target: "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement",
  event: {
    type: "cloud.defra.local.fg-gas-backend.agreement.create",
    data: {
      clientRef: "client-ref",
      code: "pigs-might-fly",
    },
  },
  ...overrides,
});

describe("dispatchOutboxEvent", () => {
  it("handles internal commands without publishing", async () => {
    const commandProcessor = {
      canProcess: vi.fn().mockReturnValue(true),
      process: vi.fn().mockResolvedValue(outboxDispatchRoutes.INTERNAL),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      commandProcessors: [commandProcessor],
      publishEvent,
    });
    const outboxEvent = createOutboxEvent();

    await dispatchOutboxEvent(outboxEvent);

    expect(commandProcessor.canProcess).toHaveBeenCalledWith(outboxEvent.event);
    expect(commandProcessor.process).toHaveBeenCalledWith(outboxEvent.event);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("publishes commands that route externally", async () => {
    const commandProcessor = {
      canProcess: vi.fn().mockReturnValue(true),
      process: vi.fn().mockResolvedValue(outboxDispatchRoutes.EXTERNAL),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      commandProcessors: [commandProcessor],
      publishEvent,
    });

    await dispatchOutboxEvent(
      createOutboxEvent({
        event: {
          type: "cloud.defra.local.fg-gas-backend.agreement.create",
          messageGroupId: "client-ref-code",
          data: {
            code: "frps-beta",
          },
        },
      }),
    );

    expect(publishEvent).toHaveBeenCalledWith(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
      {
        type: "cloud.defra.local.fg-gas-backend.agreement.create",
        messageGroupId: "client-ref-code",
        data: {
          code: "frps-beta",
        },
      },
      "client-ref-code",
    );
  });

  it("publishes events when no command processor can handle them", async () => {
    const commandProcessor = {
      canProcess: vi.fn().mockReturnValue(false),
      process: vi.fn(),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      commandProcessors: [commandProcessor],
      publishEvent,
    });

    await dispatchOutboxEvent(
      createOutboxEvent({
        event: {
          clientRef: "client-ref",
          grantCode: "grant-code",
        },
      }),
    );

    expect(commandProcessor.process).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledWith(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
      {
        clientRef: "client-ref",
        grantCode: "grant-code",
      },
      "client-ref-grant-code",
    );
  });

  it("uses case working identifiers for legacy message group ids", async () => {
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      commandProcessors: [],
      publishEvent,
    });

    await dispatchOutboxEvent(
      createOutboxEvent({
        event: {
          caseRef: "case-ref",
          workflowCode: "workflow-code",
        },
      }),
    );

    expect(publishEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "case-ref-workflow-code",
    );
  });

  it("does not append _fifo.fifo when topic already ends with _fifo.fifo", async () => {
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      commandProcessors: [],
      publishEvent,
    });

    await dispatchOutboxEvent(
      createOutboxEvent({
        target:
          "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
      }),
    );

    expect(publishEvent.mock.calls[0][0]).toBe(
      "arn:aws:sns:eu-west-2:000000000000:gas__sns__create_agreement_fifo.fifo",
    );
  });
});
