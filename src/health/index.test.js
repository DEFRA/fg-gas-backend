import hapi from "@hapi/hapi";
import { beforeAll, describe, expect, it } from "vitest";
import { health } from "./index.js";

let server;

beforeAll(async () => {
  server = hapi.server();
  await server.register(health);
  await server.initialize();
});

describe("GET /health", () => {
  it("responds with 200", async () => {
    const { statusCode, result } = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(statusCode).toEqual(200);

    expect(result).toEqual({
      message: "success",
    });
  });
});
