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

// SentTimestamp is milliseconds since 1970, in a string. The Inbox sorts on a date string
// and quietly falls back to the time the row was saved for anything it cannot read, which
// would claim a grant's versions out of the order the broker sent them.
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
      // The broker calls this "path", but it is the bucket it uploaded to.
      s3Bucket: attribute(messageAttributes, "path"),
      manifest,
    },
  };

  await saveInboxMessageUseCase(
    event,
    messageSource.ConfigBroker,
    grantCode || UNGROUPED_SEGREGATION_REF,
  );
};
