// Consumer test: fg-gas-backend reads cases FROM fg-cw-backend's actuators,
// over HTTP, for the Grant Admin Cases pages and the record links.
//
// A separate provider name from the message pact (consumer.cw-backend.test.js),
// so each pair is verified on its own. Case payloads and documents are config
// shaped, so they are only ever matched as "an object".
import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/common/get-request-context.js";
import {
  CASE_NOT_FOUND,
  findCwCase,
  findCwCaseExistence,
  findCwEvent,
  searchCwCases,
} from "../../src/grant-admin/repositories/cw-actuators.repository.js";

const { atLeastLike, boolean, eachLike, integer, like, regex, string } =
  MatchersV3;

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: "gas-token", timeoutMs: 5000 },
}));

vi.mock("../../src/common/logger.js");
vi.mock("../../src/common/config.js", () => ({
  config: {
    cwBackend,
    httpClient: { timeoutMs: 5000 },
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

const caseRow = (caseRef) => ({
  ...caseFacts(caseRef),
  replaced: boolean(false),
});

// A real keyset cursor: {createdAt, _id}, base64url.
const CURSOR =
  "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTE2VDEwOjAwOjAwLjAwMFoiLCJfaWQiOiJmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmYifQ";

// A browse page always names its last row, whether or not more follow.
const browsePagination = (hasNextPage) => ({
  endCursor: string(CURSOR),
  hasNextPage: boolean(hasNextPage),
});

// Every call carries the operator's id from the request, as the routes set it.
const asOperator = (call) => withRequestContext({ user: OID }, call);

const rejectionOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
};

const run = (interaction, test) =>
  pact.addInteraction(interaction).executeTest(async (mockServer) => {
    cwBackend.url = mockServer.url;

    return test();
  });

describe("fg-gas-backend consumer of fg-cw-backend's case actuators", () => {
  describe("C1: POST /actuators/cases/search", () => {
    it("browses the first page, with a total and the workflow codes", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a first browse page of cases",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: operatorHeaders,
            body: {},
          },
          willRespondWith: {
            status: 200,
            body: {
              cases: eachLike(caseRow("ref-1")),
              pagination: browsePagination(true),
              total: { count: integer(21), capped: boolean(false) },
              workflowCodes: eachLike(WORKFLOW),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            searchCwCases({}, { actor: ACTOR, repeat: false }),
          );

          expect(answer.rows[0].ref.caseRef).toBe("ref-1");
          expect(answer.rows[0].replaced).toBe(false);
          expect(answer.total.capped).toBe(false);
        },
      ));

    it("marks a repeated first page", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a repeated first browse page of cases",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: { ...operatorHeaders, "x-search-repeat": "1" },
            body: {},
          },
          willRespondWith: {
            status: 200,
            body: {
              cases: eachLike(caseRow("ref-1")),
              pagination: browsePagination(true),
              total: { count: integer(21), capped: boolean(false) },
              workflowCodes: eachLike(WORKFLOW),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            searchCwCases({}, { actor: ACTOR, repeat: true }),
          );

          expect(answer.rows[0].ref.caseRef).toBe("ref-1");
        },
      ));

    it("continues from a cursor, with no total", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a later browse page of cases",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: operatorHeaders,
            body: { cursor: like(CURSOR) },
          },
          willRespondWith: {
            status: 200,
            body: {
              cases: eachLike(caseRow("ref-2")),
              pagination: browsePagination(true),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            searchCwCases({ cursor: CURSOR }, { actor: ACTOR, repeat: false }),
          );

          expect(answer).not.toHaveProperty("total");
        },
      ));

    it("narrows to a workflow and a created range", () =>
      run(
        {
          states: [{ description: "cases exist" }],
          uponReceiving: "a browse of one workflow's cases over a range",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: operatorHeaders,
            body: {
              workflowCode: like(WORKFLOW),
              from: regex(ISO, "2026-06-15T00:00:00.000Z"),
              to: regex(ISO, "2026-06-17T00:00:00.000Z"),
            },
          },
          willRespondWith: {
            status: 200,
            body: {
              cases: eachLike(caseRow("ref-1")),
              pagination: browsePagination(false),
              total: { count: integer(1), capped: boolean(false) },
              workflowCodes: eachLike(WORKFLOW),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            searchCwCases(
              {
                workflowCode: WORKFLOW,
                from: "2026-06-15T00:00:00.000Z",
                to: "2026-06-17T00:00:00.000Z",
              },
              { actor: ACTOR },
            ),
          );

          expect(answer.rows).toHaveLength(1);
        },
      ));

    it("finds every case in a ref's series, as one page", () =>
      run(
        {
          states: [
            {
              description: "a case series exists",
              parameters: {
                workflowCode: WORKFLOW,
                caseRefs: ["ref-1", "ref-2"],
              },
            },
          ],
          uponReceiving: "a search for a case ref",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: operatorHeaders,
            body: { ref: like("ref-1") },
          },
          willRespondWith: {
            status: 200,
            body: {
              cases: eachLike(caseRow("ref-2")),
              pagination: { endCursor: null, hasNextPage: false },
              total: { count: integer(2), capped: boolean(false) },
              workflowCodes: eachLike(WORKFLOW),
            },
          },
        },
        async () => {
          const answer = await asOperator(() =>
            searchCwCases({ ref: "ref-1" }, { actor: ACTOR }),
          );

          expect(answer.pagination.hasNextPage).toBe(false);
        },
      ));

    it("refuses any client but GAS", () =>
      run(
        {
          states: [{ description: "the caller is not fg-gas-backend" }],
          uponReceiving: "a case search from another client",
          withRequest: {
            method: "POST",
            path: "/actuators/cases/search",
            headers: operatorHeaders,
            body: {},
          },
          willRespondWith: { status: 403 },
        },
        async () => {
          const error = await rejectionOf(
            asOperator(() => searchCwCases({}, { actor: ACTOR })),
          );

          expect(error.output.statusCode).toBe(502);
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
          expect(answer.summary.series.members).toBeInstanceOf(Array);
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
          const error = await rejectionOf(
            asOperator(() =>
              findCwCase(
                { workflowCode: WORKFLOW, caseRef: "ref-9" },
                { actor: ACTOR },
              ),
            ),
          );

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
});
