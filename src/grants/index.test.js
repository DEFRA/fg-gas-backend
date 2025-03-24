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
      mock.method(grantService, "create", async (props) => props);

      const { statusCode, result } = await server.inject({
        method: "POST",
        url: "/grants",
        payload: {
          code: "test",
          metadata: {
            description: "test",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [],
          questions: [],
        },
      });

      assert.calledOnceWith(grantService.create, {
        code: "test",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
      });

      assert.equal(statusCode, 201);

      assert.deepEqual(result, {
        code: "test",
      });
    });
  });

  describe("GET /grants", () => {
    it("returns all grants", async ({ mock }) => {
      mock.method(grantService, "findAll", async () => [
        {
          code: "1",
          metadata: {
            description: "test 1",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [],
          questions: [],
          internal: "this is private",
        },
        {
          code: "2",
          metadata: {
            description: "test 2",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [],
          questions: [],
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
          metadata: {
            description: "test 1",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [],
          questions: [],
        },
        {
          code: "2",
          metadata: {
            description: "test 2",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [],
          questions: [],
        },
      ]);
    });
  });

  describe("GET /grants/{code}", () => {
    it("returns matching grant", async ({ mock }) => {
      mock.method(grantService, "findByCode", async () => ({
        code: "adding-value",
        metadata: {
          description: "test 1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
        internal: "this is private",
      }));

      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/grants/adding-value",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        code: "adding-value",
        metadata: {
          description: "test 1",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [],
        questions: [],
      });
    });
  });

  describe("GET /grants/{code}/actions/{name}/invoke", () => {
    it("returns response from action", async ({ mock }) => {
      mock.method(grantService, "invokeGetAction", async () => ({
        arbitrary: "result",
      }));

      const { statusCode, result } = await server.inject({
        method: "GET",
        url: "/grants/adding-value/actions/test/invoke",
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        arbitrary: "result",
      });

      assert.calledOnceWith(grantService.invokeGetAction, {
        code: "adding-value",
        name: "test",
      });
    });
  });

  describe("POST /grants/{code}/actions/{name}/invoke", () => {
    it("returns response from action", async ({ mock }) => {
      mock.method(grantService, "invokePostAction", async () => ({
        arbitrary: "result",
      }));

      const { statusCode, result } = await server.inject({
        method: "POST",
        url: "/grants/adding-value/actions/test/invoke",
        payload: {
          code: "adding-value",
          name: "test",
        },
      });

      assert.equal(statusCode, 200);

      assert.deepEqual(result, {
        arbitrary: "result",
      });

      assert.calledOnceWith(grantService.invokePostAction, {
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
