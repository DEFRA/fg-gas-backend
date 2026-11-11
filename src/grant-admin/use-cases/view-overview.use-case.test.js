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
  queryCwBucket,
  summariseCwBucket,
} from "../repositories/cw-actuators.repository.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import {
  CACHE_MS,
  FIRST_RETRY_MS,
  clearOverviewCache,
  overviewRetry,
} from "../services/overview-cache.js";
import { PART_BUDGET_MS } from "../services/overview-reads.js";
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
  configFailed: { gas: runQuery, cw: queryCwBucket },
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

// The route's two steps: the use case's read, then the page's shape.
const view = async () => buildOverviewView(await viewOverviewUseCase(WHO));

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
  queryCwBucket.mockImplementation(async (_, { where }) =>
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
      { from: FROM, to: TO },
      { actor: WHO.actor },
    );
  });

  it("does not take Caseworking's bins for another window", async () => {
    countCwDeadLetters.mockResolvedValue(cwDeadLetters(TO));

    expect((await view()).deadLetters.cw).toEqual(notRead("CW-BE", "ERRORED"));
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
    expect(queryCwBucket).toHaveBeenCalledWith(
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

    it.each([
      ["topErrors", summariseCwBucket, "UNKNOWN_SUMMARY"],
      ["configFailed", queryCwBucket, "UNKNOWN_BUCKET"],
    ])(
      "says a Caseworking that answers %s with %s does not offer it",
      async (part, reader, reason) => {
        reader.mockRejectedValue(refuse(reason));

        expect((await view())[part].cw).toEqual(
          notRead("CW-BE", "NOT_OFFERED"),
        );
      },
    );

    describe("out of time", () => {
      beforeEach(() => {
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
          await vi.advanceTimersByTimeAsync(PART_BUDGET_MS);
          const overview = await viewed;

          expect(overview.deadLetters[service]).toEqual(
            notRead(hop, "TIMED_OUT"),
          );
          expect(overview.topErrors[service].sourceError).toBeNull();
        },
      );
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

    it("answers the kept answer at once while a failed part is read again in the background, over the same window", async () => {
      countCwDeadLetters.mockRejectedValueOnce(cwUnanswered("TIMED_OUT"));
      const first = await view();
      const reads = readsMade();

      vi.setSystemTime(AT.getTime() + FIRST_RETRY_MS);
      const second = await view();
      await overviewRetry();
      const third = await view();

      expect(first.deadLetters.cw.sourceError).not.toBeNull();
      expect(second.deadLetters.cw.sourceError).not.toBeNull();
      expect(third.deadLetters.cw).toEqual(read(expect.any(Object)));
      expect(third.at).toBe(first.at);
      expect(countCwDeadLetters).toHaveBeenLastCalledWith(
        { from: FROM, to: TO },
        { actor: WHO.actor },
      );
      expect(readsMade()).toBe(reads + 1);
      expect(third.topErrors).toEqual(first.topErrors);
    });

    it("waits longer before each retry", async () => {
      countCwDeadLetters.mockRejectedValue(cwUnanswered("TIMED_OUT"));
      await view();

      const triesBy = async (ms) => {
        vi.setSystemTime(AT.getTime() + ms);
        await view();
        await overviewRetry();

        return countCwDeadLetters.mock.calls.length;
      };

      expect(await triesBy(FIRST_RETRY_MS - 1)).toBe(1);
      expect(await triesBy(FIRST_RETRY_MS)).toBe(2);
      expect(await triesBy(FIRST_RETRY_MS + 9_999)).toBe(2);
      expect(await triesBy(FIRST_RETRY_MS + 10_000)).toBe(3);
    });

    it("does not ask again, until the answer expires, for a part Caseworking does not offer", async () => {
      countCwDeadLetters.mockRejectedValue(cwUnanswered("NOT_OFFERED"));
      await view();

      vi.setSystemTime(AT.getTime() + CACHE_MS - 1);
      await view();
      await overviewRetry();

      expect(countCwDeadLetters).toHaveBeenCalledOnce();
    });

    it("leaves a retry that ends after the answer expired out of the next answer", async () => {
      let answer;
      countCwDeadLetters
        .mockRejectedValueOnce(cwUnanswered("TIMED_OUT"))
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answer = resolve;
          }),
        );
      await view();

      vi.setSystemTime(AT.getTime() + FIRST_RETRY_MS);
      await view();
      vi.setSystemTime(AT.getTime() + CACHE_MS);
      const renewed = await view();
      answer(cwDeadLetters(FROM));
      await overviewRetry();

      expect(renewed.at).toBe(new Date(AT.getTime() + CACHE_MS).toISOString());
      expect((await view()).at).toBe(renewed.at);
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

    it("records only the services whose tokens were read", async () => {
      findCwApiTokens.mockRejectedValue(cwUnanswered("NOT_OFFERED"));

      await view();

      expect(audits().map(({ details }) => details.service)).toEqual(["gas"]);
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

    it("writes none for a service that lists no tokens", async () => {
      findCwApiTokens.mockResolvedValue({ tokens: [] });

      await view();

      expect(audits().map(({ details }) => details.service)).toEqual(["gas"]);
    });

    it("writes none when no tokens were read", async () => {
      listApiTokens.mockRejectedValue(new Error("boom"));
      findCwApiTokens.mockRejectedValue(new Error("boom"));

      await view();

      expect(withTransaction).not.toHaveBeenCalled();
    });
  });
});
