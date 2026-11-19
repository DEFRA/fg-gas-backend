// Consumer test: fg-gas-backend reads buckets, cases and workflow versions FROM
// fg-cw-backend's actuators, over HTTP, for the Grant Admin lists, record pages
// and record links, asks it to fetch a workflow definition, and manages its
// API clients.
//
// A separate provider name from the message pact (consumer.cw-backend.test.js),
// so each pair is verified on its own. Case payloads and documents are config
// shaped, so they are only ever matched as "an object"; so is a stored workflow.
import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/common/get-request-context.js";
import { MASKED_HASH } from "../../src/auth/models/masked-hash.js";
import {
  PAGE_SIZE,
  queryRequestSchema,
} from "../../src/common/buckets/schema.js";
import {
  CASE_NOT_FOUND,
  countCwDeadLetters,
  findCwBuckets,
  findCwCase,
  findCwCaseExistence,
  findCwEvent,
  queryCwBucket,
  readCwBucketTimeline,
} from "../../src/grant-admin/repositories/cw-actuators.repository.js";
import {
  findCwExploreSources,
  queryCwExplore,
} from "../../src/grant-admin/repositories/cw-explore.repository.js";
import {
  changeCwApiTokenExpiry,
  deleteCwApiToken,
  findCwApiTokens,
  issueCwApiToken,
  revokeCwApiToken,
  rotateCwApiToken,
} from "../../src/grant-admin/repositories/cw-clients.repository.js";
import {
  WORKFLOW_NOT_FOUND,
  WORKFLOW_VERSION_NOT_FOUND,
  fetchCwWorkflowDefinition,
  findCwWorkflowVersion,
  findCwWorkflowVersionExistence,
  findCwWorkflowVersions,
} from "../../src/grant-admin/repositories/cw-workflows.repository.js";
import { queryBucketUseCase } from "../../src/grant-admin/use-cases/query-bucket.use-case.js";

const {
  atLeastLike,
  boolean,
  constrainedArrayLike,
  eachLike,
  integer,
  like,
  regex,
  string,
} = MatchersV3;

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: "gas-token", timeoutMs: 5000 },
}));

vi.mock("../../src/common/logger.js");
vi.mock("../../src/common/mongo-client.js", () => ({ db: {} }));
vi.mock("../../src/common/config.js", () => ({
  config: {
    cwBackend,
    httpClient: { timeoutMs: 5000 },
    events: {},
    outbox: {},
    tracingHeader: "x-cdp-request-id",
  },
}));

const WORKFLOW = "frps-private-beta";
const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ACTOR = "UTF-8''%C5%81ukasz";
const ISO = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$";
const GUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const pact = new PactV3({
  consumer: "fg-gas-backend",
  provider: "fg-cw-backend-actuators",
  dir: path.resolve(process.cwd(), "tmp/pacts"),
  logLevel: "warn",
});

const authorization = regex("^Bearer .+$", "Bearer gas-token");

const operatorHeaders = {
  authorization,
  "x-actor": like(ACTOR),
  "x-actor-id": regex(GUID, OID),
};

const position = {
  phase: like("PRE_AWARD"),
  stage: like("REVIEW"),
  status: like("RECEIVED"),
};

const createdAt = regex(ISO, "2026-06-16T10:00:00.000Z");

// An open case, as the provider seeds them.
const caseFacts = (caseRef) => ({
  ref: { caseRef: like(caseRef), workflowCode: like(WORKFLOW) },
  position,
  closed: false,
  closedAt: null,
  createdAt,
});

// A real bucket cursor: {t, i}, base64url.
const CURSOR =
  "eyJ0IjoiMjAyNi0wNi0xNlQxMDowMDowMC4wMDBaIiwiaSI6ImZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZiJ9";

// Every call carries the operator's id from the request, as the routes set it.
const asOperator = (call) => withRequestContext({ user: OID }, call);

const run = (interaction, test) =>
  pact.addInteraction(interaction).executeTest(async (mockServer) => {
    cwBackend.url = mockServer.url;

    return test();
  });

