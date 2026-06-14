import { describe, expect, it, vi } from "vitest";
import { createDispatchOutboxEventUseCase } from "./dispatch-outbox-event.use-case.js";

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
    const deliveryAdapter = {
      canDeliver: vi.fn().mockReturnValue(true),
      deliver: vi.fn().mockResolvedValue(true),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      deliveryAdapters: [deliveryAdapter],
      publishEvent,
    });
    const outboxEvent = createOutboxEvent();

    await dispatchOutboxEvent(outboxEvent);

    expect(deliveryAdapter.canDeliver).toHaveBeenCalledWith(outboxEvent);
    expect(deliveryAdapter.deliver).toHaveBeenCalledWith(outboxEvent);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("publishes commands that route externally", async () => {
    const deliveryAdapter = {
      canDeliver: vi.fn().mockReturnValue(true),
      deliver: vi.fn().mockResolvedValue(false),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      deliveryAdapters: [deliveryAdapter],
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

  it("publishes events when no delivery adapter can handle them", async () => {
    const deliveryAdapter = {
      canDeliver: vi.fn().mockReturnValue(false),
      deliver: vi.fn(),
    };
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      deliveryAdapters: [deliveryAdapter],
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

    expect(deliveryAdapter.deliver).not.toHaveBeenCalled();
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
      deliveryAdapters: [],
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
      deliveryAdapters: [],
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

  it("does not append _fifo.fifo when topic already ends with .fifo", async () => {
    const publishEvent = vi.fn();
    const dispatchOutboxEvent = createDispatchOutboxEventUseCase({
      deliveryAdapters: [],
      publishEvent,
    });

    await dispatchOutboxEvent(
      createOutboxEvent({
        target: "arn:aws:sns:eu-west-2:000000000000:create_payment.fifo",
      }),
    );

    expect(publishEvent.mock.calls[0][0]).toBe(
      "arn:aws:sns:eu-west-2:000000000000:create_payment.fifo",
    );
  });
});
