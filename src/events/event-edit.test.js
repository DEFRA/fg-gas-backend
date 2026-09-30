import { describe, expect, it } from "vitest";
import {
  EDIT_REFUSAL_REASONS,
  PAYLOAD_MAX_BYTES,
  assertStorable,
  editConflict,
  editFailureReason,
  editRefusal,
  editUpdate,
  payloadRevisionOf,
  revisionFilter,
  staleEdit,
} from "./event-edit.js";

const AT = new Date("2026-09-23T14:08:00.000Z");

const anEdit = (overrides = {}) => ({
  event: { id: "evt-1", data: { sheetId: "SX0679" } },
  by: "donatas",
  note: "sheetId was sent as a number",
  revision: 0,
  original: { id: "evt-1", data: { sheetId: 679 } },
  at: AT,
  ...overrides,
});

const refusalOf = (payload) => {
  try {
    assertStorable(payload);
    return null;
  } catch (error) {
    return error.output.payload.reason;
  }
};

describe("editUpdate", () => {
  it("replaces the event, bumps the revision and records the edit", () => {
    expect(editUpdate(anEdit({ revision: 2, original: undefined }))).toEqual({
      $set: {
        event: { id: "evt-1", data: { sheetId: "SX0679" } },
        payloadRevision: 3,
        lastEdit: {
          at: AT.toISOString(),
          by: "donatas",
          note: "sheetId was sent as a number",
        },
      },
    });
  });

  it("keeps the original on the first edit", () => {
    expect(editUpdate(anEdit()).$set).toMatchObject({
      payloadRevision: 1,
      originalPayload: { id: "evt-1", data: { sheetId: 679 } },
    });
  });

  it("leaves the original alone when none is given", () => {
    expect(
      editUpdate(anEdit({ revision: 1, original: undefined })).$set,
    ).not.toHaveProperty("originalPayload");
  });

  // A purge or a redrive moves the revision on without an edit.
  it("keeps an original given past revision 0", () => {
    expect(editUpdate(anEdit({ revision: 1 })).$set).toMatchObject({
      payloadRevision: 2,
      originalPayload: { id: "evt-1", data: { sheetId: 679 } },
    });
  });

  it("sets the inbox columns it is given in the same write", () => {
    const { $set } = editUpdate(
      anEdit({
        inboxColumns: { type: "a.b", eventTime: "2026-09-23T10:00:00.000Z" },
      }),
    );

    expect($set.type).toBe("a.b");
    expect($set.eventTime).toBe("2026-09-23T10:00:00.000Z");
  });

  it("stores a null actor rather than inventing one", () => {
    expect(editUpdate(anEdit({ by: undefined })).$set.lastEdit.by).toBeNull();
  });

  it("stamps now when no time is given", () => {
    const before = Date.now();
    const { at } = editUpdate(anEdit({ at: undefined })).$set.lastEdit;

    expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
  });

  // Written by the edit alone, so no poller save can touch them.
  it("touches neither the status nor the attempts", () => {
    expect(Object.keys(editUpdate(anEdit()).$set)).toEqual([
      "event",
      "payloadRevision",
      "lastEdit",
      "originalPayload",
    ]);
  });
});

describe("payloadRevisionOf", () => {
  it("reads a missing counter as 0", () => {
    expect(payloadRevisionOf({})).toBe(0);
    expect(payloadRevisionOf(null)).toBe(0);
  });

  it("reads the stored counter", () => {
    expect(payloadRevisionOf({ payloadRevision: 4 })).toBe(4);
  });
});

describe("revisionFilter", () => {
  it("matches a missing, null or 0 counter for revision 0", () => {
    expect(revisionFilter(0)).toEqual({ $in: [null, 0] });
  });

  it("matches the counter itself after that", () => {
    expect(revisionFilter(3)).toBe(3);
  });
});

describe("staleEdit", () => {
  it("is a 412 naming the row", () => {
    const error = staleEdit("gas inbox", "abc");

    expect(error.output.statusCode).toBe(412);
    expect(error.message).toBe(
      'gas inbox event "abc" was edited since the revision given',
    );
  });
});

describe("editConflict", () => {
  it("is a 409 in an edit's own words, carrying the status", () => {
    const error = editConflict("gas inbox", "abc", "COMPLETED", "Completed");

    expect(error.output.statusCode).toBe(409);
    expect(error.message).toBe(
      'gas inbox event "abc" is COMPLETED, not editable (DEAD_LETTER or PURGED)',
    );
    expect(error.output.payload).toMatchObject({
      status: "COMPLETED",
      statusLabel: "Completed",
    });
  });
});

describe("editFailureReason", () => {
  it.each([
    [404, {}, "NOT_FOUND"],
    [409, { status: "COMPLETED" }, "NOT_EDITABLE"],
    [412, {}, "STALE"],
    [422, { reason: "DOLLAR_KEY" }, "DOLLAR_KEY"],
    [422, {}, null],
    [502, {}, null],
  ])("reads a %s %o as %s", (statusCode, payload, reason) => {
    expect(editFailureReason({ output: { statusCode, payload } })).toBe(reason);
  });

  it("is null for an error with no HTTP shape", () => {
    expect(editFailureReason(new Error("boom"))).toBeNull();
  });
});

describe("editRefusal", () => {
  it("is a 422 carrying the reason in its body", () => {
    const error = editRefusal(EDIT_REFUSAL_REASONS.UNCHANGED);

    expect(error.output.statusCode).toBe(422);
    expect(error.output.payload.reason).toBe("UNCHANGED");
  });
});

describe("assertStorable", () => {
  it("takes a plain object", () => {
    expect(refusalOf({ id: "evt-1", data: { a: [1, { b: 2 }] } })).toBeNull();
  });

  it.each([
    ["an array", [1]],
    ["a string", "text"],
    ["null", null],
    ["a number", 1],
  ])("refuses %s as NOT_AN_OBJECT", (_, payload) => {
    expect(refusalOf(payload)).toBe("NOT_AN_OBJECT");
  });

  it("refuses a payload over the bound, measured pretty-printed", () => {
    const text = "x".repeat(PAYLOAD_MAX_BYTES);

    expect(refusalOf({ text })).toBe("TOO_LARGE");
  });

  it("takes a payload exactly at the bound", () => {
    const overhead = JSON.stringify({ text: "" }, null, 2).length;
    const text = "x".repeat(PAYLOAD_MAX_BYTES - overhead);

    expect(refusalOf({ text })).toBeNull();
  });

  it("counts bytes, not characters", () => {
    const overhead = JSON.stringify({ text: "" }, null, 2).length;
    const text = "é".repeat((PAYLOAD_MAX_BYTES - overhead) / 2 + 1);

    expect(refusalOf({ text })).toBe("TOO_LARGE");
  });

  it.each([
    ["at the top", { $set: 1 }],
    ["nested", { data: { $where: "x" } }],
    ["inside an array", { data: [{ ok: 1 }, { $in: [] }] }],
  ])("refuses a $ key %s as DOLLAR_KEY", (_, payload) => {
    expect(refusalOf(payload)).toBe("DOLLAR_KEY");
  });

  it("takes a $ that does not start a key", () => {
    expect(refusalOf({ price$: "$5" })).toBeNull();
  });
});
