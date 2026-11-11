import { describe, expect, it, vi } from "vitest";
import * as last from "../../../test/fixtures/buckets/last-release-schema.js";
import { describeBucket } from "./catalogue.js";
import { parseQuery, runQuery } from "./engine.js";
import {
  catalogueEntrySchema,
  queryRequestSchema,
  queryResponseSchema,
} from "./schema.js";
import { testBucket } from "./test-bucket.js";

vi.mock("../mongo-client.js", () => ({
  db: {
    collection: () => ({
      find: () => ({ toArray: async () => [] }),
      countDocuments: async () => 3,
      aggregate: () => ({ toArray: async () => [] }),
    }),
  },
}));

const bucket = testBucket();

const errorOf = (schema, body) => schema.validate(body).error?.message;

// Either service may deploy first, so each must read what the other's last
// release sends it, and send what that release reads.
describe("with the other service on the last release", () => {
  it.each([
    ["an empty body", {}],
    [
      "a filter and a grouping",
      { where: { status: "FAILED" }, groupBy: ["status"] },
    ],
  ])(
    "forwards %s from an admin that doesn't count as a body it reads",
    (_, body) => {
      const forwarded = queryRequestSchema.validate(body).value;

      expect(forwarded).not.toHaveProperty("count");
      expect(errorOf(last.queryRequestSchema, forwarded)).toBeUndefined();
    },
  );

  it("reads the body that release forwards", () => {
    const forwarded = last.queryRequestSchema.validate({}).value;
    const { value, error } = queryRequestSchema.validate(forwarded);

    expect(error).toBeUndefined();
    expect(parseQuery(bucket, value).count).toBe(false);
  });

  it("answers a query that asks for no count in a shape that release reads", async () => {
    const answer = await runQuery(
      bucket,
      parseQuery(bucket, queryRequestSchema.validate({}).value),
    );

    expect(answer).not.toHaveProperty("total");
    expect(errorOf(last.queryResponseSchema, answer)).toBeUndefined();
  });

  it("reads that release's answer, with no total", () => {
    const answer = {
      bucket: "test.outbox",
      plan: {
        kind: "exact",
        index: ["publicationDate", "_id"],
        bound: [],
        filled: [],
        residual: [],
        scans: 1,
      },
      rows: [],
      page: { next: null, keepLooking: null, searchedTo: null, complete: true },
      groups: [],
    };

    expect(errorOf(last.queryResponseSchema, answer)).toBeUndefined();
    expect(errorOf(queryResponseSchema, answer)).toBeUndefined();
  });

  it("describes its buckets in a catalogue entry that release reads, a toggle on every fact", async () => {
    const entry = await describeBucket(bucket);

    expect(entry.facts.every(({ toggle }) => toggle === null)).toBe(true);
    expect(errorOf(last.catalogueEntrySchema, entry)).toBeUndefined();
    expect(errorOf(catalogueEntrySchema, entry)).toBeUndefined();
  });
});
