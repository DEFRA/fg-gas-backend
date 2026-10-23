import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findConfigDefinition,
  updateDefinitionFetchStatus,
} from "../../common/config-broker/config-catalog.repository.js";
import {
  storeDefinition,
  storedDefinitionVersions,
} from "../../common/config-broker/definition-stores.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  findVersionsByGrantCode,
  updateFetchStatus,
  upsert,
} from "../repositories/config-version.repository.js";
import { save } from "../repositories/grant.repository.js";
import { fetchConfigDefinitionsUseCase } from "./fetch-config-definitions.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../common/config-broker/config-catalog.repository.js");
vi.mock("../../common/config-broker/definition-stores.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/config-version.repository.js");
vi.mock("../repositories/grant.repository.js");
vi.mock("../../common/s3-client.js", async () => ({
  S3FetchError: (await vi.importActual("../../common/s3-client.js"))
    .S3FetchError,
  fetchConfigFile: vi.fn(),
}));

const CODE = "woodland";
const VERSION = "2.0.0";
const ARGS = { grantCode: CODE, version: VERSION, caller: "fg-admin" };
const SESSION = { id: "transaction" };

const grantDefinition = JSON.parse(
  readFileSync(
    new URL(
      "../../../test/fixtures/pmf-grant-definition.json",
      import.meta.url,
    ),
  ),
);

const location = (type) => ({
  s3Bucket: "config-broker-local",
  s3Key: `${CODE}/${VERSION}/gas/${type}.json`,
});

const aRow = (types = ["grant", "agreement", "payment"]) => ({
  grantCode: CODE,
  version: VERSION,
  status: "draft",
  receivedAt: "2026-10-15T10:04:00.000Z",
  s3Bucket: "config-broker-local",
  worstFetchStatus: "pending",
  definitions: Object.fromEntries(
    types.map((type) => [
      type,
      {
        s3Key: location(type).s3Key,
        fetchStatus: "pending",
        fetchAttempts: 0,
        fetchError: null,
      },
    ]),
  ),
});

const published = {
  grant: { ...grantDefinition, code: CODE },
  agreement: { code: CODE, kind: "agreement" },
  payment: { code: CODE, kind: "payment" },
};

const s3Error = (code, statusCode) =>
  new S3FetchError(`S3 said ${code}`, { code, statusCode });

const fetchedFrom = (files) => (_bucket, key) => {
  const type = key.split("/").pop().replace(".json", "");
  const file = files[type];

  return file instanceof Error
    ? Promise.reject(file)
    : Promise.resolve(structuredClone(file));
};

const audit = () => writeAuditEvent.mock.calls[0][0];

beforeEach(() => {
  vi.resetAllMocks();
  findVersionsByGrantCode.mockResolvedValue([aRow()]);
  storedDefinitionVersions.mockResolvedValue(new Set());
  findConfigDefinition.mockImplementation(({ definitionType }) =>
    Promise.resolve(location(definitionType)),
  );
  fetchConfigFile.mockImplementation(fetchedFrom(published));
  save.mockResolvedValue();
  storeDefinition.mockResolvedValue();
  writeAuditEvent.mockResolvedValue();
  withTransaction.mockImplementation((callback) => callback(SESSION));
});

