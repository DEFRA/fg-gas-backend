import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";
import { ingestAgreementEvent } from "./agreement-event-ingestion.use-case.js";

const agreementServiceSource = "AS";

const getEventData = (inboxEvent) => inboxEvent.event?.data ?? {};

const getExternalRequestedState = (eventData) =>
  eventData.currentStatus ?? eventData.status ?? null;

const getClientRef = (eventData) => eventData.clientRef ?? eventData.caseRef;

const getCode = (eventData) => eventData.workflowCode ?? eventData.code;

export const createExternalStateChangeCommand = (inboxEvent) => {
  const eventData = getEventData(inboxEvent);
  const externalRequestedState = getExternalRequestedState(eventData);

  if (!externalRequestedState || !inboxEvent.source) {
    throw new Error(`Unable to handle inbox message ${inboxEvent.messageId}`);
  }

  return {
    sourceSystem: inboxEvent.source,
    clientRef: getClientRef(eventData),
    code: getCode(eventData),
    externalRequestedState,
    eventData,
  };
};

export const processInboxEvent = async (inboxEvent) => {
  if (inboxEvent.source === agreementServiceSource) {
    return ingestAgreementEvent(inboxEvent);
  }

  return withTraceParent(inboxEvent.traceparent, async () =>
    applyExternalStateChange(createExternalStateChangeCommand(inboxEvent)),
  );
};
