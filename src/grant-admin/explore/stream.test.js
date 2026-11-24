import { BSON } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { fetchDocuments } from "../../common/explore/document-fetch.js";
import { refuseQuery } from "../../common/explore/refusal.js";
import { downloadEnding, downloadLines } from "./stream.js";

vi.mock("../../common/explore/document-fetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDocuments: vi.fn(),
}));

vi.mock("../../common/explore/query-schema.js", async (importOriginal) => ({
  ...(await importOriginal()),
  DOWNLOAD_BYTES: 100,
}));

const idOf = (n) => BSON.serialize({ _id: n }).toString("base64");

const docOf = (bytes) =>
  BSON.serialize({ x: "x".repeat(Math.max(0, bytes - 14)) }).toString("base64");

const listed = (n, size = 40) => ({
  open: { kind: "application", ref: `r${n}` },
  cells: { c0: `r${n}` },
  fetch: { box: "gas.applications", id: idOf(n), at: [], size },
});

const answerOf = (rows, stopped = null) => ({
  source: { name: "applications" },
  mode: "rows",
  read: "exact",
  columns: [],
  count: { n: rows.length, capped: false },
  groups: false,
  unwound: false,
  unseen: [],
  partial: false,
  limits: { rows: 5000, raise: "limit" },
  window: null,
  rows,
  download: { rows: 5000, stopped, searchedTo: null },
});

const run = {
  own: {
    name: "applications",
    size: "small",
    service: "GAS",
    collection: "applications",
    time: "createdAt",
  },
  meter: { deadline: Date.now() + 10_000 },
  gone: null,
};

const projected = { documents: { whole: false, id: true } };

const linesOf = async (answer, query = projected) => {
  const ending = downloadEnding();
  const lines = [];

  for await (const line of downloadLines(answer, { query, run, ending })) {
    lines.push(line);
  }

  return { lines, ending };
};

const answering = (doc) =>
  fetchDocuments.mockImplementation(async (_source, _query, { rows }) =>
    rows.map((one) => ({ ...one, doc, context: null })),
  );

describe("downloadLines", () => {
  it("sends every row's document, a header first and an end last", async () => {
    answering(docOf(20));

    const { lines, ending } = await linesOf(answerOf([listed(1), listed(2)]));

    expect(lines.map((line) => Object.keys(line)[0])).toEqual([
      "header",
      "row",
      "row",
      "end",
    ]);
    expect(lines[1].row).toMatchObject({ id: idOf(1), docNote: null });
    expect(ending).toMatchObject({ sent: 2, stopped: null, done: true });
  });

  it("stops at the download's bytes, past the first row, never sending a row later", async () => {
    answering(docOf(40));

    const { lines, ending } = await linesOf(
      answerOf([listed(1), listed(2), listed(3)]),
    );

    expect(lines.filter(({ row }) => row)).toHaveLength(2);
    expect(lines.at(-1).end.stopped).toBe("bytes");
    expect(ending).toMatchObject({ sent: 2, stopped: "bytes" });
  });

  it.each([
    ["time", refuseQuery("TOO_SLOW"), null],
    ["error", new Error("mongod went away"), "mongod went away"],
  ])(
    "ends with stopped %s when a fetch fails",
    async (stopped, error, kept) => {
      fetchDocuments.mockRejectedValue(error);

      const { lines, ending } = await linesOf(answerOf([listed(1)]));

      expect(lines.at(-1).end.stopped).toBe(stopped);
      expect(ending.error?.message ?? null).toBe(kept);
    },
  );

  it("asks again for a row a round couldn't hold, never sending it later", async () => {
    let call = 0;

    fetchDocuments.mockImplementation(async (_source, _query, { rows }) => {
      call += 1;

      return rows.map((one, n) =>
        call === 1 && n > 0
          ? { ...one, unread: true, context: null }
          : { ...one, doc: docOf(10), context: null },
      );
    });

    const { lines } = await linesOf(answerOf([listed(1), listed(2)]));

    expect(fetchDocuments).toHaveBeenCalledTimes(2);
    expect(
      lines.filter(({ row }) => row).map(({ row }) => row.docNote),
    ).toEqual([null, null]);
  });

  it("says the answer's own stop at its end", async () => {
    answering(docOf(10));

    const { lines } = await linesOf(answerOf([listed(1)], "rows"));

    expect(lines.at(-1).end.stopped).toBe("rows");
  });
});
