import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.respository.js";

export const saveInboxMessageUseCase = async (message, fnString) => {
  logger.info("save inbox message use case");
  const existing = await findByMessageId(message.id);
  if (existing !== null) {
    // message has already been stored
    logger.warn(`message with id ${message.id} already exists`);
    return;
  }

  logger.info(`storing message with id ${message.id}.`);
  const inbox = new Inbox({
    event: message,
    messageId: message.id,
    type: message.type,
    handler: fnString,
  });

  await insertOne(inbox);
  logger.info("message stored");
};
