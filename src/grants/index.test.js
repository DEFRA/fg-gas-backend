import { describe, before, it } from "node:test";
import hapi from "@hapi/hapi";
import { assert } from "../common/assert.js";
import { grantsPlugin } from "./index.js";
import { grantService } from "./grant-service.js";

describe("grantsPlugin", () => {
  let server;

  before(async () => {
    server = hapi.server();
    await server.register(grantsPlugin);
    await server.initialize();
  });

  describe("POST /grants", () => {
    it("creates a new grant and returns the id", async ({ mock }) => {
      mock.method(grantService, "create", async (props) => ({
        code: "1",
        ...props,
      }));

      const { statusCode, result } = await server.inject({
        method: "POST",
        url: "/grants",
        payload: {
          name: "test",
          endpoints: [],
        },
      });

      assert.calledOnceWith(grantService.create, {
        name: "test",
        endpoints: [],
      });

      assert.equal(statusCode, 201);

      assert.deepEqual(result, {
        code: "1",
      });
    });
  });

  describe("GET /grants", () => {
    it("returns all grants", async ({ mock }) => {
      mock.method(grantService, "findAll", async () => [
        {
          code: "1",
          name: "test 1",
          endpoints: [],
          internal: "this is private",
        },
        {
          code: "2",
          name: "test 2",
          endpoints: [],
          internal: "this is private",
        },
      ]);

      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/grants",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, [
        {
          code: "1",
          name: "test 1",
          endpoints: [],
        },
        {
          code: "2",
          name: "test 2",
          endpoints: [],
        },
      ]);
    });
  });

  describe("GET /grants/{code}", () => {
    it("returns matching grant", async ({ mock }) => {
      mock.method(grantService, "findByCode", async () => ({
        code: "adding-value",
        name: "test 1",
        endpoints: [],
        internal: "this is private",
      }));

      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/grants/adding-value",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        code: "adding-value",
        name: "test 1",
        endpoints: [],
      });
    });
  });

  describe("GET /grants/{code}/endpoints/{name}/invoke", () => {
    it("returns response from endpoint", async ({ mock }) => {
      mock.method(grantService, "invokeGetEndpoint", async () => ({
        arbitrary: "result",
      }));

      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/grants/adding-value/endpoints/test/invoke",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        arbitrary: "result",
      });

      assert.calledOnceWith(grantService.invokeGetEndpoint, {
        code: "adding-value",
        name: "test",
      });
    });
  });

  describe("POST /grants/{code}/endpoints/{name}/invoke", () => {
    it("returns response from endpoint", async ({ mock }) => {
      mock.method(grantService, "invokePostEndpoint", async () => ({
        arbitrary: "result",
      }));

      const { statusCode, result } = await server.inject({
        method: "POST",
        url: "/grants/adding-value/endpoints/test/invoke",
        payload: {
          code: "adding-value",
          name: "test",
        },
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        arbitrary: "result",
      });

      assert.calledOnceWith(grantService.invokePostEndpoint, {
        code: "adding-value",
        name: "test",
        payload: {
          code: "adding-value",
          name: "test",
        },
      });
    });
  });
});
