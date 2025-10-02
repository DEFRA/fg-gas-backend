import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.respository.js";
import os from "node:os";

export const saveInboxMessageUseCase = async (message, fnString) => {
  const hostname = os.hostname();
  logger.info("save inbox message use case");
  const existing = await findByMessageId(message.id);
  if (existing !== null) {
    // message has already been stored
    logger.warn(`message with id ${message.id} already exists`);
    return;
  }

  logger.info(`storing message with id ${message.id}.`);
  const inbox = new Inbox({
    hostname,
    event: message,
    messageId: message.id,
    type: message.type,
    handler: fnString,
  });

  await insertOne(inbox);
  logger.info("message stored");
};
