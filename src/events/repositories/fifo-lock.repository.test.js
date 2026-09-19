import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { FifoLock } from "../models/fifo-lock.js";
import {
  cleanupStaleLocks,
  freeFifoLock,
  getFifoLocks,
  setFifoLock,
} from "./fifo-lock.repository.js";

vi.mock("../../common/mongo-client.js");

const ACTOR = "INBOX";

describe("fifo-lock.repository", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });
  it("should set a FifoLock", async () => {
    const mockDate = new Date(2026, 1, 1);
    vi.setSystemTime(mockDate);
    const updateOne = vi.fn();
    db.collection.mockReturnValue({
      updateOne,
    });
    await setFifoLock(ACTOR, "1234");
    expect(updateOne).toHaveBeenCalledWith(
      { locked: false, segregationRef: "1234", actor: ACTOR },
      {
        $set: {
          lockedAt: mockDate,
          locked: true,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  });

  it("should getFifoLocks", async () => {
    vi.spyOn(FifoLock, "fromDocument");
    const mockedDocuments = [
      FifoLock.createMock({
        _id: "1234",
        segregationRef: "client-id-1234",
        actor: "INBOX",
      }),
      FifoLock.createMock({
        _id: "1235",
        segregationRef: "client-id-5678",
        actor: "INBOX",
      }),
      FifoLock.createMock({
        _id: "1236",
        segregationRef: "client-id-7899",
        actor: "OUTBOX",
      }),
    ];
    const toArray = vi
      .fn()
      .mockResolvedValue([mockedDocuments[0], mockedDocuments[1]]);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({
      find,
    });

    const results = await getFifoLocks(ACTOR);
    expect(results).toHaveLength(2);
    expect(find).toHaveBeenCalledWith({ actor: ACTOR, locked: true });
    expect(toArray).toHaveBeenCalledTimes(1);
    expect(FifoLock.fromDocument).toHaveBeenCalledTimes(2);
  });

  it("should free a FifoLock", async () => {
    const updateOne = vi.fn();
    db.collection.mockReturnValue({
      updateOne,
    });
    await freeFifoLock(ACTOR, "1234");
    expect(updateOne).toHaveBeenCalledWith(
      { segregationRef: "1234", actor: ACTOR },
      {
        $set: {
          lockedAt: null,
          locked: false,
        },
      },
    );
  });

  it("should cleanup stale locks older than TTL", async () => {
    const mockDate = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(mockDate);

    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    db.collection.mockReturnValue({
      updateMany,
    });

    const result = await cleanupStaleLocks();

    const expectedStaleThreshold = new Date(
      mockDate.getTime() - config.fifoLock.ttlMs,
    );

    expect(updateMany).toHaveBeenCalledWith(
      {
        locked: true,
        lockedAt: { $lt: expectedStaleThreshold },
      },
      {
        $set: {
          lockedAt: null,
          locked: false,
        },
      },
    );
    expect(result.modifiedCount).toBe(2);
  });

  it("should return zero modified count when no stale locks exist", async () => {
    const mockDate = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(mockDate);

    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    db.collection.mockReturnValue({
      updateMany,
    });

    const result = await cleanupStaleLocks();

    expect(result.modifiedCount).toBe(0);
  });
});
