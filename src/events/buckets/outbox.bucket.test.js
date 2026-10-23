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
      lead: ["eventType"],
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
        { value: "Audit", label: "Audit", hidden: true },
        { value: "case.create", label: "case.create" },
        { value: "Unrecognised", label: "Unrecognised" },
      ],
      toggle: { label: "Show audit events" },
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

  it("leads every index key with the event type", () => {
    expect(bucket.lead).toEqual(["eventType"]);
    expect(indexKeysOf(bucket).map(Object.keys)).toEqual([
      ["eventType", "publicationDate", "_id"],
      ["eventType", "status", "publicationDate", "_id"],
      ["eventType", "status", "lastError.name", "publicationDate", "_id"],
      ["eventType", "status", "errorKey", "publicationDate", "_id"],
      ["eventType", "refs", "publicationDate", "_id"],
    ]);
  });

  it("reads every list exactly while audit rows are hidden, by filling the visible types", () => {
    expect(choosePlan(bucket, [], false)).toEqual({
      kind: "exact",
      line: [],
      filled: ["eventType"],
      residual: [],
    });
    expect(choosePlan(bucket, ["status"], false)).toEqual({
      kind: "exact",
      line: ["status"],
      filled: ["eventType"],
      residual: [],
    });
    expect(choosePlan(bucket, ["eventType"], false)).toMatchObject({
      kind: "exact",
      line: [],
      filled: [],
    });
    expect(choosePlan(bucket, ["status", "eventType"], false)).toMatchObject({
      kind: "exact",
      filled: [],
    });
    expect(choosePlan(bucket, [], true)).toMatchObject({
      kind: "exact",
      line: "refs",
      filled: ["eventType"],
    });
    expect(scansOf(bucket, ["status"], ["status"])).toBe(3);
  });

  it("reads them exactly with audit rows shown, by filling every type", () => {
    const shown = ["eventType"];

    expect(choosePlan(bucket, [], false, shown).kind).toBe("exact");
    expect(choosePlan(bucket, ["status"], false, shown).kind).toBe("exact");
    expect(choosePlan(bucket, [], true, shown).kind).toBe("exact");
    expect(scansOf(bucket, ["status"], ["status"], shown)).toBe(4);
  });

  it("declares the short keys its filters and its switch take in URLs", () => {
    expect(
      Object.entries(bucket.facts).map(([name, { param, toggle }]) => [
        name,
        param,
        toggle?.param ?? null,
      ]),
    ).toEqual([
      ["status", "status", null],
      ["eventType", "event", "audit"],
      ["lastError.name", "errorname", null],
      ["errorKey", "error", null],
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
    expect(
      choosePlan(bucket, ["status", "errorKey"], false, ["eventType"]),
    ).toMatchObject({ kind: "exact", residual: [] });
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
