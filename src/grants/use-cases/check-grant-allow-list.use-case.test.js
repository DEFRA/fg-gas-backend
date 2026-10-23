import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, mongoClient } from "../../common/mongo-client.js";
import { fetchConfigFile, S3FetchError } from "../../common/s3-client.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { ConfigVersion, FetchStatus } from "../models/config-version.js";
import { GrantDocument } from "../models/grant-document.js";
import { Grant } from "../models/grant.js";
import { checkGrantAllowListUseCase } from "./check-grant-allow-list.use-case.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
  mongoClient: { startSession: vi.fn() },
}));
vi.mock("../../common/s3-client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchConfigFile: vi.fn(),
}));
vi.mock("../../events/write-audit-event.js");

const args = {
  grantCode: "woodland",
  sbi: "900000002",
  crn: "9000000001",
  caller: "grants-ui",
};
const populated = {
  grantCode: "woodland",
  global: { sbi: ["900000002"], crn: ["9000000001"] },
};

const grantAt = (version) =>
  new GrantDocument(
    new Grant({
      code: "woodland",
      version,
      metadata: { description: "Woodland", startDate: "2026-01-01" },
      actions: [],
      phases: [],
    }),
  );

const versionAt = (
  version,
  status = "active",
  fetchStatus = FetchStatus.Fetched,
) => {
  const row = ConfigVersion.new({
    grantCode: "woodland",
    version,
    status,
    s3Key: "woodland/" + version + "/gas/gas.json",
    s3Bucket: "config-broker-local",
  });
  row.fetchStatus = fetchStatus;
  return row.toDocument();
};

// Controlled Mongo boundary: honor the actual resolver's emitted filters and
// ordering, rather than mocking the resolver or hard-coding its answer.
const matchesFilter = (doc, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (key === "definitions.grant.fetchStatus") {
      return doc.definitions.grant.fetchStatus !== value.$ne;
    }
    return doc[key] === value;
  });

const orderedBy = (sort) => (a, b) => {
  for (const [key, direction] of Object.entries(sort)) {
    const difference = direction * (a[key] - b[key]);
    if (difference) return difference;
  }
  return 0;
};

const findDocument = (documents, filter, options = {}) =>
  documents
    .filter((doc) => matchesFilter(doc, filter))
    .sort(orderedBy(options.sort ?? {}))[0] ?? null;

