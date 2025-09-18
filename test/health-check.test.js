import { describe, expect, it } from "vitest";
import { wreck } from "./helpers/wreck.js";

describe("Health Check Tests", () => {
  it("should verify fg-gas-backend service is healthy", async () => {
    const response = await wreck.get("/health", {
      json: true,
    });

    expect(response.res.statusCode).toBe(200);
  });
});
