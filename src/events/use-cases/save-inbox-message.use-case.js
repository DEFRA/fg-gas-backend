import { getMessageGroupId } from "../../common/get-message-group-id.js";
import { logger } from "../../common/logger.js";
import { Inbox } from "../models/inbox.js";
import {
  findByMessageId,
  insertOne,
} from "../repositories/inbox.repository.js";

export const getSegregationRef = (event) => {
  const { data } = event;
  return getMessageGroupId(null, data);
};

export const saveInboxMessageUseCase = async (
  message,
  source,
  segregationRef,
) => {
  logger.info(`Save inbox message use case for message with id: ${message.id}`);
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
    // Not a default argument: those evaluate before the body, so a redelivered message
    // with no `data` would throw here rather than returning at the duplicate check.
    segregationRef: segregationRef ?? getSegregationRef(message),
  });

  await insertOne(inbox);
  logger.info(
    `Finished: Save inbox message use ccase for message with id: ${message.id}`,
  );
};
