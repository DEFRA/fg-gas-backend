import Boom from "@hapi/boom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listApiTokens } from "../../auth/services/api-client.service.js";
import { countBins } from "../../common/buckets/bins.js";
import { parseQuery, runQuery } from "../../common/buckets/engine.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { parseSummary, runSummary } from "../../common/buckets/summary.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  countCwDeadLetters,
  findCwBuckets,
  readCwBucketPage,
  summariseCwBucket,
} from "../repositories/cw-actuators.repository.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { CACHE_MS, clearOverviewCache } from "../services/overview-cache.js";
import { OVERVIEW_BUDGET_MS } from "../services/overview-reads.js";
import { buildOverviewView } from "../view-models/build-overview-view.js";
import { viewOverviewUseCase } from "./view-overview.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../../auth/services/api-client.service.js");
vi.mock("../../common/buckets/bins.js");
vi.mock("../../common/buckets/registry.js");
vi.mock("../../common/buckets/summary.js");
vi.mock("../../common/buckets/engine.js", async (importOriginal) => ({
  COUNT_CAP: (await importOriginal()).COUNT_CAP,
  parseQuery: vi.fn(),
  runQuery: vi.fn(),
}));
vi.mock("../repositories/cw-actuators.repository.js");
vi.mock("../repositories/cw-clients.repository.js");

const AT = new Date("2026-10-13T15:00:00.000Z");
const FROM = "2026-10-12T15:00:00.000Z";
const TO = AT.toISOString();
const TWO_HOURS = 2 * 60 * 60 * 1000;

const WHO = {
  actor: "UTF-8''%C5%81ukasz",
  decodedActor: "Łukasz",
  caller: "fg-grants-platform-admin",
  callerHash: "c".repeat(64),
};

const binsOf = (counts, from = FROM) =>
  counts.map((count, i) => ({
    from: new Date(Date.parse(from) + i * TWO_HOURS).toISOString(),
    to: new Date(Date.parse(from) + (i + 1) * TWO_HOURS).toISOString(),
    count,
    capped: false,
  }));

const twelve = (first) => [first, ...Array.from({ length: 11 }, () => 0)];

const facts = (eventTypes) => ({
  status: { param: "status", values: [{ value: "DEAD_LETTER" }] },
  eventType: { param: "event", values: eventTypes },
  errorKey: { param: "error" },
});

const errorsSummary = {
  id: "errors",
  among: { status: "DEAD_LETTER" },
};

const BUCKETS = {
  "gas.outbox": {
    id: "gas.outbox",
    path: "events/gas/outbox",
    facts: facts([{ value: "CreateCase", label: "Create case" }]),
    summaries: [errorsSummary],
  },
  "gas.inbox": {
    id: "gas.inbox",
    path: "events/gas/inbox",
    facts: facts([]),
    summaries: [errorsSummary],
  },
  "gas.grants": { id: "gas.grants", path: "grants", facts: {} },
};

const cwEntry = (id, path) => ({
  id,
  path,
  facts: [
    { name: "status", param: "status", values: [] },
    {
      name: "eventType",
      param: "event",
      values: [{ value: "UpdateCaseStatus", label: "Update case status" }],
    },
    { name: "errorKey", param: "error", values: null },
  ],
  summaries: [errorsSummary],
});

const anEntry = (errorKey, eventType, count) => ({
  values: { errorKey, eventType },
  count,
  capped: false,
  firstAt: null,
  lastAt: "2026-10-13T14:00:00.000Z",
});

const aSummary = (entries) => ({
  bucket: "x",
  summary: "errors",
  entries,
  more: false,
  complete: true,
});

const aPage = (rows) => ({
  bucket: "x",
  plan: {
    kind: "exact",
    index: [],
    bound: [],
    filled: [],
    residual: [],
    scans: 1,
  },
  rows,
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [],
});

