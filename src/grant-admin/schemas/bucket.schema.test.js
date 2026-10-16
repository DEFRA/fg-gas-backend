import { describe, expect, it } from "vitest";
import {
  bucketCatalogueResponseSchema,
  bucketQueryRequestSchema,
  bucketQueryResponseSchema,
} from "./bucket.schema.js";

const entry = {
  id: "gas.example",
  path: "gas/example",
  label: "Example",
  service: "GAS",
  shortLabel: "Example",
  icon: null,
  order: 70,
  noun: { one: "example", many: "examples" },
  time: { label: "Created" },
  facts: [],
  refs: [],
  indexes: [[]],
  groupings: [],
  title: { label: "Reference", format: "mono" },
  columns: [],
  audited: true,
  timeline: false,
  summaries: [],
  page: null,
  tab: null,
};

describe("bucket schemas", () => {
  it("names the engine's schemas for the API documentation", () => {
    expect(bucketQueryRequestSchema.describe().flags.label).toBe(
      "BucketQueryRequest",
    );
    expect(bucketQueryResponseSchema.describe().flags.label).toBe(
      "BucketQueryResponse",
    );
  });

  it("reads no body as the empty query", () => {
    expect(bucketQueryRequestSchema.validate(null).value).toEqual({
      where: {},
      show: [],
      limit: 20,
      groupBy: [],
    });
  });

  it("accepts a catalogue with the sources it could not read", () => {
    expect(
      bucketCatalogueResponseSchema.validate({
        buckets: [entry],
        sourceErrors: [{ hop: "CW-BE" }],
      }).error,
    ).toBeUndefined();
  });

  it.each(["buckets", "sourceErrors"])(
    "refuses a catalogue without %s",
    (key) => {
      const { [key]: _, ...rest } = { buckets: [entry], sourceErrors: [] };

      expect(bucketCatalogueResponseSchema.validate(rest).error).toBeDefined();
    },
  );

  it("refuses an entry that is not a catalogue entry", () => {
    expect(
      bucketCatalogueResponseSchema.validate({
        buckets: [{ id: "gas.example" }],
        sourceErrors: [],
      }).error,
    ).toBeDefined();
  });
});