describe("fg-gas-backend consumer of fg-cw-backend's case actuators", () => {
  describe("C1: the bucket routes", () => {
    const CASES_BUCKET = "cw.cases";
    const EMPTY_QUERY = { where: {}, limit: 20, groupBy: [] };

    // Value lists, refs and columns differ per bucket, so each is only "a list".
    const bucketEntry = {
      id: regex("^cw\\.[a-z][a-z0-9-]*$", CASES_BUCKET),
      path: string("cases"),
      label: string("Cases"),
      service: string("CW"),
      shortLabel: string("Cases"),
      icon: string("folder"),
      order: integer(80),
      noun: { one: string("case"), many: string("cases") },
      time: { label: string("Created") },
      facts: like([]),
      refs: like([]),
      indexes: like([]),
      groupings: like([]),
      title: { label: string("Reference"), format: string("mono") },
      columns: like([]),
      audited: boolean(true),
      timeline: boolean(false),
      summaries: like([]),
      page: null,
      tab: null,
    };

    // Each event box, as GAS joins the two into one list: its facts under
    // their URL keys and the kinds it searches by. Anything else may differ.
    const EVENT_FACTS = [
      ["status", "status"],
      ["eventType", "event"],
      ["lastError.name", "errorname"],
      ["errorKey", "error"],
    ];
    const EVENT_REFS = ["ref", "trace", "id"];

    // page and tab aren't pinned: Caseworking may name either or neither.
    const { page: _page, tab: _tab, ...unpaged } = bucketEntry;

    const eventBoxEntry = (box) => ({
      ...unpaged,
      id: `cw.${box}`,
      path: string(`events/cw/${box}`),
      label: string(`CW ${box}`),
      shortLabel: string(box),
      icon: string("activity"),
      noun: { one: string("event"), many: string("events") },
      title: { label: string("Event"), format: string("eventType") },
      audited: boolean(false),
      timeline: boolean(true),
      facts: EVENT_FACTS.map(([name, param]) => ({
        name,
        param,
        label: string(name),
        values:
          name === "status" || name === "eventType"
            ? eachLike({
                value: string("COMPLETED"),
                label: string("Completed"),
              })
            : null,
      })),
      refs: EVENT_REFS.map((kind) => ({ kind, label: string(kind) })),
    });

    // The body a list's first page sends, as the list query builds it.
    const EVENT_LIST_QUERY = queryRequestSchema.validate({
      where: { status: "COMPLETED", eventType: "ConfigVersionUpdated" },
      limit: PAGE_SIZE,
      count: true,
    }).value;

    const bucketRow = {
      id: string("665f1c2e9a1b2c3d4e5f6a7b"),
      time: createdAt,
      title: like("ref-1"),
      subtitle: null,
      cells: like({}),
      link: {
        kind: "case",
        workflowCode: like(WORKFLOW),
        caseRef: like("ref-1"),
      },
    };

    it("lists the buckets Caseworking owns", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a read of the bucket catalogue",
          withRequest: {
            method: "GET",
            path: "/actuators/buckets",
            headers: { authorization },
          },
          willRespondWith: {
            status: 200,
            body: {
              buckets: MatchersV3.arrayContaining(
                eventBoxEntry("outbox"),
                eventBoxEntry("inbox"),
                bucketEntry,
              ),
            },
          },
        },
        async () => {
          const entries = await findCwBuckets();
          const cases = entries.find(({ id }) => id === CASES_BUCKET);
          const inbox = entries.find(({ id }) => id === "cw.inbox");

          expect(cases.audited).toBe(true);
          expect(inbox.facts.map(({ name, param }) => [name, param])).toEqual(
            EVENT_FACTS,
          );
          expect(inbox.refs.map(({ kind }) => kind)).toEqual(EVENT_REFS);
        },
      ));

    it("answers a page of a CW event box as a list reads it", () =>
      run(
        {
          states: [{ description: "config version events exist" }],
          uponReceiving: "a page of a CW event box as a list reads it",
          withRequest: {
            method: "POST",
            path: "/actuators/buckets/cw.inbox/query",
            headers: {
              ...operatorHeaders,
              "x-search-repeat": "1",
              "x-read-time-left-ms": regex("^[1-9][0-9]*$", "2500"),
            },
            body: EVENT_LIST_QUERY,
          },
          willRespondWith: {
            status: 200,
            body: {
              bucket: "cw.inbox",
              plan: {
                kind: "exact",
                index: eachLike("eventType"),
                bound: like([]),
                filled: like([]),
                residual: like([]),
                scans: integer(1),
              },
              rows: eachLike({
                id: string("665f1c2e9a1b2c3d4e5f6a7b"),
                time: createdAt,
                title: string("ConfigVersionUpdated"),
                subtitle: string("7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8"),
                cells: { status: string("COMPLETED") },
                link: {
                  kind: "event",
                  service: "caseworking",
                  box: "inbox",
                  id: string("665f1c2e9a1b2c3d4e5f6a7b"),
                },
              }),
              page: {
                next: null,
                keepLooking: null,
                searchedTo: null,
                complete: boolean(true),
              },
              groups: like([]),
              total: { count: integer(1), capped: boolean(false) },
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            queryBucketUseCase({
              bucketId: "cw.inbox",
              body: EVENT_LIST_QUERY,
              actor: ACTOR,
              repeat: true,
              deadline: Date.now() + 3_000,
            }),
          );

          expect(answer.rows[0].link.box).toBe("inbox");
          expect(answer.total.capped).toBe(false);
        },
      ));

    it("answers one page of a bucket, newest first", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a first page of the cases bucket",
          withRequest: {
            method: "POST",
            path: `/actuators/buckets/${CASES_BUCKET}/query`,
            headers: operatorHeaders,
            body: EMPTY_QUERY,
          },
          willRespondWith: {
            status: 200,
            body: {
              bucket: CASES_BUCKET,
              plan: {
                kind: "exact",
                index: eachLike("createdAt"),
                bound: like([]),
                filled: like([]),
                residual: like([]),
                scans: integer(1),
              },
              rows: eachLike(bucketRow),
              page: {
                next: like(CURSOR),
                keepLooking: null,
                searchedTo: null,
                complete: boolean(false),
              },
              groups: like([]),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            queryCwBucket(CASES_BUCKET, EMPTY_QUERY, { actor: ACTOR }),
          );

          expect(answer.bucket).toBe(CASES_BUCKET);
          expect(answer.rows[0].link.kind).toBe("case");
          expect(answer.plan.kind).toBe("exact");
        },
      ));

    it("marks a repeated first page", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a repeated first page of the cases bucket",
          withRequest: {
            method: "POST",
            path: `/actuators/buckets/${CASES_BUCKET}/query`,
            headers: { ...operatorHeaders, "x-search-repeat": "1" },
            body: EMPTY_QUERY,
          },
          willRespondWith: {
            status: 200,
            body: { bucket: CASES_BUCKET, rows: eachLike(bucketRow) },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            queryCwBucket(CASES_BUCKET, EMPTY_QUERY, {
              actor: ACTOR,
              repeat: true,
            }),
          );

          expect(answer.rows).toHaveLength(1);
        },
      ));

    it("answers the inbox rows linked to a config version", () =>
      run(
        {
          states: [{ description: "config version events exist" }],
          uponReceiving: "a read of the inbox by a config version link",
          withRequest: {
            method: "POST",
            path: "/actuators/buckets/cw.inbox/query",
            headers: operatorHeaders,
            body: { ref: `config:${WORKFLOW}@1~2e.0~2e.0`, limit: 50 },
          },
          willRespondWith: {
            status: 200,
            body: {
              bucket: "cw.inbox",
              plan: {
                kind: "exact",
                index: eachLike("refs"),
                bound: like([]),
                filled: like([]),
                residual: like([]),
                scans: integer(1),
              },
              rows: eachLike({
                id: string("665f1c2e9a1b2c3d4e5f6a7b"),
                time: createdAt,
                title: string("ConfigVersionUpdated"),
                subtitle: string("7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8"),
                cells: {
                  status: string("COMPLETED"),
                  completedAt: regex(ISO, "2026-06-16T10:00:01.000Z"),
                },
                link: {
                  kind: "event",
                  service: "caseworking",
                  box: "inbox",
                  id: string("665f1c2e9a1b2c3d4e5f6a7b"),
                },
              }),
              page: {
                next: null,
                keepLooking: null,
                searchedTo: null,
                complete: boolean(true),
              },
              groups: like([]),
            },
          },
        },
        async () => {
          const { buckets } = await asOperator(() =>
            readCwBucketTimeline("cw.inbox", `config:${WORKFLOW}@1~2e.0~2e.0`, {
              actor: ACTOR,
            }),
          );

          expect(buckets[0].id).toBe("cw.inbox");
          expect(buckets[0].rows[0].link.service).toBe("caseworking");
          expect(buckets[0].more).toBe(false);
        },
      ));

    it("refuses a filter on a fact the bucket does not declare, by reason", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a cases bucket query naming an undeclared fact",
          withRequest: {
            method: "POST",
            path: `/actuators/buckets/${CASES_BUCKET}/query`,
            headers: operatorHeaders,
            body: { ...EMPTY_QUERY, where: { colour: "x" } },
          },
          willRespondWith: {
            status: 400,
            body: { reason: "UNKNOWN_FACT" },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwBucket(
              CASES_BUCKET,
              { ...EMPTY_QUERY, where: { colour: "x" } },
              { actor: ACTOR },
            ),
          ).catch((e) => e);

          expect(error.output.statusCode).toBe(400);
          expect(error.output.payload.reason).toBe("UNKNOWN_FACT");
        },
      ));

    it("answers 404 with a reason for a bucket it does not have", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a query of a bucket Caseworking does not have",
          withRequest: {
            method: "POST",
            path: "/actuators/buckets/cw.nothing/query",
            headers: operatorHeaders,
            body: EMPTY_QUERY,
          },
          willRespondWith: {
            status: 404,
            body: { reason: "UNKNOWN_BUCKET" },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwBucket("cw.nothing", EMPTY_QUERY, { actor: ACTOR }),
          ).catch((e) => e);

          expect(error.output.statusCode).toBe(404);
          expect(error.output.payload.reason).toBe("UNKNOWN_BUCKET");
        },
      ));

    it("refuses any client but GAS", () =>
      run(
        {
          states: [{ description: "the caller is not fg-gas-backend" }],
          uponReceiving: "a bucket query from another client",
          withRequest: {
            method: "POST",
            path: `/actuators/buckets/${CASES_BUCKET}/query`,
            headers: operatorHeaders,
            body: EMPTY_QUERY,
          },
          willRespondWith: { status: 403 },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwBucket(CASES_BUCKET, EMPTY_QUERY, { actor: ACTOR }),
          ).catch((e) => e);

          expect(error.output.statusCode).toBe(502);
        },
      ));
  });

  describe("the Explore actuators", () => {
    const QUERY = {
      v: 2,
      source: "cases",
      mode: "rows",
      columns: [
        { path: "caseRef" },
        {
          fn: "count",
          path: "payload.answers.application.parcel.parcelId",
          as: "parcels",
        },
      ],
      where: {
        all: [
          { path: "workflowCode", op: "eq", values: [WORKFLOW] },
          {
            not: {
              path: "currentStatus",
              op: "regex",
              values: [{ pattern: "^withdrawn", flags: "i" }],
            },
          },
        ],
      },
      groupBy: null,
      orderBy: null,
      limit: 50,
      positions: null,
    };

    const exploreHeaders = {
      ...operatorHeaders,
      "x-explore-time-left-ms": regex("^\\d+$", "4500"),
    };

    const known = {
      path: like("caseRef"),
      type: regex("^(text|number|boolean|date)$", "text"),
      index: like("ref"),
      closed: boolean(false),
      within: null,
    };

    it("lists the Query versions it reads and its sources, with what each may read", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a read of the Explore sources",
          withRequest: {
            method: "GET",
            path: "/actuators/explore/sources",
            headers: { authorization },
          },
          willRespondWith: {
            status: 200,
            body: {
              versions: eachLike(integer(2)),
              sources: eachLike({
                name: like("cases"),
                label: like("Cases, in Caseworking"),
                service: like("CW"),
                size: regex("^(big|small)$", "big"),
                noun: { one: like("case"), many: like("cases") },
                star: eachLike("caseRef"),
                time: like("createdAt"),
                roots: eachLike("caseRef"),
                answersAt: like("payload.answers"),
                paths: eachLike(known),
              }),
            },
          },
        },
        async () => {
          const { versions, sources } = await findCwExploreSources();

          expect(versions).toContain(2);
          expect(sources[0].name).toBe("cases");
        },
      ));

    it("answers its part of a query, rows per box", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "an Explore query of cases",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: QUERY,
          },
          willRespondWith: {
            status: 200,
            body: {
              read: regex("^(exact|windowed|full)$", "exact"),
              boxes: eachLike({
                id: like("cw.cases"),
                rows: eachLike({
                  key: {
                    t: regex(ISO, "2026-10-13T10:00:00.000Z"),
                    i: like("6650c1e2a1b2c3d4e5f60718"),
                  },
                  open: {
                    kind: like("case"),
                    code: like(WORKFLOW),
                    ref: like("client-ref-1"),
                  },
                  cells: like({ c0: "client-ref-1", c1: 2 }),
                  order: null,
                }),
                to: null,
                end: boolean(true),
                count: { n: integer(1), capped: boolean(false) },
              }),
              groups: null,
            },
          },
        },
        async () => {
          const part = await asOperator(() =>
            queryCwExplore(QUERY, { actor: ACTOR, timeLeftMs: 5000 }),
          );

          expect(part.boxes[0].rows[0].open.kind).toBe("case");
        },
      ));

    it("counts the records a query matches, capped", () => {
      const counted = {
        ...QUERY,
        mode: "count",
        columns: [{ fn: "count", path: "*" }],
        where: { path: "workflowCode", op: "eq", values: [WORKFLOW] },
        orderBy: null,
        limit: 1,
      };

      return run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "an Explore count of cases",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: counted,
          },
          willRespondWith: {
            status: 200,
            body: {
              read: regex("^(exact|full)$", "exact"),
              boxes: eachLike({
                id: like("cw.cases"),
                rows: [],
                to: null,
                end: boolean(true),
                count: { n: integer(1), capped: boolean(false) },
              }),
              groups: null,
            },
          },
        },
        async () => {
          const part = await asOperator(() =>
            queryCwExplore(counted, { actor: ACTOR, timeLeftMs: 5000 }),
          );

          expect(part.boxes[0].count.n).toBeGreaterThan(0);
        },
      );
    });

    it("refuses a Query in a version it doesn't read", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "an Explore query in version 1",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: { ...QUERY, v: 1 },
          },
          willRespondWith: {
            status: 400,
            body: { reason: "EXPLORE_QUERY_INVALID" },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwExplore(
              { ...QUERY, v: 1 },
              { actor: ACTOR, timeLeftMs: 5000 },
            ),
          ).catch((e) => e);

          expect(error.output.payload).toMatchObject({
            hop: "CW-BE",
            reason: "EXPLORE_QUERY_INVALID",
          });
        },
      ));

    it("refuses a path off its own roots or answer list, reading nothing", () => {
      const offList = {
        ...QUERY,
        columns: [{ path: "comments.text" }],
      };

      return run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "an Explore query reading a path Caseworking refuses",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: offList,
          },
          willRespondWith: {
            status: 400,
            body: {
              reason: "EXPLORE_QUERY_REFUSED",
              refusal: "PATH_NOT_ALLOWED",
            },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwExplore(offList, { actor: ACTOR, timeLeftMs: 5000 }),
          ).catch((e) => e);

          expect(error).toMatchObject({
            refusal: "PATH_NOT_ALLOWED",
            service: "CW",
          });
        },
      );
    });

    it("refuses a query it can't read exactly by its code and why, for GAS to word", () => {
      const grouped = {
        ...QUERY,
        mode: "groups",
        columns: [{ path: "currentStatus" }],
        where: {
          path: "payload.answers.applicant.business.name",
          op: "regex",
          values: [{ pattern: "x", flags: "" }],
        },
        groupBy: { path: "currentStatus" },
        orderBy: null,
      };

      return run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "an Explore query grouping a windowed read",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: grouped,
          },
          willRespondWith: {
            status: 400,
            body: {
              reason: "EXPLORE_QUERY_REFUSED",
              refusal: "GROUP_NEEDS_EXACT",
              detail: {
                why: like("NOT_INDEXED"),
                path: like("payload.answers.applicant.business.name"),
              },
            },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwExplore(grouped, { actor: ACTOR, timeLeftMs: 5000 }),
          ).catch((e) => e);

          expect(error).toMatchObject({
            refusal: "GROUP_NEEDS_EXACT",
            service: "CW",
            detail: {
              why: "NOT_INDEXED",
              path: "payload.answers.applicant.business.name",
            },
          });
        },
      );
    });

    it("refuses an operator's second query while the first runs", () =>
      run(
        {
          states: [
            { description: "an Explore query of the operator is running" },
          ],
          uponReceiving: "a second Explore query of one operator",
          withRequest: {
            method: "POST",
            path: "/actuators/explore/query",
            headers: exploreHeaders,
            body: QUERY,
          },
          willRespondWith: {
            status: 429,
            body: { reason: "EXPLORE_QUERY_BUSY", refusal: "BUSY" },
          },
        },
        async () => {
          const error = await asOperator(() =>
            queryCwExplore(QUERY, { actor: ACTOR, timeLeftMs: 5000 }),
          ).catch((e) => e);

          expect(error).toMatchObject({ refusal: "BUSY", service: "CW" });
        },
      ));
  });

  describe("the dead letters actuator", () => {
    const WINDOW = {
      from: "2026-06-15T10:00:00.000Z",
      to: "2026-06-16T10:00:00.000Z",
    };

    const bin = {
      from: regex(ISO, "2026-06-15T10:00:00.000Z"),
      to: regex(ISO, "2026-06-15T12:00:00.000Z"),
      count: integer(2),
      capped: boolean(false),
    };

    it("counts each box's dead letters in two-hour bins over the window", () =>
      run(
        {
          states: [{ description: "dead letters exist" }],
          uponReceiving: "a count of the dead letters of a day",
          withRequest: {
            method: "GET",
            path: "/actuators/dead-letters",
            query: WINDOW,
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: {
              from: WINDOW.from,
              to: WINDOW.to,
              countCap: integer(10_000),
              buckets: eachLike({
                id: regex("^cw\\.[a-z][a-z0-9-]*$", "cw.outbox"),
                bins: constrainedArrayLike(bin, 12, 12, 12),
              }),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            countCwDeadLetters(
              { ...WINDOW, binMs: 2 * 60 * 60 * 1000 },
              { actor: ACTOR },
            ),
          );

          expect(answer.buckets[0].bins).toHaveLength(12);
          expect(answer.buckets[0]).not.toHaveProperty("list");
        },
      ));
  });

  describe("C2: GET /actuators/cases/{workflowCode}/{caseRef}", () => {
    // The seeded case is a series of one, which lists no members.
    const summary = {
      ...caseFacts("ref-1"),
      originalConfigVersion: like("1.0.0"),
      currentConfigVersion: like("1.1.0"),
      series: {
        latestRef: like("ref-1"),
        refs: eachLike("ref-1"),
        members: atLeastLike(
          { caseRef: like("ref-1"), position, createdAt, closedAt: null },
          0,
          0,
        ),
      },
      // Where the case is, as its workflow version's definition names it.
      names: {
        phases: eachLike({ code: like("PRE_AWARD"), name: like("Pre award") }),
        stage: like("Review"),
        status: like("Received"),
      },
    };

    it("answers the case and its stored size", () =>
      run(
        {
          states: [
            {
              description: "a case exists",
              parameters: { workflowCode: WORKFLOW, caseRef: "ref-1" },
            },
          ],
          uponReceiving: "a read of one case",
          withRequest: {
            method: "GET",
            path: `/actuators/cases/${WORKFLOW}/ref-1`,
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: { case: summary, storedBytes: integer(4096) },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            findCwCase(
              { workflowCode: WORKFLOW, caseRef: "ref-1" },
              { actor: ACTOR },
            ),
          );

          expect(answer.summary.caseRef).toBe("ref-1");
          expect(answer.summary.currentConfigVersion).toBe("1.1.0");
          expect(answer.summary.series.members).toBeInstanceOf(Array);
          expect(answer.summary.names.phases).toEqual([
            { code: "PRE_AWARD", name: "Pre award" },
          ]);
          expect(answer.document).toBeNull();
        },
      ));

    it("answers the whole document too when asked", () =>
      run(
        {
          states: [
            {
              description: "a case exists",
              parameters: { workflowCode: WORKFLOW, caseRef: "ref-1" },
            },
          ],
          uponReceiving: "a read of one case with its document",
          withRequest: {
            method: "GET",
            path: `/actuators/cases/${WORKFLOW}/ref-1`,
            query: { include: "document" },
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: {
              case: summary,
              storedBytes: integer(4096),
              document: like({}),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            findCwCase(
              { workflowCode: WORKFLOW, caseRef: "ref-1" },
              { actor: ACTOR, include: "document" },
            ),
          );

          expect(answer.document).toBeTypeOf("object");
        },
      ));

    it("answers 404 CASE_NOT_FOUND for no such case", () =>
      run(
        {
          states: [
            {
              description: "no case exists",
              parameters: { workflowCode: WORKFLOW, caseRef: "ref-9" },
            },
          ],
          uponReceiving: "a read of a case that does not exist",
          withRequest: {
            method: "GET",
            path: `/actuators/cases/${WORKFLOW}/ref-9`,
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 404,
            body: { reason: CASE_NOT_FOUND },
          },
        },
        async () => {
          const error = await asOperator(() =>
            findCwCase(
              { workflowCode: WORKFLOW, caseRef: "ref-9" },
              { actor: ACTOR },
            ),
          ).catch((e) => e);

          expect(error.output.payload.reason).toBe(CASE_NOT_FOUND);
        },
      ));
  });

  describe("C3: GET /actuators/cases/{workflowCode}/{caseRef}/existence", () => {
    it.each([
      ["a case exists", "ref-1", true],
      ["no case exists", "ref-9", false],
    ])("answers yes or no given %s", (state, caseRef, exists) =>
      run(
        {
          states: [
            {
              description: state,
              parameters: { workflowCode: WORKFLOW, caseRef },
            },
          ],
          uponReceiving: `an existence check for a case that ${exists ? "exists" : "does not exist"}`,
          withRequest: {
            method: "GET",
            path: `/actuators/cases/${WORKFLOW}/${caseRef}/existence`,
            headers: { authorization, "x-actor-id": regex(GUID, OID) },
          },
          willRespondWith: { status: 200, body: { exists } },
        },
        async () => {
          expect(
            await asOperator(() =>
              findCwCaseExistence({ workflowCode: WORKFLOW, caseRef }),
            ),
          ).toEqual({ exists });
        },
      ),
    );
  });

  describe("C4: the workflow version routes", () => {
    const CODE = "woodland";
    const VERSION = "1.2.0";
    const SEMVER = "^\\d+\\.\\d+\\.\\d+$";

    const versionEntry = {
      version: regex(SEMVER, VERSION),
      status: regex("^(active|draft)$", "active"),
      receivedAt: regex(ISO, "2026-10-01T09:00:00.000Z"),
    };

    // Each version's fetch state, and where the workflow file is: optional to
    // GAS, which reads a Caseworking that does not send them as before.
    const versionFetchState = {
      fetchStatus: like("fetched"),
      stored: boolean(true),
    };

    const storedVersion = {
      version: {
        grantCode: like(CODE),
        ...versionEntry,
        fetchStatus: regex(
          "^(pending|fetched|transient_error|permanent_error)$",
          "fetched",
        ),
        fetchAttempts: integer(0),
        s3Key: like(`${CODE}/${VERSION}/cw/workflow.json`),
        s3Bucket: like("config-broker-local"),
      },
      versions: eachLike({ ...versionEntry, ...versionFetchState }),
      current: regex(SEMVER, VERSION),
      storedBytes: integer(48213),
      summary: {
        schemeName: like("Woodland Creation"),
        requiredRoles: { allOf: eachLike("Casework.Read"), anyOf: like([]) },
      },
    };

    const versionState = (description) => [
      { description, parameters: { code: CODE, version: VERSION } },
    ];

    it("answers a workflow's versions, newest first, and its current one", () =>
      run(
        {
          states: versionState("a workflow version is stored"),
          uponReceiving: "a read of a workflow's versions",
          withRequest: {
            method: "GET",
            path: `/actuators/workflows/${CODE}/versions`,
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: {
              code: like(CODE),
              current: regex(SEMVER, VERSION),
              versions: eachLike(versionEntry),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            findCwWorkflowVersions(CODE, { actor: ACTOR }),
          );

          expect(answer.current).toBe(VERSION);
        },
      ));

    it("answers 404 WORKFLOW_NOT_FOUND for a code with no versions", () =>
      run(
        {
          states: [
            {
              description: "no workflow exists",
              parameters: { code: "nowhere" },
            },
          ],
          uponReceiving:
            "a read of the versions of a workflow that does not exist",
          withRequest: {
            method: "GET",
            path: "/actuators/workflows/nowhere/versions",
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 404,
            body: { reason: WORKFLOW_NOT_FOUND },
          },
        },
        async () => {
          const error = await asOperator(() =>
            findCwWorkflowVersions("nowhere", { actor: ACTOR }),
          ).catch((e) => e);

          expect(error.output.payload.reason).toBe(WORKFLOW_NOT_FOUND);
        },
      ));

    it("answers one version, its stored size and summary, without the document", () =>
      run(
        {
          states: versionState("a workflow version is stored"),
          uponReceiving: "a read of one workflow version",
          withRequest: {
            method: "GET",
            path: `/actuators/workflows/${CODE}/versions/${VERSION}`,
            headers: operatorHeaders,
          },
          willRespondWith: { status: 200, body: storedVersion },
        },
        async () => {
          const answer = await asOperator(() =>
            findCwWorkflowVersion(
              { code: CODE, version: VERSION },
              { actor: ACTOR },
            ),
          );

          expect(answer.summary.schemeName).toBe("Woodland Creation");
          expect(answer.document).toBeNull();
          expect(answer.version).toMatchObject({
            fetchAttempts: 0,
            s3Key: `${CODE}/${VERSION}/cw/workflow.json`,
            s3Bucket: "config-broker-local",
          });
          expect(answer.versions[0]).toMatchObject({
            fetchStatus: "fetched",
            stored: true,
          });
        },
      ));

    it("answers the stored document and one address per endpoint when asked", () =>
      run(
        {
          states: versionState("a workflow version is stored"),
          uponReceiving: "a read of one workflow version with its document",
          withRequest: {
            method: "GET",
            path: `/actuators/workflows/${CODE}/versions/${VERSION}`,
            query: { include: "document" },
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: {
              ...storedVersion,
              document: like({}),
              addresses: eachLike({
                code: like("land-parcels"),
                service: like("LAND_DATA"),
                url: like("https://land-data.example/api/v2/parcels/{sbi}"),
              }),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            findCwWorkflowVersion(
              { code: CODE, version: VERSION },
              { actor: ACTOR, include: "document" },
            ),
          );

          expect(answer.document).toBeTypeOf("object");
          expect(answer.addresses[0].service).toBe("LAND_DATA");
        },
      ));

    it("answers 404 WORKFLOW_VERSION_NOT_FOUND for no such version", () =>
      run(
        {
          states: versionState("a workflow version is stored"),
          uponReceiving: "a read of a workflow version that does not exist",
          withRequest: {
            method: "GET",
            path: `/actuators/workflows/${CODE}/versions/9.9.9`,
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 404,
            body: { reason: WORKFLOW_VERSION_NOT_FOUND },
          },
        },
        async () => {
          const error = await asOperator(() =>
            findCwWorkflowVersion(
              { code: CODE, version: "9.9.9" },
              { actor: ACTOR },
            ),
          ).catch((e) => e);

          expect(error.output.payload.reason).toBe(WORKFLOW_VERSION_NOT_FOUND);
        },
      ));

    it("fetches a version not stored, naming the operator, and answers its outcome", () =>
      run(
        {
          states: versionState("a workflow version is not stored"),
          uponReceiving: "a fetch of a workflow version's definition",
          withRequest: {
            method: "POST",
            path: `/actuators/workflows/${CODE}/versions/${VERSION}/fetch`,
            query: { by: like(ACTOR) },
            headers: { authorization, "x-actor-id": regex(GUID, OID) },
          },
          willRespondWith: {
            status: 200,
            body: {
              files: eachLike({
                file: "workflow",
                outcome: regex("^(stored|failed)$", "stored"),
              }),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            fetchCwWorkflowDefinition(
              { code: CODE, version: VERSION },
              { by: ACTOR },
            ),
          );

          expect(answer.files[0].file).toBe("workflow");
        },
      ));

    it.each([
      [VERSION, true],
      ["9.9.9", false],
    ])(
      "answers whether version %s exists, with no operator name",
      (version, exists) =>
        run(
          {
            states: versionState("a workflow version is stored"),
            uponReceiving: `an existence check for a workflow version that ${exists ? "exists" : "does not exist"}`,
            withRequest: {
              method: "GET",
              path: `/actuators/workflows/${CODE}/versions/${version}/existence`,
              headers: { authorization, "x-actor-id": regex(GUID, OID) },
            },
            willRespondWith: { status: 200, body: { exists } },
          },
          async () => {
            expect(
              await asOperator(() =>
                findCwWorkflowVersionExistence({ code: CODE, version }),
              ),
            ).toEqual({ exists });
          },
        ),
    );
  });

  describe("the event detail actuator", () => {
    it("says whether the event's case exists", () =>
      run(
        {
          states: [
            {
              description: "an inbox event names a case",
              parameters: {
                id: "665f1c2e9a1b2c3d4e5f6a7b",
                workflowCode: WORKFLOW,
                caseRef: "ref-1",
                caseExists: true,
              },
            },
          ],
          uponReceiving: "a read of an inbox event with its case",
          withRequest: {
            method: "GET",
            path: "/actuators/events/inbox/665f1c2e9a1b2c3d4e5f6a7b",
            headers: { authorization, "x-actor-id": regex(GUID, OID) },
          },
          willRespondWith: {
            status: 200,
            body: {
              _id: like("665f1c2e9a1b2c3d4e5f6a7b"),
              status: like("COMPLETED"),
              event: like({}),
              case: {
                workflowCode: like(WORKFLOW),
                caseRef: like("ref-1"),
                exists: boolean(true),
              },
            },
          },
        },
        async () => {
          const doc = await asOperator(() =>
            findCwEvent("inbox", "665f1c2e9a1b2c3d4e5f6a7b"),
          );

          expect(doc.case.exists).toBe(true);
        },
      ));
  });

  describe("the API client actuators", () => {
    const CLIENT = "fg-gas-backend";
    const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
    const HASH = "0123456789abcdef".repeat(4);
    const HINT = "x9Q_";
    const OBJECT_ID = "^[0-9a-f]{24}$";
    const tokenHash = regex("^[0-9a-f]{64}$", HASH);
    const tokenHint = regex("^[A-Za-z0-9_-]{4}$", HINT);

    const clientState = (description, parameters = {}) => [
      {
        description,
        parameters: { clientId: CLIENT, tokenId: TOKEN_ID, ...parameters },
      },
    ];

    const callsWithItsToken = clientState(
      "fg-gas-backend calls with a token made before CW-2",
    );

    const refusal = (status, errorCode) => ({
      status,
      body: { statusCode: status, errorCode },
    });

    const errorOf = (call) => asOperator(call).catch((e) => e);

    it("lists every token row, marking the one GAS calls with", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "a read of the API client tokens",
          withRequest: {
            method: "GET",
            path: "/actuators/clients",
            headers: operatorHeaders,
          },
          willRespondWith: {
            status: 200,
            body: {
              tokens: eachLike({
                tokenId: regex(OBJECT_ID, TOKEN_ID),
                clientId: like(CLIENT),
                status: regex("^(ACTIVE|EXPIRED|REVOKED)$", "ACTIVE"),
                tokenHint: null,
                createdAt: null,
                createdBy: null,
                expiresAt: null,
                revokedAt: null,
                revokedBy: null,
                inUse: boolean(true),
                stored: {
                  _id: { $oid: regex(OBJECT_ID, TOKEN_ID) },
                  id: regex(MASKED_HASH.source, "012••••••def"),
                  client: like(CLIENT),
                  expiresAt: null,
                },
              }),
            },
          },
        },
        async () => {
          const { tokens } = await asOperator(() =>
            findCwApiTokens({ actor: ACTOR }),
          );

          expect(tokens[0]).toMatchObject({
            clientId: CLIENT,
            inUse: true,
            stored: { client: CLIENT, id: "012••••••def" },
          });
        },
      ));

    it("issues a new client's first token from its hash and hint", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "an issue of a new API client's first token",
          withRequest: {
            method: "POST",
            path: "/actuators/clients/role-reader/tokens",
            headers: operatorHeaders,
            body: { tokenHash, tokenHint, expiresAt: null, confirmed: false },
          },
          willRespondWith: {
            status: 201,
            body: {
              token: {
                tokenId: regex(OBJECT_ID, TOKEN_ID),
                clientId: "role-reader",
                status: "ACTIVE",
                tokenHint,
                createdAt,
                createdBy: like("Łukasz"),
                expiresAt: null,
                revokedAt: null,
                revokedBy: null,
                inUse: false,
              },
              newClient: true,
            },
          },
        },
        async () => {
          const { token, newClient } = await asOperator(() =>
            issueCwApiToken(
              "role-reader",
              {
                tokenHash: HASH,
                tokenHint: HINT,
                expiresAt: null,
                confirmed: false,
              },
              { actor: ACTOR },
            ),
          );

          expect(token).toMatchObject({
            status: "ACTIVE",
            tokenHint: HINT,
            inUse: false,
          });
          expect(token.createdAt).toBeInstanceOf(Date);
          expect(newClient).toBe(true);
        },
      ));

    it("refuses an unconfirmed issue to a client with an active token", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "an unconfirmed issue to a client with active tokens",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/${CLIENT}/tokens`,
            headers: operatorHeaders,
            body: { tokenHash, tokenHint, expiresAt: null, confirmed: false },
          },
          willRespondWith: {
            status: 409,
            body: {
              statusCode: 409,
              errorCode: "HAS_ACTIVE",
              active: integer(1),
            },
          },
        },
        async () => {
          const error = await errorOf(() =>
            issueCwApiToken(
              CLIENT,
              {
                tokenHash: HASH,
                tokenHint: HINT,
                expiresAt: null,
                confirmed: false,
              },
              { actor: ACTOR },
            ),
          );

          expect(error.output.statusCode).toBe(409);
          expect(error.output.payload).toMatchObject({
            errorCode: "HAS_ACTIVE",
            active: 1,
          });
        },
      ));

    it("revokes another active token of a client", () =>
      run(
        {
          states: clientState(
            "a client has an active token GAS does not call with",
            { clientId: "role-reader" },
          ),
          uponReceiving: "a revoke of an active API token",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/role-reader/tokens/${TOKEN_ID}/revoke`,
            headers: operatorHeaders,
          },
          willRespondWith: { status: 204 },
        },
        async () => {
          await expect(
            asOperator(() =>
              revokeCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR }),
            ),
          ).resolves.toBeUndefined();
        },
      ));

    it("refuses to revoke the token GAS calls with", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "a revoke of the token GAS calls with",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/${CLIENT}/tokens/${TOKEN_ID}/revoke`,
            headers: operatorHeaders,
          },
          willRespondWith: refusal(409, "API_TOKEN_IN_USE"),
        },
        async () => {
          const error = await errorOf(() =>
            revokeCwApiToken(CLIENT, TOKEN_ID, { actor: ACTOR }),
          );

          expect(error.output.statusCode).toBe(409);
          expect(error.output.payload.errorCode).toBe("API_TOKEN_IN_USE");
        },
      ));

    it("answers 404 API_TOKEN_NOT_FOUND for a token not under that name", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "a revoke of a token under another client's name",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/role-reader/tokens/${TOKEN_ID}/revoke`,
            headers: operatorHeaders,
          },
          willRespondWith: refusal(404, "API_TOKEN_NOT_FOUND"),
        },
        async () => {
          const error = await errorOf(() =>
            revokeCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR }),
          );

          expect(error.output.payload.errorCode).toBe("API_TOKEN_NOT_FOUND");
        },
      ));

    const tokenRow = (fields) => ({
      tokenId: regex(OBJECT_ID, TOKEN_ID),
      clientId: "role-reader",
      status: "ACTIVE",
      tokenHint,
      createdAt,
      createdBy: like("Łukasz"),
      revokedAt: null,
      revokedBy: null,
      inUse: false,
      ...fields,
    });

    it("deletes a token that can no longer call", () =>
      run(
        {
          states: clientState("a client has a revoked token", {
            clientId: "role-reader",
          }),
          uponReceiving: "a delete of a revoked API token",
          withRequest: {
            method: "DELETE",
            path: `/actuators/clients/role-reader/tokens/${TOKEN_ID}`,
            headers: operatorHeaders,
          },
          willRespondWith: { status: 204 },
        },
        async () => {
          await expect(
            asOperator(() =>
              deleteCwApiToken("role-reader", TOKEN_ID, { actor: ACTOR }),
            ),
          ).resolves.toBeUndefined();
        },
      ));

    it.each([
      ["an active token", CLIENT, 409, "API_TOKEN_ACTIVE"],
      [
        "a token not under that name",
        "role-reader",
        404,
        "API_TOKEN_NOT_FOUND",
      ],
    ])("refuses a delete of %s", (description, clientId, status, errorCode) =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: `a delete of ${description}`,
          withRequest: {
            method: "DELETE",
            path: `/actuators/clients/${clientId}/tokens/${TOKEN_ID}`,
            headers: operatorHeaders,
          },
          willRespondWith: refusal(status, errorCode),
        },
        async () => {
          const error = await errorOf(() =>
            deleteCwApiToken(clientId, TOKEN_ID, { actor: ACTOR }),
          );

          expect(error.output.statusCode).toBe(status);
          expect(error.output.payload.errorCode).toBe(errorCode);
        },
      ),
    );

    it("sets a revoked token's expiry, reviving it", () =>
      run(
        {
          states: clientState("a client has a revoked token", {
            clientId: "role-reader",
          }),
          uponReceiving: "a change of a revoked API token's expiry",
          withRequest: {
            method: "PUT",
            path: `/actuators/clients/role-reader/tokens/${TOKEN_ID}/expiry`,
            headers: operatorHeaders,
            body: { expiresAt: null },
          },
          willRespondWith: {
            status: 200,
            body: {
              token: tokenRow({ expiresAt: null }),
              previousExpiresAt: regex(ISO, "2026-11-03T10:00:00.000Z"),
              revived: true,
            },
          },
        },
        async () => {
          const { token, revived } = await asOperator(() =>
            changeCwApiTokenExpiry(
              "role-reader",
              TOKEN_ID,
              { expiresAt: null },
              { actor: ACTOR },
            ),
          );

          expect(token).toMatchObject({ status: "ACTIVE", revokedAt: null });
          expect(revived).toBe(true);
        },
      ));

    it("refuses to set the token GAS calls with to stop", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "a change of the GAS token's expiry to the past",
          withRequest: {
            method: "PUT",
            path: `/actuators/clients/${CLIENT}/tokens/${TOKEN_ID}/expiry`,
            headers: operatorHeaders,
            body: { expiresAt: regex(ISO, "2000-01-01T00:00:00.000Z") },
          },
          willRespondWith: refusal(409, "API_TOKEN_IN_USE"),
        },
        async () => {
          const error = await errorOf(() =>
            changeCwApiTokenExpiry(
              CLIENT,
              TOKEN_ID,
              { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
              { actor: ACTOR },
            ),
          );

          expect(error.output.payload.errorCode).toBe("API_TOKEN_IN_USE");
        },
      ));

    it("rotates an active token, the new one taking its expiry", () =>
      run(
        {
          states: clientState(
            "a client has an active token GAS does not call with",
            { clientId: "role-reader" },
          ),
          uponReceiving: "a rotate of an active API token",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/role-reader/tokens/${TOKEN_ID}/rotate`,
            headers: operatorHeaders,
            body: { tokenHash, tokenHint, keepOld: "24h" },
          },
          willRespondWith: {
            status: 201,
            body: {
              token: tokenRow({ expiresAt: null }),
              oldExpiresAt: regex(ISO, "2026-11-05T23:59:59.000Z"),
            },
          },
        },
        async () => {
          const { token, oldExpiresAt } = await asOperator(() =>
            rotateCwApiToken(
              "role-reader",
              TOKEN_ID,
              { tokenHash: HASH, tokenHint: HINT, keepOld: "24h" },
              { actor: ACTOR },
            ),
          );

          expect(token).toMatchObject({ status: "ACTIVE", tokenHint: HINT });
          expect(oldExpiresAt).toBeInstanceOf(Date);
        },
      ));

    it("refuses to end the token GAS calls with at once", () =>
      run(
        {
          states: callsWithItsToken,
          uponReceiving: "a rotate of the GAS token with no overlap",
          withRequest: {
            method: "POST",
            path: `/actuators/clients/${CLIENT}/tokens/${TOKEN_ID}/rotate`,
            headers: operatorHeaders,
            body: { tokenHash, tokenHint, keepOld: "none" },
          },
          willRespondWith: refusal(409, "API_TOKEN_IN_USE"),
        },
        async () => {
          const error = await errorOf(() =>
            rotateCwApiToken(
              CLIENT,
              TOKEN_ID,
              { tokenHash: HASH, tokenHint: HINT, keepOld: "none" },
              { actor: ACTOR },
            ),
          );

          expect(error.output.payload.errorCode).toBe("API_TOKEN_IN_USE");
        },
      ));
  });
});
