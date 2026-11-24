import { BSON } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDocuments,
  fetchPart,
} from "../../common/explore/document-fetch.js";
import {
  START_PRINTED,
  startOf as cutStart,
} from "../../common/explore/document-start.js";
import { ONE_DOCUMENT_ALLOWANCE } from "../../common/explore/query-schema.js";
import { refusalOf, refuseQuery } from "../../common/explore/refusal.js";
import {
  fetchedInOrder,
  inRounds,
  withShownDocument,
  withStarts,
  withoutDocuments,
} from "./documents.js";

vi.mock("../../common/explore/document-fetch.js", async (actual) => ({
  ...(await actual()),
  fetchDocuments: vi.fn(),
  fetchPart: vi.fn(),
}));

const own = {
  name: "events",
  size: "big",
  added: {},
  boxes: [
    { id: "gas.outbox", service: "GAS", box: "outbox" },
    { id: "gas.inbox", service: "GAS", box: "inbox" },
  ],
};

const idOf = (n) => BSON.serialize({ _id: n }).toString("base64");

const docOf = (bytes) =>
  BSON.serialize({ x: "x".repeat(Math.max(0, bytes - 14)) }).toString("base64");

// A document of `n` values: a list of n - 1 numbers.
const valuesDoc = (n) =>
  BSON.serialize({ a: Array.from({ length: n - 1 }, (_, m) => m) }).toString(
    "base64",
  );

const bytesOf = (doc) => Buffer.byteLength(doc, "base64");

// A document's start as GAS sends it.
const startOfDoc = (doc) => {
  const start = cutStart(Buffer.from(doc, "base64"));

  return { ...start, doc: start.doc.toString("base64") };
};

const listed = (n, size, box = "gas.outbox", at = []) => ({
  open: { kind: "event", id: `e${n}` },
  cells: { c0: `r${n}` },
  fetch: { box, id: idOf(n), at, size },
});

const whole = {
  v: 4,
  source: "events",
  mode: "rows",
  columns: [{ path: "status" }],
  where: null,
  unwind: [],
  groupBy: null,
  orderBy: { path: "status", fn: null, desc: false },
  limit: 50,
  positions: { "gas.outbox": "x" },
  documents: { whole: true, id: true },
};

const projected = { ...whole, documents: { whole: false, id: true } };

const entryOf = (row, more) => ({
  box: row.fetch.box,
  id: row.fetch.id,
  at: row.fetch.at,
  context: null,
  ...more,
});

let run;

beforeEach(() => {
  run = {
    source: { name: "events" },
    own,
    meter: { deadline: Date.now() + 10_000, spent: 0, budget: 100 },
    cwPart: vi.fn(),
  };
});

// The fetch answers each row asked that has an entry with it.
const answering = (entries) =>
  fetchDocuments.mockImplementation(async (_source, _query, { rows }) =>
    rows
      .map((one) =>
        entries.find(({ box, id }) => box === one.box && id === one.id),
      )
      .filter(Boolean),
  );

const askedIds = (call) => call[2].rows.map(({ id }) => id);

// GAS's starts fetch answers each row asked that has an entry with it, up
// to the first without, and then what ended it.
const answeringStarts = (entries, ended = "time") =>
  fetchPart.mockImplementation(async (_source, { rows }) => {
    const found = rows.map((one) =>
      entries.find(({ box, id }) => box === one.box && id === one.id),
    );
    const read = found.indexOf(undefined);

    return read === -1
      ? { documents: found }
      : { documents: found.slice(0, read), ended };
  });

