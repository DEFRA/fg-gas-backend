import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Inbox, InboxStatus } from "./inbox.js";

describe("inbox model", () => {
  it("creates an inbox model", () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {},
      messageId,
      type: "io.onsite.agreement.status.foo",
    });

    expect(obj).toBeInstanceOf(Inbox);
  });

  it("should mark a document as complete", async () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);

    obj.markAsComplete();
    expect(obj.status).toBe(InboxStatus.COMPLETED);
    expect(obj.claimedBy).toBeNull();
    expect(obj.claimedAt).toBeNull();
    expect(obj.claimExpiresAt).toBeNull();
    expect(obj.completionDate).toEqual(expect.any(String));
  });

  it("should mark a document as failed", async () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);

    obj.markAsFailed();
    expect(obj.status).toBe(InboxStatus.FAILED);
    expect(obj.lastResubmissionDate).toEqual(expect.any(String));
    expect(obj.claimedBy).toBeNull();
    expect(obj.claimedAt).toBeNull();
    expect(obj.claimExpiresAt).toBeNull();
  });

  it("should convert to a document", () => {
    const messageId = randomUUID();
    const obj = new Inbox({
      event: {
        data: {
          foo: "barr",
        },
      },
      messageId,
      type: "io.onsite.agreement.status.foo",
    });

    obj.claimedBy = randomUUID();
    obj.claimedAt = new Date();
    obj.claimExpiresAt = new Date(Date.now() + 5000);
    const doc = obj.toDocument();
    expect(doc.event).toBe(obj.event);
    expect(doc.publicationDate).toBe(obj.publicationDate);
    expect(doc.status).toBe(obj.status);
    expect(doc.messageId).toBe(obj.messageId);
  });

  it("should create model from doc", () => {
    const doc = {
      _id: "09909-popopo",
      claimExpiresAt: new Date("2025-10-27T13:46:58.876Z"),
      claimedAt: new Date("2025-10-27T13:46:53.876Z"),
      claimedBy: "9216e9d3-611d-41e3-bc60-a0793964e30c",
      completionAttempts: 1,
      completionDate: null,
      event: {
        data: {
          foo: "barr",
        },
      },
      lastResubmissionDate: null,
      messageId: "d2868709-7232-4f08-8375-d367901cdadf",
      publicationDate: "2025-10-27T13:46:53.876Z",
      status: "PUBLISHED",
      type: "io.onsite.agreement.status.foo",
    };

    const model = Inbox.fromDocument(doc);
    expect(model).toBeInstanceOf(Inbox);
    expect(model._id).toBe(doc._id);
  });
});