const aRow = (kind, code, version) => ({
  id: "66f000000000000000000001",
  time: "2026-10-13T09:12:00.000Z",
  title: code,
  subtitle: null,
  cells: {},
  link: { kind, code, version },
});

const aToken = (tokenId, status, expiresAt) => ({
  tokenId,
  clientId: "grants-ui",
  tokenHint: "ab12",
  status,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  createdBy: "Ada Lovelace",
  expiresAt: new Date(expiresAt),
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: {},
});

const cwDeadLetters = (from = FROM) => ({
  from,
  to: TO,
  countCap: 10_000,
  buckets: [
    {
      id: "cw.outbox",
      list: { path: "events/cw/outbox", query: { status: "DEAD_LETTER" } },
      bins: binsOf(twelve(1), from),
    },
    {
      id: "cw.inbox",
      list: { path: "events/cw/inbox", query: { status: "DEAD_LETTER" } },
      bins: binsOf(twelve(2), from),
    },
  ],
});

const cwUnanswered = (cwReason) =>
  Object.assign(Boom.badGateway("CW-BE is unavailable"), { cwReason });

const READERS = {
  deadLetters: { gas: countBins, cw: countCwDeadLetters },
  topErrors: { gas: runSummary, cw: summariseCwBucket },
  configFailed: { gas: runQuery, cw: readCwBucketPage },
  tokensExpiring: { gas: listApiTokens, cw: findCwApiTokens },
};

const PARTS = Object.entries(READERS).flatMap(([part, services]) =>
  Object.keys(services).map((service) => [part, service]),
);

const read = (data) => ({ data, sourceError: null });

const notRead = (hop, reason) => ({ data: null, sourceError: { hop, reason } });

// The kept parts' reads: the tokens are read for every request.
const readsMade = () =>
  Object.entries(READERS)
    .filter(([part]) => part !== "tokensExpiring")
    .flatMap(([, readers]) => Object.values(readers))
    .reduce((sum, reader) => sum + reader.mock.calls.length, 0);

const asRead = (_part, _service, read) => read;

// The route's two steps: the use case's read, then the page's shape.
const view = async () =>
  buildOverviewView(await viewOverviewUseCase(WHO, asRead));

