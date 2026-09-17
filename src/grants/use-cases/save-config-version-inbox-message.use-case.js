import { logger } from "../../common/logger.js";
import { getTraceParent } from "../../common/trace-parent.js";
import {
  messageSource,
  saveInboxMessageUseCase,
} from "./save-inbox-message.use-case.js";

export const CONFIG_VERSION_EVENT_TYPE = "config-version.updated";

// An event with no grant cannot be grouped, but must still reach the Inbox to be visible.
export const UNGROUPED_SEGREGATION_REF = "unknown-grant";

const attribute = (attributes, key) => attributes?.[key]?.StringValue;

// SentTimestamp is epoch milliseconds in a string. The Inbox sorts on an ISO instant and
// silently falls back to insert time for anything Date.parse rejects, which would lose the
// per-grant ordering FIFO lock exists to provide.
const toEventTime = (sentTimeStamp) => {
  const epochMs = sentTimeStamp ? Number(sentTimeStamp) : Number.NaN;

  return Number.isNaN(epochMs)
    ? new Date().toISOString()
    : new Date(epochMs).toISOString();
};

export const saveConfigVersionInboxMessageUseCase = async (
  manifest,
  messageAttributes,
  { messageId, sentTimeStamp } = {},
) => {
  const grantCode = attribute(messageAttributes, "grant");
  const version = attribute(messageAttributes, "version");
  const status = attribute(messageAttributes, "status");

  logger.info(
    `Received config version update: ${grantCode}@${version} (${status})`,
  );

  const event = {
    id: messageId,
    type: CONFIG_VERSION_EVENT_TYPE,
    time: toEventTime(sentTimeStamp),
    traceparent: getTraceParent(),
    data: {
      grantCode,
      version,
      status,
      // NB: Left as published: SNS delivers these as strings, and Boolean("false") is true.
      isLatest: attribute(messageAttributes, "isLatest"),
      path: attribute(messageAttributes, "path"),
      manifest,
    },
  };

  await saveInboxMessageUseCase(
    event,
    messageSource.ConfigBroker,
    grantCode || UNGROUPED_SEGREGATION_REF,
  );
};
