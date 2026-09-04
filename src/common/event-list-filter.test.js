import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { buildEventListFilter, escapeRegex } from "./event-list-filter.js";

const inboxFilter = (options) =>
  buildEventListFilter({ ...options, eventIdField: "messageId" });

const outboxFilter = (options) =>
  buildEventListFilter({ ...options, eventIdField: "event.id" });

describe("buildEventListFilter", () => {
  it("is empty with no status and no q", () => {
    expect(inboxFilter({})).toEqual({});
    expect(outboxFilter({})).toEqual({});
  });

  it("keeps the pre-search shape when only status is given", () => {
    expect(inboxFilter({ status: "FAILED" })).toEqual({ status: "FAILED" });
  });

  it("treats an empty or whitespace-only q as absent", () => {
    expect(inboxFilter({ q: "" })).toEqual({});
    expect(inboxFilter({ q: "   " })).toEqual({});
    expect(inboxFilter({ q: "\t\n" })).toEqual({});
  });

  it("trims a q with surrounding whitespace", () => {
    expect(inboxFilter({ q: "  msg-1  " }).$or).toContainEqual({
      messageId: "msg-1",
    });
  });

  it("ANDs status with q rather than overwriting either", () => {
    const filter = inboxFilter({ status: "FAILED", q: "msg-1" });

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0]).toEqual({ status: "FAILED" });
    expect(filter.$and[1]).toHaveProperty("$or");
  });
});

describe("buildEventListFilter q", () => {
  it("matches the inbox messageId exactly", () => {
    expect(inboxFilter({ q: "msg-1" }).$or).toContainEqual({
      messageId: "msg-1",
    });
  });

  it("matches the outbox event.id exactly", () => {
    expect(outboxFilter({ q: "evt-1" }).$or).toContainEqual({
      "event.id": "evt-1",
    });
  });

  it("matches segregationRef exactly and as a case-insensitive prefix", () => {
    const { $or } = inboxFilter({ q: "GLD-9B2" });

    expect($or).toContainEqual({ segregationRef: "GLD-9B2" });
    expect($or).toContainEqual({
      segregationRef: { $regex: "^GLD-9B2", $options: "i" },
    });
  });

  it("matches a 24-hex q as an ObjectId _id", () => {
    const hex = "665f1c2e9a1b2c3d4e5f6a7b";

    expect(inboxFilter({ q: hex }).$or).toContainEqual({
      _id: ObjectId.createFromHexString(hex),
    });
  });

  it("does not attempt an _id match for a q that is not 24 hex characters", () => {
    const idClauses = (q) =>
      inboxFilter({ q }).$or.filter((clause) => "_id" in clause);

    expect(idClauses("665f1c2e9a1b2c3d4e5f6a7")).toEqual([]);
    expect(idClauses("zzzz1c2e9a1b2c3d4e5f6a7b")).toEqual([]);
    expect(idClauses("GLD-9B2-BWS")).toEqual([]);
  });

  it("escapes regex metacharacters so a ref is matched literally", () => {
    const { $or } = inboxFilter({ q: "a.b+c*" });

    expect($or).toContainEqual({
      segregationRef: { $regex: "^a\\.b\\+c\\*", $options: "i" },
    });
  });

  it("escapes a q that is nothing but metacharacters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toEqual(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\",
    );
  });

  it("anchors the prefix regex so it never matches mid-string", () => {
    const [clause] = inboxFilter({ q: "BWS" }).$or.filter(
      (candidate) => candidate.segregationRef?.$regex,
    );

    expect(clause.segregationRef.$regex.startsWith("^")).toBe(true);
  });
});

// There is no TYPE (`kind`) filter: an unknown `kind` is rejected by the query
// schema before it reaches here, and a `kind` key handed to the builder
// directly is simply ignored. Audit rows are still recognised structurally for
// DISPLAY, in grant-admin/services/map-event-row.js.
describe("buildEventListFilter and kind", () => {
  it("ignores a kind key entirely rather than filtering on it", () => {
    expect(outboxFilter({ kind: "audit" })).toEqual({});
    expect(inboxFilter({ kind: "audit" })).toEqual({});
    expect(outboxFilter({ status: "FAILED", kind: "domain" })).toEqual({
      status: "FAILED",
    });
  });

  it("ANDs status and q together", () => {
    const filter = outboxFilter({ status: "FAILED", q: "evt-1" });

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0]).toEqual({ status: "FAILED" });
    expect(filter.$and[1]).toHaveProperty("$or");
  });
});

// The two boxes as the repositories actually configure them: the inbox keys
// off a Z-normalised ISO string, the outbox off a BSON Date.
const inboxRange = (options) =>
  buildEventListFilter({
    ...options,
    eventIdField: "messageId",
    traceparentField: "traceparent",
    rangeField: "eventTime",
    rangeIsDate: false,
  });

const outboxRange = (options) =>
  buildEventListFilter({
    ...options,
    eventIdField: "event.id",
    traceparentField: "event.traceparent",
    rangeField: "publicationDate",
    rangeIsDate: true,
  });

const FROM = "2026-06-16T00:00:00.000Z";
const TO = "2026-06-16T23:59:59.999Z";

