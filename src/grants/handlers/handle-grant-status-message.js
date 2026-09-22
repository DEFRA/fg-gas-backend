import { withTraceParent } from "../../common/trace-parent.js";
import { applyExternalStateChange } from "../services/apply-event-status-change.service.js";

const firstPresent = (...values) => values.find(Boolean) ?? null;

export const handleGrantStatusMessage = async (message) => {
  const { event, source, traceparent } = message;
  const { data } = event;
  const status = firstPresent(data.currentStatus, data.status);
  const clientRef = firstPresent(data.clientRef, data.caseRef);
  const code = firstPresent(data.workflowCode, data.code);

  if (!status || !source) {
    throw new Error(`Unable to handle inbox message ${message.messageId}`);
  }

  await withTraceParent(traceparent, async () =>
    applyExternalStateChange({
      sourceSystem: source,
      clientRef,
      code,
      externalRequestedState: status,
      eventData: data,
    }),
  );
};
