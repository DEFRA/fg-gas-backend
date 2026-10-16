// What the Caseworking stub answers for its buckets: a catalogue entry and a
// record's timeline, shaped as fg-cw-backend's routes answer.

export const aCwBucketEntry = (box) => ({
  id: `cw.${box}`,
  path: `events/cw/${box}`,
  label: `CW ${box}`,
  service: "CW",
  shortLabel: box,
  icon: "activity",
  order: box === "outbox" ? 30 : 40,
  noun: { one: "event", many: "events" },
  time: { label: box === "outbox" ? "Created" : "Received" },
  facts: [],
  refs: [{ kind: "ref", label: "Reference" }],
  indexes: [[]],
  groupings: [],
  title: { label: "Event", format: "eventType" },
  columns: [],
  audited: false,
  timeline: true,
  summaries: [],
  page: null,
  tab: null,
});

export const aCwEventRow = (box, { id, eventId, time, type, status }) => ({
  id,
  time,
  title: type,
  subtitle: eventId,
  cells: { status, completedAt: time },
  link: { kind: "event", service: "caseworking", box, id },
});

// One bucket of what POST /actuators/timeline answers; null rows is a bucket
// Caseworking could not read.
export const aCwTimelineBucket = (box, rows) => ({
  id: `cw.${box}`,
  label: `CW ${box}`,
  rows,
  more: false,
});

export const aCwBucketAnswer = (box, rows) => ({
  bucket: `cw.${box}`,
  plan: {
    kind: "exact",
    index: ["refs", "publicationDate", "_id"],
    bound: ["ref"],
    filled: [],
    residual: [],
    scans: 1,
  },
  rows,
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [],
});
