import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { indexKeysOf } from "../../common/buckets/bucket.js";
import { parseQuery } from "../../common/buckets/engine.js";
import { choosePlan, scansOf } from "../../common/buckets/plan.js";
import { queryRequestSchema } from "../../common/buckets/schema.js";
import { INBOX, OUTBOX, defineEventType } from "../event-types.js";
import { outboxBucket } from "./outbox.bucket.js";

defineEventType({ name: "case.create", sentAs: "create", boxes: [OUTBOX] });
defineEventType({ name: "received.only", sentAs: "in", boxes: [INBOX] });

const ID = "66f000000000000000000001";

describe("gas.outbox", () => {
  const bucket = outboxBucket();

  it("lists every outbox row by the time it was created", () => {
    expect(bucket).toMatchObject({
      id: "gas.outbox",
      path: "events/gas/outbox",
      label: "GAS outbox",
      service: "GAS",
      shortLabel: "Outbox",
      icon: "activity",
      order: 10,
      noun: { one: "event", many: "events" },
      collection: "outbox",
      lead: [],
      time: { field: "publicationDate", type: "date", label: "Created" },
      audited: false,
      timeline: true,
    });
  });

  it("declares its facts, with the seven statuses and the types the outbox sends", () => {
    expect(Object.keys(bucket.facts)).toEqual([
      "status",
      "eventType",
      "lastError.name",
      "errorKey",
    ]);
    expect(bucket.facts.status.values).toHaveLength(7);
    expect(bucket.facts.eventType).toMatchObject({
      label: "Event",
      values: [
        { value: "Audit", label: "Audit" },
        { value: "case.create", label: "case.create" },
        { value: "Unrecognised", label: "Unrecognised" },
      ],
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

  it("keeps one index per filter shape, then its error lines and its refs", () => {
    expect(indexKeysOf(bucket).map(Object.keys)).toEqual([
      ["publicationDate", "_id"],
      ["status", "publicationDate", "_id"],
      ["eventType", "publicationDate", "_id"],
      ["eventType", "status", "publicationDate", "_id"],
      ["eventType", "status", "lastError.name", "publicationDate", "_id"],
      ["status", "errorKey", "eventType", "publicationDate", "_id"],
      ["refs", "publicationDate", "_id"],
    ]);
  });

  it.each([
    ["nothing", [], []],
    ["a status", ["status"], ["status"]],
    ["a type", ["eventType"], ["eventType"]],
    ["a type and a status", ["eventType", "status"], ["eventType", "status"]],
  ])("reads %s exactly on its own index, in one scan", (_, asked, line) => {
    expect(choosePlan(bucket, asked, false)).toEqual({
      kind: "exact",
      line,
      filled: [],
      residual: [],
    });
    expect(scansOf(bucket, line, asked)).toBe(1);
  });

  it.each([1, 2, 3, 4, 5])("reads %i statuses exactly, one scan each", (n) => {
    expect(choosePlan(bucket, ["status"], false, { status: n })).toMatchObject({
      kind: "exact",
      line: ["status"],
      filled: [],
    });
  });

  it("reads a ref on its own index, filling nothing", () => {
    expect(choosePlan(bucket, [], true)).toEqual({
      kind: "exact",
      line: "refs",
      filled: [],
      residual: [],
    });
  });

  it("declares the short keys its filters take in URLs", () => {
    expect(
      Object.entries(bucket.facts).map(([name, { param }]) => [name, param]),
    ).toEqual([
      ["status", "status"],
      ["eventType", "event"],
      ["lastError.name", "errorname"],
      ["errorKey", "error"],
    ]);
  });

  it("is the Outbox tab of its service's Events page", () => {
    expect(bucket.page).toEqual({
      id: "events",
      label: "GAS events",
      shortLabel: "Events",
    });
    expect(bucket.tab).toBe("Outbox");
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
    expect(choosePlan(bucket, ["status", "errorKey"], false)).toMatchObject({
      kind: "exact",
      residual: [],
    });
  });

  it("groups by status, and draws the status as a badge", () => {
    expect(bucket.groupings).toEqual(["status"]);
    expect(bucket.title).toEqual({ label: "Event", format: "eventType" });
    expect(bucket.columns).toEqual([
      { key: "status", label: "Status", format: "badge", fact: "status" },
    ]);
  });

  it("projects only the envelope's id from the event", () => {
    expect(bucket.row.projection).toEqual({
      eventType: 1,
      status: 1,
      completionDate: 1,
      "event.id": 1,
    });
  });

  it("presents a row linked to its event page", () => {
    expect(
      bucket.row.present({
        _id: ObjectId.createFromHexString(ID),
        eventType: "case.create",
        status: "COMPLETED",
        completionDate: "2026-10-09T09:14:04.000Z",
        event: { id: "0b7c1d1e-0000-4000-8000-000000000001" },
      }),
    ).toEqual({
      title: "case.create",
      subtitle: "0b7c1d1e-0000-4000-8000-000000000001",
      cells: {
        status: "COMPLETED",
        completedAt: "2026-10-09T09:14:04.000Z",
      },
      link: { kind: "event", service: "gas", box: "outbox", id: ID },
    });
  });

  it("presents null for what a row does not hold, never dropping the row", () => {
    expect(
      bucket.row.present({
        _id: ObjectId.createFromHexString(ID),
        status: "DEAD_LETTER",
      }),
    ).toMatchObject({
      title: null,
      subtitle: null,
      cells: { status: "DEAD_LETTER", completedAt: null },
    });
  });
});
