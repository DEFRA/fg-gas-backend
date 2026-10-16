import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationCreatedEvent } from "../grants/events/application-created.event.js";
import { caseStatusUpdated } from "../grants/events/inbound-event-types.js";
import { findByMessageId, insertOne } from "./repositories/inbox.repository.js";
import { insertMany } from "./repositories/outbox.repository.js";
import { saveEvents } from "./save-events.js";
import { saveInboxMessageUseCase } from "./use-cases/save-inbox-message.use-case.js";
import { writeAuditEvent } from "./write-audit-event.js";

vi.mock("@defra/fcp-audit-publisher", () => ({
  validateAuditEvent: vi.fn(() => ({ valid: true })),
}));
vi.mock("../common/logger.js");
vi.mock("./repositories/inbox.repository.js");
vi.mock("./repositories/outbox.repository.js");

const insertedOutboxRow = () => insertMany.mock.calls[0][0][0].toDocument();

describe("every insert into the outbox", () => {
  beforeEach(() => {
    insertMany.mockResolvedValue(undefined);
  });

  it("stamps a published event", async () => {
    const event = new ApplicationCreatedEvent({
      clientRef: "ABC-123",
      code: "example-grant",
      status: "PRE_AWARD:REVIEW:IN_REVIEW",
    });

    await saveEvents([{ event, target: "some-topic" }], {});

    expect(insertedOutboxRow()).toMatchObject({
      eventType: "ApplicationCreated",
      refs: ["ref:abc-123", `id:${event.id}`],
    });
  });

  it("stamps an audit event", async () => {
    await writeAuditEvent({
      entities: [
        { entity: "APPLICATION", action: "SUBMIT", entityid: "ABC-123" },
      ],
      status: "SUCCESS",
    });

    expect(insertedOutboxRow()).toMatchObject({
      eventType: "Audit",
      refs: [expect.stringMatching(/^trace:/)],
    });
  });
});

describe("every insert into the inbox", () => {
  beforeEach(() => {
    findByMessageId.mockResolvedValue(null);
  });

  const insertedInboxRow = () => insertOne.mock.calls[0][0].toDocument();

  it("stamps a received message", async () => {
    await saveInboxMessageUseCase(
      {
        id: "0b7c1d1e-0000-4000-8000-000000000001",
        type: caseStatusUpdated.sentAs,
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        data: { caseRef: "ABC-123", workflowCode: "example-grant" },
      },
      "CW",
    );

    expect(insertedInboxRow()).toMatchObject({
      eventType: "CaseStatusUpdated",
      refs: [
        "ref:abc-123",
        "case:example-grant:~41.~42.~43.-123",
        "id:0b7c1d1e-0000-4000-8000-000000000001",
        "trace:4bf92f3577b34da6a3ce929d0e0e4736",
      ],
    });
    expect(insertedInboxRow()).not.toHaveProperty("kind");
  });

  it("stamps a message nobody declared as unrecognised", async () => {
    await saveInboxMessageUseCase(
      {
        id: "0b7c1d1e-0000-4000-8000-000000000002",
        type: "io.example.unknown",
        data: { clientRef: "ABC-123", grantCode: "example-grant" },
      },
      "AS",
    );

    expect(insertedInboxRow()).toMatchObject({
      eventType: "Unrecognised",
      refs: ["id:0b7c1d1e-0000-4000-8000-000000000002"],
    });
  });
});
