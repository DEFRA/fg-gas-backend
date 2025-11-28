import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.repository.js";

export const messageSource = {
  AgreementService: "AS",
  CaseWorking: "CW",
};

export const saveInboxMessageUseCase = async (message, source) => {
  logger.info(
    `Save inbox message use ccase for message with id: ${message.id}`,
  );
  const existing = await findByMessageId(message.id);
  if (existing !== null) {
    // message has already been stored
    logger.warn(`Message with id ${message.id} already exists`);
    return;
  }

  logger.info(`Storing message with id ${message.id}.`);
  const inbox = new Inbox({
    traceparent: message.traceparent,
    event: message,
    messageId: message.id,
    type: message.type,
    source,
  });

  await insertOne(inbox);
  logger.info(
    `Finished: Save inbox message use ccase for message with id: ${message.id}`,
  );
};
