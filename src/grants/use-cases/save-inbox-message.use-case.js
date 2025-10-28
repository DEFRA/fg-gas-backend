import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.repository.js";

export const saveInboxMessageUseCase = async (message) => {
  logger.info("Save inbox message use case");
  const existing = await findByMessageId(message.id);
  if (existing !== null) {
    // message has already been stored
    logger.warn(`Message with id ${message.id} already exists`);
    return;
  }

  logger.info(`Storing message with id ${message.id}.`);
  const inbox = new Inbox({
    event: message,
    messageId: message.id,
    type: message.type,
  });

  await insertOne(inbox);
  logger.info("Inbox message stored");
};
