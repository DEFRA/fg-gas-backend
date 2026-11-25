import { Decimal128 } from "mongodb";
import { describe, expect, it } from "vitest";
import { toEventHistory } from "./map-event-history.js";

const at = (minute, ms = 0) =>
  new Date(Date.UTC(2026, 5, 16, 10, minute, 0, ms)).toISOString();

const anAttempt = (minute, message = "boom") => ({
  at: at(minute),
  name: "TypeError",
  message,
  stack: "TypeError: boom\n    at x (x.js:1:1)",
});

const aDoc = (overrides = {}) => ({
  status: "DEAD_LETTER",
  publicationDate: at(0),
  completionDate: null,
  lastResubmissionDate: null,
  attemptHistory: [],
  event: { id: "evt-1", data: { a: 3 } },
  ...overrides,
});

const kinds = (history) => history.map(({ kind }) => kind);

describe("toEventHistory", () => {
  it("lists every kind newest first", () => {
    const history = toEventHistory(
      aDoc({
        status: "COMPLETED",
        attemptHistory: [anAttempt(1), anAttempt(7)],
        history: [
          { kind: "dead-lettered", at: at(2) },
          {
            kind: "purged",
            at: at(3),
            by: "Ada",
            reasonCode: "OTHER",
            note: "n",
          },
          {
            kind: "payload-edited",
            at: at(4),
            by: "Ada",
            note: null,
            before: { id: "evt-1", data: { a: 1 } },
          },
          { kind: "redriven", at: at(5), by: "Ada" },
        ],
        completionDate: at(8),
      }),
    );

    expect(kinds(history)).toEqual([
      "delivered",
      "attempt",
      "redriven",
      "payload-edited",
      "purged",
      "dead-lettered",
      "attempt",
      "received",
    ]);
    expect(history.at(-1)).toEqual({ kind: "received", at: at(0) });
    expect(history[0]).toEqual({ kind: "delivered", at: at(8) });
  });

  it("orders entries in one millisecond as a delivery or death ends them", () => {
    const same = at(5);
    const history = toEventHistory(
      aDoc({
        publicationDate: same,
        completionDate: same,
        attemptHistory: [{ ...anAttempt(5) }],
        history: [
          { kind: "payload-edited", at: same, by: "Ada", note: null },
          { kind: "redriven", at: same, by: "Ada" },
          {
            kind: "purged",
            at: same,
            by: "Ada",
            reasonCode: "OTHER",
            note: null,
          },
          { kind: "dead-lettered", at: same },
        ],
      }),
    );

    expect(kinds(history)).toEqual([
      "delivered",
      "dead-lettered",
      "attempt",
      "purged",
      "redriven",
      "payload-edited",
      "received",
    ]);
  });

  it("numbers every kept attempt from 1, across redrives", () => {
    const history = toEventHistory(
      aDoc({
        attemptHistory: [anAttempt(1, "one"), anAttempt(3, "two")],
        history: [{ kind: "redriven", at: at(2), by: "Ada" }],
        lastRedrive: { at: at(2), by: "Ada" },
      }),
    );

    expect(history.filter(({ kind }) => kind === "attempt")).toEqual([
      {
        kind: "attempt",
        at: at(3),
        number: 2,
        name: "TypeError",
        message: "two",
        stack: anAttempt(3).stack,
      },
      {
        kind: "attempt",
        at: at(1),
        number: 1,
        name: "TypeError",
        message: "one",
        stack: anAttempt(1).stack,
      },
    ]);
  });

  it("gives a completed row its receipt and its delivery", () => {
    expect(
      toEventHistory(aDoc({ status: "COMPLETED", completionDate: at(1) })),
    ).toEqual([
      { kind: "delivered", at: at(1) },
      { kind: "received", at: at(0) },
    ]);
  });

  it("dates a death stored before the history by the last failure", () => {
    expect(
      toEventHistory(
        aDoc({ completionAttempts: 5, lastResubmissionDate: at(4) }),
      ),
    ).toEqual([
      { kind: "dead-lettered", at: at(4) },
      { kind: "received", at: at(0) },
    ]);
  });

  it("derives a death on a purged row too, but never on a living one", () => {
    expect(
      kinds(
        toEventHistory(aDoc({ status: "PURGED", lastResubmissionDate: at(4) })),
      ),
    ).toContain("dead-lettered");
    expect(
      kinds(
        toEventHistory(
          aDoc({ status: "RESUBMITTED", lastResubmissionDate: at(4) }),
        ),
      ),
    ).not.toContain("dead-lettered");
  });

  it("derives no death when the history has one", () => {
    const history = toEventHistory(
      aDoc({
        lastResubmissionDate: at(4),
        history: [{ kind: "dead-lettered", at: at(6) }],
      }),
    );

    expect(history.filter(({ kind }) => kind === "dead-lettered")).toEqual([
      { kind: "dead-lettered", at: at(6) },
    ]);
  });

  it("derives a death since the last redrive past an earlier stored one", () => {
    const history = toEventHistory(
      aDoc({
        lastResubmissionDate: at(6),
        lastRedrive: { at: at(5), by: "Ada" },
        history: [
          { kind: "dead-lettered", at: at(4) },
          { kind: "redriven", at: at(5), by: "Ada" },
        ],
      }),
    );

    expect(
      history.filter(({ kind }) => kind === "dead-lettered").map((e) => e.at),
    ).toEqual([at(6), at(4)]);
  });

  it("derives no second death where the last failure is a stored death before the redrive", () => {
    const history = toEventHistory(
      aDoc({
        lastResubmissionDate: at(4),
        lastRedrive: { at: at(5), by: "Ada" },
        history: [
          { kind: "dead-lettered", at: at(4) },
          { kind: "redriven", at: at(5), by: "Ada" },
        ],
      }),
    );

    expect(
      history.filter(({ kind }) => kind === "dead-lettered").map((e) => e.at),
    ).toEqual([at(4)]);
  });

  describe("a row written before the history", () => {
    const legacy = aDoc({
      status: "PURGED",
      lastResubmissionDate: at(1),
      lastEdit: { at: at(2), by: "Ada", note: "fixed a" },
      originalPayload: { id: "evt-1", data: { a: 1 } },
      lastRedrive: { at: at(3), by: null },
      lastPurge: { at: at(4), by: "Bo", reasonCode: "OTHER", note: "gone" },
      payloadRevision: 3,
    });

    it("gets an entry from each last record it kept", () => {
      expect(toEventHistory(legacy)).toEqual([
        {
          kind: "purged",
          at: at(4),
          by: "Bo",
          reasonCode: "OTHER",
          note: "gone",
        },
        { kind: "redriven", at: at(3), by: "System" },
        {
          kind: "payload-edited",
          at: at(2),
          by: "Ada",
          note: "fixed a",
          before: null,
          after: null,
        },
        { kind: "dead-lettered", at: at(1) },
        { kind: "received", at: at(0) },
      ]);
    });

    it("gets no second entry where the history has the same one", () => {
      const history = toEventHistory({
        ...legacy,
        history: [
          { kind: "redriven", at: at(3), by: null },
          { kind: "purged", at: at(4), by: "Bo", reasonCode: "OTHER" },
          {
            kind: "payload-edited",
            at: at(2),
            by: "Ada",
            note: "fixed a",
            before: { id: "evt-1", data: { a: 2 } },
          },
        ],
      });

      expect(kinds(history)).toEqual([
        "purged",
        "redriven",
        "payload-edited",
        "dead-lettered",
        "received",
      ]);
      expect(history[2].before).toEqual({ id: "evt-1", data: { a: 2 } });
    });

    // A pod that predates the history redrives without writing an entry.
    it("gets an entry for a redrive the history missed", () => {
      const history = toEventHistory({
        ...legacy,
        lastRedrive: { at: at(9), by: "Ada" },
        history: [{ kind: "redriven", at: at(3), by: null }],
      });

      expect(
        history.filter(({ kind }) => kind === "redriven").map((e) => e.at),
      ).toEqual([at(9), at(3)]);
    });

    const legacyEdit = (payloadRevision) =>
      toEventHistory({
        ...aDoc(),
        lastEdit: { at: at(2), by: "Ada", note: "fixed a" },
        originalPayload: { id: "evt-1", data: { a: 1 } },
        payloadRevision,
      }).find(({ kind }) => kind === "payload-edited");

    it("diffs the original against the payload for a lone edit", () => {
      expect(legacyEdit(1)).toMatchObject({
        before: { id: "evt-1", data: { a: 1 } },
        after: { id: "evt-1", data: { a: 3 } },
      });
    });

    it("has no diff for the last of several edits, which the original predates", () => {
      expect(legacyEdit(2)).toMatchObject({ before: null, after: null });
    });
  });

  describe("payload diffs", () => {
    const anEdit = (minute, data) => ({
      kind: "payload-edited",
      at: at(minute),
      by: "Ada",
      note: null,
      ...(data && { before: { id: "evt-1", data } }),
    });

    const edits = (doc) =>
      toEventHistory(doc).filter(({ kind }) => kind === "payload-edited");

    it("takes each edit's after from the next edit's before, and the newest's from the payload", () => {
      expect(
        edits(aDoc({ history: [anEdit(1, { a: 1 }), anEdit(2, { a: 2 })] })),
      ).toEqual([
        expect.objectContaining({
          at: at(2),
          before: { id: "evt-1", data: { a: 2 } },
          after: { id: "evt-1", data: { a: 3 } },
        }),
        expect.objectContaining({
          at: at(1),
          before: { id: "evt-1", data: { a: 1 } },
          after: { id: "evt-1", data: { a: 2 } },
        }),
      ]);
    });

    it("has no diff for an edit past the 5 newest, whose before was dropped", () => {
      const history = Array.from({ length: 7 }, (_, n) =>
        anEdit(n + 1, n < 2 ? undefined : { a: n }),
      );
      const [newest, ...older] = edits(aDoc({ history }));

      expect(newest.before).not.toBeNull();
      expect(older.slice(0, 4).every(({ before }) => before !== null)).toBe(
        true,
      );
      expect(older.slice(4)).toEqual([
        expect.objectContaining({ at: at(2), before: null, after: null }),
        expect.objectContaining({ at: at(1), before: null, after: null }),
      ]);
    });

    it("serves BSON numbers as JSON an edit can send back", () => {
      const [edit] = edits(
        aDoc({
          event: { data: { a: Decimal128.fromString("1.10") } },
          history: [anEdit(1, { a: Decimal128.fromString("1.00") })],
        }),
      );

      expect(edit.before.data.a).toBe("1.00");
      expect(edit.after.data.a).toBe("1.10");
    });
  });

  it("rebuilds a stored entry from its declared keys only", () => {
    const [entry] = toEventHistory(
      aDoc({
        publicationDate: null,
        history: [{ kind: "redriven", at: at(1), by: "", claimedBy: "SECRET" }],
      }),
    );

    expect(entry).toEqual({ kind: "redriven", at: at(1), by: "System" });
  });

  it("leaves out an entry of a kind it does not know, and tolerates a malformed history", () => {
    expect(
      toEventHistory(
        aDoc({
          publicationDate: null,
          history: [{ kind: "teleported", at: at(1) }, null, "nope"],
        }),
      ),
    ).toEqual([]);
    expect(
      toEventHistory(aDoc({ publicationDate: null, history: "nope" })),
    ).toEqual([]);
  });
});
