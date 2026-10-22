import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRequestContext } from "../../common/get-request-context.js";
import { wreck } from "../../common/wreck.js";
import {
  WORKFLOW_NOT_FOUND,
  WORKFLOW_VERSION_NOT_FOUND,
  fetchCwWorkflowDefinition,
  findCwWorkflowVersion,
  findCwWorkflowVersionExistence,
  findCwWorkflowVersions,
} from "./cw-workflows.repository.js";

const { cwBackend } = vi.hoisted(() => ({
  cwBackend: { url: undefined, token: undefined },
}));

vi.mock("../../common/config.js", () => ({ config: { cwBackend } }));
vi.mock("../../common/logger.js");
vi.mock("../../common/wreck.js", () => ({
  wreck: { get: vi.fn(), post: vi.fn() },
}));

const URL_BASE = "http://cw.test";
const TOKEN = "cw-token";

const TIMEOUT_MS = 3000;

beforeEach(() => {
  cwBackend.url = URL_BASE;
  cwBackend.token = TOKEN;
  cwBackend.timeoutMs = TIMEOUT_MS;
});

const httpError = (statusCode, body) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: {
      payload:
        body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    },
  });

describe("Caseworking workflow versions", () => {
  const OID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const ACTOR = "UTF-8''%C5%81ukasz";
  const REF = { code: "Casework-Smoke", version: "1.2.0" };

  const VERSIONS = [
    {
      version: "2.0.0",
      status: "draft",
      receivedAt: "2026-10-15T10:04:00.000Z",
    },
    {
      version: "1.2.0",
      status: "active",
      receivedAt: "2026-10-01T09:00:00.000Z",
    },
  ];

  const SUMMARY = {
    schemeName: "Casework smoke",
    requiredRoles: { allOf: ["Casework.Read"], anyOf: [] },
  };

  const ADDRESSES = [
    {
      code: "land-parcels",
      service: "LAND_DATA",
      url: "https://land.test/parcels/{sbi}",
    },
    { code: "unset", service: "NOWHERE", url: null },
  ];

  const aVersionAnswer = (extra = {}) => ({
    payload: {
      version: {
        grantCode: "Casework-Smoke",
        version: "1.2.0",
        status: "active",
        receivedAt: "2026-10-01T09:00:00.000Z",
        fetchStatus: "fetched",
      },
      versions: VERSIONS,
      current: "1.2.0",
      storedBytes: 48213,
      summary: SUMMARY,
      ...extra,
    },
  });

  const inRequest = (call) => withRequestContext({ user: OID }, call);

  it("reads a workflow's versions as the operator, the code escaped", async () => {
    wreck.get.mockResolvedValue({
      payload: { code: "Casework-Smoke", current: "1.2.0", versions: VERSIONS },
    });

    expect(
      await inRequest(() =>
        findCwWorkflowVersions("Casework-Smoke", { actor: ACTOR }),
      ),
    ).toEqual({ code: "Casework-Smoke", current: "1.2.0", versions: VERSIONS });
    expect(new URL(wreck.get.mock.calls[0][0]).pathname).toBe(
      "/actuators/workflows/Casework-Smoke/versions",
    );
    expect(wreck.get.mock.calls[0][1].headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "x-actor-id": OID,
      "x-actor": ACTOR,
    });
  });

  it("reads one version without its document unless asked", async () => {
    wreck.get.mockResolvedValue(aVersionAnswer());

    await findCwWorkflowVersion(REF, { actor: ACTOR });
    await findCwWorkflowVersion(REF, { actor: ACTOR, include: "document" });

    const [summaryUrl, wholeUrl] = wreck.get.mock.calls.map(
      ([url]) => new URL(url),
    );
    expect(summaryUrl.pathname).toBe(
      "/actuators/workflows/Casework-Smoke/versions/1.2.0",
    );
    expect(summaryUrl.search).toBe("");
    expect(wholeUrl.searchParams.get("include")).toBe("document");
  });

  it("answers the version, its document and its addresses in endpoint order, and nothing else Caseworking adds", async () => {
    const document = { _id: "6710c4", code: "Casework-Smoke", anything: [1] };
    wreck.get.mockResolvedValue(
      aVersionAnswer({ document, addresses: ADDRESSES, extra: "dropped" }),
    );

    expect(
      await findCwWorkflowVersion(REF, { actor: ACTOR, include: "document" }),
    ).toEqual({
      version: {
        grantCode: "Casework-Smoke",
        version: "1.2.0",
        status: "active",
        receivedAt: "2026-10-01T09:00:00.000Z",
        fetchStatus: "fetched",
      },
      versions: VERSIONS,
      current: "1.2.0",
      storedBytes: 48213,
      summary: SUMMARY,
      document,
      addresses: ADDRESSES,
    });
  });

  it("passes on each version's fetch state and where the version is, when Caseworking sends them", async () => {
    const fetchState = {
      fetchError: "S3 timed out",
      fetchAttempts: 2,
      s3Key: "casework-smoke/1.2.0/cw/workflow.json",
      s3Bucket: "config-broker-local",
    };
    const versions = [{ ...VERSIONS[0], fetchStatus: "pending", stored: true }];
    wreck.get.mockResolvedValue(
      aVersionAnswer({
        version: { ...aVersionAnswer().payload.version, ...fetchState },
        versions,
      }),
    );

    const found = await findCwWorkflowVersion(REF, { actor: ACTOR });

    expect(found.version).toMatchObject(fetchState);
    expect(found.versions).toEqual(versions);
  });

  it("answers no document and no addresses when none were asked for", async () => {
    wreck.get.mockResolvedValue(aVersionAnswer());

    expect(await findCwWorkflowVersion(REF, { actor: ACTOR })).toMatchObject({
      document: null,
      addresses: null,
    });
  });

  it("reads a version whose document is over the read limit again without it, as too large", async () => {
    wreck.get.mockRejectedValueOnce(
      Boom.entityTooLarge(
        "Payload content length greater than maximum allowed",
      ),
    );
    wreck.get.mockResolvedValueOnce(aVersionAnswer());

    const found = await findCwWorkflowVersion(REF, {
      actor: ACTOR,
      include: "document",
    });

    expect(found).toMatchObject({
      storedBytes: 48213,
      document: null,
      tooLarge: true,
    });
    const [first, second] = wreck.get.mock.calls.map(([url]) => new URL(url));
    expect(first.searchParams.get("include")).toBe("document");
    expect(second.search).toBe("");
  });

  it("answers a 413 on a read without the document as entity too large", async () => {
    wreck.get.mockRejectedValue(httpError(413));

    const error = await findCwWorkflowVersion(REF, {}).catch((e) => e);

    expect(error.output.statusCode).toBe(413);
    expect(wreck.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a version with no received time", { receivedAt: null }],
    ["a version of no known status", { status: "retired" }],
    ["a version with no fetch status", { fetchStatus: null }],
  ])("answers 502, not a page GAS cannot give, for %s", async (_, row) => {
    const answer = aVersionAnswer();
    answer.payload.version = { ...answer.payload.version, ...row };
    wreck.get.mockResolvedValue(answer);

    const error = await findCwWorkflowVersion(REF, {}).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
  });

  it("answers 502 for a versions list holding a version with no received time", async () => {
    wreck.get.mockResolvedValue({
      payload: {
        code: "Casework-Smoke",
        current: "1.2.0",
        versions: [{ ...VERSIONS[1], receivedAt: null }],
      },
    });

    const error = await findCwWorkflowVersions("Casework-Smoke").catch(
      (e) => e,
    );

    expect(error.output.statusCode).toBe(502);
  });

  it("answers 502 for a version answer it cannot read", async () => {
    wreck.get.mockResolvedValue({ payload: { version: null } });

    const error = await findCwWorkflowVersion(REF, {}).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
  });

  it.each([WORKFLOW_NOT_FOUND, WORKFLOW_VERSION_NOT_FOUND])(
    "answers a 404 %s with its reason",
    async (reason) => {
      wreck.get.mockRejectedValue(httpError(404, { statusCode: 404, reason }));

      const error = await findCwWorkflowVersion(REF, {}).catch((e) => e);

      expect(error.output.statusCode).toBe(404);
      expect(error.output.payload.reason).toBe(reason);
    },
  );

  it("answers a 404 without a known reason - a route this Caseworking lacks - as a 502", async () => {
    wreck.get.mockRejectedValue(httpError(404, { reason: "CASE_NOT_FOUND" }));

    const error = await findCwWorkflowVersions("woodland", {}).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
  });

  it.each([
    [504, 504],
    [408, 504],
    [500, 502],
  ])("answers a Caseworking %i as a %i", async (status, expected) => {
    wreck.get.mockRejectedValue(httpError(status, { message: "SECRET" }));

    const error = await findCwWorkflowVersion(REF, {}).catch((e) => e);

    expect(error.output.statusCode).toBe(expected);
    expect(error.message).not.toContain("SECRET");
  });

  it("asks whether a version exists, escaped, with the operator's id but no operator name", async () => {
    wreck.get.mockResolvedValue({ payload: { exists: false } });

    expect(
      await inRequest(() =>
        findCwWorkflowVersionExistence({
          code: "Case/Smoke",
          version: "1.2.0",
        }),
      ),
    ).toEqual({ exists: false });
    expect(new URL(wreck.get.mock.calls[0][0]).pathname).toBe(
      "/actuators/workflows/Case%2FSmoke/versions/1.2.0/existence",
    );
    expect(wreck.get.mock.calls[0][1].headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "x-actor-id": OID,
    });
  });

  it.each([[{}], [{ exists: "yes" }], [{ exists: null }]])(
    "answers 502, not no workflow, for an existence answer it cannot read: %j",
    async (payload) => {
      wreck.get.mockResolvedValue({ payload });

      const error = await findCwWorkflowVersionExistence(REF).catch((e) => e);

      expect(error.output.statusCode).toBe(502);
    },
  );

  it("answers a 404 on the existence check - a route this Caseworking lacks - as a 502", async () => {
    wreck.get.mockRejectedValue(httpError(404, { message: "Not Found" }));

    const error = await findCwWorkflowVersionExistence(REF).catch((e) => e);

    expect(error.output.statusCode).toBe(502);
  });

  describe("fetchCwWorkflowDefinition", () => {
    it("posts the fetch naming the operator, as the operator", async () => {
      wreck.post.mockResolvedValue({ payload: { files: [] } });

      expect(
        await inRequest(() => fetchCwWorkflowDefinition(REF, { by: "a b&c" })),
      ).toEqual({ files: [] });

      const url = new URL(wreck.post.mock.calls[0][0]);
      expect(url.pathname).toBe(
        "/actuators/workflows/Casework-Smoke/versions/1.2.0/fetch",
      );
      expect(url.searchParams.get("by")).toBe("a b&c");
      expect(wreck.post.mock.calls[0][1].headers["x-actor-id"]).toBe(OID);
    });

    it("answers each outcome in the grant fetch's shape", async () => {
      wreck.post.mockResolvedValueOnce({
        payload: {
          files: [{ file: "workflow", outcome: "stored" }],
        },
      });
      wreck.post.mockResolvedValueOnce({
        payload: {
          files: [{ file: "workflow", outcome: "failed", reason: "missing" }],
        },
      });
      wreck.post.mockResolvedValueOnce({
        payload: {
          files: [
            {
              file: "workflow",
              outcome: "failed",
              reason: "invalid",
              message: "Workflow phases are not unique",
            },
          ],
        },
      });

      expect(await fetchCwWorkflowDefinition(REF, { by: "Jo" })).toEqual({
        files: [{ file: "workflow", outcome: "stored" }],
      });
      expect(await fetchCwWorkflowDefinition(REF, { by: "Jo" })).toEqual({
        files: [
          {
            file: "workflow",
            outcome: "failed",
            reason: "missing",
            message: null,
          },
        ],
      });
      expect(await fetchCwWorkflowDefinition(REF, { by: "Jo" })).toEqual({
        files: [
          {
            file: "workflow",
            outcome: "failed",
            reason: "invalid",
            message: "Workflow phases are not unique",
          },
        ],
      });
    });

    it("answers 502 for an outcome it does not know", async () => {
      wreck.post.mockResolvedValue({
        payload: {
          files: [{ file: "workflow", outcome: "failed", reason: "lost" }],
        },
      });

      const error = await fetchCwWorkflowDefinition(REF, { by: "Jo" }).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(502);
    });

    it("answers a version Caseworking does not have 404, and no answer 504", async () => {
      wreck.post.mockRejectedValueOnce(
        httpError(404, { reason: WORKFLOW_VERSION_NOT_FOUND }),
      );
      wreck.post.mockRejectedValueOnce(httpError(504));

      const notFound = await fetchCwWorkflowDefinition(REF, {
        by: "Jo",
      }).catch((e) => e);
      const timedOut = await fetchCwWorkflowDefinition(REF, {
        by: "Jo",
      }).catch((e) => e);

      expect(notFound.output.payload.reason).toBe(WORKFLOW_VERSION_NOT_FOUND);
      expect(timedOut.output.statusCode).toBe(504);
    });
  });
});
