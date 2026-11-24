import { BSON, BSONRegExp } from "mongodb";
import { describe, expect, it } from "vitest";
import { shapeValue } from "./evaluate.js";
import { START_BYTES } from "./document-start.js";
import { checkDocuments, checkPart, sentBytes } from "./large-answers.js";

const row = (n) => ({
  key: { t: "2026-10-13T10:00:00.000Z", i: `${n}` },
  open: { kind: "case", code: "w", ref: `r${n}` },
  cells: { ref: `r${n}`, n, list: ["a", 1], none: null },
  order: null,
});

const part = (rows, groups = null) => ({
  read: "exact",
  boxes: [
    {
      id: "cw.cases",
      rows,
      to: null,
      end: true,
      count: { n: rows.length, capped: false },
    },
  ],
  groups,
});

const failure = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

describe("checkPart", () => {
  it("reads a part of 5,000 rows, its rows as they were", async () => {
    const rows = Array.from({ length: 5000 }, (_, n) => row(n));

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads lists inside lists, 8 deep, in each of 20 cells", async () => {
    const deep = [[[[[[[["a", null]]]]]]], 1];
    const cells = Object.fromEntries(
      Array.from({ length: 20 }, (_, n) => [`c${n}`, deep]),
    );
    const rows = [{ ...row(0), cells, order: [1, [2]] }];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads an exact decimal", async () => {
    const rows = [{ ...row(1), order: { x: "9007199254740993" } }];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads an object's cell as its text, alone or in a list", async () => {
    const rows = [
      { ...row(0), cells: { x: { text: "{ a: 1 }" }, y: [{ text: "{}" }] } },
    ];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
  });

  it("reads a list inside a list whole, as deep as mongod nests them", async () => {
    const nested = (depth) =>
      Array.from({ length: depth }).reduce((inner) => [inner], "a");
    const shown = shapeValue(nested(100));
    const cellOf = (value) => [{ ...row(0), cells: { x: value } }];

    expect((await checkPart(part(cellOf(shown)))).boxes[0].rows).toEqual(
      cellOf(shown),
    );
    expect(await failure(checkPart(part(cellOf(nested(201)))))).toMatchObject({
      details: [{ path: ["boxes", 0, "rows", 0], type: "item" }],
    });
  });

  it("reads a row's typed _id, positions and size", async () => {
    const rows = [
      {
        ...row(0),
        id: "FgAAAAdfaWQAawBxbH0D4hmgu1sSAA==",
        at: [3, null],
        size: 120,
      },
    ];

    expect((await checkPart(part(rows))).boxes[0].rows).toBe(rows);
    expect(
      await failure(checkPart(part([{ ...rows[0], at: [-1] }]))),
    ).toMatchObject({ details: [{ path: ["boxes", 0, "rows", 0] }] });
    expect(
      await failure(checkPart(part([{ ...rows[0], size: 17 * 1024 * 1024 }]))),
    ).toMatchObject({ details: [{ path: ["boxes", 0, "rows", 0] }] });
  });

  it("reads groups", async () => {
    const groups = [
      { key: "a", value: "A", n: 2, aggs: { "count(*)": 2, "max(x)": null } },
    ];

    expect((await checkPart(part([], groups))).groups).toEqual(groups);
  });

  it("reads values sent typed, to sort and merge by", async () => {
    const typed = [
      { n: "NaN" },
      { b: true },
      { d: "2026-10-01T00:00:00.000Z" },
      { o: "65f000000000000000000001" },
      { k: [["a", [1, { b: false }]]] },
      { i: 5 },
      { f: "-0" },
      { l: "9007199254740993" },
      { e: BSON.serialize({ v: new BSONRegExp("a", "i") }).toString("base64") },
    ];
    const rows = typed.map((order, n) => ({ ...row(n), order }));
    const groups = [
      { key: "a", value: { b: true }, n: 1, aggs: { "sum(x)": [1.5, 0] } },
    ];

    expect((await checkPart(part(rows, groups))).groups).toEqual(groups);
  });

  it.each([
    ["two tags", { b: true, d: "2026-10-01" }],
    ["an unknown tag", { x: 1 }],
    ["a boolean that isn't one", { b: "true" }],
    ["a time that isn't one", { d: "soon" }],
    ["an id that isn't one", { o: "zz" }],
    ["a number that isn't one", { n: "1" }],
    ["an object's entry that isn't a pair", { k: [["a"]] }],
    [
      "an object deeper than mongod nests one",
      Array.from({ length: 401 }).reduce((inner) => ({ k: [["a", inner]] }), 1),
    ],
    ["an Int32 that isn't an integer", { i: 1.5 }],
    ["a Long that isn't one", { l: "1.5" }],
    ["a Double that isn't one", { f: "five" }],
    [
      "a BSON value of more than v",
      { e: BSON.serialize({ v: 1, w: 2 }).toString("base64") },
    ],
    ["a BSON value that isn't BSON", { e: "AAAA" }],
  ])("refuses an order of %s", async (_, order) => {
    const error = await failure(checkPart(part([{ ...row(0), order }])));

    expect(error.details).toEqual([
      { path: ["boxes", 0, "rows", 0], type: "item" },
    ]);
  });

  it.each([
    ["a cell that is an object", { ...row(1), cells: { x: { $gt: "" } } }],
    ["an order of no decimal", { ...row(1), order: { x: "abc" } }],
    [
      "an order of too many digits",
      { ...row(1), order: { x: `${"1".repeat(40)}e0` } },
    ],
    [
      "an order of a decimal out of range",
      { ...row(1), order: { x: "1e9999" } },
    ],
    [
      "an object's cell with more than its text",
      { ...row(1), cells: { x: { text: "{}", more: 1 } } },
    ],
    [
      "a list deeper than mongod nests one",
      {
        ...row(1),
        cells: {
          x: Array.from({ length: 201 }).reduce((inner) => [inner], "a"),
        },
      },
    ],
    ["a key without an id", { ...row(1), key: { t: null } }],
    ["an open that isn't an object", { ...row(1), open: "x" }],
    ["a row that isn't an object", "row"],
  ])("refuses %s, naming where", async (_, bad) => {
    const error = await failure(checkPart(part([row(0), bad])));

    expect(error.details).toEqual([
      { path: ["boxes", 0, "rows", 1], type: "item" },
    ]);
  });

  it("refuses what the schema refuses outside the rows", async () => {
    expect(
      await failure(checkPart({ ...part([]), read: "sideways" })),
    ).toMatchObject({
      details: [expect.objectContaining({ path: ["read"] })],
    });
  });

  it("reads where a download's exact read was cut, never a window's", async () => {
    const cutAfter = {
      key: { ...row(1).key, box: "cw.cases" },
      order: { d: "2026-10-13T10:00:00.000Z" },
    };

    expect(
      (await checkPart({ ...part([row(0), row(1)]), cutAfter })).cutAfter,
    ).toEqual(cutAfter);
    expect(
      await failure(checkPart({ ...part([]), read: "windowed", cutAfter })),
    ).toMatchObject({
      details: [expect.objectContaining({ path: ["cutAfter"] })],
    });
    expect(
      await failure(
        checkPart({ ...part([]), cutAfter: { key: row(1).key, order: null } }),
      ),
    ).toMatchObject({
      details: [expect.objectContaining({ path: ["cutAfter", "key", "box"] })],
    });
  });

  it("refuses a group it can't read", async () => {
    const error = await failure(
      checkPart(part([], [{ key: {}, value: "A", n: 1, aggs: {} }])),
    );

    expect(error.details).toEqual([{ path: ["groups", 0], type: "item" }]);
  });
});

