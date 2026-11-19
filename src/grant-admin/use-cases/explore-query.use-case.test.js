import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodePositions,
  encodePositions,
} from "../../common/explore/merge.js";
import { MAX_LIMIT } from "../../common/explore/query-schema.js";
import { refuseQuery } from "../../common/explore/refusal.js";
import { runPart } from "../../common/explore/run.js";
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
  versions: [2],
  sources: [
    {
      name: "cases",
      label: "Cases, in Caseworking",
      service: "CW",
      size: "big",
      noun: { one: "case", many: "cases" },
      star: ["caseRef", "workflowCode", "currentStatus", "createdAt"],
      time: "createdAt",
      roots: [
        "caseRef",
        "workflowCode",
        "currentStatus",
        "createdAt",
        "payload",
      ],
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

  it("refuses a path under none of the source's roots", async () => {
    const text = "db.applications.find({}, { clientRef: 1, colour: 1 })";
    const error = await failure(ask(text));

    expect(error.output.payload.error).toMatchObject({
      message: expect.stringMatching(
        /^Applications can’t read “colour”\. A path starts with clientRef, code, /,
      ),
      at: text.indexOf("colour"),
    });
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["db.applications.find({ anything: /9238/ })", "anything"],
    ["db.applications.find({ 'identifiers.nino': 'x' })", "nino"],
    ["db.applications.find({ _id: 'x' })", "_id"],
    ["db.cases.find({ comments: /x/ })", "comments"],
    ["db.cases.find({ 'payload.answers.sortCode': 'x' })", "sortCode"],
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
    expect(query).toMatchObject({ v: 2, limit: 50, positions: null });
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
      csv: false,
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

  it("asks Caseworking for its source at the version both read, with the operator", async () => {
    queryCwExplore.mockResolvedValue(exactPart("cw.cases", [row(5, 1, "CW")]));

    await ask(
      "db.cases.find({ workflowCode: 'w' }, { caseRef: 1, 'payload.answers.applicant.business.name': 1 })",
    );

    expect(queryCwExplore).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 2,
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

  it("words Caseworking refusing a path off its roots, naming Caseworking", async () => {
    queryCwExplore.mockRejectedValue(
      Object.assign(refuseQuery("PATH_NOT_ALLOWED"), { service: "CW" }),
    );

    const error = await failure(
      ask("db.cases.find({ workflowCode: 'w' }, { caseRef: 1 })"),
    );

    expect(error.output.payload).toEqual({
      statusCode: 400,
      reason: "QUERY_REFUSED",
      message: "Caseworking doesn’t let Explore read a path this query uses",
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
    expect(audits()[0].details.csv).toBe(true);
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
            { partial: true, skipped: 1 },
          ),
        )
        .mockResolvedValueOnce(box([row(30, 3)], null));

      const answer = await ask(QUERY, { csv: true, untilEnd: true });

      expect(runPart).toHaveBeenCalledTimes(2);
      expect(answer).toMatchObject({
        partial: false,
        window: { end: true, skipped: 1, positions: null },
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

  it("caps LIMIT and uses the limit asked", async () => {
    runPart.mockResolvedValue(exactPart("gas.agreements", []));

    await ask("db.agreements.find({}, { agreementNumber: 1 }).limit(9000)");
    await ask("db.agreements.find({}, { agreementNumber: 1 })", { limit: 7 });

    expect(runPart.mock.calls.map(([, query]) => query.limit)).toEqual([
      5000, 7,
    ]);
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
        .mockResolvedValueOnce(skipping([dated(50, 1)], after(30, 3), 1))
        .mockResolvedValueOnce(skipping([], after(10, 5), 2));

      const answer = await ask(
        `db.applications.find({ '${BUSINESS}': /x/ }, { createdAt: 1 })`,
        { windows: 2 },
      );

      expect(answer.columns).toEqual([
        expect.objectContaining({ label: "createdAt", kind: "date" }),
      ]);
      expect(answer).toMatchObject({
        windowRows: [1, 0],
        window: { to: at(10), skipped: 3 },
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
