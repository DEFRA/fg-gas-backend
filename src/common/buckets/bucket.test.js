import { describe, expect, it } from "vitest";
import {
  BUCKET_ID,
  STORED,
  defineBucket,
  indexKeysOf,
  keyOf,
  summaryLineOf,
  toIso,
  toStoredTime,
} from "./bucket.js";
import { REFS } from "./plan.js";
import { ledBucket, testBucket } from "./test-bucket.js";

describe("BUCKET_ID", () => {
  it.each(["gas.outbox", "cw.cases", "gas.case-notes2"])("matches %s", (id) => {
    expect(BUCKET_ID.test(id)).toBe(true);
  });

  it.each(["GAS.Outbox", "outbox", "gas.", "gas.out box", "gas.1st"])(
    "does not match %s",
    (id) => {
      expect(BUCKET_ID.test(id)).toBe(false);
    },
  );
});

describe("defineBucket", () => {
  it("returns the frozen definition with its defaults", () => {
    const bucket = testBucket();

    expect(Object.isFrozen(bucket)).toBe(true);
    expect(Object.isFrozen(bucket.facts.status.values)).toBe(true);
    expect(bucket.facts.grantCode).toEqual({
      label: "Grant",
      values: null,
      toggle: null,
      param: "grant",
    });
    expect(bucket.audited).toBe(false);
    expect(bucket.timeline).toBe(false);
  });

  it("defaults lead, refs, indexes, groupings and columns to empty", () => {
    const bucket = defineBucket({
      id: "test.plain",
      path: "test/plain",
      collection: "plain",
      time: { field: "createdAt", type: "isoString", label: "Created" },
    });

    expect(bucket).toMatchObject({
      lead: [],
      facts: {},
      refs: {},
      indexes: [],
      groupings: [],
      columns: [],
    });
  });

  it.each([
    ["no path", { path: undefined }],
    ["a path with a leading slash", { path: "/test/outbox" }],
    ["a path with capitals", { path: "Test/Outbox" }],
    ["a path with an empty segment", { path: "test//outbox" }],
    ["a path with a dot", { path: "test.outbox" }],
  ])("refuses %s", (_, overrides) => {
    expect(() => testBucket(overrides)).toThrow(
      'Bucket "test.outbox" has a missing or malformed path',
    );
  });

  it("accepts a path of words joined by slashes", () => {
    expect(testBucket({ path: "events/gas/outbox" }).path).toBe(
      "events/gas/outbox",
    );
  });

  it.each([
    ["a fact with no URL key", { grantCode: { label: "Grant" } }],
    [
      "a fact with a capitalised URL key",
      { grantCode: { label: "Grant", param: "Grant" } },
    ],
    [
      "a fact with a reserved URL key",
      { grantCode: { label: "Grant", param: "from" } },
    ],
  ])("refuses %s", (_, facts) => {
    expect(() =>
      testBucket({ facts: { ...testBucket().facts, ...facts } }),
    ).toThrow(
      "has a fact or toggle without a URL key of its own, or with a reserved one",
    );
  });

  it("refuses one URL key used twice", () => {
    expect(() =>
      testBucket({
        facts: {
          ...testBucket().facts,
          grantCode: { label: "Grant", param: "status" },
        },
      }),
    ).toThrow("uses one URL key twice");
  });

  it("refuses a malformed id", () => {
    expect(() => testBucket({ id: "Test.Outbox" })).toThrow(
      'Bucket "Test.Outbox" has a malformed id',
    );
  });

  it.each([
    "ref",
    "from",
    "to",
    "range",
    "cursor",
    "searched",
    "limit",
    "groupBy",
  ])("refuses a fact named %s", (name) => {
    expect(() =>
      testBucket({
        facts: { [name]: { label: "Reserved" } },
        indexes: [],
        groupings: [],
        columns: [],
      }),
    ).toThrow("names a fact with a reserved name");
  });

  it("refuses an index line that names an undeclared fact", () => {
    expect(() =>
      testBucket({ indexes: [["status"], ["colour"], ["code"]] }),
    ).toThrow("has an index line that names an undeclared fact");
  });

  it("refuses a grouping that names an undeclared fact", () => {
    expect(() => testBucket({ groupings: ["colour"] })).toThrow(
      "has a grouping that names an undeclared fact",
    );
  });

  it("refuses a grouping on an open fact", () => {
    expect(() => testBucket({ groupings: ["grantCode"] })).toThrow(
      "has a grouping with no closed or stored values",
    );
  });

  it("refuses a stored fact that leads no index line", () => {
    expect(() =>
      testBucket({ indexes: [["status"], ["status", "code"]] }),
    ).toThrow("has a stored fact that leads no index line");
  });

  it("refuses a stored fact behind a lead", () => {
    expect(() =>
      ledBucket({
        facts: { ...ledBucket().facts, code: testBucket().facts.code },
        indexes: [["code"]],
        groupings: [],
      }),
    ).toThrow("has a stored fact that leads no index line");
  });

  it("refuses a lead that names an undeclared fact", () => {
    expect(() => testBucket({ lead: ["colour"] })).toThrow(
      "leads with an undeclared fact",
    );
  });

  it.each(["grantCode", "code"])(
    "refuses a lead on %s, which has no closed values",
    (fact) => {
      expect(() => testBucket({ lead: [fact] })).toThrow(
        "leads with a fact without closed values",
      );
    },
  );

  it("keeps a fact's toggle and the values it hides", () => {
    const { toggle, values } = ledBucket().facts.eventType;

    expect(toggle).toEqual({ label: "Show audit events", param: "audit" });
    expect(values.filter(({ hidden }) => hidden)).toEqual([
      { value: "audit", label: "audit", hidden: true },
    ]);
  });

  it.each([
    ["an open fact", { values: undefined }],
    ["a stored fact", { values: STORED }],
  ])("refuses a toggle on %s", (_, overrides) => {
    expect(() =>
      testBucket({
        facts: {
          shown: {
            label: "Shown",
            param: "shown",
            toggle: { label: "Show hidden", param: "hidden" },
            ...overrides,
          },
        },
        indexes: [],
        groupings: [],
        columns: [],
      }),
    ).toThrow("has a toggle on a fact without closed values");
  });

  it("refuses a hidden value on a fact with no toggle to show it", () => {
    const { toggle: _, ...eventType } = ledBucket().facts.eventType;

    expect(() =>
      ledBucket({ facts: { ...ledBucket().facts, eventType } }),
    ).toThrow("hides a value of a fact that has no toggle to show it");
  });

  it("refuses a fact named show", () => {
    expect(() =>
      testBucket({
        facts: { show: { label: "Reserved" } },
        indexes: [],
        groupings: [],
        columns: [],
      }),
    ).toThrow("names a fact with a reserved name");
  });

  it("refuses two equal index lines", () => {
    expect(() =>
      testBucket({ indexes: [["status"], ["code"], ["status"]] }),
    ).toThrow("declares the same index line twice");
  });

  it("refuses a declared time-only line", () => {
    expect(() => testBucket({ indexes: [[], ["code"]] })).toThrow(
      "declares the same index line twice",
    );
  });

  it.each(["grantCode", "code", "colour"])(
    "refuses a badge column on %s, which has no closed values",
    (fact) => {
      expect(() =>
        testBucket({
          columns: [{ key: fact, label: "Badge", format: "badge", fact }],
        }),
      ).toThrow("has a badge column that names a fact without closed values");
    },
  );

  describe("a summary", () => {
    const summary = {
      id: "errors",
      label: "Errors",
      by: ["grantCode"],
      among: { status: "DEAD_LETTER" },
      top: 20,
      none: "None recorded",
    };
    const indexes = [["status"], ["status", "grantCode"], ["code"]];

    it("is declared with the index line that reads it", () => {
      const bucket = testBucket({ indexes, summaries: [summary] });

      expect(bucket.summaries).toEqual([summary]);
      expect(summaryLineOf(summary)).toEqual(["status", "grantCode"]);
      expect(Object.isFrozen(bucket.summaries[0].among)).toBe(true);
    });

    it("is none unless declared", () => {
      expect(testBucket().summaries).toEqual([]);
    });

    it.each([
      ["by an undeclared fact", { by: ["colour"] }],
      ["among an undeclared fact", { among: { colour: "red" } }],
    ])("is refused %s", (_, overrides) => {
      expect(() =>
        testBucket({ indexes, summaries: [{ ...summary, ...overrides }] }),
      ).toThrow("has a summary that names an undeclared fact");
    });

    it("is refused among a fact without closed values", () => {
      expect(() =>
        testBucket({
          indexes: [["status"], ["code"], ["code", "grantCode"]],
          summaries: [{ ...summary, among: { code: "x" } }],
        }),
      ).toThrow("has a summary among a fact without closed values");
    });

    it("is refused on a bucket that hides values of a fact it does not lead with", () => {
      expect(() =>
        testBucket({
          indexes,
          facts: {
            ...testBucket().facts,
            status: {
              label: "Status",
              param: "status",
              values: [
                { value: "DEAD_LETTER", label: "Dead letter" },
                { value: "HIDDEN", label: "Hidden", hidden: true },
              ],
              toggle: { label: "Show hidden", param: "hidden" },
            },
          },
          summaries: [summary],
        }),
      ).toThrow(
        "has a summary, and hides values of a fact it does not lead with",
      );
    });

    it("is refused counting by no fact", () => {
      expect(() =>
        testBucket({ indexes, summaries: [{ ...summary, by: [] }] }),
      ).toThrow("has a summary that counts by no fact");
    });

    it("reads its line without the facts the lead already puts in front", () => {
      expect(
        summaryLineOf({ ...summary, by: ["grantCode", "eventType"] }, [
          "eventType",
        ]),
      ).toEqual(["status", "grantCode"]);
    });

    it("is refused without an index line of its own", () => {
      expect(() => testBucket({ summaries: [summary] })).toThrow(
        "has a summary with no index line of its own",
      );
    });

    it("is refused on an audited bucket", () => {
      expect(() =>
        testBucket({ indexes, summaries: [summary], audited: true }),
      ).toThrow("is audited and declares a summary");
    });
  });

  it("refuses a lead with more values than one read may scan", () => {
    const values = Array.from({ length: 50 }, (_, n) => ({
      value: `type-${n}`,
      label: `Type ${n}`,
    }));

    expect(() =>
      ledBucket({
        facts: {
          eventType: { label: "Event", values },
          status: testBucket().facts.status,
        },
        indexes: [["status"]],
        groupings: ["status"],
        columns: [],
      }),
    ).toThrow("leads with more values than one read may scan");
  });

  describe("a page", () => {
    const page = { id: "events", label: "Test events", shortLabel: "Events" };

    it("is declared with the tab the bucket is on it", () => {
      expect(testBucket({ page, tab: "Outbox" })).toMatchObject({
        page,
        tab: "Outbox",
      });
    });

    it("is none unless declared", () => {
      expect(testBucket()).toMatchObject({ page: null, tab: null });
    });

    it.each([
      ["a page with no tab", { page }],
      ["a tab with no page", { tab: "Outbox" }],
    ])("is refused as %s", (_, overrides) => {
      expect(() => testBucket(overrides)).toThrow(
        "declares a page without a tab, or a tab without a page",
      );
    });
  });

  it("refuses a bucket that is both audited and timeline", () => {
    expect(() => testBucket({ audited: true, timeline: true })).toThrow(
      "is both audited and timeline",
    );
  });

  it("refuses a ref kind declared both as a search and as a link", () => {
    expect(() => testBucket({ links: ["ref"] })).toThrow(
      "declares a ref kind both as a search and as a link",
    );
  });

  it("accepts a stored fact", () => {
    expect(testBucket().facts.code.values).toBe(STORED);
  });
});

