import { defineBucket, toIso } from "../../common/buckets/bucket.js";
import { eventStatusValues } from "../event-status-values.js";
import { REDRIVABLE_STATUSES } from "../event-redrive.js";
import { NO_ERROR_KEY } from "../../common/buckets/error-key.js";
import { INBOX, eventTypeValues } from "../event-types.js";

const orNull = (value) => value ?? null;

// Read when the bucket is made, so every event type has loaded.
const facts = () => ({
  status: { label: "Status", param: "status", values: eventStatusValues },
  eventType: {
    label: "Event",
    param: "event",
    values: eventTypeValues(INBOX),
  },
  "lastError.name": { label: "Error name", param: "errorname" },
  errorKey: {
    label: "Error",
    param: "error",
    nullAs: { value: NO_ERROR_KEY, among: { status: REDRIVABLE_STATUSES } },
  },
});

const summaries = [
  {
    id: "errors",
    label: "Top errors",
    by: ["errorKey", "eventType"],
    among: { status: "DEAD_LETTER" },
    top: 20,
    none: NO_ERROR_KEY,
  },
];

const row = {
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
};

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
    facts: facts(),
    refs: { ref: "Reference", trace: "Trace ID", id: "Event ID" },
    links: ["application", "config"],
    // One list index per filter shape, then the error lines and Top errors'.
    indexes: [
      ["status"],
      ["eventType"],
      ["eventType", "status"],
      ["status", "lastError.name"],
      ["status", "errorKey", "eventType"],
    ],
    groupings: ["status"],
    audited: false,
    timeline: true,
    summaries,
    title: { label: "Event", format: "eventType" },
    columns: [
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ],
    row,
  });
