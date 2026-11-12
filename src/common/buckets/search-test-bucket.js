import { testBucket } from "./test-bucket.js";

// The test list searched by the fields each of its codes declares.
export const searchedBucket = (overrides = {}) =>
  testBucket({
    time: { field: "createdAt", type: "isoString", label: "Created" },
    search: { collection: "record_search", lead: "code" },
    ...overrides,
  });
