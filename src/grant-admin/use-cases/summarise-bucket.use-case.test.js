import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSummary, runSummary } from "../../common/buckets/summary.js";
import { refuse } from "../../common/buckets/refusal.js";
import { findBucket } from "../../common/buckets/registry.js";
import { summariseCwBucket } from "../repositories/cw-actuators.repository.js";
import { summariseBucketUseCase } from "./summarise-bucket.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/buckets/summary.js");
vi.mock("../../common/buckets/registry.js");
vi.mock("../repositories/cw-actuators.repository.js");

const BODY = { from: "2026-10-08T12:00:00.000Z" };
const QUERY = { summary: { id: "errors" }, from: BODY.from, to: undefined };
const RESULT = { bucket: "gas.outbox", summary: "errors", entries: [] };

const reasonOf = (reason) =>
  expect.objectContaining({
    output: expect.objectContaining({
      payload: expect.objectContaining({ reason }),
    }),
  });

const ask = (bucketId, summaryId = "errors") =>
  summariseBucketUseCase({
    bucketId,
    summaryId,
    body: BODY,
    actor: "Jo Operator",
  });

describe("summariseBucketUseCase", () => {
  beforeEach(() => {
    parseSummary.mockReturnValue(QUERY);
    runSummary.mockResolvedValue(RESULT);
    summariseCwBucket.mockResolvedValue({
      bucket: "cw.example",
      summary: "errors",
      entries: [],
    });
  });

  it("reads a summary of one of this service's buckets", async () => {
    const bucket = { id: "gas.outbox" };
    findBucket.mockReturnValue(bucket);

    expect(await ask("gas.outbox")).toBe(RESULT);
    expect(parseSummary).toHaveBeenCalledWith(bucket, "errors", BODY);
    expect(runSummary).toHaveBeenCalledWith(bucket, QUERY);
    expect(summariseCwBucket).not.toHaveBeenCalled();
  });

  it("refuses before the read a summary the bucket does not declare", async () => {
    findBucket.mockReturnValue({ id: "gas.outbox" });
    parseSummary.mockImplementation(() => {
      throw refuse("UNKNOWN_SUMMARY");
    });

    await expect(ask("gas.outbox", "nothing")).rejects.toThrow(
      reasonOf("UNKNOWN_SUMMARY"),
    );
    expect(runSummary).not.toHaveBeenCalled();
  });

  it("forwards a Caseworking bucket by its id, with the operator", async () => {
    const answer = await ask("cw.example");

    expect(answer).toMatchObject({ bucket: "cw.example" });
    expect(summariseCwBucket).toHaveBeenCalledWith(
      "cw.example",
      "errors",
      BODY,
      { actor: "Jo Operator" },
    );
    expect(findBucket).not.toHaveBeenCalled();
  });

  it("passes Caseworking's refusal on", async () => {
    summariseCwBucket.mockRejectedValue(refuse("UNKNOWN_SUMMARY"));

    await expect(ask("cw.example")).rejects.toThrow(
      reasonOf("UNKNOWN_SUMMARY"),
    );
  });

  it.each([
    ["a GAS bucket nobody registered", "gas.nothing"],
    ["an id of another service", "other.cases"],
    ["a malformed id", "GAS.Outbox"],
    ["an inherited property name", "constructor.x"],
  ])("refuses UNKNOWN_BUCKET for %s", async (_, bucketId) => {
    findBucket.mockReturnValue(undefined);

    await expect(ask(bucketId)).rejects.toThrow(reasonOf("UNKNOWN_BUCKET"));
    expect(summariseCwBucket).not.toHaveBeenCalled();
    expect(runSummary).not.toHaveBeenCalled();
  });
});