describe("withShownDocument", () => {
  it("prints Show it's one row whole, up to the one-document allowance", async () => {
    const rows = [listed(1, 30)];
    const doc = docOf(30);

    answering([entryOf(rows[0], { doc })]);

    const answer = await withShownDocument({ rows }, { query: whole, run });

    expect(fetchDocuments.mock.calls[0][2].bytes).toBe(
      ONE_DOCUMENT_ALLOWANCE.bytes,
    );
    expect(answer.rows[0]).toMatchObject({
      open: { kind: "event", id: "e1" },
      id: idOf(1),
      doc,
      start: { doc, cut: false },
      docNote: null,
      context: null,
    });
    expect(answer.rows[0]).not.toHaveProperty("fetch");
    expect(answer.documents).toEqual({ whole: true, bytes: 2 * bytesOf(doc) });
  });

  it("cuts the start of a large document for its line, sending the document whole", async () => {
    const rows = [listed(1, 10)];
    const doc = valuesDoc(120_000);

    answering([entryOf(rows[0], { doc })]);

    const answer = await withShownDocument({ rows }, { query: whole, run });
    const { start } = answer.rows[0];

    expect(answer.rows[0].doc).toBe(doc);
    expect(start).toEqual(startOfDoc(doc));
    expect(start.cut).toBe(true);
    expect(bytesOf(start.doc)).toBeLessThan(START_PRINTED * 4);
    expect(answer.documents.bytes).toBe(bytesOf(doc) + bytesOf(start.doc));
  });

  it("says the bytes and values of a document past the allowance", async () => {
    const big = valuesDoc(ONE_DOCUMENT_ALLOWANCE.values + 1);
    const rows = [listed(1, 10)];

    answering([entryOf(rows[0], { doc: big })]);

    const answer = await withShownDocument({ rows }, { query: projected, run });

    expect(answer.rows[0]).toMatchObject({
      doc: null,
      start: startOfDoc(big),
      docNote: {
        later: bytesOf(big),
        values: ONE_DOCUMENT_ALLOWANCE.values + 1,
      },
    });
    expect(answer.documents.bytes).toBe(bytesOf(startOfDoc(big).doc));
  });

  it("charges the records joined beside the row", async () => {
    const rows = [listed(1, 10)];
    const doc = docOf(20);
    const definition = docOf(60);

    answering([entryOf(rows[0], { doc, context: { definition } })]);

    const answer = await withShownDocument({ rows }, { query: projected, run });

    expect(answer.rows[0]).toMatchObject({ doc, context: { definition } });
    expect(answer.documents.bytes).toBe(2 * bytesOf(doc) + bytesOf(definition));
  });

  it.each([
    ["gone", { gone: true }],
    ["too large to make", { tooLarge: true }],
  ])("says a row's document is %s", async (_, note) => {
    const rows = [listed(1, 30)];

    answering([entryOf(rows[0], note)]);

    const answer = await withShownDocument({ rows }, { query: whole, run });

    expect(answer.rows[0]).toMatchObject({
      doc: null,
      start: null,
      docNote: note,
    });
    expect(answer.documents.bytes).toBe(0);
  });

  it("says a record changed since it was found, keeping its document", async () => {
    const rows = [listed(1, 30)];
    const doc = docOf(30);

    answering([entryOf(rows[0], { doc, changed: true })]);

    const answer = await withShownDocument({ rows }, { query: whole, run });

    expect(answer.rows[0]).toMatchObject({ doc, docNote: { changed: true } });
  });

  it("fails rather than show a row the fetch left out", async () => {
    fetchDocuments.mockResolvedValue([]);

    await expect(
      withShownDocument({ rows: [listed(1, 30)] }, { query: whole, run }),
    ).rejects.toThrow("left out a row");
  });

  it("keeps the allowance the decisions set", () => {
    expect(ONE_DOCUMENT_ALLOWANCE).toEqual({
      bytes: 16 * 1024 * 1024,
      values: 250_000,
    });
  });
});

