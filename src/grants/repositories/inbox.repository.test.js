import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { Inbox, InboxStatus } from "../models/inbox.js";
import {
  claimEvents,
  findByMessageId,
  insertMany,
  insertOne,
  processExpiredEvents,
  update,
  updateDeadEvents,
  updateFailedEvents,
  updateResubmittedEvents,
} from "./inbox.repository.js";

vi.mock("../../common/mongo-client.js");

describe("inbox.repository", () => {
  it("should claim events", async () => {
    const claimedBy = randomUUID();
    const mockDocument = {};

    const findOneAndUpdate = vi.fn();
    findOneAndUpdate
      .mockResolvedValueOnce(mockDocument)
      .mockResolvedValueOnce(null);

    db.collection.mockReturnValue({
      findOneAndUpdate,
    });

    const results = await claimEvents(claimedBy);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Inbox);
  });

  it("should insert many", async () => {
    const insertMany = vi.fn().mockResolvedValueOnce({ modifiedCount: 1 });
    db.collection.mockReturnValue({ insertMany });

    const events = [new Inbox({}), new Inbox({})];

    const mockSession = vi.fn();
    await insertMany(events, mockSession);
    expect(insertMany).toHaveBeenCalledWith(events, mockSession);
  });

  it("should process expired events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({
      updateMany,
    });

    await processExpiredEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        claimExpiresAt: {
          $lt: expect.any(Date),
        },
      },
      {
        $set: {
          status: InboxStatus.FAILED,
          claimedAt: null,
          claimedBy: null,
          claimExpiresAt: null,
        },
      },
    );
  });

  it("should update dead events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateDeadEvents();

    expect(updateMany).toHaveBeenCalledWith(
      { completionAttempts: { $gte: config.inbox.inboxMaxRetries } },
      {
        $set: {
          status: InboxStatus.DEAD,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      },
    );
  });

  it("should update resubmitted events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateResubmittedEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        status: InboxStatus.RESUBMITTED,
      },
      {
        $set: {
          status: InboxStatus.PUBLISHED,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
        $inc: { completionAttempts: 1 },
      },
    );
  });

  it("should update failed events", async () => {
    const updateMany = vi.fn().mockResolvedValue({});
    db.collection.mockReturnValue({ updateMany });

    await updateFailedEvents();

    expect(updateMany).toHaveBeenCalledWith(
      {
        status: InboxStatus.FAILED,
      },
      {
        $set: {
          status: InboxStatus.RESUBMITTED,
          claimedAt: null,
          claimExpiresAt: null,
          claimedBy: null,
        },
      },
    );
  });

  it("should insertMany", async () => {
    const insertManySpy = vi.fn();
    db.collection.mockReturnValue({ insertMany: insertManySpy });
    const session = {};

    const events = [
      new Inbox({
        event: {
          some_data_bar: "foo",
        },
      }),
    ];

    await insertMany(events, session);

    expect(insertManySpy).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          event: {
            some_data_bar: "foo",
          },
        }),
      ],
      { session },
    );
  });

  it("should finsByMessageId", async () => {
    const id = randomUUID();
    const mockDoc = { _id: id };
    const findOneMock = vi.fn().mockResolvedValue(mockDoc);
    db.collection.mockReturnValue({ findOne: findOneMock });
    const doc = await findByMessageId(id);
    expect(findOneMock).toHaveBeenCalledWith({ messageId: id });
    expect(mockDoc).toEqual(doc);
  });

  it("should insertOne", async () => {
    const id = randomUUID();
    const insertOneMock = vi.fn();
    db.collection.mockReturnValue({ insertOne: insertOneMock });
    const session = {};
    const doc = new Inbox({
      _id: id,
    });
    await insertOne(doc, session);
    expect(insertOneMock).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: id,
      }),
      { session },
    );
  });

  it("should update a document", async () => {
    const id = randomUUID();
    const inbox = new Inbox({ _id: id });
    vi.spyOn(inbox, "toDocument").mockReturnValue({
      _id: id,
      someOtherValue: "foo",
    });
    const updateOneMock = vi.fn();
    db.collection.mockReturnValue({ updateOne: updateOneMock });

    await update(inbox);

    expect(inbox.toDocument).toHaveBeenCalled();
    expect(updateOneMock).toHaveBeenCalledWith(
      { _id: id },
      {
        $set: expect.objectContaining({ someOtherValue: "foo" }),
      },
    );
  });
});