describe("keyOf", () => {
  const bucket = testBucket();

  it("holds the line, then the time and the id", () => {
    expect(Object.entries(keyOf(bucket, ["status", "eventType"]))).toEqual([
      ["status", 1],
      ["eventType", 1],
      ["publicationDate", -1],
      ["_id", -1],
    ]);
  });

  it("puts refs where the facts go", () => {
    expect(Object.entries(keyOf(bucket, REFS))).toEqual([
      ["refs", 1],
      ["publicationDate", -1],
      ["_id", -1],
    ]);
  });

  it("holds only the time and the id for the time-only line", () => {
    expect(keyOf(bucket, [])).toEqual({ publicationDate: -1, _id: -1 });
  });

  it("puts the lead before the line and before refs", () => {
    const led = ledBucket();

    expect(Object.keys(keyOf(led, ["status"]))).toEqual([
      "eventType",
      "status",
      "publicationDate",
      "_id",
    ]);
    expect(Object.keys(keyOf(led, REFS))).toEqual([
      "eventType",
      "refs",
      "publicationDate",
      "_id",
    ]);
  });
});

describe("indexKeysOf", () => {
  it("lists the time-only key, each line and the refs key", () => {
    const bucket = testBucket();

    expect(indexKeysOf(bucket)).toEqual([
      keyOf(bucket, []),
      keyOf(bucket, ["status"]),
      keyOf(bucket, ["status", "eventType"]),
      keyOf(bucket, ["code"]),
      keyOf(bucket, REFS),
    ]);
  });
});

describe("toIso", () => {
  it("answers the ISO string of a Date", () => {
    expect(toIso(new Date("2026-10-09T09:00:00.000Z"))).toBe(
      "2026-10-09T09:00:00.000Z",
    );
  });

  it("answers the ISO string of a date string", () => {
    expect(toIso("2026-10-09T09:00:00Z")).toBe("2026-10-09T09:00:00.000Z");
  });

  it.each([null, undefined])("answers null for %s", (value) => {
    expect(toIso(value)).toBeNull();
  });
});

describe("toStoredTime", () => {
  it("answers a Date for a date bucket", () => {
    expect(toStoredTime(testBucket(), "2026-10-09T09:00:00Z")).toEqual(
      new Date("2026-10-09T09:00:00.000Z"),
    );
  });

  it("answers the ISO string for an isoString bucket", () => {
    const bucket = testBucket({
      time: { field: "createdAt", type: "isoString", label: "Created" },
    });

    expect(toStoredTime(bucket, "2026-10-09T09:00:00Z")).toBe(
      "2026-10-09T09:00:00.000Z",
    );
  });
});
