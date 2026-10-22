import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { indexKeysOf } from "../../common/buckets/bucket.js";
import { parseQuery } from "../../common/buckets/engine.js";
import { choosePlan } from "../../common/buckets/plan.js";
import { queryRequestSchema } from "../../common/buckets/schema.js";
import { INBOX, OUTBOX, defineEventType } from "../event-types.js";
import { inboxBucket } from "./inbox.bucket.js";

defineEventType({ name: "case.status.updated", sentAs: "in", boxes: [INBOX] });
defineEventType({ name: "sent.only", sentAs: "out", boxes: [OUTBOX] });

const ID = "66f000000000000000000001";

describe("gas.inbox", () => {
  const bucket = inboxBucket();

  it("lists every inbox row by the time it was received", () => {
    expect(bucket).toMatchObject({
      id: "gas.inbox",
      path: "events/gas/inbox",
      label: "GAS inbox",
      service: "GAS",
      shortLabel: "Inbox",
      icon: "activity",
      order: 20,
      noun: { one: "event", many: "events" },
      collection: "inbox",
      time: { field: "publicationDate", type: "isoString", label: "Received" },
      audited: false,
      timeline: true,
    });
  });

  it("declares its facts, with the types the inbox receives", () => {
    expect(Object.keys(bucket.facts)).toEqual([
      "status",
      "eventType",
      "lastError.name",
      "errorKey",
    ]);
    expect(bucket.facts.eventType.values).toEqual([
      { value: "case.status.updated", label: "case.status.updated" },
      { value: "Unrecognised", label: "Unrecognised" },
    ]);
  });

  it("hides no type, and declares no toggle", () => {
    expect(bucket.facts.eventType.toggle).toBeNull();
    expect(bucket.facts.eventType.values.some(({ hidden }) => hidden)).toBe(
      false,
    );
    expect(choosePlan(bucket, [], false)).toMatchObject({
      kind: "exact",
      line: [],
    });
  });

  it("declares its ref kinds: the reference, the trace and the event id", () => {
    expect(bucket.refs).toEqual({
      ref: "Reference",
      trace: "Trace ID",
      id: "Event ID",
    });
  });

  it("reads an application's events by its link, never offered as a search", () => {
    const { value } = queryRequestSchema.validate({
      ref: "application:woodland:client-wmp-test-0061",
    });

    expect(bucket.links).toContain("application");
    expect(Object.keys(bucket.refs)).not.toContain("application");
    expect(parseQuery(bucket, value)).toMatchObject({
      ref: "application:woodland:client-wmp-test-0061",
      refKind: "application",
      plan: { line: "refs" },
    });
  });

  it("holds only its lines in its index keys", () => {
    expect(indexKeysOf(bucket).map(Object.keys)).toEqual([
      ["publicationDate", "_id"],
      ["status", "publicationDate", "_id"],
      ["status", "eventType", "publicationDate", "_id"],
      ["status", "lastError.name", "publicationDate", "_id"],
      ["status", "errorKey", "eventType", "publicationDate", "_id"],
      ["refs", "publicationDate", "_id"],
    ]);
  });

  it("is the Inbox tab of its service's Events page", () => {
    expect(bucket.page).toEqual({
      id: "events",
      label: "GAS events",
      shortLabel: "Events",
    });
    expect(bucket.tab).toBe("Inbox");
  });

  it("declares its dead letters counted by error key and event type as Top errors, each entry an exact read", () => {
    expect(bucket.summaries).toEqual([
      {
        id: "errors",
        label: "Top errors",
        by: ["errorKey", "eventType"],
        among: { status: "DEAD_LETTER" },
        top: 20,
        none: "No error recorded",
      },
    ]);
    expect(
      choosePlan(bucket, ["status", "errorKey", "eventType"], false, [
        "eventType",
      ]),
    ).toMatchObject({ kind: "exact", residual: [] });
  });

  it("groups by status, and draws the status as a badge", () => {
    expect(bucket.groupings).toEqual(["status"]);
    expect(bucket.columns).toEqual([
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ]);
  });

  it("never projects the event", () => {
    expect(bucket.row.projection).toEqual({
      eventType: 1,
      status: 1,
      completionDate: 1,
      messageId: 1,
    });
  });

  it("presents a row linked to its event page", () => {
    expect(
      bucket.row.present({
        _id: ObjectId.createFromHexString(ID),
        eventType: "case.status.updated",
        status: "COMPLETED",
        completionDate: "2026-10-09T09:14:04.000Z",
        messageId: "0b7c1d1e-0000-4000-8000-000000000002",
      }),
    ).toEqual({
      title: "case.status.updated",
      subtitle: "0b7c1d1e-0000-4000-8000-000000000002",
      cells: {
        status: "COMPLETED",
        completedAt: "2026-10-09T09:14:04.000Z",
      },
      link: { kind: "event", service: "gas", box: "inbox", id: ID },
    });
  });

  it("presents null for what a row does not hold, never dropping the row", () => {
    expect(
      bucket.row.present({
        _id: ObjectId.createFromHexString(ID),
        status: "PUBLISHED",
      }),
    ).toMatchObject({
      title: null,
      subtitle: null,
      cells: {
        status: "PUBLISHED",
        completedAt: null,
      },
    });
  });
});
