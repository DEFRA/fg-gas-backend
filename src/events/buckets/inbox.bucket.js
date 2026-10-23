import { defineBucket, toIso } from "../../common/buckets/bucket.js";
import { eventStatusValues } from "../event-status-values.js";
import { INBOX, eventTypeValues } from "../event-types.js";

const orNull = (value) => value ?? null;

// A factory: event types are complete only after every module has loaded.
export const inboxBucket = () =>
  defineBucket({
    id: "gas.inbox",
    path: "events/gas/inbox",
    label: "GAS inbox",
    service: "GAS",
    shortLabel: "Inbox",
    icon: "activity",
    page: { id: "events", label: "GAS events", shortLabel: "Events" },
    tab: "Inbox",
    order: 20,
    noun: { one: "event", many: "events" },
    collection: "inbox",
    time: { field: "publicationDate", type: "isoString", label: "Received" },
    facts: {
      status: { label: "Status", param: "status", values: eventStatusValues },
      eventType: {
        label: "Event",
        param: "event",
        values: eventTypeValues(INBOX),
      },
      "lastError.name": { label: "Error name", param: "errorname" },
      errorKey: { label: "Error", param: "error" },
    },
    refs: { ref: "Reference", trace: "Trace ID", id: "Event ID" },
    links: ["application", "config"],
    indexes: [
      ["status"],
      ["status", "eventType"],
      ["status", "lastError.name"],
      ["status", "errorKey", "eventType"],
    ],
    groupings: ["status"],
    audited: false,
    timeline: true,
    summaries: [
      {
        id: "errors",
        label: "Top errors",
        by: ["errorKey", "eventType"],
        among: { status: "DEAD_LETTER" },
        top: 20,
        none: "No error recorded",
      },
    ],
    title: { label: "Event", format: "eventType" },
    columns: [
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ],
    row: {
      projection: {
        eventType: 1,
        status: 1,
        completionDate: 1,
        messageId: 1,
      },
      present: (doc) => ({
        title: orNull(doc.eventType),
        subtitle: orNull(doc.messageId),
        cells: {
          status: doc.status,
          completedAt: toIso(doc.completionDate),
        },
        link: {
          kind: "event",
          service: "gas",
          box: "inbox",
          id: doc._id.toString(),
        },
      }),
    },
  });
