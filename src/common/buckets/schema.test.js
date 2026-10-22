import { describe, expect, it } from "vitest";
import {
  MAX_GROUPINGS,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  TIMELINE_LIMIT,
  catalogueEntrySchema,
  queryRequestSchema,
  queryResponseSchema,
  summaryRequestSchema,
  summaryResponseSchema,
  timelineRequestSchema,
  timelineResponseSchema,
} from "./schema.js";

const response = () => ({
  bucket: "test.outbox",
  plan: {
    kind: "exact",
    index: ["publicationDate", "_id"],
    bound: [],
    filled: [],
    residual: [],
    scans: 1,
  },
  rows: [
    {
      id: "66f000000000000000000001",
      time: "2026-10-09T09:14:03.120Z",
      title: "case.update.status",
      subtitle: null,
      cells: {
        status: "DEAD_LETTER",
        position: { phase: "PRE_AWARD", stage: "REVIEW", status: "IN_REVIEW" },
        total: 1200,
        completedAt: null,
      },
      link: { kind: "event", service: "gas", box: "outbox", id: "1" },
    },
  ],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: "status",
      values: [{ value: "PUBLISHED", count: 0, capped: false }],
      total: { count: 10000, capped: true },
    },
    {
      by: "source",
      values: [{ value: "AS", count: 1, capped: false }],
      total: { count: 1, capped: false },
    },
    { by: "code", values: null, total: null },
  ],
});

const entry = () => ({
  id: "test.outbox",
  path: "test/outbox",
  label: "Test outbox",
  service: "Test",
  shortLabel: "Outbox",
  icon: null,
  order: 10,
  noun: { one: "event", many: "events" },
  time: { label: "Created" },
  facts: [
    {
      name: "status",
      param: "status",
      label: "Status",
      values: [{ value: "PUBLISHED", label: "Queued", tone: "neutral" }],
      toggle: null,
    },
    {
      name: "source",
      param: "source",
      label: "Source",
      values: [{ value: "AS", label: "Agreement service" }],
      toggle: null,
    },
    {
      name: "grantCode",
      param: "grant",
      label: "Grant",
      values: null,
      toggle: null,
    },
  ],
  refs: [{ kind: "ref", label: "Reference" }],
  indexes: [[], ["status"]],
  groupings: ["status"],
  title: { label: "Event", format: "eventType" },
  columns: [
    { key: "status", label: "Status", format: "badge", fact: "status" },
    { key: "grantCode", label: "Grant", format: "mono" },
  ],
  audited: false,
  timeline: true,
  summaries: [],
  page: null,
  tab: null,
});

describe("constants", () => {
  it("pages by 20, up to 100, with at most 3 groupings", () => {
    expect(PAGE_SIZE).toBe(20);
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(MAX_GROUPINGS).toBe(3);
  });
});

describe("queryRequestSchema", () => {
  it.each([undefined, null, {}])("reads %j as the empty query", (body) => {
    expect(queryRequestSchema.validate(body).value).toEqual({
      where: {},
      show: [],
      limit: 20,
      groupBy: [],
    });
  });

  it("accepts every key", () => {
    const body = {
      where: { status: "DEAD_LETTER", source: "AS" },
      show: ["eventType"],
      ref: "ref:abc-123-xyz",
      from: "2026-10-08T12:00:00.000Z",
      to: "2026-10-09T12:00:00.000Z",
      cursor: "eyJ0IjoiMjAyNi0xMC0wOVQwOTowMDowMC4wMDBaIn0",
      limit: 50,
      groupBy: ["status", "eventType"],
    };

    expect(queryRequestSchema.validate(body)).toEqual({ value: body });
  });

  it.each([
    ["an unknown key", { q: "text" }],
    ["a prefix search", { prefix: "abc" }],
    ["an empty filter value", { where: { status: "" } }],
    ["a numeric filter value", { where: { status: 1 } }],
    ["a boolean filter value", { where: { status: true } }],
    ["a list as a filter value", { where: { status: ["A", "B"] } }],
    ["a filter value over 200 characters", { where: { a: "x".repeat(201) } }],
    [
      "more than 8 filters",
      {
        where: Object.fromEntries([..."abcdefghi"].map((name) => [name, "x"])),
      },
    ],
    ["a ref over 256 characters", { ref: "x".repeat(257) }],
    ["a from that is not a date", { from: "yesterday" }],
    ["a to that is not a date", { to: "tomorrow" }],
    ["a cursor over 512 characters", { cursor: "x".repeat(513) }],
    ["a limit of zero", { limit: 0 }],
    ["a limit over the maximum", { limit: 101 }],
    ["a key it does not know", { total: true }],
    ["more than 3 groupings", { groupBy: ["a", "b", "c", "d"] }],
  ])("refuses %s", (_, body) => {
    expect(queryRequestSchema.validate(body).error).toBeDefined();
  });
});

