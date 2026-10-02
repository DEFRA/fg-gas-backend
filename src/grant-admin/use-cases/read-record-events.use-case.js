import { AUDIT_EXCLUDE } from "../../events/event-audit.js";
import { readCaseworkingPage } from "../services/event-sources.js";
import { findEventsUseCase } from "./find-events.use-case.js";

// A record page's Events tab: the events page searched for the record's ref,
// GAS's and Caseworking's rows merged, audit rows left out.
export const readRecordEventsUseCase = async (ref) => {
  const filters = { q: ref, audit: AUDIT_EXCLUDE };
  const list = await findEventsUseCase({
    ...filters,
    caseworking: readCaseworkingPage({ ...filters, sections: ["list"] }),
  });

  return {
    content: {
      events: { rows: list.events, more: list.pagination.hasNextPage },
    },
    sourceErrors: list.sourceErrors,
  };
};
