import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { FifoLock } from "../models/fifo-lock.js";
import { getFifoLocks, setFifoLock } from "./fifo-lock.repository.js";

vi.mock("../../common/mongo-client.js");

describe("fifo-lock.repository", () => {
  it("should set a FifoLock", async () => {
    const mockDate = new Date(2026, 1, 1);
    vi.setSystemTime(mockDate);
    const updateOne = vi.fn();
    db.collection.mockReturnValue({
      updateOne,
    });
    await setFifoLock("1234");
    expect(updateOne).toHaveBeenCalledWith(
      { segregationRef: "1234" },
      {
        $set: {
          lockedAt: mockDate,
          locked: true,
        },
      },
      { upsert: true },
    );
  });

  it("should getFifoLocks", async () => {
    vi.spyOn(FifoLock, "fromDocument");
    const mockedDocuments = [
      FifoLock.createMock({
        _id: "1234",
        segregationRef: "client-id-1234",
      }),
      FifoLock.createMock({
        _id: "1235",
        segregationRef: "client-id-5678",
      }),
    ];
    const toArray = vi.fn().mockResolvedValue(mockedDocuments);
    const find = vi.fn().mockReturnValue({ toArray });
    db.collection.mockReturnValue({
      find,
    });

    const results = await getFifoLocks();
    expect(results).toHaveLength(2);
    expect(find).toHaveBeenCalledWith({ locked: true });
    expect(toArray).toHaveBeenCalledTimes(1);
    expect(FifoLock.fromDocument).toHaveBeenCalledTimes(2);
  });
});
