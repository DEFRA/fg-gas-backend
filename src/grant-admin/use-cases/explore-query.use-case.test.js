import { BSON, ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDocuments,
  fetchPart,
} from "../../common/explore/document-fetch.js";
import {
  decodePositions,
  encodePositions,
} from "../../common/explore/merge.js";
import { MAX_LIMIT } from "../../common/explore/query-schema.js";
import { asQueryPositions } from "../explore/csv.js";
import { refuseQuery } from "../../common/explore/refusal.js";
import { runPart } from "../../common/explore/run.js";
import {
  getRequestContext,
  withRequestContext,
} from "../../common/get-request-context.js";
import { logger } from "../../common/logger.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { registerGasExploreSources } from "../../../test/helpers/explore-sources.js";
import { ownSources } from "../explore/sources.js";
import { buildVocabulary } from "../explore/vocabulary.js";
import {
  cwExploreFailure,
  queryCwExplore,
} from "../repositories/cw-explore.repository.js";
import { exploreQueryResponseSchema } from "../schemas/explore.schema.js";
import { exploreQueryUseCase } from "./explore-query.use-case.js";
import { exploreVocabularyUseCase } from "./explore-vocabulary.use-case.js";
import {
  forgetExploreVocabulary,
  loadExploreValues,
  loadExploreVocabulary,
} from "./load-explore-vocabulary.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/explore/run.js");
vi.mock("../../common/explore/document-fetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchDocuments: vi.fn(),
  fetchPart: vi.fn(),
}));
vi.mock("../../events/write-audit-event.js");
vi.mock("../../common/with-transaction.js", () => ({
  transactionOptions: {},
  withTransaction: (work) => work({ session: true }),
}));
vi.mock("./load-explore-vocabulary.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadExploreVocabulary: vi.fn(),
  loadExploreValues: vi.fn(),
}));
vi.mock("./explore-vocabulary.use-case.js");
vi.mock("../repositories/cw-explore.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  queryCwExplore: vi.fn(),
}));

const SENTINEL = "Sentinel Farm 4417";
const SKIPPED = {
  open: { kind: "application", code: "g", ref: "r9" },
  id: "FgAAAAdfaWQAawBxbH0D4hmgu1sSAA==",
};
const ACTOR_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const known = (path, extra = {}) => ({
  path,
  type: "text",
  index: null,
  closed: false,
  within: null,
  ...extra,
});

const CW_SOURCES = {
  sources: [
    {
      name: "cases",
      label: "Cases, in Caseworking",
      service: "CW",
      size: "big",
      noun: { one: "case", many: "cases" },
      star: ["caseRef", "workflowCode", "currentStatus", "createdAt"],
      time: "createdAt",
      answersAt: "payload.answers",
      paths: [
        known("caseRef", { index: "ref", scans: 1 }),
        known("workflowCode", { index: "fact" }),
        known("currentStatus"),
        known("createdAt", { type: "date", index: "time", stored: "date" }),
      ],
    },
  ],
};

const ANSWERS = [
  { path: "applicant.business.name", type: "text" },
  { path: "parcels.parcelId", type: "text" },
];

const BUSINESS = "phases.answers.applicant.business.name";

const id = (n) => n.toString(16).padStart(24, "0");
const at = (minute) =>
  `2026-10-13T10:${String(minute).padStart(2, "0")}:00.000Z`;

const row = (minute, n, service = "GAS") => ({
  key: { t: at(minute), i: id(n) },
  open: { kind: "event", service, box: "outbox", id: id(n) },
  cells: { created: at(minute) },
  order: null,
});

const exactPart = (boxId, rows, n = rows.length) => ({
  read: "exact",
  groups: null,
  boxes: [
    { id: boxId, rows, to: null, end: true, count: { n, capped: false } },
  ],
});

const windowedPart = (boxId, rows, to, end = false) => ({
  read: "windowed",
  groups: null,
  boxes: [{ id: boxId, rows, to, end, count: null }],
});

const ask = (query, extra = {}, args = {}) =>
  exploreQueryUseCase({
    body: { query, ...extra },
    actorId: ACTOR_ID,
    actor: "Jo Operator",
    ...args,
  });

const failure = (promise) => promise.catch((error) => error);

const audits = () => writeAuditEvent.mock.calls.map(([event]) => event);

const logged = () =>
  JSON.stringify(
    ["info", "warn", "error", "debug"].flatMap(
      (level) => logger[level].mock.calls,
    ),
  );

const { exploreVocabularyUseCase: readVocabulary } = await vi.importActual(
  "./explore-vocabulary.use-case.js",
);

// Every answer and refusal carries the editor's vocabulary.
const VOCABULARY = { sources: [] };

let cw;

beforeEach(() => {
  registerGasExploreSources();
  forgetExploreVocabulary();
  cw = CW_SOURCES;
  loadExploreVocabulary.mockImplementation(async () =>
    buildVocabulary({
      own: ownSources(),
      answers: ANSWERS,
      cw,
      cwFailure: cw ? null : cwExploreFailure("TIMED_OUT"),
    }),
  );
  writeAuditEvent.mockResolvedValue();
  exploreVocabularyUseCase.mockResolvedValue(VOCABULARY);
});

