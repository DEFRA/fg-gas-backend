import { describe, expect, it } from "vitest";
import { listPaginationSchema } from "./admin-list.schema.js";

describe("listPaginationSchema", () => {
  it("accepts a next page and a last page with no cursor", () => {
    expect(
      listPaginationSchema.validate({
        endCursor: "eyJ2IjoxfQ",
        hasNextPage: true,
      }).error,
    ).toBeUndefined();
    expect(
      listPaginationSchema.validate({ endCursor: null, hasNextPage: false })
        .error,
    ).toBeUndefined();
  });
});
