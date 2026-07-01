import hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { agreements } from "./index.js";

describe("agreements", () => {
  it("registers as a hapi plugin", async () => {
    const server = hapi.server();
    await server.register(agreements);
    expect(server.registrations.agreements).toBeDefined();
  });
});
