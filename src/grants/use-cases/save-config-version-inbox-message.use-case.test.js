import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTraceParent } from "../../common/trace-parent.js";
import { Inbox } from "../../events/models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../../events/repositories/inbox.repository.js";
import { CONFIG_VERSION_UPDATED_EVENT_TYPE } from "../events/inbound-event-types.js";
import {
  saveConfigVersionInboxMessageUseCase,
  UNGROUPED_SEGREGATION_REF,
} from "./save-config-version-inbox-message.use-case.js";

vi.mock("../../events/repositories/inbox.repository.js");

const manifest = [
  "woodland/1.2.0/gas/gas.json",
  "woodland/1.2.0/gas/payment.json",
];

const messageAttributes = {
  grant: { StringValue: "woodland" },
  version: { StringValue: "1.2.0" },
  status: { StringValue: "active" },
  path: { StringValue: "config-broker-bucket" },
};

const metadata = { messageId: "msg-1", sentTimeStamp: "1758106800000" };

const savedInbox = () => insertOne.mock.calls[0][0];

const save = (attributes = messageAttributes, meta = metadata) =>
  saveConfigVersionInboxMessageUseCase(manifest, attributes, meta);

beforeEach(() => {
  vi.clearAllMocks();
  findByMessageId.mockResolvedValue(null);
  insertOne.mockResolvedValue(true);
});

describe("save config version inbox message", () => {
  it("stores the event as an inbox message", async () => {
    await save();

    expect(insertOne).toHaveBeenCalledWith(expect.any(Inbox));
  });

  it("records the config broker as the source", async () => {
    await save();

    expect(savedInbox().source).toBe("CB");
  });

  it("uses the SQS message id so redelivery is deduplicated", async () => {
    await save();

    expect(savedInbox().messageId).toBe("msg-1");
    expect(findByMessageId).toHaveBeenCalledWith("msg-1");
  });

  it("does not store a message that is already in the inbox", async () => {
    findByMessageId.mockResolvedValue({});

    await save();

    expect(insertOne).not.toHaveBeenCalled();
  });

  it("wraps the manifest and attributes in a config version event", async () => {
    await save();

    expect(savedInbox().event).toEqual({
      id: "msg-1",
      type: CONFIG_VERSION_UPDATED_EVENT_TYPE,
      time: "2025-09-17T11:00:00.000Z",
      traceparent: undefined,
      data: {
        grantCode: "woodland",
        version: "1.2.0",
        status: "active",
        s3Bucket: "config-broker-bucket",
        manifest,
      },
    });
  });

  it("groups by grant code so one grant's versions stay ordered", async () => {
    await save();

    expect(savedInbox().segregationRef).toBe("woodland");
  });

  it("sorts on the time the broker sent the message", async () => {
    await save();

    expect(savedInbox().eventTime).toBe("2025-09-17T11:00:00.000Z");
  });

  it.each([
    ["is missing", undefined],
    ["is empty", ""],
    ["is not a number", "not-a-timestamp"],
  ])(
    "falls back to the current time when the sent timestamp %s",
    async (_, sentTimeStamp) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-09-17T12:00:00.000Z"));

      await save(messageAttributes, { messageId: "msg-1", sentTimeStamp });

      expect(savedInbox().eventTime).toBe("2025-09-17T12:00:00.000Z");
      vi.useRealTimers();
    },
  );

  it("carries the traceparent the message is being processed under", async () => {
    await withTraceParent("00-abc-def-01", save);

    expect(savedInbox().traceparent).toBe("00-abc-def-01");
  });

  // Ingest stays unconditional: a malformed event must be visible, not stuck on the queue.
  it("still stores an event that carries no grant code", async () => {
    const { grant, ...withoutGrant } = messageAttributes;

    await save(withoutGrant);

    expect(savedInbox().segregationRef).toBe(UNGROUPED_SEGREGATION_REF);
    expect(savedInbox().event.data.grantCode).toBeUndefined();
  });
});
