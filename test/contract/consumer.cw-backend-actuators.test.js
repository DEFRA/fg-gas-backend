// Consumer test: fg-gas-backend reads buckets, cases and workflow versions FROM
// fg-cw-backend's actuators, over HTTP, for the Grant Admin lists, record pages
// and record links, and asks it to fetch a workflow definition.
//
// A separate provider name from the message pact (consumer.cw-backend.test.js),
// so each pair is verified on its own. Case payloads and documents are config
// shaped, so they are only ever matched as "an object"; so is a stored workflow.
import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../src/common/get-request-context.js";
import {
  CASE_NOT_FOUND,
  findCwBuckets,
  findCwCase,
  findCwCaseExistence,
  findCwEvent,
  queryCwBucket,
} from "../../src/grant-admin/repositories/cw-actuators.repository.js";
import {
  WORKFLOW_NOT_FOUND,
  WORKFLOW_VERSION_NOT_FOUND,
  fetchCwWorkflowDefinition,
  findCwWorkflowVersion,
  findCwWorkflowVersionExistence,
  findCwWorkflowVersions,
} from "../../src/grant-admin/repositories/cw-workflows.repository.js";

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
            body: { buckets: eachLike(bucketEntry) },
          },
        },
        async () => {
          const [entry] = await findCwBuckets();

          expect(entry.id).toBe(CASES_BUCKET);
          expect(entry.audited).toBe(true);
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
});
