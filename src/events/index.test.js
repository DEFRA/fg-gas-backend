import hapi from "@hapi/hapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "./index.js";
import { agreementStatusUpdatedSubscriber } from "./subscribers/agreement-status-updated.subscriber.js";
import { caseStatusUpdatedSubscriber } from "./subscribers/case-status-updated.subscriber.js";
import { InboxSubscriber } from "./subscribers/inbox.subscriber.js";
import { OutboxSubscriber } from "./subscribers/outbox.subscriber.js";

vi.mock("./subscribers/agreement-status-updated.subscriber.js");
vi.mock("./subscribers/case-status-updated.subscriber.js");
vi.mock("./subscribers/inbox.subscriber.js");
vi.mock("./subscribers/outbox.subscriber.js");

describe("events", () => {
  let server;

  beforeEach(() => {
    server = hapi.server();
    vi.clearAllMocks();
  });

  it("owns the durable event subscriber lifecycle", async () => {
    const inboxStart = vi.fn();
    const inboxStop = vi.fn();
    const outboxStart = vi.fn();
    const outboxStop = vi.fn();
    InboxSubscriber.prototype.start = inboxStart;
    InboxSubscriber.prototype.stop = inboxStop;
    OutboxSubscriber.prototype.start = outboxStart;
    OutboxSubscriber.prototype.stop = outboxStop;

    await server.register(events);
    await server.initialize();

    server.events.emit("start");
    expect(agreementStatusUpdatedSubscriber.start).toHaveBeenCalledOnce();
    expect(caseStatusUpdatedSubscriber.start).toHaveBeenCalledOnce();
    expect(inboxStart).toHaveBeenCalledOnce();
    expect(outboxStart).toHaveBeenCalledOnce();

    server.events.emit("stop");
    expect(agreementStatusUpdatedSubscriber.stop).toHaveBeenCalledOnce();
    expect(caseStatusUpdatedSubscriber.stop).toHaveBeenCalledOnce();
    expect(inboxStop).toHaveBeenCalledOnce();
    expect(outboxStop).toHaveBeenCalledOnce();
  });
});
