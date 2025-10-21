import { describe, expect, it } from "vitest";
import { getReadPreference } from "./mongo-client.js";

describe("Mongo client", () => {
  it("should get read preference based on environment", () => {
    expect(getReadPreference("development")).toBe("primary");
    expect(getReadPreference("production")).toBe("secondary");
  });
});
