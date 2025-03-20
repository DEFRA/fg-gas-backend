import { describe, before, it } from "node:test";
import hapi from "@hapi/hapi";
import { assert } from "../common/assert.js";
import { healthPlugin } from "./index.js";

describe("healthPlugin", () => {
  let server;

  before(async () => {
    server = hapi.server();
    await server.register(healthPlugin);
    await server.initialize();
  });

  describe("GET /health", () => {
    it("responds with 200", async () => {
      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/health",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        message: "success",
      });
    });
  });
});
