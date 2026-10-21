import { STORED, defineBucket } from "./bucket.js";

const statuses = [
  "PUBLISHED",
  "PROCESSING",
  "FAILED",
  "RESUBMITTED",
  "COMPLETED",
  "DEAD_LETTER",
  "PURGED",
].map((value) => ({ value, label: value, tone: "neutral" }));

const eventTypes = [
  { value: "case.create", label: "case.create" },
  { value: "case.update.status", label: "case.update.status" },
];

export const testBucket = (overrides = {}) =>
  defineBucket({
    id: "test.outbox",
    path: "test/outbox",
    label: "Test outbox",
    service: "Test",
    shortLabel: "Outbox",
    order: 10,
    noun: { one: "event", many: "events" },
    collection: "outbox",
    time: { field: "publicationDate", type: "date", label: "Created" },
    facts: {
      status: { label: "Status", param: "status", values: statuses },
      eventType: { label: "Event", param: "event", values: eventTypes },
      grantCode: { label: "Grant", param: "grant" },
      code: { label: "Code", param: "code", values: STORED },
      source: {
        label: "Source",
        param: "source",
        values: [
          { value: "AS", label: "Agreement service" },
          { value: "CW", label: "Caseworking" },
        ],
      },
    },
    refs: { ref: "Reference", msg: "Message id" },
    indexes: [["status"], ["status", "eventType"], ["code"]],
    groupings: ["status", "eventType", "code"],
    title: { label: "Event", format: "eventType" },
    columns: [
      { key: "status", label: "Status", format: "badge", fact: "status" },
      { key: "grantCode", label: "Grant", format: "mono" },
    ],
    row: {
      projection: { eventType: 1, status: 1 },
      present: (doc) => ({
        title: doc.eventType,
        subtitle: null,
        cells: { status: doc.status },
        link: null,
      }),
    },
    ...overrides,
  });

// The same list led by its event type, one of which stays hidden until shown.
export const ledBucket = (overrides = {}) => {
  const { status, grantCode } = testBucket().facts;

  return testBucket({
    lead: ["eventType"],
    facts: {
      eventType: {
        label: "Event",
        param: "event",
        values: [
          ...eventTypes,
          { value: "audit", label: "audit", hidden: true },
        ],
        toggle: { label: "Show audit events", param: "audit" },
      },
      status,
      grantCode,
    },
    indexes: [["status"]],
    groupings: ["status", "eventType"],
    ...overrides,
  });
};
