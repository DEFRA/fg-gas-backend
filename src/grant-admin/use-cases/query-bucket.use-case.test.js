import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseQuery, runQuery } from "../../common/buckets/engine.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { auditedRead } from "../../events/audited-read.js";
import { queryCwBucket } from "../repositories/cw-actuators.repository.js";
import {
  buildQueryBucketAudit,
  queryBucketUseCase,
} from "./query-bucket.use-case.js";

const audit = vi.hoisted(() => ({ builder: null, reads: 0 }));

vi.mock("../../common/logger.js");
vi.mock("../../common/buckets/engine.js");
vi.mock("../../common/buckets/registry.js");
vi.mock("../repositories/cw-actuators.repository.js");
vi.mock("../../events/audited-read.js", () => ({
  auditedRead: vi.fn((read, builder) => {
    audit.builder = builder;

    return (args) => {
      audit.reads += 1;

      return read(args);
    };
  }),
}));

const BODY = { where: { code: "example-grant" }, limit: 20 };
const QUERY = {
  where: { code: "example-grant" },
  asked: ["code"],
  ref: "ref:abc-123",
  refKind: "ref",
  from: "2026-10-08T12:00:00.000Z",
  to: "2026-10-09T12:00:00.000Z",
  cursor: null,
  plan: { kind: "exact" },
};
const RESULT = {
  bucket: "gas.applications",
  rows: [{ id: "1" }, { id: "2" }],
};

const reasonOf = (reason) =>
  expect.objectContaining({
    output: expect.objectContaining({
      payload: expect.objectContaining({ reason }),
    }),
  });

const ask = (bucketId, overrides) =>
  queryBucketUseCase({
    bucketId,
    body: BODY,
    caller: "fg-grants-platform-admin",
    actor: "Jo Operator",
    repeat: false,
    ...overrides,
  });

describe("queryBucketUseCase", () => {
  beforeEach(() => {
    audit.reads = 0;
    parseQuery.mockReturnValue(QUERY);
    runQuery.mockResolvedValue(RESULT);
    queryCwBucket.mockResolvedValue({ bucket: "cw.example", rows: [] });
  });

  it("is audited as a read that releases data", () => {
    expect(auditedRead).toBeDefined();
    expect(audit.builder).toBe(buildQueryBucketAudit);
  });

  it("reads a bucket that is not audited without an audit", async () => {
    const bucket = { id: "gas.outbox", audited: false };
    findBucket.mockReturnValue(bucket);

    expect(await ask("gas.outbox")).toBe(RESULT);
    expect(findBucket).toHaveBeenCalledWith("gas.outbox");
    expect(parseQuery).toHaveBeenCalledWith(bucket, BODY);
    expect(runQuery).toHaveBeenCalledWith(bucket, QUERY);
    expect(audit.reads).toBe(0);
  });

  it("reads an audited bucket through the audited read", async () => {
    const bucket = { id: "gas.applications", audited: true };
    findBucket.mockReturnValue(bucket);

    expect(await ask("gas.applications")).toBe(RESULT);
    expect(runQuery).toHaveBeenCalledWith(bucket, QUERY);
    expect(audit.reads).toBe(1);
  });

  it("refuses before the read, so a refused request writes no audit", async () => {
    findBucket.mockReturnValue({ id: "gas.applications", audited: true });
    parseQuery.mockImplementation(() => {
      throw refuse("UNKNOWN_FACT");
    });

    await expect(ask("gas.applications")).rejects.toThrow(
      reasonOf("UNKNOWN_FACT"),
    );
    expect(audit.reads).toBe(0);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("forwards a Caseworking bucket by its id, with the operator, and writes no audit", async () => {
    const answer = await ask("cw.example", { repeat: true });

    expect(answer).toEqual({ bucket: "cw.example", rows: [] });
    expect(queryCwBucket).toHaveBeenCalledWith("cw.example", BODY, {
      actor: "Jo Operator",
      repeat: true,
    });
    expect(findBucket).not.toHaveBeenCalled();
    expect(audit.reads).toBe(0);
  });

  it("passes Caseworking's refusal on", async () => {
    queryCwBucket.mockRejectedValue(refuse("UNKNOWN_BUCKET"));

    await expect(ask("cw.nothing")).rejects.toThrow(reasonOf("UNKNOWN_BUCKET"));
  });

  it.each([
    ["a GAS bucket nobody registered", "gas.nothing"],
    ["an id of another service", "other.cases"],
    ["a malformed id", "GAS.Outbox"],
    ["an id with no owner", "outbox"],
    ["an inherited property name", "constructor.x"],
  ])("refuses UNKNOWN_BUCKET for %s", async (_, bucketId) => {
    findBucket.mockReturnValue(undefined);

    await expect(ask(bucketId)).rejects.toThrow(reasonOf("UNKNOWN_BUCKET"));
    expect(queryCwBucket).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("buildQueryBucketAudit", () => {
  const args = {
    bucket: { id: "gas.applications" },
    query: QUERY,
    caller: "fg-grants-platform-admin",
    repeat: false,
  };

  it("records what was asked and how it was read", () => {
    expect(buildQueryBucketAudit(args, RESULT)).toEqual({
      entities: [
        {
          entity: "BUCKET",
          action: "QUERY_BUCKET",
          entityid: "gas.applications",
        },
      ],
      details: {
        caller: "fg-grants-platform-admin",
        facts: ["code"],
        refKind: "ref",
        from: "2026-10-08T12:00:00.000Z",
        to: "2026-10-09T12:00:00.000Z",
        page: "first",
        plan: "exact",
        resultCount: 2,
        repeat: false,
      },
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "admin-query-bucket",
    });
  });

  it("never records a filter value or the ref searched for", () => {
    const written = JSON.stringify(buildQueryBucketAudit(args, RESULT));

    expect(written).not.toContain("example-grant");
    expect(written).not.toContain("abc-123");
  });

  it("names a later page, and carries the plan of a read that failed", () => {
    const { details } = buildQueryBucketAudit(
      {
        ...args,
        repeat: true,
        query: {
          ...QUERY,
          ref: null,
          refKind: null,
          cursor: { t: "t", i: "i" },
          plan: { kind: "bounded" },
        },
      },
      null,
    );

    expect(details).toMatchObject({
      page: "next",
      plan: "bounded",
      refKind: null,
      repeat: true,
    });
    expect(details.resultCount).toBeUndefined();
  });
});
