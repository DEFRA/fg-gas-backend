import { defineBucket, toIso } from "../../common/buckets/bucket.js";
import { outboxStatusValues } from "../event-status-values.js";
import { REDRIVABLE_STATUSES } from "../event-redrive.js";
import { NO_ERROR_KEY } from "../../common/buckets/error-key.js";
import { OUTBOX, eventTypeValues } from "../event-types.js";

const orNull = (value) => value ?? null;

// Read when the bucket is made, so every event type has loaded.
const facts = () => ({
  status: { label: "Status", param: "status", values: outboxStatusValues },
  eventType: {
    label: "Event",
    param: "event",
    values: eventTypeValues(OUTBOX),
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
    "event.id": 1,
  },
  present: (doc) => ({
    title: orNull(doc.eventType),
    subtitle: orNull(doc.event?.id),
    cells: {
      status: doc.status,
      completedAt: toIso(doc.completionDate),
    },
    link: {
      kind: "event",
      service: "gas",
      box: "outbox",
      id: doc._id.toString(),
    },
  }),
};

// A factory: event types are complete only after every module has loaded.
export const outboxBucket = () =>
  defineBucket({
    id: "gas.outbox",
    path: "events/gas/outbox",
    label: "GAS outbox",
    service: "GAS",
    shortLabel: "Outbox",
    icon: "activity",
    order: 10,
    noun: { one: "event", many: "events" },
    collection: "outbox",
    time: { field: "publicationDate", type: "date", label: "Created" },
    facts: facts(),
    refs: { ref: "Reference", trace: "Trace ID", id: "Event ID" },
    links: ["application"],
    // One list index per filter shape, then the error lines and Top errors'.
    indexes: [
      ["status"],
      ["eventType"],
      ["eventType", "status"],
      ["eventType", "status", "lastError.name"],
      ["status", "lastError.name"],
      ["status", "errorKey"],
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
