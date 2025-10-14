import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { Outbox, OutboxStatus } from "../models/outbox.js";
import { fetchPendingEvents, insertMany } from "./outbox.repository.js";

vi.mock("../../common/mongo-client.js");

describe("outbox.repository", () => {
  describe("insertMany", () => {
    it("should insert events", async () => {
      const mockInsertMany = vi.fn().mockResolvedValueOnce({
        modifiedCount: 1,
      });
      db.collection.mockReturnValue({
        insertMany: mockInsertMany,
      });

      const events = [
        new Outbox({
          target: "arn:some:arn:value",
          event: {
            clientRef: "1234-7778",
          },
        }),
        new Outbox({
          target: "arn:some:other:value",
          event: {
            clientRef: "0987-1234",
          },
        }),
      ];

      const mockSession = vi.fn();

      await insertMany(events, mockSession);

      expect(mockInsertMany).toHaveBeenCalledWith(events, {
        session: mockSession,
      });
    });
  });

  describe("fetchPendingEvents", () => {
    it("should fetch any pending events", async () => {
      const claimedBy = randomUUID();
      const mockDocument = {
        _id: "1234",
        publicationDate: new Date(),
        target: "arn:an:arn:value",
        event: {
          clientRef: "1234-5668",
        },
        completionAttempts: 1,
        status: OutboxStatus.PUBLISHED,
      };
      const findOneAndUpdateMock = vi.fn();
      findOneAndUpdateMock
        .mockResolvedValueOnce(mockDocument)
        .mockResolvedValueOnce(null);

      db.collection.mockReturnValue({ findOneAndUpdate: findOneAndUpdateMock });

      const results = await fetchPendingEvents(claimedBy);
      expect(results[0]).toBeInstanceOf(Outbox);
      expect(results).toHaveLength(1);
    });
  });
});