describe("checkGrantAllowListUseCase", () => {
  let grantDocuments;
  let configDocuments;
  let grants;
  let catalogue;
  let lists;
  let settings;
  let session;

  beforeEach(() => {
    grantDocuments = [grantAt("1.1.0"), grantAt("1.4.0")];
    configDocuments = [versionAt("1.4.0")];
    grants = {
      findOne: vi.fn(async (filter, options) =>
        findDocument(grantDocuments, filter, options),
      ),
      insertOne: vi.fn(async (doc) => {
        grantDocuments.push(doc);
      }),
    };
    catalogue = {
      findOne: vi.fn(async (filter, options) =>
        findDocument(configDocuments, filter, options),
      ),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    settings = {
      findOne: vi.fn().mockResolvedValue({ grantCode: "woodland", open: true }),
    };
    lists = { findOne: vi.fn().mockResolvedValue(populated) };
    db.collection.mockImplementation(
      (name) =>
        ({
          grants,
          config_versions: catalogue,
          allow_lists: lists,
          grant_settings: settings,
        })[name],
    );
    session = {
      withTransaction: vi.fn(async (callback) => callback(session)),
      endSession: vi.fn(),
    };
    mongoClient.startSession.mockReturnValue(session);
    writeAuditEvent.mockResolvedValue();
  });

  it("denies an otherwise allowed applicant when settings do not exist", async () => {
    settings.findOne.mockResolvedValue(null);
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: false,
    });
  });

  it.each([
    [args, true],
    [{ ...args, sbi: "900000004" }, false],
    [{ ...args, crn: "9000000003" }, false],
  ])(
    "returns the domain decision with unchanged audit fields: %j",
    async (input, allowed) => {
      await expect(checkGrantAllowListUseCase(input)).resolves.toEqual({
        allowed,
      });
      expect(writeAuditEvent).toHaveBeenCalledWith(
        {
          entities: [
            {
              entity: "GRANT",
              action: "CHECK_ALLOW_LIST",
              entityid: "woodland",
            },
          ],
          details: { caller: "grants-ui", allowed },
          accounts: { sbi: input.sbi, crn: input.crn, frn: undefined },
          segregationRef: "woodland",
          security: { pmccode: "0706" },
          status: "SUCCESS",
        },
        session,
      );
    },
  );

  it("loads the latest active definition across majors before reading the grant-wide list", async () => {
    configDocuments.push(
      versionAt("1.3.0"),
      versionAt("2.0.0"),
      versionAt("2.0.1"),
      versionAt("3.0.0", "inactive"),
    );
    grantDocuments.push(grantAt("1.3.0"), grantAt("2.0.0"), grantAt("2.0.1"));
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
    expect(grants.findOne).toHaveBeenCalledWith({
      code: "woodland",
      version: "2.0.1",
    });
    expect(grants.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      lists.findOne.mock.invocationCallOrder[0],
    );
    expect(fetchConfigFile).not.toHaveBeenCalled();
  });

  it.each([
    ["no catalogue", []],
    ["only inactive definitions", [versionAt("1.4.0", "inactive")]],
  ])(
    "rejects historical grants with %s instead of accepting orphan lists",
    async (_, versions) => {
      configDocuments = versions;
      await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
        output: { statusCode: 404 },
      });
      expect(lists.findOne).not.toHaveBeenCalled();
      expect(grants.findOne).not.toHaveBeenCalled();
      expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
        status: "FAILURE",
        details: { caller: "grants-ui" },
        accounts: { sbi: args.sbi, crn: args.crn },
      });
      expect(writeAuditEvent.mock.calls[0][0].details).toEqual({
        caller: "grants-ui",
      });
    },
  );

  it("fails on a broken latest definition rather than falling back to an older active version", async () => {
    configDocuments.push(
      versionAt("2.0.0", "active", FetchStatus.PermanentError),
    );
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 502 },
    });
    expect(lists.findOne).not.toHaveBeenCalled();
    expect(grants.findOne).not.toHaveBeenCalled();
    expect(writeAuditEvent.mock.calls[0][0].status).toBe("FAILURE");
  });

  it("returns 404 for an unknown grant and never reads its list", async () => {
    grantDocuments = [];
    configDocuments = [];
    await expect(
      checkGrantAllowListUseCase({ ...args, grantCode: "missing" }),
    ).rejects.toMatchObject({ output: { statusCode: 404 } });
    expect(lists.findOne).not.toHaveBeenCalled();
  });

  it("does not default to unrestricted if resolution fails and no list exists", async () => {
    configDocuments = [];
    lists.findOne.mockResolvedValue(null);
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(lists.findOne).not.toHaveBeenCalled();
  });

  it("defaults to unrestricted only after successful grant resolution", async () => {
    lists.findOne.mockResolvedValue(null);
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
    expect(grants.findOne).toHaveBeenCalledWith({
      code: "woodland",
      version: "1.4.0",
    });
  });

  it("resolves a newly published major on the next request", async () => {
    await checkGrantAllowListUseCase(args);
    configDocuments.push(versionAt("2.0.0"));
    grantDocuments.push(grantAt("2.0.0"));
    await checkGrantAllowListUseCase(args);
    expect(grants.findOne).toHaveBeenNthCalledWith(1, {
      code: "woodland",
      version: "1.4.0",
    });
    expect(grants.findOne).toHaveBeenNthCalledWith(2, {
      code: "woodland",
      version: "2.0.0",
    });
  });

  it("fetches a pending definition through the existing resolver", async () => {
    configDocuments = [versionAt("1.4.0", "active", FetchStatus.Pending)];
    fetchConfigFile.mockResolvedValue({
      code: "woodland",
      metadata: { description: "Woodland", startDate: "2026-01-01" },
      actions: [],
      phases: [],
    });
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
    expect(fetchConfigFile).toHaveBeenCalledWith(
      "config-broker-local",
      "woodland/1.4.0/gas/gas.json",
    );
    expect(grants.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "woodland",
        version: "1.4.0",
      }),
      { session: undefined },
    );
  });

  it("propagates definition-fetch failure before reading the list", async () => {
    configDocuments = [versionAt("1.4.0", "active", FetchStatus.Pending)];
    fetchConfigFile.mockRejectedValue(
      new S3FetchError("unavailable", { statusCode: 503 }),
    );
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 503 },
    });
    expect(lists.findOne).not.toHaveBeenCalled();
    expect(writeAuditEvent.mock.calls[0][0].status).toBe("FAILURE");
  });

  it("fails closed on malformed persisted list state", async () => {
    lists.findOne.mockResolvedValue({
      grantCode: "woodland",
      global: { sbi: ["bad"], crn: [] },
    });
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });

  it("propagates storage failures", async () => {
    lists.findOne.mockRejectedValue(new Error("storage unavailable"));
    await expect(checkGrantAllowListUseCase(args)).rejects.toThrow(
      "storage unavailable",
    );
    expect(writeAuditEvent.mock.calls[0][0].status).toBe("FAILURE");
  });

  it("reads the current list for every query", async () => {
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
    lists.findOne.mockResolvedValue({
      grantCode: "woodland",
      global: { sbi: ["900000004"], crn: [] },
    });
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: false,
    });
  });

  it.each(["900000002", "900000004"])(
    "withholds a true or false decision if success auditing fails: %s",
    async (sbi) => {
      writeAuditEvent.mockRejectedValue(new Error("audit unavailable"));
      await expect(
        checkGrantAllowListUseCase({ ...args, sbi }),
      ).rejects.toThrow("audit unavailable");
    },
  );

  it("withholds a decision if the audit transaction cannot commit", async () => {
    session.withTransaction.mockImplementation(async (callback) => {
      await callback(session);
      throw new Error("commit failed");
    });
    await expect(checkGrantAllowListUseCase(args)).rejects.toThrow(
      "commit failed",
    );
  });

  it("waits for the audit commit before releasing the decision", async () => {
    let commit;
    const committed = new Promise((resolve) => {
      commit = resolve;
    });
    session.withTransaction.mockImplementation(async (callback) => {
      await callback(session);
      await committed;
    });
    let released = false;
    const pending = checkGrantAllowListUseCase(args).then((result) => {
      released = true;
      return result;
    });
    await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalled());
    expect(released).toBe(false);
    commit();
    await expect(pending).resolves.toEqual({ allowed: true });
  });
});