describe("checkDocuments", () => {
  const idOf = (_id) => BSON.serialize({ _id }).toString("base64");
  const id = idOf(1);
  const doc = (value) => BSON.serialize({ value }).toString("base64");
  const entry = (more) => ({
    box: "cw.inbox",
    id,
    at: [],
    context: null,
    ...more,
  });
  const askedFor = (entries) =>
    entries.map(({ box, id: rowId, at }) => ({ box, id: rowId, at }));
  const answer = (documents) => ({ documents });
  const check = (documents, bytes = 1024, asked = askedFor(documents)) =>
    checkDocuments(answer(documents), { bytes, asked });

  it("reads documents, and rows it couldn't send", async () => {
    const documents = [
      entry({ doc: doc("a"), changed: true }),
      entry({ gone: true }),
      entry({ unread: true }),
      entry({ tooLarge: true }),
    ];

    expect(await check(documents)).toEqual(answer(documents));
    expect(
      await checkPart(answer(documents), {
        query: {
          mode: "documents",
          documents: { bytes: 1024 },
          rows: askedFor(documents),
        },
      }),
    ).toEqual(answer(documents));
  });

  it("checks an answer by what was asked: a rows part to a fetch is refused", async () => {
    await expect(
      checkPart(
        { read: "exact", groups: null, boxes: [] },
        {
          query: {
            mode: "documents",
            documents: { bytes: 1024 },
            rows: [entry({})],
          },
        },
      ),
    ).rejects.toMatchObject({ details: [{ path: [] }] });
  });

  it.each([
    ["a document that isn't BSON", entry({ doc: "AAAA" })],
    ["a document cut short", entry({ doc: doc("a").slice(0, 8) })],
    ["a row with no document and no note", entry({})],
    ["a row with two notes", entry({ gone: true, unread: true })],
    ["a note no fetch gives", entry({ later: 5 })],
    ["an id that isn't text", entry({ id: 5, doc: doc("a") })],
    ["a document beside a note", entry({ doc: doc("a"), gone: true })],
    [
      "a joined record that isn't BSON",
      entry({ doc: doc("a"), context: { definition: "AAAA" } }),
    ],
    [
      "a service that isn't text",
      entry({ doc: doc("a"), context: { service: 1 } }),
    ],
  ])("refuses %s", async (_, bad) => {
    await expect(check([bad], 1024, [entry({})])).rejects.toMatchObject({
      details: [{ path: ["documents", 0] }],
    });
  });

  it.each([
    ["another row's", entry({ id: idOf(2), gone: true })],
    ["another box's", entry({ box: "cw.outbox", gone: true })],
    ["another element's", entry({ at: [1], gone: true })],
  ])(
    "refuses an entry for %s than the row asked in its place",
    async (_, bad) => {
      await expect(check([bad], 1024, [entry({})])).rejects.toMatchObject({
        details: [{ path: ["documents", 0] }],
      });
    },
  );

  it("refuses an answer that doesn't hold the first row asked", async () => {
    await expect(
      check([entry({ unread: true }), entry({ gone: true })]),
    ).rejects.toMatchObject({ details: [{ path: ["documents", 0] }] });
  });

  it("reads a joined record as stored, or none", async () => {
    const documents = [
      entry({ doc: doc("a"), context: { definition: doc("d") } }),
      entry({ doc: doc("a"), context: { agreement: null } }),
      entry({ doc: doc("a"), context: { service: "CW", box: "inbox" } }),
    ];

    expect(await check(documents)).toEqual(answer(documents));
  });

  it("refuses an answer with more or fewer entries than rows asked", async () => {
    const one = entry({ gone: true });

    await expect(check([one], 1024, [])).rejects.toMatchObject({
      details: [{ type: "length" }],
    });
    await expect(check([], 1024, [one])).rejects.toMatchObject({
      details: [{ type: "length" }],
    });
  });

  it("refuses more bytes than were asked for, documents and joined records, past one row's", async () => {
    const big = doc("x".repeat(2000));
    const joined = entry({ doc: doc("a"), context: { definition: big } });

    expect(await check([entry({ doc: big })], 10)).toEqual(
      answer([entry({ doc: big })]),
    );
    await expect(
      check([entry({ doc: big }), entry({ doc: doc("a") })], 2020),
    ).rejects.toMatchObject({ details: [{ type: "bytes" }] });
    await expect(
      check([joined, entry({ doc: doc("a") })], 2020),
    ).rejects.toMatchObject({ details: [{ type: "bytes" }] });
  });
});