describe("fetchedInOrder", () => {
  it("asks again for a row a round couldn't hold", async () => {
    const rows = [listed(1, 10), listed(2, 10), listed(3, 10)];
    let call = 0;

    fetchDocuments.mockImplementation(async (_source, _query, asked) => {
      call += 1;

      return asked.rows.map((one, n) =>
        call === 1 && n > 0
          ? { ...one, unread: true, context: null }
          : { ...one, doc: docOf(30), context: null },
      );
    });

    const settled = [];

    for await (const { row } of fetchedInOrder(rows, {
      query: projected,
      run,
      next: inRounds,
      bytes: () => 1000,
    })) {
      settled.push(row);
    }

    expect(fetchDocuments.mock.calls.map(askedIds)).toEqual([
      [idOf(1), idOf(2), idOf(3)],
      [idOf(2), idOf(3)],
    ]);
    expect(settled).toEqual(rows);
  });

  it("asks for twice as many rows after a round that held every one, twice as many as it settled after one that didn't", () => {
    const rows = Array.from({ length: 300 }, (_, n) => listed(n, 10));

    expect(inRounds(rows, 0, null)).toHaveLength(50);
    expect(
      inRounds(rows, 50, { asked: 50, settled: 50, unread: false }),
    ).toHaveLength(100);
    expect(
      inRounds(rows, 150, { asked: 100, settled: 60, unread: true }),
    ).toHaveLength(120);
  });
});

