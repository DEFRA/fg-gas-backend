import { describe, expect, it, vi } from "vitest";
import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.repository.js";
import { saveInboxMessageUseCase } from "./save-inbox-message.use-case.js";

vi.mock("../repositories/inbox.repository.js");

describe("save inbox message", () => {
  it("saves a message", async () => {
    insertOne.mockResolvedValue(true);
    findByMessageId.mockResolvedValue(null);
    const message = {};
    await saveInboxMessageUseCase(message, "CW");
    expect(findByMessageId).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledWith(expect.any(Inbox));
  });

  it("should do nothing id message is already saved", async () => {
    findByMessageId.mockResolvedValue({});
    vi.spyOn(logger, "warn");
    const message = {};
    await saveInboxMessageUseCase(message, "CW");
    expect(logger.warn).toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });
});