describe("queryResponseSchema", () => {
  it("accepts an exact answer", () => {
    expect(queryResponseSchema.validate(response()).error).toBeUndefined();
  });

  it("accepts a bounded answer", () => {
    const bounded = {
      ...response(),
      rows: [],
      page: {
        next: null,
        keepLooking: "eyJ0Ijoi",
        searchedTo: "2026-09-03T10:12:00.000Z",
        complete: false,
      },
      groups: [],
    };

    expect(queryResponseSchema.validate(bounded).error).toBeUndefined();
  });

  it("accepts a row with no link, title or subtitle", () => {
    const [row] = response().rows;
    const bare = {
      ...response(),
      rows: [{ ...row, title: null, subtitle: null, link: null }],
    };

    expect(queryResponseSchema.validate(bare).error).toBeUndefined();
  });

  it.each(["bucket", "plan", "rows", "page", "groups"])(
    "refuses an answer without %s",
    (key) => {
      const { [key]: _, ...rest } = response();

      expect(queryResponseSchema.validate(rest).error).toBeDefined();
    },
  );

  it.each(["id", "time", "title", "subtitle", "cells", "link"])(
    "refuses a row without %s",
    (key) => {
      const [{ [key]: _, ...row }] = response().rows;

      expect(
        queryResponseSchema.validate({ ...response(), rows: [row] }).error,
      ).toBeDefined();
    },
  );

  it("refuses a link without a kind", () => {
    const [row] = response().rows;

    expect(
      queryResponseSchema.validate({
        ...response(),
        rows: [{ ...row, link: { id: "1" } }],
      }).error,
    ).toBeDefined();
  });
});

describe("catalogueEntrySchema", () => {
  it("accepts an entry", () => {
    expect(catalogueEntrySchema.validate(entry()).error).toBeUndefined();
  });

  it("accepts a format it has not seen", () => {
    const next = {
      ...entry(),
      title: { label: "Event", format: "sparkline" },
      columns: [{ key: "trend", label: "Trend", format: "sparkline" }],
    };

    expect(catalogueEntrySchema.validate(next).error).toBeUndefined();
  });

  it.each(Object.keys(entry()))("refuses an entry without %s", (key) => {
    const { [key]: _, ...rest } = entry();

    expect(catalogueEntrySchema.validate(rest).error).toBeDefined();
  });

  it.each([
    ["a toggle", { label: "Show hidden", param: "hidden" }, false],
    ["a toggle with no label", { param: "hidden" }, true],
    ["a toggle with no URL key", { label: "Show hidden" }, true],
    [
      "a toggle with a key it does not know",
      { label: "Show", param: "hidden", off: 1 },
      true,
    ],
  ])("%s on a fact: refused is %s", (_, toggle, refused) => {
    const [status, source, ...facts] = entry().facts;
    const toggled = {
      ...entry(),
      facts: [status, { ...source, toggle }, ...facts],
    };

    expect(Boolean(catalogueEntrySchema.validate(toggled).error)).toBe(refused);
  });

  it("accepts a value marked hidden", () => {
    const [status, ...facts] = entry().facts;
    const hiding = {
      ...entry(),
      facts: [
        {
          ...status,
          values: [{ value: "A", label: "A", hidden: true }],
          toggle: { label: "Show A", param: "a" },
        },
        ...facts,
      ],
    };

    expect(catalogueEntrySchema.validate(hiding).error).toBeUndefined();
  });

  it.each([
    ["Not needed yet.", false],
    ["", true],
    [1, true],
  ])("a value with the hint %j: refused is %s", (hint, refused) => {
    const [status, ...facts] = entry().facts;
    const hinted = {
      ...entry(),
      facts: [
        { ...status, values: [{ value: "A", label: "A", hint }] },
        ...facts,
      ],
    };

    expect(Boolean(catalogueEntrySchema.validate(hinted).error)).toBe(refused);
  });

  it("refuses a tone it does not know", () => {
    const [status, ...facts] = entry().facts;
    const loud = {
      ...entry(),
      facts: [
        { ...status, values: [{ value: "A", label: "A", tone: "loud" }] },
        ...facts,
      ],
    };

    expect(catalogueEntrySchema.validate(loud).error).toBeDefined();
  });
});