describe("withStarts", () => {
  const starts = {
    ...whole,
    documents: { whole: true, id: true, mode: "starts" },
  };
  const startOf = (n) => ({
    doc: BSON.serialize({ n }).toString("base64"),
    cut: false,
  });
  const printed = { bytes: 100, values: 3 };
  const started = (row, n) => entryOf(row, { start: startOf(n), printed });
  const windowed = (rows) => ({ rows, read: "windowed", partial: false });
  const shorterOf = (rows) =>
    vi.fn((n) => ({ ...windowed(rows.slice(0, n)), window: { to: n } }));

  it("gives each record row its start, from GAS's boxes and Caseworking's at once", async () => {
    const rows = [
      listed(1, 40, "gas.outbox"),
      listed(2, 40, "cw.inbox", [3]),
      listed(3, 40, "cw.outbox", [0]),
    ];

    answeringStarts([started(rows[0], 1)]);
    run.cwPart.mockResolvedValue({
      documents: [
        { ...started(rows[1], 2), changed: true },
        entryOf(rows[2], { gone: true }),
      ],
    });

    const answer = await withStarts(windowed(rows), {
      query: starts,
      run,
      shorter: shorterOf(rows),
    });

    expect(fetchPart).toHaveBeenCalledTimes(1);
    expect(run.cwPart.mock.calls[0][0]).toMatchObject({
      mode: "documents",
      documents: { whole: true, id: true, mode: "starts" },
      rows: [
        { box: "cw.inbox", id: idOf(2), at: [3] },
        { box: "cw.outbox", id: idOf(3), at: [0] },
      ],
    });
    expect(run.cwPart.mock.calls[0][0].documents).not.toHaveProperty("bytes");
    expect(answer.rows).toEqual([
      {
        open: { kind: "event", id: "e1" },
        cells: { c0: "r1" },
        id: idOf(1),
        at: [],
        start: startOf(1),
        printed,
        context: { service: "GAS", box: "outbox" },
        docNote: null,
      },
      expect.objectContaining({
        start: startOf(2),
        context: { service: "CW", box: "inbox" },
        docNote: { changed: true },
      }),
      expect.objectContaining({
        start: null,
        printed: null,
        docNote: { gone: true },
      }),
    ]);
    expect(answer.partial).toBe(false);
    expect(answer.documents).toEqual({
      whole: true,
      bytes: 2 * bytesOf(startOf(1).doc),
    });
  });

  it("ends a windowed page at the first row not read, in the page's order", async () => {
    const rows = [
      listed(1, 40, "gas.outbox"),
      listed(2, 40, "cw.inbox"),
      listed(3, 40, "gas.outbox"),
    ];
    const shorter = shorterOf(rows);

    answeringStarts([started(rows[0], 1), started(rows[2], 3)]);
    run.cwPart.mockResolvedValue({ documents: [], ended: "time" });

    const answer = await withStarts(windowed(rows), {
      query: starts,
      run,
      shorter,
    });

    expect(shorter).toHaveBeenCalledWith(1);
    expect(answer.rows.map(({ id }) => id)).toEqual([idOf(1)]);
    expect(answer).toMatchObject({ partial: true, window: { to: 1 } });
  });

  it("ends the page at Caseworking's first row when Caseworking refuses out of time", async () => {
    const rows = [
      listed(1, 40, "gas.outbox"),
      listed(2, 40, "gas.inbox"),
      listed(3, 40, "cw.inbox"),
    ];
    const shorter = shorterOf(rows);

    answeringStarts([started(rows[0], 1), started(rows[1], 2)]);
    run.cwPart.mockRejectedValue(
      Object.assign(refuseQuery("TOO_SLOW"), { service: "CW" }),
    );

    const answer = await withStarts(windowed(rows), {
      query: starts,
      run,
      shorter,
    });

    expect(shorter).toHaveBeenCalledWith(2);
    expect(answer.rows.map(({ id }) => id)).toEqual([idOf(1), idOf(2)]);
    expect(answer).toMatchObject({ partial: true, window: { to: 2 } });
  });

  it("fails a page when Caseworking fails other than out of time or work", async () => {
    const rows = [listed(1, 40, "gas.outbox"), listed(2, 40, "cw.inbox")];
    const failed = new Error("CW-BE explore failed: ERRORED");

    answeringStarts([started(rows[0], 1)]);
    run.cwPart.mockRejectedValue(failed);

    const error = await withStarts(windowed(rows), {
      query: starts,
      run,
      shorter: shorterOf(rows),
    }).catch((caught) => caught);

    expect(error).toBe(failed);
  });

  it.each([
    ["GAS's", "gas.outbox", "time", "TOO_SLOW", undefined],
    ["GAS's, out of work", "gas.outbox", "work", "TOO_COSTLY", undefined],
    ["Caseworking's", "cw.inbox", "time", "TOO_SLOW", "CW"],
    ["Caseworking's, out of work", "cw.inbox", "work", "TOO_COSTLY", "CW"],
  ])(
    "refuses a page whose first row, %s, wasn't read",
    async (_, box, ended, refusal, service) => {
      const rows = [listed(1, 40, box)];

      answeringStarts([], ended);
      run.cwPart.mockResolvedValue({ documents: [], ended });

      const error = await withStarts(windowed(rows), {
        query: starts,
        run,
        shorter: shorterOf(rows),
      }).catch((caught) => caught);

      expect(refusalOf(error)).toBe(refusal);
      expect(error.service).toBe(service);
    },
  );

  it("refuses an exact read it can't read whole, which has no way on", async () => {
    const rows = [listed(1, 40), listed(2, 40)];

    answeringStarts([started(rows[0], 1)]);

    const error = await withStarts(
      { rows, read: "exact" },
      { query: starts, run, shorter: shorterOf(rows) },
    ).catch((caught) => caught);

    expect(refusalOf(error)).toBe("TOO_SLOW");
  });

  it("gives a group's, a value's or a count's row the start of its document, counting both", async () => {
    const doc = docOf(30);
    const group = { open: null, cells: { c0: "A" }, id: null, doc };

    const answer = await withStarts(
      { rows: [group], read: "exact" },
      { query: starts, run, shorter: vi.fn() },
    );

    expect(answer.rows).toEqual([{ ...group, start: { doc, cut: false } }]);
    expect(answer.documents.bytes).toBe(2 * bytesOf(doc));
    expect(fetchPart).not.toHaveBeenCalled();
    expect(run.cwPart).not.toHaveBeenCalled();
  });

  it("cuts a large group's start, leaving its document whole", async () => {
    const doc = valuesDoc(120_000);
    const group = { open: null, cells: { c0: "A" }, id: null, doc };

    const answer = await withStarts(
      { rows: [group], read: "exact" },
      { query: starts, run, shorter: vi.fn() },
    );

    expect(answer.rows[0].doc).toBe(doc);
    expect(answer.rows[0].start).toEqual(startOfDoc(doc));
    expect(answer.rows[0].start.cut).toBe(true);
  });
});

describe("withoutDocuments", () => {
  it("leaves each row what it shows, and no documents", () => {
    expect(withoutDocuments({ rows: [listed(1, 30)], mode: "rows" })).toEqual({
      rows: [{ open: { kind: "event", id: "e1" }, cells: { c0: "r1" } }],
      mode: "rows",
      documents: null,
    });
  });
});
