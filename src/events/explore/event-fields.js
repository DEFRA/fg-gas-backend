import { EVENT_BOXES, EVENT_SERVICES } from "../event-boxes.js";

// What the union of the boxes adds to each record: where it was read, as a
// $unionWith with a $set of the box would.
export const eventAdded = {
  service: (_, { service }) => [service],
  box: (_, { box }) => [box],
};

// The paths an event's record is read through an index by, and those worth
// suggesting. Audit events carry no `id:` or `ref:` refs.
export const eventPaths = [
  { path: "_id", type: "objectId", index: { id: true } },
  { path: "publicationDate", type: "date", index: { time: true } },
  {
    path: "service",
    type: "text",
    index: { box: "service" },
    labels: EVENT_SERVICES,
  },
  { path: "box", type: "text", index: { box: "box" }, labels: EVENT_BOXES },
  { path: "eventType", type: "text", index: { fact: "eventType" } },
  { path: "status", type: "text", index: { fact: "status" } },
  { path: "errorKey", type: "text", index: { fact: "errorKey" } },
  { path: "lastError.name", type: "text", index: { fact: "lastError.name" } },
  { path: "refs", type: "text", index: { refs: true } },
  { path: "event.id", type: "text", index: { ref: "id", stable: true } },
  { path: "event.type", type: "text" },
  { path: "event.source", type: "text" },
  { path: "event.time", type: "date" },
  { path: "event.data.clientRef", type: "text" },
  { path: "event.data.code", type: "text" },
  { path: "event.data.caseRef", type: "text" },
  { path: "event.data.workflowCode", type: "text" },
  { path: "event.data.agreementNumber", type: "text" },
  { path: "event.data.identifiers.sbi", type: "text" },
  { path: "event.data.newStatus", type: "text" },
  { path: "target", type: "text" },
  { path: "lastError.message", type: "text" },
  { path: "completionAttempts", type: "number" },
  { path: "completionDate", type: "date" },
];

export const eventStar = [
  "publicationDate",
  "service",
  "box",
  "eventType",
  "status",
];

export const openEvent = (doc, { service, box }) => ({
  kind: "event",
  service,
  box,
  id: String(doc._id),
});