describe("exploreQueryUseCase", () => {
  it("refuses a query that doesn't parse with where, reading and auditing nothing", async () => {
    const text = `db.applications.find({ '${BUSINESS}': '${SENTINEL}`;
    const error = await failure(ask(text));

    expect(error.output.statusCode).toBe(400);
    expect(error.output.payload).toEqual({
      statusCode: 400,
      reason: "QUERY_INVALID",
      error: {
        message: "This text isn’t closed: add '",
        at: text.lastIndexOf("'"),
        end: text.length,
      },
      vocabulary: VOCABULARY,
    });
    expect(runPart).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
    expect(error.message).not.toContain(SENTINEL);
    expect(error.data).toEqual({ logLevel: "info" });
  });

  it("reads a path no source suggests, and says it may be mistyped", async () => {
    runPart.mockResolvedValue(exactPart("gas.agreements", []));

    const answer = await ask(
      "db.agreements.find({}, { agreementNumber: 1, 'payload.bank.sortCode': 1, colour: 1 })",
    );

    expect(answer.unseen).toEqual(["payload.bank.sortCode", "colour"]);
    expect(runPart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["db.applications.find({ 'a..b': 1 })", "a..b"],
    ["db.applications.find({ _id: 'x' })", "_id"],
    ["db.applications.find({ _id: ObjectId('x') })", "_id"],
    ["db.cases.find({}, { 'a.$ref': 1 })", "$ref"],
  ])("refuses %s, reading and auditing nothing", async (text) => {
    const error = await failure(ask(text));

    expect(error.output.payload.reason).toBe("QUERY_INVALID");
    expect(runPart).not.toHaveBeenCalled();
    expect(queryCwExplore).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses a text bound on a time Caseworking stores as a date", async () => {
    const error = await failure(
      ask("db.cases.find({ createdAt: { $gte: '2026-11-01' } })"),
    );

    expect(error.output.payload.error.message).toBe(
      "createdAt is stored as a date: compare it with ISODate('2026-10-01')",
    );
  });

  it("checks without reading, and names the source", async () => {
    expect(await ask("db.payments.find()", { check: true })).toEqual({
      ok: true,
      source: "payments",
      vocabulary: VOCABULARY,
    });
    expect(runPart).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("reads GAS's own source, answers, and audits only that it was queried", async () => {
    runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)], 1));

    const answer = await ask(
      `db.applications.find({ code: 'grasslands', '${BUSINESS}': /${SENTINEL}/i }, { clientRef: 1, parcels: { $size: '$phases.answers.parcels.parcelId' } }) // ${SENTINEL}`,
    );

    expect(answer).toMatchObject({
      source: { name: "applications", noun: "application" },
      read: "exact",
      count: { n: 1, capped: false },
      groups: false,
      window: null,
      unseen: [],
      columns: [
        { key: "c0", label: "clientRef", kind: "text", aggregate: false },
        { key: "c1", label: "parcels", kind: "text", aggregate: true },
      ],
    });

    const [source, query] = runPart.mock.calls[0];

    expect(source.name).toBe("applications");
    expect(query).toMatchObject({ v: 4, limit: 50, positions: null });
    expect(query).not.toHaveProperty("answers");
    expect(query.where).toEqual({
      all: [
        { path: "code", op: "eq", values: ["grasslands"] },
        {
          path: BUSINESS,
          op: "regex",
          values: [{ pattern: SENTINEL, flags: "i" }],
        },
      ],
    });

    const [event] = audits();

    expect(event).toMatchObject({
      status: "success",
      entities: [
        {
          entity: "EXPLORE_SOURCE",
          action: "EXPLORE_QUERY",
          entityid: "applications",
        },
      ],
    });
    expect(event.details).toEqual({
      source: "applications",
      resultCount: 1,
      download: null,
      outcome: "ANSWERED",
    });
    expect(JSON.stringify(event)).not.toContain("phases");
    expect(JSON.stringify(event)).not.toContain("Sentinel");
    expect(JSON.stringify(event)).not.toContain("grasslands");
    expect(logged()).not.toContain("Sentinel");
  });

  it("audits a refusal that reached Mongo, and answers it with a message", async () => {
    runPart.mockRejectedValue(refuseQuery("TOO_MANY_TO_SORT"));

    const error = await failure(
      ask(
        "db.applications.find({ code: 'x' }, { clientRef: 1 }).sort({ clientRef: 1 })",
      ),
    );

    expect(error.output.payload).toEqual({
      statusCode: 400,
      reason: "QUERY_REFUSED",
      message:
        "The Grant Application Service has too many records to sort. Narrow it with an indexed path: clientRef, currentConfigVersion, createdAt, refs, identifiers.sbi, identifiers.frn, identifiers.crn",
      service: "GAS",
      vocabulary: VOCABULARY,
    });
    expect(audits()[0]).toMatchObject({
      status: "failure",
      details: { outcome: "TOO_MANY_TO_SORT", resultCount: null },
    });
  });

  it.each([
    ["TOO_SLOW", 408, "QUERY_TOO_SLOW"],
    ["TOO_MANY_TO_COUNT", 400, "QUERY_REFUSED"],
    ["TOO_BIG", 400, "QUERY_REFUSED"],
  ])("answers %s as %s %s", async (code, status, reason) => {
    runPart.mockRejectedValue(refuseQuery(code));

    const error = await failure(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    );

    expect(error.output.statusCode).toBe(status);
    expect(error.output.payload).toMatchObject({ reason });
    expect(typeof error.output.payload.message).toBe("string");
  });

  it("refuses a query past the instance's limit as busy, naming the service", async () => {
    const finishes = [];

    runPart.mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );

    const held = ["a", "b"].map((n) =>
      ask(
        "db.agreements.find({}, { agreementNumber: 1 })",
        {},
        { actorId: `${n}${ACTOR_ID.slice(1)}` },
      ),
    );
    const error = await failure(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    );

    expect(error.output.statusCode).toBe(429);
    expect(error.output.payload).toMatchObject({
      reason: "QUERY_BUSY",
      service: "GAS",
      refusal: "FULL",
      message:
        "The Grant Application Service is running as many queries as it can. Try again in a moment.",
    });

    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    finishes.forEach((finish) => finish(exactPart("gas.agreements", [])));
    await Promise.all(held);
  });

  it("counts Caseworking's sources apart, so GAS's full room never refuses them", async () => {
    const finishes = [];

    runPart.mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );
    queryCwExplore.mockImplementation(
      () => new Promise((resolve) => finishes.push(resolve)),
    );

    const actor = (n) => ({ actorId: `${n}${ACTOR_ID.slice(1)}` });
    const held = [
      ask("db.agreements.find({}, { agreementNumber: 1 })", {}, actor("a")),
      ask("db.agreements.find({}, { agreementNumber: 1 })", {}, actor("b")),
      ask("db.cases.find({}, { caseRef: 1 })", {}, actor("c")),
      ask("db.cases.find({}, { caseRef: 1 })", {}, actor("d")),
    ];

    await vi.waitFor(() => expect(finishes).toHaveLength(4));

    const error = await failure(
      ask("db.cases.find({}, { caseRef: 1 })", {}, actor("e")),
    );

    expect(error.output.payload).toMatchObject({
      refusal: "FULL",
      service: "CW",
      message:
        "Caseworking is running as many queries as it can. Try again in a moment.",
    });

    finishes.forEach((finish, n) =>
      finish(
        n < 2 ? exactPart("gas.agreements", []) : exactPart("cw.cases", []),
      ),
    );
    await Promise.all(held);
  });

  it("refuses a second query of the same operator while the first runs", async () => {
    let finish;

    runPart.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const first = ask("db.agreements.find({}, { agreementNumber: 1 })");
    const second = await failure(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    );

    expect(second.output.statusCode).toBe(429);
    expect(second.output.payload).toEqual({
      statusCode: 429,
      reason: "QUERY_BUSY",
      refusal: "BUSY",
      message:
        "You already have a query running. Wait for it to finish, then try again.",
      service: "GAS",
      vocabulary: VOCABULARY,
    });

    finish(exactPart("gas.agreements", []));
    await first;
    runPart.mockResolvedValue(exactPart("gas.agreements", []));
    await expect(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    ).resolves.toMatchObject({
      read: "exact",
    });
  });

  it("asks Caseworking for its source, with the operator", async () => {
    queryCwExplore.mockResolvedValue(exactPart("cw.cases", [row(5, 1, "CW")]));

    await ask(
      "db.cases.find({ workflowCode: 'w' }, { caseRef: 1, 'payload.answers.applicant.business.name': 1 })",
    );

    expect(queryCwExplore).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 4,
        source: "cases",
        columns: [
          { path: "caseRef" },
          { path: "payload.answers.applicant.business.name" },
        ],
      }),
      {
        actor: "Jo Operator",
        timeLeftMs: expect.any(Number),
        signal: expect.any(AbortSignal),
      },
    );
    expect(queryCwExplore.mock.calls[0][1].timeLeftMs).toBeGreaterThan(9000);
    expect(runPart).not.toHaveBeenCalled();
  });

  it("asks Caseworking for any answer of a case, as for an application", async () => {
    queryCwExplore.mockResolvedValue(exactPart("cw.cases", []));

    await ask(
      "db.cases.find({ 'payload.answers.applicant.business.email': /x/ })",
    );

    expect(queryCwExplore.mock.calls[0][0].where.path).toBe(
      "payload.answers.applicant.business.email",
    );
  });

  it("words Caseworking refusing a malformed path, naming Caseworking", async () => {
    queryCwExplore.mockRejectedValue(
      Object.assign(refuseQuery("PATH_NOT_ALLOWED"), { service: "CW" }),
    );

    const error = await failure(
      ask("db.cases.find({ workflowCode: 'w' }, { caseRef: 1 })"),
    );

    expect(error.output.payload).toEqual({
      statusCode: 400,
      reason: "QUERY_REFUSED",
      message: "Caseworking can’t read a malformed path in this query",
      service: "CW",
      vocabulary: VOCABULARY,
    });
  });

  it("names the paths no definition holds, and none it knows or holds below", async () => {
    runPart.mockResolvedValue(exactPart("gas.applications", []));

    const answer = await ask(
      "db.applications.find({ 'phases.answers.aplicant.name': 'x', 'identifiers.sbi': '1' }, { 'phases.answers': 1, 'agreements.FPTT1.latestStatus': 1 })",
    );

    expect(answer.unseen).toEqual(["phases.answers.aplicant.name"]);
  });

  it("names Caseworking when it didn't answer for its own source, before reading", async () => {
    cw = null;

    const error = await failure(ask("db.cases.find({}, { caseRef: 1 })"));

    expect(error.output.payload).toMatchObject({
      statusCode: 502,
      hop: "CW-BE",
      reason: "TIMED_OUT",
    });
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  describe("events", () => {
    it("reads both services and merges their rows newest first, counts added", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.outbox", [row(5, 1), row(3, 2)], 2),
      );
      queryCwExplore.mockResolvedValue(
        exactPart("cw.outbox", [row(4, 3, "CW")], 7),
      );

      const answer = await ask(
        "db.events.find({ status: 'DEAD_LETTER' }, { publicationDate: 1 })",
      );

      expect(answer.rows.map(({ open }) => open.service)).toEqual([
        "GAS",
        "CW",
        "GAS",
      ]);
      expect(answer.count).toEqual({ n: 9, capped: false });
    });

    it("reads only the pinned service", async () => {
      runPart.mockResolvedValue(exactPart("gas.outbox", []));

      await ask("db.events.find({ service: 'GAS' }, { publicationDate: 1 })");

      expect(queryCwExplore).not.toHaveBeenCalled();
    });

    it("fails naming Caseworking when it doesn't answer for unpinned events, never half", async () => {
      runPart.mockResolvedValue(exactPart("gas.outbox", [row(5, 1)]));
      queryCwExplore.mockRejectedValue(cwExploreFailure("UNREACHABLE"));

      const error = await failure(
        ask("db.events.find({}, { publicationDate: 1 })"),
      );

      expect(error.output.payload).toMatchObject({
        hop: "CW-BE",
        reason: "UNREACHABLE",
      });
      expect(audits()[0]).toMatchObject({
        status: "failure",
        details: { outcome: "UNREACHABLE" },
      });
    });

    it("fails naming Caseworking for unpinned events when its sources didn't answer", async () => {
      cw = null;
      runPart.mockResolvedValue(exactPart("gas.outbox", []));

      expect(
        (await failure(ask("db.events.find({}, { publicationDate: 1 })")))
          .output.payload,
      ).toMatchObject({
        hop: "CW-BE",
        reason: "TIMED_OUT",
      });
    });

    it("sends each service its own boxes' positions, and keeps a finished service finished", async () => {
      const positions = encodePositions({
        "gas.outbox": { t: at(30), i: id(9) },
        "gas.inbox": null,
        "cw.outbox": null,
        "cw.inbox": null,
      });

      runPart.mockResolvedValue(
        windowedPart("gas.outbox", [row(20, 1)], { t: at(10), i: id(2) }),
      );

      const answer = await ask(
        "db.events.find({ 'lastError.message': /x/ }, { publicationDate: 1 })",
        { positions },
      );

      expect(runPart.mock.calls[0][1].positions).toEqual({
        "gas.outbox": expect.any(String),
        "gas.inbox": null,
      });
      expect(queryCwExplore).not.toHaveBeenCalled();
      expect(answer.window).toMatchObject({ to: at(10), end: false });
    });
  });

  it("refuses positions it can't read", async () => {
    const error = await failure(
      ask(`db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`, {
        positions: "%%%",
      }),
    );

    expect(error.output.payload).toMatchObject({
      statusCode: 400,
      reason: "QUERY_REFUSED",
    });
  });

  it("reads a CSV down to the end when asked, not to positions", async () => {
    runPart
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(50, 1)], { t: at(30), i: id(3) }),
      )
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(20, 2)], { t: at(10), i: id(7) }),
      )
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(5, 3)], null, true),
      );

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`,
      { csv: true, untilEnd: true },
    );

    expect(runPart).toHaveBeenCalledTimes(3);
    expect(answer.rows).toHaveLength(3);
    expect(answer).toMatchObject({ partial: false, window: { end: true } });
  });

  it("reads a CSV from the top down to the positions shown, at most 5,000 rows", async () => {
    const target = { "gas.applications": { t: at(20), i: id(5) } };

    runPart
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(50, 1), row(40, 2)], {
          t: at(30),
          i: id(3),
        }),
      )
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(25, 4), row(20, 5), row(15, 6)], {
          t: at(10),
          i: id(7),
        }),
      );

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`,
      {
        csv: true,
        positions: encodePositions(target),
      },
    );

    expect(answer.rows).toHaveLength(4);
    expect(runPart).toHaveBeenCalledTimes(2);
    expect(runPart.mock.calls[0][1]).toMatchObject({
      limit: 5000,
      positions: null,
    });
    expect(audits()[0].details.download).toBe("CSV");
  });

  it("answers a window that ran out of work with the rows found so far, partial, and audits it so", async () => {
    runPart.mockResolvedValue({
      ...windowedPart("gas.applications", [row(50, 1)], {
        t: at(30),
        i: id(3),
      }),
      boxes: [
        {
          id: "gas.applications",
          rows: [row(50, 1)],
          to: { t: at(30), i: id(3) },
          end: false,
          count: null,
          partial: true,
        },
      ],
    });

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /9238/ }, { clientRef: 1 })`,
    );

    expect(answer).toMatchObject({
      read: "windowed",
      partial: true,
      rows: [{ cells: { created: at(50) } }],
      window: { to: at(30), end: false },
    });
    expect(answer.window.positions).not.toBeNull();
    expect(audits()[0].details).toMatchObject({ outcome: "PARTIAL" });
  });

  describe("a CSV that can't read all it was asked", () => {
    const QUERY = `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`;
    const box = (rows, to, extra = {}) => ({
      read: "windowed",
      groups: null,
      boxes: [
        {
          id: "gas.applications",
          rows,
          to,
          end: to === null,
          count: null,
          ...extra,
        },
      ],
    });

    it("reads on past a record too large to search, counting it, and audits it", async () => {
      runPart
        .mockResolvedValueOnce(
          box(
            [row(50, 1)],
            { t: at(40), i: id(2) },
            { partial: true, skipped: [SKIPPED] },
          ),
        )
        .mockResolvedValueOnce(box([row(30, 3)], null));

      const answer = await ask(QUERY, { csv: true, untilEnd: true });

      expect(runPart).toHaveBeenCalledTimes(2);
      expect(answer).toMatchObject({
        partial: false,
        window: { end: true, skipped: [SKIPPED], positions: null },
      });
      expect(answer.rows).toHaveLength(2);
      expect(audits()[0].details).toMatchObject({
        resultCount: 2,
        outcome: "ANSWERED",
      });
    });

    it("gives where to go on when a window ran out of work", async () => {
      runPart.mockResolvedValueOnce(
        box([row(50, 1)], { t: at(45), i: id(2) }, { partial: true }),
      );

      const answer = await ask(QUERY, { csv: true, untilEnd: true });

      expect(answer.partial).toBe(true);
      expect(decodePositions(answer.window.positions)).toEqual({
        "gas.applications": { t: at(45), i: id(2) },
      });
    });

    it("gives where to go on when it reaches the rows an answer may hold", async () => {
      const columns = Array.from(
        { length: 8 },
        (_, n) => `c${n}: '$clientRef'`,
      ).join(", ");
      const rows = Array.from({ length: 2500 }, (_, n) =>
        row(59 - (n % 50), n + 10),
      );

      runPart.mockResolvedValueOnce(box(rows, { t: at(1), i: id(9) }));

      const answer = await ask(
        `db.applications.find({ '${BUSINESS}': /x/ }, { ${columns} })`,
        { csv: true, untilEnd: true },
      );

      expect(answer.rows).toHaveLength(2500);
      expect(answer.partial).toBe(true);
      expect(answer.window.positions).not.toBeNull();
    });

    it("keeps the rows it read when Caseworking is full at a later window", async () => {
      runPart
        .mockResolvedValueOnce(box([row(50, 1)], { t: at(40), i: id(2) }))
        .mockRejectedValueOnce(
          Object.assign(refuseQuery("FULL"), { service: "CW" }),
        );

      const answer = await ask(QUERY, { csv: true, untilEnd: true });

      expect(answer).toMatchObject({ partial: true, window: { to: at(40) } });
      expect(answer.rows).toHaveLength(1);
    });

    it("audits a caller that went away during a later window as ABORTED", async () => {
      const gone = new AbortController();

      runPart
        .mockResolvedValueOnce(box([row(50, 1)], { t: at(40), i: id(2) }))
        .mockImplementationOnce(async () => {
          gone.abort();
          throw refuseQuery("TOO_SLOW");
        });

      await ask(QUERY, { csv: true, untilEnd: true }, { signal: gone.signal });

      expect(audits()[0].details.outcome).toBe("ABORTED");
    });
  });

  it("ends a CSV that runs out of time at its last whole window, partial, with where to go on", async () => {
    const target = { "gas.applications": { t: at(5), i: id(9) } };

    runPart
      .mockResolvedValueOnce(
        windowedPart("gas.applications", [row(50, 1), row(40, 2)], {
          t: at(30),
          i: id(3),
        }),
      )
      .mockRejectedValueOnce(refuseQuery("TOO_SLOW"));

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`,
      { csv: true, positions: encodePositions(target) },
    );

    expect(answer).toMatchObject({ partial: true, window: { to: at(30) } });
    expect(answer.rows).toHaveLength(2);
    expect(decodePositions(answer.window.positions)).toEqual({
      "gas.applications": { t: at(30), i: id(3) },
    });
    expect(audits()[0].details.outcome).toBe("PARTIAL");
  });

  it("ends a CSV before a window it has no time for, partial, with where to go on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    runPart.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 5_000);

      return windowedPart("gas.applications", [row(50, 1)], {
        t: at(30),
        i: id(3),
      });
    });

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`,
      { csv: true, untilEnd: true },
    ).finally(() => vi.useRealTimers());

    expect(runPart).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ partial: true, window: { to: at(30) } });
    expect(audits().map(({ details }) => details.outcome)).toEqual(["PARTIAL"]);
  });

  it("still refuses a CSV whose first window runs out of time", async () => {
    runPart.mockRejectedValueOnce(refuseQuery("TOO_SLOW"));

    const error = await failure(
      ask(`db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`, {
        csv: true,
        positions: encodePositions({
          "gas.applications": { t: at(5), i: id(9) },
        }),
      }),
    );

    expect(error.output.statusCode).toBe(408);
  });

  it("stops a CSV at the first window that ran out of work, and says it is partial", async () => {
    const target = { "gas.applications": { t: at(20), i: id(5) } };

    runPart.mockResolvedValue({
      read: "windowed",
      groups: null,
      boxes: [
        {
          id: "gas.applications",
          rows: [row(50, 1)],
          to: { t: at(45), i: id(2) },
          end: false,
          count: null,
          partial: true,
        },
      ],
    });

    const answer = await ask(
      `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`,
      { csv: true, positions: encodePositions(target) },
    );

    expect(runPart).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ partial: true, window: { to: at(45) } });
    expect(answer.rows).toHaveLength(1);
  });

  it("refuses a LIMIT over 5,000 and uses the limit asked", async () => {
    runPart.mockResolvedValue(exactPart("gas.agreements", []));

    const text = "db.agreements.find({}, { agreementNumber: 1 }).limit(9000)";
    const error = await failure(ask(text));

    await ask("db.agreements.find({}, { agreementNumber: 1 })", { limit: 7 });

    expect(error.output.payload.error).toEqual({
      message: "Explore shows at most 5,000 rows",
      at: text.indexOf("9000"),
      end: text.indexOf("9000") + 4,
    });
    expect(runPart.mock.calls.map(([, query]) => query.limit)).toEqual([7]);
  });

  it("refuses a 31st test, reading nothing", async () => {
    const text = `db.applications.find({ $or: [${Array.from(
      { length: 31 },
      (_, n) => `{ 'phases.answers.a${n}': { $regex: 'x' } }`,
    ).join(", ")}] })`;
    const error = await failure(ask(text));

    expect(error.output.payload.error).toMatchObject({
      message: "A query has at most 30 conditions",
    });
    expect(runPart).not.toHaveBeenCalled();
  });

  it("reads with one deadline for the whole request, 10 seconds", async () => {
    runPart.mockResolvedValue(exactPart("gas.agreements", []));

    const started = Date.now();

    await ask("db.agreements.find({}, { agreementNumber: 1 })");

    const [, , meter] = runPart.mock.calls[0];

    expect(meter.deadline - started).toBeGreaterThanOrEqual(10_000);
    expect(meter.deadline - started).toBeLessThan(10_100);
  });

  it("stops at its next check when the caller gives up", async () => {
    const stopped = new AbortController();

    runPart.mockImplementation(async (_, __, meter) => {
      stopped.abort();

      return meter.deadline === 0
        ? Promise.reject(refuseQuery("TOO_SLOW"))
        : exactPart("gas.agreements", []);
    });

    const error = await failure(
      ask(
        "db.agreements.find({}, { agreementNumber: 1 })",
        {},
        { signal: stopped.signal },
      ),
    );

    expect(error.output.statusCode).toBe(408);
    runPart.mockResolvedValue(exactPart("gas.agreements", []));
    await expect(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    ).resolves.toMatchObject({
      read: "exact",
    });
  });

  it("answers a CSV that runs out of time as too slow, and frees the operator", async () => {
    runPart.mockImplementation(async (_, query, meter) => {
      meter.deadline = 0;

      throw refuseQuery("TOO_SLOW");
    });

    const error = await failure(
      ask(`db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`, {
        csv: true,
        positions: encodePositions({
          "gas.applications": { t: at(20), i: id(5) },
        }),
      }),
    );

    expect(error.output.payload).toMatchObject({
      statusCode: 408,
      reason: "QUERY_TOO_SLOW",
      service: "GAS",
    });
    runPart.mockResolvedValue(exactPart("gas.agreements", []));
    await expect(
      ask("db.agreements.find({}, { agreementNumber: 1 })"),
    ).resolves.toMatchObject({
      read: "exact",
    });
  });

  it("stops Caseworking's part when GAS's own part fails", async () => {
    runPart.mockRejectedValue(refuseQuery("TOO_SLOW"));
    queryCwExplore.mockImplementation(
      (_, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("stopped"))),
        ),
    );

    const error = await failure(
      ask("db.events.find({}, { publicationDate: 1 })"),
    );

    expect(error.output.statusCode).toBe(408);
    expect(queryCwExplore.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("says a query would take too long when its work is refused up front", async () => {
    runPart.mockRejectedValue(refuseQuery("TOO_COSTLY"));

    expect(
      (await failure(ask("db.agreements.find({}, { agreementNumber: 1 })")))
        .output.payload,
    ).toMatchObject({
      statusCode: 408,
      reason: "QUERY_TOO_SLOW",
      message: expect.stringMatching(
        /^The Grant Application Service would take too long\./,
      ),
    });
  });

  it("passes Caseworking's full house on as its own, naming it", async () => {
    queryCwExplore.mockRejectedValue(
      Object.assign(refuseQuery("FULL"), { service: "CW" }),
    );

    expect(
      (await failure(ask("db.cases.find({}, { caseRef: 1 })"))).output.payload,
    ).toEqual({
      statusCode: 429,
      reason: "QUERY_BUSY",
      refusal: "FULL",
      message:
        "Caseworking is running as many queries as it can. Try again in a moment.",
      service: "CW",
      vocabulary: VOCABULARY,
    });
  });

  it("cuts a CSV, and a LIMIT GPA sends, to the cells an answer may hold", async () => {
    runPart.mockResolvedValue(exactPart("gas.agreements", []));

    const columns = Array.from(
      { length: 8 },
      (_, n) => `c${n}: '$agreementNumber'`,
    ).join(", ");
    await ask(`db.agreements.find({}, { ${columns} })`, { csv: true });
    await ask(`db.agreements.find({}, { ${columns} })`, { limit: 5000 });

    expect(runPart.mock.calls.map(([, query]) => query.limit)).toEqual([
      2500, 2500,
    ]);
  });

  it("still suggests a path tested only inside $or, which narrows once moved up", async () => {
    queryCwExplore.mockRejectedValueOnce(
      Object.assign(refuseQuery("TOO_SLOW"), { service: "CW" }),
    );

    const slow = await failure(
      ask(
        "db.cases.find({ $or: [{ workflowCode: 'w' }, { caseRef: 'r' }] }, { caseRef: 1 })",
      ),
    );

    expect(slow.output.payload.message).toBe(
      "Caseworking took too long. Narrow it with an indexed path: caseRef, workflowCode, createdAt",
    );
  });

  it("names Caseworking where Caseworking refused", async () => {
    queryCwExplore.mockRejectedValueOnce(
      Object.assign(refuseQuery("TOO_SLOW"), { service: "CW" }),
    );
    queryCwExplore.mockRejectedValueOnce(
      Object.assign(
        refuseQuery("GROUP_NEEDS_EXACT", {
          why: "SECOND_REF",
          path: "caseRef",
        }),
        {
          service: "CW",
        },
      ),
    );

    const slow = await failure(
      ask("db.cases.find({ workflowCode: 'w' }, { caseRef: 1 })"),
    );
    const group = await failure(
      ask(
        "db.cases.aggregate([{ $match: { workflowCode: 'w' } }, { $group: { _id: '$currentStatus', n: { $sum: 1 } } }])",
      ),
    );

    expect(slow.output.payload).toMatchObject({
      statusCode: 408,
      reason: "QUERY_TOO_SLOW",
      service: "CW",
      message:
        "Caseworking took too long. Narrow it with an indexed path: caseRef, createdAt",
    });
    expect(group.output.payload).toMatchObject({
      statusCode: 400,
      reason: "QUERY_REFUSED",
      service: "CW",
      message:
        "$group counts every record, so every condition must be read through an index, but only one reference is read through its index, and caseRef is a second. Conditions read so: caseRef, workflowCode, createdAt",
    });
  });

  it("reads every part windowed when one is, and goes on windowed", async () => {
    runPart
      .mockResolvedValueOnce(exactPart("gas.outbox", [row(5, 1)]))
      .mockResolvedValueOnce(
        windowedPart("gas.outbox", [row(5, 1)], { t: at(1), i: id(9) }),
      );
    queryCwExplore.mockResolvedValue(
      windowedPart("cw.outbox", [row(4, 2, "CW")], { t: at(2), i: id(8) }),
    );

    const answer = await ask(
      "db.events.find({ refs: 'ref:x' }, { publicationDate: 1 })",
    );

    expect(answer.read).toBe("windowed");
    expect(runPart.mock.calls[1][1].window).toBe(true);
  });

  it("asks only the service named, by its code", async () => {
    queryCwExplore.mockResolvedValue(exactPart("cw.outbox", []));

    await ask("db.events.find({ service: 'CW' }, { publicationDate: 1 })");

    expect(runPart).not.toHaveBeenCalled();
    expect(
      (await failure(ask("db.events.find({ service: 'caseworking' })"))).output
        .payload.error.message,
    ).toBe("Events come from GAS or CW: service: 'GAS'");
  });

  describe("events pinned to a service with any operator", () => {
    it.each([
      "{ service: { $in: ['GAS'] } }",
      "{ service: { $ne: 'CW' } }",
      "{ service: { $nin: ['CW'] }, box: 'outbox' }",
    ])("reads GAS's boxes alone for %s, Caseworking down", async (filter) => {
      cw = null;
      runPart.mockResolvedValue(exactPart("gas.outbox", [row(5, 1)]));

      const answer = await ask(
        `db.events.find(${filter}, { publicationDate: 1 })`,
      );

      expect(answer.rows).toHaveLength(1);
      expect(queryCwExplore).not.toHaveBeenCalled();
    });

    it("reads Caseworking's boxes alone for $nin of GAS", async () => {
      queryCwExplore.mockResolvedValue(exactPart("cw.outbox", []));

      await ask(
        "db.events.find({ service: { $nin: ['GAS'] } }, { publicationDate: 1 })",
      );

      expect(runPart).not.toHaveBeenCalled();
      expect(queryCwExplore).toHaveBeenCalledOnce();
    });
  });

  describe("a CSV of a query that typed its own limit", () => {
    it("exports no more rows than find(…).limit(n) showed", async () => {
      runPart.mockResolvedValue(exactPart("gas.agreements", []));

      await ask("db.agreements.find({}, { agreementNumber: 1 }).limit(10)", {
        csv: true,
      });

      expect(runPart.mock.calls[0][1].limit).toBe(10);
    });

    it("exports no more groups than a $limit of 3 showed, read to the end too", async () => {
      runPart.mockResolvedValue({
        read: "exact",
        boxes: [
          {
            id: "gas.agreements",
            rows: [],
            to: null,
            end: true,
            count: { n: 9, capped: false },
          },
        ],
        groups: ["a", "b", "c", "d", "e"].map((key, n) => ({
          key: `string:${key}`,
          value: key,
          n: 10 - n,
          aggs: {},
        })),
      });

      const answer = await ask(
        "db.agreements.aggregate([{ $group: { _id: '$code' } }, { $limit: 3 }])",
        { csv: true, untilEnd: true },
      );

      expect(answer.rows).toHaveLength(3);
    });

    it("still exports up to 5,000 rows where no limit was typed", async () => {
      runPart.mockResolvedValue(exactPart("gas.agreements", []));

      await ask("db.agreements.find({}, { agreementNumber: 1 })", {
        csv: true,
      });

      expect(runPart.mock.calls[0][1].limit).toBe(5000);
    });
  });

  describe("the vocabulary", () => {
    it("is loaded within the request's one deadline, the read's meter set before it", async () => {
      runPart.mockResolvedValue(exactPart("gas.agreements", []));
      const started = Date.now();

      await ask("db.agreements.find({}, { agreementNumber: 1 })");

      const [{ timeLeftMs }] = loadExploreVocabulary.mock.calls[0];
      const [, , meter] = runPart.mock.calls[0];
      expect(timeLeftMs).toBeLessThanOrEqual(10_000);
      expect(timeLeftMs).toBeGreaterThan(9_000);
      expect(meter.deadline - started).toBeLessThanOrEqual(10_000);
    });

    it.each([
      ["db.agreements.find()", false],
      ["// a note\ndb.applications.find()", false],
      ["db.cases.find()", true],
      ["db.workflows.find()", true],
      ["db.events.find()", true],
    ])("asks Caseworking's sources for %s: %s", async (text, withCw) => {
      runPart.mockResolvedValue(exactPart("gas.agreements", []));
      queryCwExplore.mockResolvedValue(exactPart("cw.cases", []));

      await failure(ask(text));

      expect(loadExploreVocabulary.mock.calls[0][0].withCw).toBe(withCw);
    });
  });

  it.each([
    [null, "payments"],
    [{ why: null, path: null, noun: "agreements" }, "agreements"],
  ])(
    "names what there is too much of to read in full: %j",
    async (detail, noun) => {
      runPart.mockRejectedValue(refuseQuery("TOO_BIG", detail));

      const error = await failure(ask("db.payments.find({}, { sbi: 1 })"));

      expect(error.output.payload.message).toBe(
        `The Grant Application Service has too many ${noun} to read in full`,
      );
    },
  );

  it("reads nothing for a caller already gone", async () => {
    const gone = new AbortController();
    gone.abort();
    runPart.mockImplementation(async (_, __, meter) =>
      meter.deadline === 0
        ? Promise.reject(refuseQuery("TOO_SLOW"))
        : exactPart("gas.agreements", []),
    );

    const error = await failure(
      ask(
        "db.agreements.find({}, { agreementNumber: 1 })",
        {},
        { signal: gone.signal },
      ),
    );

    expect(error.output.statusCode).toBe(408);
    expect(audits()[0].details.outcome).toBe("ABORTED");
  });

  describe("windows read in turn", () => {
    const WINDOWED = `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`;
    const after = (minute, n) => ({ t: at(minute), i: id(n) });

    it("reads each window from where the last ended, as one answer, each audited", async () => {
      runPart
        .mockResolvedValueOnce(
          windowedPart(
            "gas.applications",
            [row(50, 1), row(45, 2)],
            after(30, 3),
          ),
        )
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(20, 4)], after(10, 5)),
        )
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(5, 6)], after(1, 7)),
        );

      const answer = await ask(WINDOWED, { windows: 3 });

      expect(runPart).toHaveBeenCalledTimes(3);
      expect(runPart.mock.calls[0][1].positions).toBeNull();
      expect(runPart.mock.calls[1][1].positions).toEqual({
        "gas.applications": expect.any(String),
      });
      expect(answer.rows).toHaveLength(4);
      expect(answer).toMatchObject({
        windowRows: [2, 1, 1],
        stopped: null,
        window: { to: at(1), end: false },
      });
      expect(audits().map(({ details }) => details.resultCount)).toEqual([
        2, 1, 1,
      ]);
    });

    it("takes the columns' kinds from every window's rows and sums what each skipped", async () => {
      const dated = (minute, n) => ({
        ...row(minute, n),
        cells: { c0: at(minute) },
      });
      const skipping = (rows, to, skipped) => {
        const part = windowedPart("gas.applications", rows, to);

        return {
          ...part,
          boxes: [{ ...part.boxes[0], partial: true, skipped }],
        };
      };
      runPart
        .mockResolvedValueOnce(
          skipping([dated(50, 1)], after(30, 3), [SKIPPED]),
        )
        .mockResolvedValueOnce(skipping([], after(10, 5), [SKIPPED, SKIPPED]));

      const answer = await ask(
        `db.applications.find({ '${BUSINESS}': /x/ }, { createdAt: 1 })`,
        { windows: 2 },
      );

      expect(answer.columns).toEqual([
        expect.objectContaining({ label: "createdAt", kind: "date" }),
      ]);
      expect(answer).toMatchObject({
        windowRows: [1, 0],
        window: { to: at(10), skipped: [SKIPPED, SKIPPED, SKIPPED] },
      });
      await expect(exploreQueryResponseSchema(answer)).resolves.toBeDefined();
    });

    it("stops at the window that reaches the end", async () => {
      runPart
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(50, 1)], after(30, 3)),
        )
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(20, 4)], null, true),
        );

      const answer = await ask(WINDOWED, { windows: 50 });

      expect(runPart).toHaveBeenCalledTimes(2);
      expect(answer).toMatchObject({
        windowRows: [1, 1],
        stopped: null,
        window: { end: true },
      });
    });

    it("keeps the rows before a window that fails, and says where it stopped", async () => {
      runPart
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(50, 1)], after(30, 3)),
        )
        .mockRejectedValueOnce(refuseQuery("TOO_SLOW"));

      const answer = await ask(WINDOWED, { windows: 3 });

      expect(answer.rows).toHaveLength(1);
      expect(answer).toMatchObject({
        windowRows: [1],
        stopped: { statusCode: 408, code: "QUERY_TOO_SLOW" },
        window: { to: at(30), end: false },
      });
      expect(audits()).toHaveLength(2);
    });

    it("stops before a window that could pass the cells one answer holds", async () => {
      const wide = `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1, code: 1, currentStatus: 1, createdAt: 1 })`;
      runPart.mockResolvedValue(
        windowedPart(
          "gas.applications",
          [row(50, 1), row(45, 2)],
          after(30, 3),
        ),
      );

      const answer = await ask(wide, { windows: 50, limit: MAX_LIMIT });

      expect(runPart).toHaveBeenCalledTimes(1);
      expect(answer).toMatchObject({
        windowRows: [2],
        stopped: { statusCode: 413, code: "TOO_MANY_CELLS" },
        window: { to: at(30), end: false },
      });
      expect(audits()).toHaveLength(1);
      await expect(exploreQueryResponseSchema(answer)).resolves.toBeDefined();
    });

    it("reads on while the next window still fits", async () => {
      const wide = `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1, code: 1, currentStatus: 1, createdAt: 1 })`;
      runPart.mockResolvedValue(
        windowedPart("gas.applications", [row(50, 1)], after(30, 3)),
      );

      const answer = await ask(wide, { windows: 3, limit: 2_000 });

      expect(runPart).toHaveBeenCalledTimes(3);
      expect(answer).toMatchObject({ windowRows: [1, 1, 1], stopped: null });
    });

    it("stops before a window it has no time for, reading and auditing only those it read", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      runPart.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 5_000);

        return windowedPart("gas.applications", [row(50, 1)], after(30, 3));
      });

      const answer = await ask(WINDOWED, { windows: 3 }).finally(() =>
        vi.useRealTimers(),
      );

      expect(runPart).toHaveBeenCalledTimes(1);
      expect(answer).toMatchObject({
        windowRows: [1],
        stopped: { statusCode: 408, code: "QUERY_TOO_SLOW" },
        window: { to: at(30), end: false },
      });
      expect(audits().map(({ details }) => details.outcome)).toEqual([
        "ANSWERED",
      ]);
    });

    it("stops a later window on a failure that isn't an answer as FAILED, and logs it", async () => {
      runPart
        .mockResolvedValueOnce(
          windowedPart("gas.applications", [row(50, 1)], after(30, 3)),
        )
        .mockRejectedValueOnce(new Error("socket closed"));

      const answer = await ask(WINDOWED, { windows: 2 });

      expect(answer.stopped).toEqual({ statusCode: 500, code: "FAILED" });
      expect(logger.error).toHaveBeenCalledWith(
        "Explore query window failed: socket closed",
      );
    });

    it("refuses as before when the first window fails", async () => {
      runPart.mockRejectedValueOnce(refuseQuery("TOO_SLOW"));

      const error = await failure(ask(WINDOWED, { windows: 3 }));

      expect(error.output.statusCode).toBe(408);
    });

    it("answers an exact read as its one window", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)]));

      const answer = await ask("db.applications.find()", { windows: 5 });

      expect(runPart).toHaveBeenCalledTimes(1);
      expect(answer).toMatchObject({ windowRows: [1], stopped: null });
    });

    it("answers no windowRows unless asked", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)]));

      const answer = await ask("db.applications.find()");

      expect(answer).not.toHaveProperty("windowRows");
      expect(answer).not.toHaveProperty("stopped");
    });
  });

  describe("with the vocabulary", () => {
    beforeEach(() => {
      loadExploreValues.mockResolvedValue(new Map());
      exploreVocabularyUseCase.mockImplementation(readVocabulary);
    });

    const names = ({ sources }) => sources.map(({ name }) => name);

    it("carries it beside an answer, a check and a refusal alike", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)]));

      const answered = await ask("db.applications.find()");
      const checkedOnly = await ask("db.payments.find()", { check: true });
      const refusal = await failure(ask("db.applications.find({"));

      expect(names(answered.vocabulary)).toContain("cases");
      expect(checkedOnly).toEqual({
        ok: true,
        source: "payments",
        vocabulary: answered.vocabulary,
      });
      expect(refusal.output.payload).toMatchObject({
        reason: "QUERY_INVALID",
        vocabulary: answered.vocabulary,
      });
    });

    it("reads Caseworking's sources for it even when the query reads none", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", []));

      await ask("db.applications.find()");

      expect(loadExploreVocabulary).toHaveBeenCalledWith();
    });

    it("carries null when it can't be read, and the answer still stands", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)]));
      loadExploreValues.mockRejectedValue(new Error("values unread"));

      const answer = await ask("db.applications.find()");

      expect(answer).toMatchObject({ read: "exact", vocabulary: null });
      expect(logger.warn).toHaveBeenCalledWith(
        "Explore vocabulary not read: values unread",
      );
    });
  });
});

describe("exploreQueryUseCase with documents", () => {
  const docOf = (value) => BSON.serialize({ value }).toString("base64");
  const idOf = (n) => BSON.serialize({ _id: n }).toString("base64");
  const stored = (minute, n, box = "gas.applications", size = 40) => ({
    ...row(minute, n),
    id: idOf(n),
    at: [],
    size,
  });
  const fetchingAll = () =>
    fetchDocuments.mockImplementation(
      async (_source, _query, { rows: asked }) =>
        asked.map(({ box, id, at }) => ({
          box,
          id,
          at,
          doc: docOf(`${id} ${SENTINEL}`),
          context: null,
        })),
    );
  const textOf = async (stream) => {
    let text = "";

    for await (const chunk of stream) {
      text += chunk;
    }

    return text;
  };
  const linesOf = async (stream) =>
    (await textOf(stream))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  const startOf = (id) => ({ doc: docOf(`${id} ${SENTINEL}`), cut: true });
  const printed = { bytes: 5000, values: 12 };
  const startingAll = (most = Infinity) =>
    fetchPart.mockImplementation(async (_source, { rows: asked }) => ({
      documents: asked.slice(0, most).map(({ box, id, at }) => ({
        box,
        id,
        at,
        start: startOf(id),
        printed,
      })),
      ...(most < asked.length && { ended: "time" }),
    }));

  it("asks for each document's shape, from the projection", async () => {
    runPart.mockResolvedValue(exactPart("gas.applications", []));

    await ask("db.applications.find()", { starts: true });
    await ask("db.applications.find({}, { _id: 0, clientRef: 1 })", {
      starts: true,
    });
    await ask("db.applications.find({}, { clientRef: 1 })");

    expect(runPart.mock.calls.map(([, query]) => query.documents)).toEqual([
      { whole: true, id: true, mode: "starts" },
      { whole: false, id: false, mode: "starts" },
      undefined,
    ]);
  });

  it("answers each record row with its start, and says how many bytes were sent", async () => {
    runPart.mockResolvedValue(
      exactPart("gas.applications", [stored(5, 1), stored(4, 2)]),
    );
    startingAll();

    const answer = await ask("db.applications.find()", { starts: true });

    expect(fetchPart.mock.calls[0][1].documents).toEqual({
      whole: true,
      id: true,
      mode: "starts",
    });
    expect(
      answer.rows.map(({ id, start, docNote, context }) => [
        id,
        start,
        docNote,
        context,
      ]),
    ).toEqual([
      [idOf(1), startOf(idOf(1)), null, null],
      [idOf(2), startOf(idOf(2)), null, null],
    ]);
    expect(answer.rows[0]).not.toHaveProperty("doc");
    expect(answer.rows[0].printed).toEqual(printed);
    expect(answer.documents).toEqual({
      whole: true,
      bytes: answer.rows.reduce(
        (sum, { start }) => sum + Buffer.byteLength(start.doc, "base64"),
        0,
      ),
    });
    expect(logged()).toContain(`documents.bytes ${answer.documents.bytes}`);
    expect(logged()).not.toContain("Sentinel");
    await expect(exploreQueryResponseSchema(answer)).resolves.toBeDefined();
  });

  it("answers each group's row with its document and that document's start", async () => {
    runPart.mockResolvedValue({
      read: "exact",
      boxes: [
        {
          id: "gas.applications",
          rows: [],
          to: null,
          end: true,
          count: { n: 3, capped: false },
        },
      ],
      groups: [
        { key: "string:a", value: "a", n: 2, aggs: {} },
        { key: "string:b", value: "b", n: 1, aggs: {} },
      ],
    });

    const answer = await ask(
      "db.applications.aggregate([{ $group: { _id: '$code' } }])",
      { starts: true },
    );

    expect(answer.rows.map(({ doc, start }) => [doc, start])).toEqual(
      answer.rows.map(({ doc }) => [doc, { doc, cut: false }]),
    );
    expect(fetchPart).not.toHaveBeenCalled();
    await expect(exploreQueryResponseSchema(answer)).resolves.toBeDefined();
    await expect(
      exploreQueryResponseSchema({
        ...answer,
        rows: [{ ...answer.rows[0], start: { cut: false } }],
      }),
    ).rejects.toThrow();
  });

  describe("a page whose starts aren't all read in time", () => {
    const four = [stored(9, 1), stored(8, 2), stored(7, 3), stored(6, 4)];

    it("ends at the last start read, Keep looking going on from the next record", async () => {
      runPart.mockResolvedValue(
        windowedPart("gas.applications", four, four[3].key),
      );
      startingAll(2);

      const answer = await ask("db.applications.find()", { starts: true });

      expect(answer.rows.map(({ id }) => id)).toEqual([idOf(1), idOf(2)]);
      expect(answer.partial).toBe(true);
      expect(answer.window.end).toBe(false);
      expect(decodePositions(answer.window.positions)).toEqual({
        "gas.applications": four[1].key,
      });

      runPart.mockResolvedValue(
        windowedPart("gas.applications", four.slice(2), four[3].key, true),
      );
      startingAll();

      const next = await ask("db.applications.find()", {
        starts: true,
        positions: answer.window.positions,
      });

      expect(runPart.mock.calls[1][1].positions).toEqual(
        asQueryPositions(decodePositions(answer.window.positions)),
      );
      expect(next.rows.map(({ id }) => id)).toEqual([idOf(3), idOf(4)]);
    });

    it("is refused as too slow when not even its first start was read", async () => {
      runPart.mockResolvedValue(
        windowedPart("gas.applications", four, four[3].key),
      );
      startingAll(0);

      const error = await failure(
        ask("db.applications.find()", { starts: true }),
      );

      expect(error.output.statusCode).toBe(408);
      expect(error.output.payload).toMatchObject({
        reason: "QUERY_TOO_SLOW",
        service: "GAS",
      });
    });

    it("is refused as too slow when it is an exact read, which has no way on", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", four));
      startingAll(3);

      const error = await failure(
        ask("db.applications.find()", { starts: true }),
      );

      expect(error.output.payload.reason).toBe("QUERY_TOO_SLOW");
    });
  });

  it("sends no documents and no fetch without asking", async () => {
    runPart.mockResolvedValue(exactPart("gas.applications", [stored(5, 1)]));

    const answer = await ask("db.applications.find()");

    expect(answer.documents).toBeNull();
    expect(answer.rows[0]).toEqual({
      open: row(5, 1).open,
      cells: row(5, 1).cells,
    });
    expect(fetchDocuments).not.toHaveBeenCalled();
  });

  it.each([
    ["db.applications.find()", { rows: 5000, raise: "limit" }],
    [
      "db.applications.aggregate([{ $match: { code: 'x' } }])",
      { rows: 5000, raise: "stage" },
    ],
    ["db.applications.distinct('code')", { rows: 5000, raise: null }],
    [
      "db.applications.countDocuments({ code: 'x' })",
      { rows: 5000, raise: null },
    ],
    [
      `db.applications.find({}, { ${Array.from({ length: 10 }, (_, n) => `p${n}: 1`).join(", ")} })`,
      { rows: 2000, raise: "limit" },
    ],
  ])("says the limits that apply to %s", async (text, limits) => {
    runPart.mockResolvedValue({
      ...exactPart("gas.applications", []),
      groups: text.includes("distinct") ? [] : null,
    });

    expect((await ask(text)).limits).toEqual(limits);
  });

  describe("a CSV's limits", () => {
    const QUERY = "db.applications.find({}, { clientRef: 1 })";
    const minuteOf = (n) =>
      new Date(Date.UTC(2026, 9, 13, 10) - n * 1000).toISOString();
    const timed = (n) => ({
      key: { t: minuteOf(n), i: id(n + 1) },
      open: { kind: "application", code: "g", ref: `r${n}` },
      cells: { c0: `r${n}` },
      order: null,
    });
    const windowAt = (n) =>
      windowedPart("gas.applications", [timed(n)], {
        t: minuteOf(n),
        i: id(n + 1),
      });
    const WINDOWED = `db.applications.find({ '${BUSINESS}': /x/ }, { clientRef: 1 })`;

    it("says nothing stopped it when it holds every row found", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [row(5, 1)]));

      expect((await ask(QUERY, { csv: true })).download).toEqual({
        rows: 5000,
        stopped: null,
        searchedTo: at(5),
      });
    });

    it("says it stopped at its rows when more were found than it holds", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [row(5, 1)], 9000),
      );

      expect((await ask(QUERY, { csv: true })).download).toMatchObject({
        stopped: "rows",
      });
    });

    it("holds what a typed limit asked for, and says nothing stopped it", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [row(5, 1)], 9000),
      );

      expect(
        (await ask(`${QUERY}.limit(1)`, { csv: true })).download,
      ).toMatchObject({ rows: 1, stopped: null });
    });

    const grouped = (n) => ({
      read: "exact",
      boxes: [
        {
          id: "gas.applications",
          rows: [],
          to: null,
          end: true,
          count: { n: 9, capped: false },
        },
      ],
      groups: Array.from({ length: n }, (_, m) => ({
        key: `string:g${m}`,
        value: `g${m}`,
        n: 1,
        aggs: {},
      })),
    });

    it.each([
      [
        "a grouped",
        "db.applications.aggregate([{ $group: { _id: '$code' } }])",
      ],
      ["a distinct", "db.applications.distinct('code')"],
    ])(
      "says nothing stopped %s download that holds every group",
      async (_, text) => {
        runPart.mockResolvedValue(grouped(2));

        const answer = await ask(text, { csv: true });

        expect(answer.rows).toHaveLength(2);
        expect(answer.download.stopped).toBeNull();
      },
    );

    it("says nothing stopped a count's download", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [], 9000));

      const answer = await ask("db.applications.countDocuments({})", {
        csv: true,
      });

      expect(answer.download.stopped).toBeNull();
    });

    it("says a grouped download stopped at its rows when it holds fewer groups than were found", async () => {
      runPart.mockResolvedValue(grouped(5001));

      const answer = await ask(
        "db.applications.aggregate([{ $group: { _id: '$code' } }])",
        { csv: true },
      );

      expect(answer.download.stopped).toBe("rows");
    });

    it("says it stopped at its bytes when Caseworking's cells allowance cut its window", async () => {
      queryCwExplore.mockResolvedValue({
        read: "windowed",
        groups: null,
        boxes: [
          {
            id: "cw.cases",
            rows: [row(5, 1, "CW")],
            to: row(5, 1, "CW").key,
            end: false,
            count: null,
            partial: true,
            cut: true,
            skipped: [],
          },
        ],
      });

      const answer = await ask(
        "db.cases.find({ 'payload.answers.applicant.business.email': /x/ }, { caseRef: 1 })",
        { csv: true, untilEnd: true },
      );

      expect(answer.download.stopped).toBe("bytes");
    });

    it("says it stopped for time when a window ran out of work, skipping nothing", async () => {
      runPart.mockResolvedValue({
        ...windowAt(1),
        boxes: [{ ...windowAt(1).boxes[0], partial: true, skipped: [] }],
      });

      const answer = await ask(WINDOWED, { csv: true, untilEnd: true });

      expect(runPart).toHaveBeenCalledTimes(1);
      expect(answer.download.stopped).toBe("time");
    });

    it("says it stopped at 50 windows", async () => {
      runPart.mockImplementation(async () =>
        windowAt(runPart.mock.calls.length),
      );

      const answer = await ask(WINDOWED, { csv: true, untilEnd: true });

      expect(runPart).toHaveBeenCalledTimes(50);
      expect(answer.download).toMatchObject({
        stopped: "windows",
        searchedTo: minuteOf(50),
      });
    });

    it.each([
      ["time", "TOO_SLOW"],
      ["error", "FULL"],
    ])(
      "says it stopped for %s when a later window is refused %s",
      async (stopped, code) => {
        runPart
          .mockResolvedValueOnce(windowAt(1))
          .mockRejectedValueOnce(refuseQuery(code));

        const answer = await ask(WINDOWED, { csv: true, untilEnd: true });

        expect(answer.download).toMatchObject({ stopped });
        expect(answer.rows).toHaveLength(1);
      },
    );
  });

  describe("mongod's failures", () => {
    const TEXT =
      "db.applications.find({}, { clientRef: 1, n: { $size: '$phases.answers.parcels' } })";
    const MESSAGE =
      "The argument to $size must be an array, but was of type: string";
    const spanOf = (text) => {
      const at = text.indexOf("{ $size");

      return { at, end: text.indexOf("}", at) + 1 };
    };

    it("answers mongod's own words, at the expression that failed", async () => {
      runPart.mockRejectedValue(
        refuseQuery("MONGOD_ERROR", { fn: "count", type: "string", column: 1 }),
      );

      const error = await failure(ask(TEXT));

      expect(error.output.statusCode).toBe(400);
      expect(error.output.payload).toEqual({
        statusCode: 400,
        reason: "QUERY_REFUSED",
        refusal: "MONGOD_ERROR",
        service: "GAS",
        message: MESSAGE,
        error: { message: MESSAGE, ...spanOf(TEXT) },
        vocabulary: VOCABULARY,
      });
    });

    it("answers Caseworking's the same way, as Caseworking's", async () => {
      const text =
        "db.cases.find({}, { caseRef: 1, n: { $size: '$payload.answers.parcels' } })";

      queryCwExplore.mockRejectedValue(
        Object.assign(
          refuseQuery("MONGOD_ERROR", { fn: "count", type: "int", column: 1 }),
          { service: "CW" },
        ),
      );

      const error = await failure(ask(text));

      expect(error.output.payload).toMatchObject({
        refusal: "MONGOD_ERROR",
        service: "CW",
        message: "The argument to $size must be an array, but was of type: int",
        error: spanOf(text),
      });
    });

    it("says no place when the column isn't known", async () => {
      runPart.mockRejectedValue(
        refuseQuery("MONGOD_ERROR", {
          fn: "count",
          type: "string",
          column: null,
        }),
      );

      const error = await failure(ask(TEXT));

      expect(error.output.payload.message).toBe(MESSAGE);
      expect(error.output.payload).not.toHaveProperty("error");
    });

    it.each([
      [
        "CELLS_TOO_LARGE",
        "These cells are too large to show together. Name fewer paths or set a lower .limit()",
      ],
      [
        "ANSWER_TOO_LARGE",
        "This answer is too large: set a lower .limit() or name fewer paths",
      ],
    ])("answers %s with what to do", async (code, message) => {
      runPart.mockRejectedValue(refuseQuery(code));

      const error = await failure(ask(TEXT));

      expect(error.output.payload).toMatchObject({
        statusCode: 400,
        reason: "QUERY_REFUSED",
        refusal: code,
        message,
        service: "GAS",
      });
    });
  });

  describe("from Caseworking", () => {
    const TEXT = "db.cases.find({ workflowCode: 'w' }, { caseRef: 1 })";
    const cwRow = (minute, n) => ({
      ...row(minute, n, "CW"),
      id: idOf(n),
      at: [],
      size: 30,
    });

    it("fetches the shown rows' starts in one documents call", async () => {
      queryCwExplore
        .mockResolvedValueOnce(exactPart("cw.cases", [cwRow(5, 1)]))
        .mockImplementationOnce(async (query) => ({
          documents: query.rows.map((one) => ({
            ...one,
            start: { doc: docOf("c"), cut: false },
            printed: { bytes: 20, values: 1 },
          })),
        }));

      const answer = await ask(TEXT, { starts: true });
      const [read, fetch] = queryCwExplore.mock.calls.map(([query]) => query);

      expect(read).toMatchObject({
        v: 4,
        documents: { whole: false, id: true, mode: "starts" },
      });
      expect(fetch).toMatchObject({
        v: 4,
        mode: "documents",
        documents: { whole: false, id: true, mode: "starts" },
        rows: [{ box: "cw.cases", id: idOf(1), at: [] }],
      });
      expect(fetch.documents).not.toHaveProperty("bytes");
      expect(answer.rows[0]).toMatchObject({
        start: { doc: docOf("c"), cut: false },
        printed: { bytes: 20, values: 1 },
        docNote: null,
      });
    });

    it("ends a page at the first row Caseworking didn't send a start for, going on from there", async () => {
      const rows = [cwRow(9, 1), cwRow(8, 2), cwRow(7, 3)];

      queryCwExplore
        .mockResolvedValueOnce(windowedPart("cw.cases", rows, rows[2].key))
        .mockImplementationOnce(async (query) => ({
          documents: query.rows.slice(0, 2).map((one) => ({
            ...one,
            start: { doc: docOf("c"), cut: false },
            printed: { bytes: 20, values: 1 },
          })),
        }));

      const answer = await ask(TEXT, { starts: true });

      expect(answer.rows.map(({ id }) => id)).toEqual([idOf(1), idOf(2)]);
      expect(answer.partial).toBe(true);
      expect(decodePositions(answer.window.positions)).toEqual({
        "cw.cases": rows[1].key,
      });
    });

    it("refuses a page Caseworking sent no start for as Caseworking too slow", async () => {
      const rows = [cwRow(9, 1)];

      queryCwExplore
        .mockResolvedValueOnce(windowedPart("cw.cases", rows, rows[0].key))
        .mockResolvedValueOnce({ documents: [], ended: "time" });

      const error = await failure(ask(TEXT, { starts: true }));

      expect(error.output.payload).toMatchObject({
        reason: "QUERY_TOO_SLOW",
        service: "CW",
      });
    });

    it("refuses a page Caseworking sent no start for, out of work, as Caseworking too costly to read", async () => {
      const rows = [cwRow(9, 1)];

      queryCwExplore
        .mockResolvedValueOnce(windowedPart("cw.cases", rows, rows[0].key))
        .mockResolvedValueOnce({ documents: [], ended: "work" });

      const error = await failure(ask(TEXT, { starts: true }));

      expect(error.output.payload).toMatchObject({
        reason: "QUERY_TOO_SLOW",
        message: expect.stringContaining("would take too long"),
        service: "CW",
      });
    });
  });

  describe("Show it", () => {
    const HEX = "6741a0c2e4b0f1a2b3c4d5e6";
    const oidId = BSON.serialize({ _id: new ObjectId(HEX) }).toString("base64");
    const shownRow = (
      at,
      size = 2 * 1024 * 1024,
      box = "gas.applications",
    ) => ({
      ...row(5, 1),
      key: { t: row(5, 1).key.t, i: HEX },
      id: oidId,
      at,
      size,
      box,
    });
    const show = (more) => ({
      id: oidId,
      at: [],
      service: null,
      box: null,
      ...more,
    });
    const TEXT = "db.applications.find({ code: 'grasslands' })";
    const fetchingWith = (more = {}) =>
      fetchDocuments.mockImplementation(
        async (_source, _query, { rows: asked }) =>
          asked.map((one) => ({
            ...one,
            doc: docOf("whole"),
            context: null,
            ...more,
          })),
      );

    it("reads the record by its _id alone, its document tested on the run's own filter", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [shownRow([])]));
      fetchingWith();

      const answer = await ask(TEXT, { show: show(), limit: 50 });
      const [, read] = runPart.mock.calls[0];
      const [, fetched] = fetchDocuments.mock.calls[0];

      expect(read.where).toEqual({
        all: [{ path: "_id", op: "eq", values: [{ oid: HEX }] }],
      });
      expect(read.limit).toBe(50);
      expect(read.documents).toEqual({ whole: true, id: true });
      expect(fetched.where).toEqual({
        path: "code",
        op: "eq",
        values: ["grasslands"],
      });
      expect(answer.rows).toHaveLength(1);
      expect(answer.rows[0]).toMatchObject({
        id: oidId,
        doc: docOf("whole"),
        start: { doc: docOf("whole"), cut: false },
        docNote: null,
      });
      expect(answer.documents).toMatchObject({ whole: true, gone: false });
      await expect(exploreQueryResponseSchema(answer)).resolves.toBeDefined();
      expect(answer.count).toEqual({ n: 1, capped: false });
      expect(audits()[0].details).toMatchObject({
        resultCount: 1,
        outcome: "ANSWERED",
      });
    });

    it("shows the one unwound row asked of a large record, whole, past a page's allowance", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [
          shownRow([0]),
          shownRow([1]),
          shownRow([2]),
        ]),
      );
      fetchingWith();

      const answer = await ask(
        "db.applications.aggregate([{ $unwind: '$phases' }])",
        { show: show({ at: [1] }), documents: true },
      );

      expect(fetchDocuments.mock.calls[0][2].rows).toEqual([
        { box: "gas.applications", id: oidId, at: [1] },
      ]);
      expect(answer.rows).toHaveLength(1);
      expect(answer.rows[0]).toMatchObject({
        at: [1],
        doc: docOf("whole"),
        docNote: null,
      });
    });

    it.each([
      ["the one row of a value that isn't a list", [shownRow([null])], 1],
      ["no row of a list", [shownRow([0]), shownRow([1])], 0],
    ])(
      "reads no position at an $unwind that doesn't keep the record, showing %s",
      async (_, rows, shown) => {
        runPart.mockResolvedValue(exactPart("gas.applications", rows));
        fetchingWith();

        const answer = await ask(
          "db.applications.aggregate([{ $unwind: '$phases' }])",
          { show: show({ at: [null] }) },
        );

        expect(answer.rows).toHaveLength(shown);
        expect(answer.documents.gone).toBe(shown === 0);
      },
    );

    it("says a record changed since the run, keeping its document, with no documents asked as for the Table", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [shownRow([])]));
      fetchingWith({ changed: true });

      const answer = await ask(TEXT, { show: show() });

      expect(answer.rows[0]).toMatchObject({
        doc: docOf("whole"),
        docNote: { changed: true },
      });
    });

    it("says the record is gone when no row of it is read", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", []));

      const answer = await ask(TEXT, { show: show() });

      expect(answer.rows).toEqual([]);
      expect(answer.documents).toMatchObject({ gone: true, bytes: 0 });
      expect(fetchDocuments).not.toHaveBeenCalled();
    });

    it("says a record is gone on a small source's full read", async () => {
      runPart.mockResolvedValue({
        ...exactPart("gas.grants", []),
        read: "full",
      });

      const answer = await ask("db.grants.find({ code: 'x' })", {
        show: show(),
      });

      expect(runPart.mock.calls[0][1].where).toEqual({
        all: [{ path: "_id", op: "eq", values: [{ oid: HEX }] }],
      });
      expect(answer.documents.gone).toBe(true);
    });

    it("never says a record is gone when its read kept fewer of its rows than it found", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [shownRow([0]), shownRow([1])], 9),
      );
      fetchingWith();

      const answer = await ask(
        "db.applications.aggregate([{ $unwind: '$phases' }, { $limit: 2 }])",
        { show: show({ at: [7] }) },
      );

      expect(runPart.mock.calls[0][1].limit).toBe(2);
      expect(answer.rows).toEqual([]);
      expect(answer.documents.gone).toBe(false);
      expect(answer).not.toHaveProperty("cut");
    });

    it("says the record is gone when its row is read but its document is gone", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [shownRow([])]));
      fetchingWith({ doc: undefined, gone: true });

      const answer = await ask(TEXT, { show: show() });

      expect(answer.rows[0].docNote).toEqual({ gone: true });
      expect(answer.documents.gone).toBe(true);
    });

    it("reads an event in a Caseworking box from Caseworking alone, by its service and box", async () => {
      queryCwExplore
        .mockResolvedValueOnce(
          exactPart("cw.inbox", [shownRow([], 40, "cw.inbox")]),
        )
        .mockImplementationOnce(async (query) => ({
          documents: query.rows.map((one) => ({
            ...one,
            doc: docOf("event"),
            context: { service: "CW", box: "inbox" },
          })),
        }));

      const answer = await ask(
        "db.events.find({ status: 'DEAD_LETTER' }, { publicationDate: 1 })",
        { show: show({ service: "CW", box: "inbox" }) },
      );
      const [read, fetch] = queryCwExplore.mock.calls.map(([query]) => query);

      expect(runPart).not.toHaveBeenCalled();
      expect(read.where).toEqual({
        all: [
          { path: "_id", op: "eq", values: [{ oid: HEX }] },
          { path: "service", op: "eq", values: ["CW"] },
          { path: "box", op: "eq", values: ["inbox"] },
        ],
      });
      expect(fetch).toMatchObject({
        mode: "documents",
        where: { path: "status", op: "eq", values: ["DEAD_LETTER"] },
        rows: [{ box: "cw.inbox", id: oidId, at: [] }],
      });
      expect(answer.rows[0]).toMatchObject({
        doc: docOf("event"),
        context: { service: "CW", box: "inbox" },
      });
    });

    it.each([
      [
        "an _id of another type than the source's",
        TEXT,
        show({ id: BSON.serialize({ _id: "AGR-1" }).toString("base64") }),
        "This _id isn’t one applications have",
      ],
      [
        "a query that gives no records",
        "db.applications.distinct('code')",
        show(),
        "Show it shows one record’s row, and this query gives no records",
      ],
      [
        "a service and box beside a record that isn't an event",
        TEXT,
        show({ service: "GAS", box: "outbox" }),
        "Show it reads an event by its service and box, and nothing else by them",
      ],
      [
        "positions for an $unwind the query hasn't",
        TEXT,
        show({ at: [3] }),
        "Show it’s row positions don’t fit this query’s $unwind",
      ],
      [
        "fewer positions than the query's $unwinds",
        "db.applications.aggregate([{ $unwind: '$phases' }])",
        show({ at: [] }),
        "Show it’s row positions don’t fit this query’s $unwind",
      ],
      [
        "a text _id that isn't valid UTF-8",
        "db.agreements.find({})",
        show({
          id: Buffer.from(
            "1100000002" + "5f696400" + "03000000" + "ff6200",
            "hex",
          ).toString("base64"),
        }),
        "This _id isn’t one agreements have",
      ],
      [
        "an event without its service and box",
        "db.events.find({}, { publicationDate: 1 })",
        show(),
        "Show it reads an event by its service and box, and nothing else by them",
      ],
    ])(
      "refuses %s in GAS's own words, reading nothing",
      async (_, text, asked, message) => {
        const error = await failure(ask(text, { show: asked }));

        expect(error.output.payload).toMatchObject({
          statusCode: 400,
          reason: "QUERY_REFUSED",
          message,
          service: "GAS",
        });
        expect(runPart).not.toHaveBeenCalled();
      },
    );

    it("streams the one row, its header saying the record is gone once its document is found gone", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [shownRow([])]));
      fetchingWith({ doc: undefined, gone: true });

      const lines = await linesOf(
        (
          await ask(TEXT, {
            csv: true,
            documents: true,
            stream: true,
            show: show(),
          })
        ).stream,
      );

      expect(lines[0].header.documents).toEqual({ whole: true, gone: true });
      expect(lines[1].row.docNote).toEqual({ gone: true });
    });

    it("streams the one row, saying in its header when the record is gone", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", []));

      const lines = await linesOf(
        (
          await ask(TEXT, {
            csv: true,
            documents: true,
            stream: true,
            show: show(),
          })
        ).stream,
      );

      expect(lines[0].header.documents).toEqual({ whole: true, gone: true });
      expect(lines).toHaveLength(2);
      expect(lines[1].end.stopped).toBeNull();
    });
  });

  describe("Download JSON, streamed", () => {
    const TEXT = "db.applications.find({}, { clientRef: 1 })";
    const STREAM = { csv: true, documents: true, stream: true };

    it("streams a header, a line a row and an end line, then audits it once", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [stored(5, 1), stored(4, 2)]),
      );
      fetchingAll();

      const { stream } = await ask(TEXT, STREAM);
      const lines = await linesOf(stream);

      expect(lines[0].header).toMatchObject({
        source: { name: "applications" },
        mode: "rows",
        limits: { rows: 5000, raise: "limit" },
      });
      expect(
        lines.slice(1, 3).map(({ row: line }) => Object.keys(line)),
      ).toEqual([
        ["open", "id", "at", "doc", "context", "docNote"],
        ["open", "id", "at", "doc", "context", "docNote"],
      ]);
      expect(lines[1].row).toMatchObject({ id: idOf(1), docNote: null });
      expect(lines[3]).toEqual({
        end: { stopped: null, searchedTo: at(4), skipped: [] },
      });
      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));
      expect(audits()[0]).toMatchObject({
        status: "success",
        details: { resultCount: 2, download: "JSON", outcome: "ANSWERED" },
      });
      expect(logged()).not.toContain("Sentinel");
    });

    it("answers only its check when a check is asked", async () => {
      expect(await ask(TEXT, { ...STREAM, check: true })).toEqual({
        ok: true,
        source: "applications",
        vocabulary: VOCABULARY,
      });
      expect(runPart).not.toHaveBeenCalled();
    });

    it("audits a refusal before the first byte as the same CSV's, as JSON", async () => {
      runPart.mockRejectedValue(refuseQuery("TOO_MANY_TO_SORT"));

      await failure(ask(`${TEXT}.sort({ clientRef: 1 })`, STREAM));
      await failure(ask(`${TEXT}.sort({ clientRef: 1 })`, { csv: true }));

      expect(audits().map(({ status, details }) => [status, details])).toEqual([
        [
          "failure",
          {
            source: "applications",
            resultCount: null,
            download: "JSON",
            outcome: "TOO_MANY_TO_SORT",
          },
        ],
        [
          "failure",
          {
            source: "applications",
            resultCount: null,
            download: "CSV",
            outcome: "TOO_MANY_TO_SORT",
          },
        ],
      ]);
    });

    it("streams a grouped download's worked-out documents, saying nothing stopped it", async () => {
      runPart.mockResolvedValue({
        read: "exact",
        boxes: [
          {
            id: "gas.applications",
            rows: [],
            to: null,
            end: true,
            count: { n: 3, capped: false },
          },
        ],
        groups: [
          { key: "string:a", value: "a", n: 2, aggs: {} },
          { key: "string:b", value: "b", n: 1, aggs: {} },
        ],
      });

      const lines = await linesOf(
        (
          await ask(
            "db.applications.aggregate([{ $group: { _id: '$code' } }])",
            STREAM,
          )
        ).stream,
      );

      expect(lines.slice(1, -1).map(({ row: line }) => line.id)).toEqual([
        null,
        null,
      ]);
      expect(
        lines
          .slice(1, -1)
          .map(({ row: line }) =>
            BSON.deserialize(Buffer.from(line.doc, "base64")),
          ),
      ).toEqual([{ _id: "a" }, { _id: "b" }]);
      expect(lines.at(-1).end.stopped).toBeNull();
      expect(fetchDocuments).not.toHaveBeenCalled();
    });

    it("refuses before the first byte, as the answer would", async () => {
      runPart.mockRejectedValue(refuseQuery("TOO_MANY_TO_SORT"));

      const error = await failure(
        ask(`${TEXT}.sort({ clientRef: 1 })`, STREAM),
      );

      expect(error.output.payload).toMatchObject({
        statusCode: 400,
        reason: "QUERY_REFUSED",
        vocabulary: VOCABULARY,
      });
      expect(fetchDocuments).not.toHaveBeenCalled();
    });

    it("ends with stopped error when a batch fails, and audits it failed", async () => {
      runPart.mockResolvedValue(exactPart("gas.applications", [stored(5, 1)]));
      fetchDocuments.mockRejectedValue(new Error("mongod went away"));

      const { stream } = await ask(TEXT, STREAM);
      const lines = await linesOf(stream);

      expect(lines.at(-1).end.stopped).toBe("error");
      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));
      expect(audits()[0]).toMatchObject({
        status: "failure",
        details: { resultCount: 0, outcome: "FAILED" },
      });
    });

    it("says it stopped at its rows, and audits it partial", async () => {
      runPart.mockResolvedValue(
        exactPart("gas.applications", [stored(5, 1)], 9000),
      );
      fetchingAll();

      const lines = await linesOf((await ask(TEXT, STREAM)).stream);

      expect(lines.at(-1).end.stopped).toBe("rows");
      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));
      expect(audits()[0].details.outcome).toBe("PARTIAL");
    });

    it("audits it aborted when the caller goes away part way", async () => {
      const gone = new AbortController();
      const big = 12 * 1024 * 1024;

      runPart.mockResolvedValue(
        exactPart("gas.applications", [
          stored(5, 1, "gas.applications", big),
          stored(4, 2, "gas.applications", big),
        ]),
      );
      fetchDocuments.mockImplementation(
        async (_source, _query, { rows: asked }) => {
          gone.abort();

          return asked.map((one) => ({
            ...one,
            doc: docOf("a"),
            context: null,
          }));
        },
      );

      const { stream } = await ask(TEXT, STREAM, { signal: gone.signal });

      await textOf(stream);
      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));
      expect(fetchDocuments).toHaveBeenCalledTimes(1);
      expect(audits()[0]).toMatchObject({
        status: "failure",
        details: { resultCount: 1, outcome: "ABORTED" },
      });
    });

    it("audits every download as its operator, though a stream ends after its request", async () => {
      const audited = [];
      writeAuditEvent.mockImplementation(async ({ details }) =>
        audited.push({
          download: details.download,
          outcome: details.outcome,
          user: getRequestContext()?.user ?? null,
        }),
      );
      const asOperator = (asking) =>
        withRequestContext({ user: ACTOR_ID }, asking);
      const gone = new AbortController();

      runPart.mockResolvedValue(exactPart("gas.applications", [stored(5, 1)]));
      fetchingAll();

      await asOperator(() => ask(TEXT, { csv: true }));
      await linesOf((await asOperator(() => ask(TEXT, STREAM))).stream);

      const { stream } = await asOperator(() =>
        ask(TEXT, STREAM, { signal: gone.signal }),
      );
      gone.abort();
      stream.destroy();
      await vi.waitFor(() => expect(audited).toHaveLength(3));

      runPart.mockRejectedValue(refuseQuery("TOO_MANY_TO_SORT"));
      await asOperator(() =>
        failure(ask(`${TEXT}.sort({ clientRef: 1 })`, STREAM)),
      );

      expect(audited).toEqual([
        { download: "CSV", outcome: "ANSWERED", user: ACTOR_ID },
        { download: "JSON", outcome: "ANSWERED", user: ACTOR_ID },
        { download: "JSON", outcome: "ABORTED", user: ACTOR_ID },
        { download: "JSON", outcome: "TOO_MANY_TO_SORT", user: ACTOR_ID },
      ]);
    });

    it("audits it aborted, and frees the operator, when the stream is closed before its first read", async () => {
      const gone = new AbortController();

      runPart.mockResolvedValue(exactPart("gas.applications", [stored(5, 1)]));

      const { stream } = await ask(TEXT, STREAM, { signal: gone.signal });

      gone.abort();
      stream.destroy();

      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));
      expect(fetchDocuments).not.toHaveBeenCalled();
      expect(audits()[0]).toMatchObject({
        status: "failure",
        details: { resultCount: 0, download: "JSON", outcome: "ABORTED" },
      });

      runPart.mockResolvedValue(exactPart("gas.applications", []));
      await expect(ask(TEXT)).resolves.toMatchObject({ read: "exact" });
    });

    it("keeps the operator's slot until the stream ends", async () => {
      let release;

      runPart.mockResolvedValue(exactPart("gas.applications", [stored(5, 1)]));
      fetchDocuments.mockImplementation(
        (_source, _query, { rows: asked }) =>
          new Promise((resolve) => {
            release = () =>
              resolve(
                asked.map((one) => ({
                  ...one,
                  doc: docOf("a"),
                  context: null,
                })),
              );
          }),
      );

      const { stream } = await ask(TEXT, STREAM);
      const read = textOf(stream);

      await vi.waitFor(() => expect(release).toBeDefined());

      const busy = await failure(ask(TEXT));

      expect(busy.output.payload).toMatchObject({ refusal: "BUSY" });

      release();
      await read;
      await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalledTimes(1));

      runPart.mockResolvedValue(exactPart("gas.applications", []));
      await expect(ask(TEXT)).resolves.toMatchObject({ read: "exact" });
    });
  });
});