describe("checkStarts", () => {
  const idOf = (_id) => BSON.serialize({ _id }).toString("base64");
  const startOf = (value, cut = true) => ({
    doc: BSON.serialize({ value }).toString("base64"),
    cut,
  });
  const printed = { bytes: 5000, values: 3 };
  const entry = (n, more) => ({
    box: "cw.inbox",
    id: idOf(n),
    at: [],
    ...more,
  });
  const asked = [1, 2, 3].map((n) => entry(n, {}));
  const fetch = {
    mode: "documents",
    documents: { whole: true, id: true, mode: "starts" },
    rows: asked,
  };
  const ended = (documents, why = "time") => ({ documents, ended: why });
  const check = (documents, more = ended(documents)) =>
    checkPart(more, { query: fetch });

  it("reads starts, the rows gone or too large, up to where the fetch ended and why", async () => {
    const documents = [
      entry(1, { start: startOf("a"), printed, changed: true }),
      entry(2, { start: { ...startOf("b"), quotedKey: true }, printed }),
    ];
    const noted = [entry(1, { gone: true }), entry(2, { tooLarge: true })];
    const all = asked.map((one) => ({ ...one, gone: true }));

    expect(await check(documents)).toEqual(ended(documents));
    expect(await check(noted, ended(noted, "work"))).toEqual(
      ended(noted, "work"),
    );
    expect(await check([])).toEqual(ended([]));
    expect(await check(all, { documents: all })).toEqual({ documents: all });
  });

  it.each([
    ["no reason for fewer entries than asked", { documents: [] }],
    ["an unknown reason", ended([], "money")],
    [
      "a reason beside every row",
      ended(asked.map((one) => ({ ...one, gone: true }))),
    ],
  ])("refuses %s", async (_, answer) => {
    await expect(check(answer.documents, answer)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: ["ended"] })],
    });
  });

  it.each([
    [
      "more entries than rows asked",
      [...asked, entry(4, {})].map((one) => ({ ...one, gone: true })),
    ],
    ["a row out of order", [entry(2, { gone: true })]],
    [
      "a start that isn't BSON",
      [entry(1, { start: { doc: "AAAA", cut: true }, printed })],
    ],
    [
      "a start over START_BYTES",
      [entry(1, { start: startOf("x".repeat(START_BYTES)), printed })],
    ],
    ["a start without what it printed", [entry(1, { start: startOf("a") })]],
    [
      "a start beside a note",
      [entry(1, { start: startOf("a"), printed, gone: true })],
    ],
    [
      "a start with a context",
      [entry(1, { start: startOf("a"), printed, context: null })],
    ],
    ["an unread row", [entry(1, { unread: true })]],
    ["a whole document", [entry(1, { doc: startOf("a").doc })]],
    [
      "a quotedKey that isn't true",
      [entry(1, { start: { ...startOf("a"), quotedKey: false }, printed })],
    ],
  ])("refuses %s", async (_, documents) => {
    await expect(check(documents)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: expect.any(Array) })],
    });
  });

  it("counts a start's bytes as sent", () => {
    const start = startOf("a");

    expect(
      sentBytes([entry(1, { start, printed }), entry(2, { gone: true })]),
    ).toBe(Buffer.byteLength(start.doc, "base64"));
  });
});

describe("sentBytes", () => {
  it("counts each sent document and the records joined beside it, never a row without one or where an event was read", () => {
    const doc = BSON.serialize({ a: 1 }).toString("base64");
    const definition = BSON.serialize({ b: "xy" }).toString("base64");
    const bytes = (text) => Buffer.byteLength(text, "base64");

    expect(
      sentBytes([
        { doc, context: { service: "GAS", box: "outbox" } },
        { doc, context: { definition } },
        { gone: true, context: { definition } },
      ]),
    ).toBe(2 * bytes(doc) + bytes(definition));
  });
});
