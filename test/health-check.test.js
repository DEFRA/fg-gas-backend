import Wreck from "@hapi/wreck";
import { env } from "node:process";
import { describe, expect, it } from "vitest";

describe("Health Check Tests", () => {
  it("should verify fg-gas-backend service is healthy", async () => {
    const apiUrl = env.API_URL || "http://localhost:3001";
    console.log("API_URL:", apiUrl);
    console.log(
      "Available env vars:",
      Object.keys(env).filter(
        (k) => k.includes("API") || k.includes("GAS") || k.includes("PORT"),
      ),
    );

    const response = await Wreck.get(`${apiUrl}/health`, {
      json: true,
    });

    expect(response.res.statusCode).toBe(200);
    console.log("✅ FG-Gas-Backend service is healthy");
  });

  it("should verify database connectivity", async () => {
    // Test database connectivity through the API
    const apiUrl = env.API_URL || "http://localhost:3001";
    const response = await Wreck.get(`${apiUrl}/grants`, {
      json: true,
    });

    expect(response.res.statusCode).toBe(200);
    expect(Array.isArray(response.payload)).toBe(true);
    console.log("✅ Database connectivity verified");
  });
});