beforeEach(() => {
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  clearOverviewCache();

  findBucket.mockImplementation((id) => BUCKETS[id]);
  countBins.mockImplementation(async (bucket) =>
    binsOf(twelve(bucket.id === "gas.outbox" ? 3 : 4)),
  );
  parseSummary.mockImplementation((bucket, summaryId, body) => ({
    bucket,
    summaryId,
    body,
  }));
  runSummary.mockImplementation(async (bucket) =>
    aSummary(
      bucket.id === "gas.outbox"
        ? [anEntry("Grant <v> not found", "CreateCase", 9)]
        : [anEntry(null, null, 2)],
    ),
  );
  parseQuery.mockImplementation((_, body) => body);
  runQuery.mockImplementation(async (_, { where }) =>
    aPage(
      where.worstFetchStatus === "permanent_error"
        ? [aRow("grant", "frps", "1.11.0")]
        : [],
    ),
  );
  listApiTokens.mockResolvedValue({
    tokens: [
      aToken("gas-soon", "ACTIVE", "2026-10-20T00:00:00.000Z"),
      aToken("gas-later", "ACTIVE", "2027-01-01T00:00:00.000Z"),
    ],
  });

  countCwDeadLetters.mockImplementation(async ({ from }) =>
    cwDeadLetters(from),
  );
  findCwBuckets.mockResolvedValue([
    cwEntry("cw.outbox", "events/cw/outbox"),
    cwEntry("cw.inbox", "events/cw/inbox"),
  ]);
  summariseCwBucket.mockImplementation(async (id) =>
    aSummary(
      id === "cw.inbox"
        ? [anEntry("Status <v> unknown", "UpdateCaseStatus", 5)]
        : [],
    ),
  );
  readCwBucketPage.mockImplementation(async (_, { where }) =>
    aPage(
      where.fetchStatus === "transient_error"
        ? [aRow("workflow", "woodland", "2.1.0")]
        : [],
    ),
  );
  findCwApiTokens.mockResolvedValue({
    tokens: [aToken("cw-gone", "EXPIRED", "2026-10-01T00:00:00.000Z")],
  });

  withTransaction.mockImplementation(async (operation) => operation({}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the Overview, read and shaped", () => {
  it("answers when it was worked out and the 24 hours its counts cover", async () => {
    expect(await view()).toMatchObject({
      at: TO,
      window: { from: FROM, to: TO },
      countCap: 10_000,
    });
  });

  it("counts GAS's dead letters in both boxes in twelve two-hour bars, audit events left to the engine", async () => {
    const { deadLetters } = await view();

    expect(deadLetters.gas).toEqual(
      read({
        count: 7,
        capped: false,
        bars: binsOf(twelve(7)),
        lists: [
          {
            box: "outbox",
            count: 3,
            capped: false,
            list: {
              path: "events/gas/outbox",
              query: { status: "DEAD_LETTER", from: FROM, to: TO },
            },
          },
          {
            box: "inbox",
            count: 4,
            capped: false,
            list: {
              path: "events/gas/inbox",
              query: { status: "DEAD_LETTER", from: FROM, to: TO },
            },
          },
        ],
      }),
    );
    expect(countBins).toHaveBeenCalledWith(BUCKETS["gas.inbox"], {
      where: { status: "DEAD_LETTER" },
      from: FROM,
      to: TO,
      binMs: TWO_HOURS,
    });
  });

  it("adds Caseworking's boxes from its actuator, as the operator", async () => {
    const { deadLetters } = await view();

    expect(deadLetters.cw).toEqual(
      read({
        count: 3,
        capped: false,
        bars: binsOf(twelve(3)),
        lists: [
          {
            box: "outbox",
            count: 1,
            capped: false,
            list: {
              path: "events/cw/outbox",
              query: { status: "DEAD_LETTER", from: FROM, to: TO },
            },
          },
          {
            box: "inbox",
            count: 2,
            capped: false,
            list: {
              path: "events/cw/inbox",
              query: { status: "DEAD_LETTER", from: FROM, to: TO },
            },
          },
        ],
      }),
    );
    expect(countCwDeadLetters).toHaveBeenCalledWith(
      { from: FROM, to: TO, binMs: TWO_HOURS },
      { actor: WHO.actor },
    );
  });

  it("caps Caseworking's figures at the cap Caseworking counted to", async () => {
    countCwDeadLetters.mockResolvedValue({
      ...cwDeadLetters(),
      countCap: 2,
    });

    const { deadLetters } = await view();

    expect(deadLetters.cw.data).toMatchObject({ count: 2, capped: true });
    expect(deadLetters.cw.data.lists[0]).toMatchObject({
      count: 1,
      capped: false,
    });
  });

  it("ranks each service's top errors among every current dead letter, linked to the list they are in", async () => {
    const { topErrors } = await view();

    expect(topErrors.gas.data.entries.map(({ errorKey }) => errorKey)).toEqual([
      "Grant <v> not found",
      null,
    ]);
    expect(topErrors.gas.data.entries[0]).toMatchObject({
      event: { value: "CreateCase", label: "Create case" },
      list: {
        path: "events/gas/outbox",
        query: {
          status: "DEAD_LETTER",
          error: "Grant <v> not found",
          event: "CreateCase",
        },
      },
    });
    expect(parseSummary).toHaveBeenCalledWith(
      BUCKETS["gas.inbox"],
      "errors",
      {},
    );
    expect(topErrors.cw.data.entries).toEqual([
      {
        errorKey: "Status <v> unknown",
        event: { value: "UpdateCaseStatus", label: "Update case status" },
        count: 5,
        capped: false,
        lastAt: "2026-10-13T14:00:00.000Z",
        list: {
          path: "events/cw/inbox",
          query: {
            status: "DEAD_LETTER",
            error: "Status <v> unknown",
            event: "UpdateCaseStatus",
          },
        },
      },
    ]);
    expect(summariseCwBucket).toHaveBeenCalledWith(
      "cw.outbox",
      "errors",
      {},
      { actor: WHO.actor },
    );
  });

  it("answers the active grant and workflow versions whose definition failed, either way", async () => {
    const { configFailed } = await view();

    expect(configFailed.gas).toEqual(
      read({
        versions: [
          {
            code: "frps",
            version: "1.11.0",
            definition: "permanent_error",
            receivedAt: "2026-10-13T09:12:00.000Z",
          },
        ],
        more: false,
      }),
    );
    expect(configFailed.cw.data.versions).toEqual([
      {
        code: "woodland",
        version: "2.1.0",
        definition: "transient_error",
        receivedAt: "2026-10-13T09:12:00.000Z",
      },
    ]);
    expect(parseQuery).toHaveBeenCalledWith(BUCKETS["gas.grants"], {
      where: { status: "active", worstFetchStatus: "transient_error" },
      limit: 100,
      groupBy: [],
    });
    expect(readCwBucketPage).toHaveBeenCalledWith(
      "cw.workflows",
      {
        where: { status: "active", fetchStatus: "permanent_error" },
        limit: 100,
        groupBy: [],
      },
      { actor: WHO.actor },
    );
  });

  it("answers each service's tokens expiring within 30 days, or expired", async () => {
    const { tokensExpiring } = await view();

    expect(
      tokensExpiring.gas.data.tokens.map(({ tokenId }) => tokenId),
    ).toEqual(["gas-soon"]);
    expect(tokensExpiring.cw.data).toMatchObject({
      withinDays: 30,
      tokens: [{ tokenId: "cw-gone", status: "EXPIRED" }],
    });
    expect(listApiTokens).toHaveBeenCalledWith({ callerHash: WHO.callerHash });
    expect(findCwApiTokens).toHaveBeenCalledWith({ actor: WHO.actor });
  });

  describe("a part that cannot be read", () => {
    it.each(PARTS)("%s of %s fails alone", async (part, service) => {
      READERS[part][service].mockRejectedValue(new Error("boom"));

      const overview = await view();

      expect(overview[part][service]).toEqual(
        notRead(service === "cw" ? "CW-BE" : "GAS", "ERRORED"),
      );
      expect(
        PARTS.filter(([other, otherService]) =>
          Boolean(overview[other][otherService].sourceError),
        ),
      ).toEqual([[part, service]]);
    });

    it("says GAS's own read ran out of time", async () => {
      countBins.mockRejectedValue(refuse("TIMED_OUT"));

      expect((await view()).deadLetters.gas).toEqual(
        notRead("GAS", "TIMED_OUT"),
      );
    });

    it.each(["UNREACHABLE", "TIMED_OUT", "NOT_OFFERED", "ERRORED"])(
      "says why Caseworking gave no answer: %s",
      async (cwReason) => {
        summariseCwBucket.mockRejectedValue(cwUnanswered(cwReason));

        expect((await view()).topErrors.cw).toEqual(notRead("CW-BE", cwReason));
      },
    );

    it.each([
      ["without one of the lists", () => [cwEntry("cw.outbox", "x")]],
      [
        "whose list declares no summaries",
        () => [
          cwEntry("cw.outbox", "x"),
          { ...cwEntry("cw.inbox", "y"), summaries: undefined },
        ],
      ],
    ])(
      "says a Caseworking %s does not offer its errors",
      async (_, entries) => {
        findCwBuckets.mockResolvedValue(entries());

        expect((await view()).topErrors.cw).toEqual(
          notRead("CW-BE", "NOT_OFFERED"),
        );
      },
    );

    describe("out of time", () => {
      // As the driver does: a transaction given a timeoutMS fails once it runs
      // out, and commits only if its work finished first.
      const committed = [];
      const bounded = (operation, { timeoutMS }) =>
        new Promise((resolve, reject) => {
          let settled = false;
          const settle = (done) => {
            if (!settled) {
              settled = true;
              done();
            }
          };
          if (timeoutMS !== undefined) {
            setTimeout(
              () => settle(() => reject(new Error("timed out"))),
              timeoutMS,
            );
          }
          operation({}).then(
            () =>
              settle(() => {
                committed.push(operation);
                resolve();
              }),
            (error) => settle(() => reject(error)),
          );
        });

      beforeEach(() => {
        committed.length = 0;
        vi.useFakeTimers({
          now: AT,
          toFake: ["Date", "setTimeout", "clearTimeout"],
        });
      });

      it.each([
        ["GAS", "gas", countBins],
        ["CW-BE", "cw", countCwDeadLetters],
      ])(
        "answers %s's part that is still reading as out of time, within its budget",
        async (hop, service, reader) => {
          reader.mockReturnValue(new Promise(() => {}));

          const viewed = view();
          await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS);
          const overview = await viewed;

          expect(overview.deadLetters[service]).toEqual(
            notRead(hop, "TIMED_OUT"),
          );
          expect(overview.topErrors[service].sourceError).toBeNull();
        },
      );

      const slow = (value) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(value), OVERVIEW_BUDGET_MS - 100);
        });

      it("answers a cold read within one budget, the tokens and their audit read beside the rest", async () => {
        countBins.mockImplementation(() => slow(binsOf(twelve(1))));
        listApiTokens.mockImplementation(() =>
          slow({ tokens: [aToken("gas-soon", "ACTIVE", "2026-10-20")] }),
        );
        let answered = false;

        const viewed = view().then((overview) => {
          answered = true;
          return overview;
        });
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS);

        expect(answered).toBe(true);
        const overview = await viewed;
        expect(overview.deadLetters.gas.sourceError).toBeNull();
        expect(overview.tokensExpiring.gas.sourceError).toBeNull();
        expect(writeAuditEvent).toHaveBeenCalledTimes(2);
      });

      it("withholds the tokens when their audit is still writing at the end of the budget", async () => {
        writeAuditEvent.mockReturnValue(new Promise(() => {}));
        withTransaction.mockImplementation(bounded);

        const viewed = view();
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS);
        const overview = await viewed;

        expect(overview.tokensExpiring.gas).toEqual(
          notRead("GAS", "TIMED_OUT"),
        );
        expect(overview.deadLetters.gas.sourceError).toBeNull();
      });

      it("never commits a SUCCESS audit for tokens it withholds, an insert that outruns the budget cut short", async () => {
        listApiTokens.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    tokens: [aToken("gas-soon", "ACTIVE", "2026-10-20")],
                  }),
                OVERVIEW_BUDGET_MS - 10,
              );
            }),
        );
        findCwApiTokens.mockResolvedValue({ tokens: [] });
        writeAuditEvent.mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 50)),
        );
        withTransaction.mockImplementation(bounded);

        const viewed = view();
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS + 100);
        const overview = await viewed;

        expect(overview.tokensExpiring.gas).toEqual(
          notRead("GAS", "TIMED_OUT"),
        );
        expect(committed).toEqual([]);
      });

      const audited = () =>
        writeAuditEvent.mock.calls.map(([{ details, status }]) => [
          details.service,
          status,
        ]);

      it("audits a token list still running at the end of the budget as a FAILURE", async () => {
        findCwApiTokens.mockReturnValue(new Promise(() => {}));

        const viewed = view();
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS);
        const overview = await viewed;

        expect(overview.tokensExpiring.cw).toEqual(
          notRead("CW-BE", "TIMED_OUT"),
        );
        expect(audited()).toEqual([
          ["gas", "success"],
          ["cw", "failure"],
        ]);
      });

      it("never audits as viewed the tokens a list answers after the budget", async () => {
        findCwApiTokens.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    tokens: [aToken("cw-gone", "EXPIRED", "2026-10-01")],
                  }),
                OVERVIEW_BUDGET_MS + 100,
              );
            }),
        );

        const viewed = view();
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS + 100);
        const overview = await viewed;

        expect(overview.tokensExpiring.cw).toEqual(
          notRead("CW-BE", "TIMED_OUT"),
        );
        expect(audited()).toEqual([
          ["gas", "success"],
          ["cw", "failure"],
        ]);
      });

      it("reads a joined read's tokens by the joining call's own budget", async () => {
        countBins.mockImplementation(() => slow(binsOf(twelve(1))));
        const first = view();
        await vi.advanceTimersByTimeAsync(1_000);
        listApiTokens.mockImplementation(() =>
          slow({ tokens: [aToken("gas-soon", "ACTIVE", "2026-10-20")] }),
        );

        const second = view();
        await vi.advanceTimersByTimeAsync(OVERVIEW_BUDGET_MS);

        expect((await first).deadLetters.gas.sourceError).toBeNull();
        expect((await second).tokensExpiring.gas.sourceError).toBeNull();
        expect(countBins).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("the cache", () => {
    it("answers again from the first read for 60 seconds", async () => {
      const first = await view();
      const reads = readsMade();

      vi.setSystemTime(AT.getTime() + CACHE_MS - 1);

      expect(await view()).toEqual(first);
      expect(readsMade()).toBe(reads);
    });

    it("reads everything again after 60 seconds, over a new window", async () => {
      await view();
      const reads = readsMade();

      vi.setSystemTime(AT.getTime() + CACHE_MS);
      const again = await view();

      expect(again.at).toBe(new Date(AT.getTime() + CACHE_MS).toISOString());
      expect(readsMade()).toBe(2 * reads);
    });

    it("shares a read already in flight", async () => {
      const [first, second] = await Promise.all([view(), view()]);

      expect(second).toEqual(first);
      expect(countCwDeadLetters).toHaveBeenCalledOnce();
    });

    it("reads the tokens for each request, so each caller's token in use is its own", async () => {
      await view();
      vi.setSystemTime(AT.getTime() + 1_000);
      await view();

      expect(countCwDeadLetters).toHaveBeenCalledOnce();
      expect(listApiTokens).toHaveBeenCalledTimes(2);
      expect(findCwApiTokens).toHaveBeenCalledTimes(2);
    });

    it("reads a failed part again on the next request, over the same window, the rest kept", async () => {
      countCwDeadLetters.mockRejectedValueOnce(cwUnanswered("TIMED_OUT"));
      const first = await view();
      const reads = readsMade();

      vi.setSystemTime(AT.getTime() + 1_000);
      const second = await view();
      const third = await view();

      expect(first.deadLetters.cw.sourceError).not.toBeNull();
      expect(second.deadLetters.cw).toEqual(read(expect.any(Object)));
      expect(second.at).toBe(first.at);
      expect(countCwDeadLetters).toHaveBeenLastCalledWith(
        { from: FROM, to: TO, binMs: TWO_HOURS },
        { actor: WHO.actor },
      );
      expect(readsMade()).toBe(reads + 1);
      expect(second.topErrors).toEqual(first.topErrors);
      expect(third).toEqual(second);
    });

    it("shares a read again of a failed part already in flight", async () => {
      countCwDeadLetters.mockRejectedValueOnce(cwUnanswered("TIMED_OUT"));
      await view();

      const [second, third] = await Promise.all([view(), view()]);

      expect(third).toEqual(second);
      expect(countCwDeadLetters).toHaveBeenCalledTimes(2);
    });

    it("keeps a part its check refuses as failed, and reads it again, the corrected answer shown", async () => {
      const refused = {
        data: null,
        sourceError: notRead("CW-BE", "ERRORED").sourceError,
      };
      const isBad = ({ data }) =>
        JSON.stringify(data).includes('"version":"bad"');
      const checkPart = vi.fn((_part, _service, read) =>
        isBad(read) ? refused : read,
      );
      readCwBucketPage.mockImplementationOnce(async () =>
        aPage([aRow("workflow", "woodland", "bad")]),
      );
      const shown = async () =>
        buildOverviewView(await viewOverviewUseCase(WHO, checkPart));

      const first = await shown();
      const second = await shown();

      expect(first.configFailed.cw).toEqual(notRead("CW-BE", "ERRORED"));
      expect(second.configFailed.cw.sourceError).toBeNull();
      expect(checkPart).toHaveBeenCalledWith(
        "configFailed",
        "cw",
        expect.any(Object),
        { from: FROM, to: TO },
      );
    });

    it("does not ask again, until the answer expires, for a part Caseworking does not offer", async () => {
      countCwDeadLetters.mockRejectedValue(cwUnanswered("NOT_OFFERED"));
      await view();

      vi.setSystemTime(AT.getTime() + CACHE_MS - 1);
      await view();

      expect(countCwDeadLetters).toHaveBeenCalledOnce();
    });
  });

  describe("the tokens' audit", () => {
    const audits = () => writeAuditEvent.mock.calls.map(([event]) => event);

    it("records each service's tokens viewed, on every request, the cached ones too", async () => {
      await view();
      await view();

      expect(audits()).toHaveLength(4);
      expect(audits()[0]).toMatchObject({
        status: "success",
        entities: [
          { entity: "API_CLIENT", action: "VIEW_API_CLIENT", entityid: "gas" },
        ],
        details: { service: "gas", actor: "Łukasz", caller: WHO.caller },
        security: { pmccode: "0706" },
      });
      expect(audits()[1].details.service).toBe("cw");
      expect(JSON.stringify(audits())).not.toContain(WHO.callerHash);
    });

    it("records a service whose tokens could not be read as a FAILURE, as the tokens page does", async () => {
      findCwApiTokens.mockRejectedValue(cwUnanswered("TIMED_OUT"));

      const overview = await view();

      expect(overview.tokensExpiring.cw).toEqual(notRead("CW-BE", "TIMED_OUT"));
      expect(
        audits().map(({ details, status }) => [details.service, status]),
      ).toEqual([
        ["gas", "success"],
        ["cw", "failure"],
      ]);
      expect(audits()[1].details).toMatchObject({
        actor: "Łukasz",
        errorCode: "UNEXPECTED_FAILURE",
      });
    });

    it("withholds the tokens, and only them, when the audit cannot be written", async () => {
      withTransaction.mockRejectedValue(new Error("no primary"));

      const overview = await view();

      expect(overview.tokensExpiring).toEqual({
        gas: notRead("GAS", "ERRORED"),
        cw: notRead("GAS", "ERRORED"),
      });
      expect(overview.deadLetters.gas.sourceError).toBeNull();
    });

    it("withholds only the service whose audit cannot be written", async () => {
      withTransaction
        .mockImplementationOnce(async (operation) => operation({}))
        .mockRejectedValueOnce(new Error("no primary"));

      const overview = await view();

      expect(overview.tokensExpiring.gas.sourceError).toBeNull();
      expect(overview.tokensExpiring.cw).toEqual(notRead("GAS", "ERRORED"));
    });

    it("writes none for a service that lists no tokens", async () => {
      findCwApiTokens.mockResolvedValue({ tokens: [] });

      await view();

      expect(audits().map(({ details }) => details.service)).toEqual(["gas"]);
    });

    it("writes only FAILURE audits when no tokens were read", async () => {
      listApiTokens.mockRejectedValue(new Error("boom"));
      findCwApiTokens.mockRejectedValue(new Error("boom"));

      await view();

      expect(withTransaction).not.toHaveBeenCalled();
      expect(audits().map(({ status }) => status)).toEqual([
        "failure",
        "failure",
      ]);
    });
  });
});
