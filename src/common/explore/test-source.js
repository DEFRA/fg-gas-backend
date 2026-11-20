import { testBucket } from "../buckets/test-bucket.js";

// Two boxes of one source, timed differently, as the events' boxes are.
export const outbox = () =>
  testBucket({
    id: "test.outbox",
    path: "test/outbox",
    facts: {
      ...testBucket().facts,
      version: { label: "Version", param: "version", within: "code" },
    },
    indexes: [
      ["status"],
      ["status", "eventType"],
      ["code"],
      ["code", "version"],
    ],
    links: ["application"],
  });

export const inbox = () =>
  testBucket({
    id: "test.inbox",
    path: "test/inbox",
    collection: "inbox",
    time: { field: "publicationDate", type: "isoString", label: "Received" },
  });

export const testSource = (boxes = [outbox(), inbox()]) => ({
  name: "events",
  label: "Events, in tests",
  service: "Test",
  size: "big",
  noun: { one: "event", many: "events" },
  time: "publicationDate",
  star: ["publicationDate", "box", "eventType", "status"],
  added: { box: (_, { box }) => [box] },
  answersAt: "payload.answers",
  boxes: boxes.map((bucket) => ({
    id: bucket.id,
    bucket,
    service: "Test",
    box: bucket.id.split(".")[1],
  })),
  open: (doc, { box }) => ({ kind: "event", box, id: String(doc._id) }),
  openPaths: [],
  paths: [
    { path: "_id", type: "objectId", index: { id: true } },
    { path: "ref", type: "text", index: { ref: "ref" } },
    { path: "refs", type: "text", index: { refs: true } },
    { path: "msg", type: "text", index: { ref: "msg", stable: true } },
    { path: "status", type: "text", index: { fact: "status" } },
    { path: "eventType", type: "text", index: { fact: "eventType" } },
    { path: "code", type: "text", index: { fact: "code" } },
    { path: "version", type: "text", index: { fact: "version" } },
    { path: "grantCode", type: "text" },
    { path: "publicationDate", type: "date", index: { time: true } },
    { path: "box", type: "text", index: { box: "box" } },
    { path: "attempts", type: "number" },
  ],
});