describe("the timeline schemas", () => {
  const [row] = response().rows;

  it("answers 50 rows from each bucket", () => {
    expect(TIMELINE_LIMIT).toBe(50);
  });

  it.each([
    ["a ref", { ref: "ref:abc-123" }, false],
    [
      "a case link longer than a search may be",
      { ref: `case:w:${"~41.".repeat(70)}` },
      false,
    ],
    ["a ref longer than any link", { ref: `ref:${"a".repeat(4096)}` }, true],
    ["no ref", {}, true],
    ["another key", { ref: "ref:abc-123", limit: 10 }, true],
  ])("reads a request with %s: refused is %s", (_, body, refused) => {
    expect(Boolean(timelineRequestSchema.validate(body).error)).toBe(refused);
  });

  it("accepts a bucket with rows and one that could not be read", () => {
    const answer = {
      buckets: [
        { id: "test.outbox", label: "Test outbox", rows: [row], more: true },
        { id: "test.inbox", label: "Test inbox", rows: null, more: false },
      ],
    };

    expect(timelineResponseSchema.validate(answer).error).toBeUndefined();
  });

  it.each(["id", "label", "rows", "more"])(
    "refuses a bucket without its %s",
    (key) => {
      const { [key]: _, ...bucket } = {
        id: "test.outbox",
        label: "Test outbox",
        rows: [],
        more: false,
      };

      expect(
        timelineResponseSchema.validate({ buckets: [bucket] }).error,
      ).toBeDefined();
    },
  );
});

describe("summaries", () => {
  const declared = {
    id: "errors",
    label: "Errors",
    by: ["errorKey", "eventType"],
    among: { status: "DEAD_LETTER" },
    top: 20,
    none: "No error recorded",
  };
  const answer = () => ({
    bucket: "gas.outbox",
    summary: "errors",
    entries: [
      {
        values: { errorKey: "TimeoutError: <v> timed out", eventType: "Sent" },
        count: 100000,
        capped: true,
        firstAt: "2026-10-01T08:00:00.000Z",
        lastAt: "2026-10-09T09:14:03.120Z",
      },
      {
        values: { errorKey: null, eventType: null },
        count: 2,
        capped: false,
        firstAt: null,
        lastAt: null,
      },
    ],
    more: false,
    complete: true,
  });

  it("reads no body as a summary over all time", () => {
    expect(summaryRequestSchema.validate(undefined).value).toEqual({
      show: [],
    });
    expect(summaryRequestSchema.validate(null).value).toEqual({ show: [] });
  });

  it("accepts a time range and the facts to show hidden values of", () => {
    const body = {
      show: ["eventType"],
      from: "2026-10-08T12:00:00.000Z",
      to: "2026-10-09T12:00:00.000Z",
    };

    expect(summaryRequestSchema.validate(body)).toEqual({ value: body });
  });

  it.each([
    ["a from that is not a date", { from: "yesterday" }],
    ["a key it does not know", { where: {} }],
  ])("refuses %s", (_, body) => {
    expect(summaryRequestSchema.validate(body).error).toBeDefined();
  });

  it("accepts an answer, with an entry for the rows that hold no value", () => {
    expect(summaryResponseSchema.validate(answer()).error).toBeUndefined();
  });

  it.each(["bucket", "summary", "entries", "more", "complete"])(
    "refuses an answer without %s",
    (key) => {
      const { [key]: _, ...rest } = answer();

      expect(summaryResponseSchema.validate(rest).error).toBeDefined();
    },
  );

  it("accepts a catalogue entry that declares one", () => {
    expect(
      catalogueEntrySchema.validate({ ...entry(), summaries: [declared] })
        .error,
    ).toBeUndefined();
  });

  it.each(["id", "label", "by", "among", "top", "none"])(
    "refuses a declared summary without %s",
    (key) => {
      const { [key]: _, ...rest } = declared;

      expect(
        catalogueEntrySchema.validate({ ...entry(), summaries: [rest] }).error,
      ).toBeDefined();
    },
  );
});

describe("a catalogue entry's page", () => {
  it("accepts a page with the tab the bucket is on it", () => {
    const paged = {
      ...entry(),
      page: { id: "events", label: "Test events", shortLabel: "Events" },
      tab: "Outbox",
    };

    expect(catalogueEntrySchema.validate(paged).error).toBeUndefined();
  });

  it.each(["page", "tab"])("refuses an entry without %s", (key) => {
    const { [key]: _, ...rest } = entry();

    expect(catalogueEntrySchema.validate(rest).error).toBeDefined();
  });
});

describe("a catalogue entry's URL keys", () => {
  it("refuses a fact without one", () => {
    const [status, ...facts] = entry().facts;
    const { param: _, ...keyless } = status;

    expect(
      catalogueEntrySchema.validate({ ...entry(), facts: [keyless, ...facts] })
        .error,
    ).toBeDefined();
  });
});
