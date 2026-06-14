import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";

const getAgreementEventData = (inboxEvent) => inboxEvent.event?.data ?? {};

const getAgreementStatus = (eventData) =>
  eventData.status ?? eventData.currentStatus ?? null;

const getAgreementClientRef = (eventData) =>
  eventData.clientRef ?? eventData.caseRef;

const getAgreementCode = (eventData) =>
  eventData.code ?? eventData.workflowCode;

export const createAgreementExternalStateChangeCommand = (inboxEvent) => {
  const eventData = getAgreementEventData(inboxEvent);
  const externalRequestedState = getAgreementStatus(eventData);

  if (!externalRequestedState || !inboxEvent.source) {
    throw new Error(`Unable to handle inbox message ${inboxEvent.messageId}`);
  }

  return {
    sourceSystem: inboxEvent.source,
    clientRef: getAgreementClientRef(eventData),
    code: getAgreementCode(eventData),
    externalRequestedState,
    eventData,
  };
};

export const ingestAgreementEvent = async (inboxEvent) =>
  withTraceParent(inboxEvent.traceparent, async () =>
    applyExternalStateChange(
      createAgreementExternalStateChangeCommand(inboxEvent),
    ),
  );