describe("fetchConfigDefinitionsUseCase", () => {
  it("stores every file not stored, grant then agreement then payment", async () => {
    const result = await fetchConfigDefinitionsUseCase(ARGS);

    expect(result).toEqual({
      files: [
        { file: "grant", outcome: "stored" },
        { file: "agreement", outcome: "stored" },
        { file: "payment", outcome: "stored" },
      ],
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE, version: VERSION }),
      SESSION,
    );
    expect(storeDefinition.mock.calls).toEqual([
      [
        "agreement",
        { grantCode: CODE, version: VERSION, definition: published.agreement },
        SESSION,
      ],
      [
        "payment",
        { grantCode: CODE, version: VERSION, definition: published.payment },
        SESSION,
      ],
    ]);
  });

  it("fetches only the files not stored, and nothing when all are", async () => {
    storedDefinitionVersions.mockImplementation((type) =>
      Promise.resolve(new Set(type === "payment" ? [] : [VERSION])),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files).toEqual([{ file: "payment", outcome: "stored" }]);
    expect(fetchConfigFile).toHaveBeenCalledTimes(1);

    storedDefinitionVersions.mockResolvedValue(new Set([VERSION]));
    vi.mocked(fetchConfigFile).mockClear();

    expect(await fetchConfigDefinitionsUseCase(ARGS)).toEqual({ files: [] });
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });

  it("only asks about the files the version has", async () => {
    findVersionsByGrantCode.mockResolvedValue([aRow(["grant"])]);

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files).toEqual([{ file: "grant", outcome: "stored" }]);
    expect(storeDefinition).not.toHaveBeenCalled();
  });

  it("never writes what GAS recorded about fetching the version", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({ ...published, payment: s3Error("NoSuchKey", 404) }),
    );

    await fetchConfigDefinitionsUseCase(ARGS);

    expect(updateFetchStatus).not.toHaveBeenCalled();
    expect(updateDefinitionFetchStatus).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", s3Error("NoSuchKey", 404)],
    ["forbidden", s3Error("AccessDenied", 403)],
    ["unparseable", s3Error("PARSE_ERROR", 200)],
    ["timeout", s3Error("SERVICE_ERROR", 503)],
  ])(
    "reports an S3 failure as %s, stores nothing for that file and still stores the others",
    async (reason, error) => {
      fetchConfigFile.mockImplementation(
        fetchedFrom({ ...published, agreement: error }),
      );

      const { files } = await fetchConfigDefinitionsUseCase(ARGS);

      expect(files).toEqual([
        { file: "grant", outcome: "stored" },
        { file: "agreement", outcome: "failed", reason, message: null },
        { file: "payment", outcome: "stored" },
      ]);
      expect(storeDefinition).not.toHaveBeenCalledWith(
        "agreement",
        expect.anything(),
      );
      expect(logger.error).toHaveBeenCalledWith(
        { event: { action: "admin-definition-fetch-failed" } },
        expect.stringContaining(`agreement definition for ${CODE}@${VERSION}`),
      );
    },
  );

  it("reports a file with no location as missing without asking S3", async () => {
    findConfigDefinition.mockImplementation(({ definitionType }) =>
      Promise.resolve(
        definitionType === "payment"
          ? { ...location("payment"), s3Key: null }
          : location(definitionType),
      ),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files[2]).toEqual({
      file: "payment",
      outcome: "failed",
      reason: "missing",
      message: null,
    });
    expect(fetchConfigFile).toHaveBeenCalledTimes(2);
  });

  it("reports a file its owning context refuses as invalid, with the reason cut short", async () => {
    storeDefinition.mockImplementation((type) =>
      type === "payment"
        ? Promise.reject(Boom.badImplementation("x".repeat(600)))
        : Promise.resolve(),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files[2]).toEqual({
      file: "payment",
      outcome: "failed",
      reason: "invalid",
      message: "x".repeat(500),
    });
  });

  it("reports a file too malformed to build as invalid", async () => {
    storeDefinition.mockImplementation((type) =>
      type === "agreement"
        ? Promise.reject(new TypeError("Cannot read properties of undefined"))
        : Promise.resolve(),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files[1]).toEqual({
      file: "agreement",
      outcome: "failed",
      reason: "invalid",
      message: "Cannot read properties of undefined",
    });
  });

  it("stops on a refusal that is not about the definition", async () => {
    storeDefinition.mockRejectedValue(Boom.serverUnavailable("busy"));

    const error = await fetchConfigDefinitionsUseCase(ARGS).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
    expect(error.data.files).toEqual([]);
  });

  it("reads every file from S3 before the transaction opens", async () => {
    let readsBefore;
    withTransaction.mockImplementation((callback) => {
      readsBefore = fetchConfigFile.mock.calls.length;
      return callback(SESSION);
    });

    await fetchConfigDefinitionsUseCase(ARGS);

    expect(readsBefore).toBe(3);
  });

  it("writes the SUCCESS audit event in the transaction that stores the files", async () => {
    await fetchConfigDefinitionsUseCase(ARGS);

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      SESSION,
    );
  });

  it("fails the fetch when its audit event cannot be written, so nothing it stored commits", async () => {
    const failure = new MongoServerError({ message: "outbox down", code: 6 });
    writeAuditEvent.mockRejectedValue(failure);

    await expect(fetchConfigDefinitionsUseCase(ARGS)).rejects.toBe(failure);
  });

  it("lets a transient transaction error through as it is, for the transaction to retry", async () => {
    const conflict = new MongoServerError({
      message: "WriteConflict",
      code: 112,
      errorLabels: ["TransientTransactionError"],
    });
    storeDefinition.mockRejectedValue(conflict);

    await expect(fetchConfigDefinitionsUseCase(ARGS)).rejects.toBe(conflict);
  });

  it("stops on a failure while reading, naming the files that failed before it", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({ ...published, grant: s3Error("NoSuchKey", 404) }),
    );
    findConfigDefinition.mockImplementation(({ definitionType }) =>
      definitionType === "payment"
        ? Promise.reject(new MongoServerError({ message: "down", code: 6 }))
        : Promise.resolve(location(definitionType)),
    );

    const error = await fetchConfigDefinitionsUseCase(ARGS).catch((e) => e);

    expect(error.data.files).toEqual([
      { file: "grant", outcome: "failed", reason: "missing", message: null },
    ]);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(storeDefinition).not.toHaveBeenCalled();
    expect(audit().details.files).toEqual([
      { file: "grant", outcome: "failed", reason: "missing" },
    ]);
  });

  it("refuses a grant file arrival would refuse, and saves nothing", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({
        ...published,
        grant: { ...published.grant, metadata: undefined },
      }),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files[0]).toEqual({
      file: "grant",
      outcome: "failed",
      reason: "invalid",
      message: expect.any(String),
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a grant file published under another code, and saves nothing", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({
        ...published,
        grant: { ...published.grant, code: "frps-private-beta" },
      }),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files).toEqual([
      {
        file: "grant",
        outcome: "failed",
        reason: "invalid",
        message: `Definition is for "frps-private-beta", not "${CODE}"`,
      },
      { file: "agreement", outcome: "stored" },
      { file: "payment", outcome: "stored" },
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a grant file with no code for what arrival says, not as another grant's", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({
        ...published,
        grant: { ...published.grant, code: undefined },
      }),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files[0]).toEqual({
      file: "grant",
      outcome: "failed",
      reason: "invalid",
      message: expect.stringContaining('"code" is required'),
    });
    expect(files[0].message).not.toContain("Definition is for");
    expect(save).not.toHaveBeenCalled();
  });

  it("counts a file stored since it was found missing as stored, without storing it again", async () => {
    storedDefinitionVersions.mockImplementation(
      (type, _code, _versions, session) =>
        Promise.resolve(
          new Set(session === SESSION && type !== "payment" ? [VERSION] : []),
        ),
    );

    const { files } = await fetchConfigDefinitionsUseCase(ARGS);

    expect(files).toEqual([
      { file: "grant", outcome: "stored" },
      { file: "agreement", outcome: "stored" },
      { file: "payment", outcome: "stored" },
    ]);
    expect(save).not.toHaveBeenCalled();
    expect(storeDefinition.mock.calls.map(([type]) => type)).toEqual([
      "payment",
    ]);
  });

  it("stops when a grant store still conflicts in the transaction", async () => {
    save.mockRejectedValue(Boom.conflict("already exists"));

    const error = await fetchConfigDefinitionsUseCase(ARGS).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
    expect(error.data.files).toEqual([]);
  });

  it("audits a fetch that ran as a SUCCESS naming each file's outcome", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({ ...published, payment: s3Error("NoSuchKey", 404) }),
    );

    await fetchConfigDefinitionsUseCase(ARGS);

    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(audit()).toMatchObject({
      status: "SUCCESS",
      entities: [
        {
          entity: "GRANT",
          action: "FETCH_CONFIG_DEFINITION",
          entityid: CODE,
        },
      ],
      security: { pmccode: "0706" },
    });
    expect(audit().details).toEqual({
      caller: "fg-admin",
      version: VERSION,
      files: [
        { file: "grant", outcome: "stored" },
        { file: "agreement", outcome: "stored" },
        { file: "payment", outcome: "failed", reason: "missing" },
      ],
    });
  });

  it("refuses an unknown version with 404 GRANT_VERSION_NOT_FOUND, audited as a FAILURE", async () => {
    findVersionsByGrantCode.mockResolvedValue([]);

    const error = await fetchConfigDefinitionsUseCase(ARGS).catch((e) => e);

    expect(error.output.statusCode).toBe(404);
    expect(error.output.payload.reason).toBe("GRANT_VERSION_NOT_FOUND");
    expect(withTransaction).not.toHaveBeenCalled();
    expect(audit()).toMatchObject({ status: "FAILURE" });
    expect(audit().details).toEqual({
      caller: "fg-admin",
      version: VERSION,
      files: [],
      errorCode: "GRANT_VERSION_NOT_FOUND",
    });
  });

  it("stops on a failure that is no outcome, and the FAILURE audit, outside the transaction, names the files that failed first", async () => {
    fetchConfigFile.mockImplementation(
      fetchedFrom({ ...published, grant: s3Error("AccessDenied", 403) }),
    );
    storeDefinition.mockRejectedValue(
      new MongoServerError({ message: "down", code: 6 }),
    );

    const error = await fetchConfigDefinitionsUseCase(ARGS).catch((e) => e);

    expect(error.output.statusCode).toBe(500);
    expect(error.data.files).toEqual([
      { file: "grant", outcome: "failed", reason: "forbidden", message: null },
    ]);
    expect(audit()).toMatchObject({ status: "FAILURE" });
    expect(writeAuditEvent.mock.calls[0][1]).toBeNull();
    expect(audit().details).toEqual({
      caller: "fg-admin",
      version: VERSION,
      files: [{ file: "grant", outcome: "failed", reason: "forbidden" }],
      errorCode: "UNEXPECTED_FAILURE",
    });
    expect(logger.error).toHaveBeenCalledWith(
      { event: { action: "admin-definition-fetch-failed" } },
      expect.stringContaining("agreement"),
    );
  });
});