describe("buildEventListFilter q - traceparent and payload references", () => {
  const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("matches an inbox traceparent at the top level", () => {
    expect(inboxRange({ q: TRACEPARENT }).$or).toContainEqual({
      traceparent: TRACEPARENT,
    });
  });

  it("matches an outbox traceparent inside the event", () => {
    const clauses = outboxRange({ q: TRACEPARENT }).$or;

    expect(clauses).toContainEqual({ "event.traceparent": TRACEPARENT });
    expect(clauses).not.toContainEqual({ traceparent: TRACEPARENT });
  });

  it("matches event.data.caseRef exactly, in both boxes", () => {
    expect(inboxRange({ q: "CASE-1" }).$or).toContainEqual({
      "event.data.caseRef": "CASE-1",
    });
    expect(outboxRange({ q: "CASE-1" }).$or).toContainEqual({
      "event.data.caseRef": "CASE-1",
    });
  });

  it("matches event.data.clientRef exactly, in both boxes", () => {
    expect(inboxRange({ q: "GLD-9B2-BWS" }).$or).toContainEqual({
      "event.data.clientRef": "GLD-9B2-BWS",
    });
    expect(outboxRange({ q: "GLD-9B2-BWS" }).$or).toContainEqual({
      "event.data.clientRef": "GLD-9B2-BWS",
    });
  });

  it("keeps every clause it already had", () => {
    const clauses = inboxRange({ q: "msg-1" }).$or;

    expect(clauses).toContainEqual({ messageId: "msg-1" });
    expect(clauses).toContainEqual({ segregationRef: "msg-1" });
    expect(clauses).toContainEqual({
      segregationRef: { $regex: "^msg-1", $options: "i" },
    });
  });

  it("still adds the _id clause for an ObjectId-shaped q", () => {
    const hex = "665f1c2e9a1b2c3d4e5f6a7b";

    expect(inboxRange({ q: hex }).$or).toContainEqual({
      _id: ObjectId.createFromHexString(hex),
    });
  });

  it("matches nothing extra for a q that is only whitespace", () => {
    expect(inboxRange({ q: "  " })).toEqual({});
  });
});

describe("buildEventListFilter from/to", () => {
  it("is unchanged when neither bound is given", () => {
    expect(inboxRange({})).toEqual({});
    expect(outboxRange({})).toEqual({});
  });

  it("compares the inbox sort key as a string", () => {
    expect(inboxRange({ from: FROM, to: TO })).toEqual({
      eventTime: { $gte: FROM, $lte: TO },
    });
  });

  it("coerces the outbox sort key to a Date", () => {
    expect(outboxRange({ from: FROM, to: TO })).toEqual({
      publicationDate: { $gte: new Date(FROM), $lte: new Date(TO) },
    });
  });

  it("is inclusive at both ends", () => {
    expect(inboxRange({ from: FROM }).eventTime.$gte).toEqual(FROM);
    expect(inboxRange({ to: TO }).eventTime.$lte).toEqual(TO);
  });

  it("accepts each bound on its own", () => {
    expect(inboxRange({ from: FROM })).toEqual({ eventTime: { $gte: FROM } });
    expect(inboxRange({ to: TO })).toEqual({ eventTime: { $lte: TO } });
    expect(outboxRange({ from: FROM })).toEqual({
      publicationDate: { $gte: new Date(FROM) },
    });
  });

  it("combines with status and q under one $and", () => {
    const filter = inboxRange({ status: "FAILED", q: "msg-1", from: FROM });

    expect(filter.$and).toHaveLength(3);
    expect(filter.$and).toContainEqual({ status: "FAILED" });
    expect(filter.$and).toContainEqual({ eventTime: { $gte: FROM } });
  });

  it("is ignored when the box declares no range field", () => {
    expect(
      buildEventListFilter({
        eventIdField: "messageId",
        from: FROM,
        to: TO,
      }),
    ).toEqual({});
  });
});

describe("buildEventListFilter error", () => {
  const build = (overrides = {}) =>
    buildEventListFilter({
      eventIdField: "messageId",
      rangeField: "eventTime",
      ...overrides,
    });

  it("matches the stored lastError.message exactly", () => {
    expect(build({ error: "No handler found" })).toEqual({
      "lastError.message": "No handler found",
    });
  });

  it("is not a regex, so a message full of metacharacters matches literally", () => {
    const message = "boom (a.b+c) [x]";

    expect(build({ error: message })["lastError.message"]).toBe(message);
  });

  it("AND-s with every other filter rather than widening the selection", () => {
    const filter = build({ status: "DEAD_LETTER", error: "boom" });

    expect(filter.$and).toEqual([
      { status: "DEAD_LETTER" },
      { "lastError.message": "boom" },
    ]);
  });

  it("AND-s with a search term as well, so `q` and `error` narrow together", () => {
    const filter = build({ q: "GLD-9B2", error: "boom" });

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and.at(-1)).toEqual({ "lastError.message": "boom" });
  });

  it("constrains nothing when absent, so an unfiltered query is unchanged", () => {
    expect(build({})).toEqual({});
    expect(build({ error: undefined })).toEqual({});
    expect(build({ error: "" })).toEqual({});
  });
});
