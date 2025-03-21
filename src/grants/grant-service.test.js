import { describe, it } from "node:test";
import { assert } from "../common/assert.js";
import { grantRepository } from "./grant-repository.js";
import { wreck } from "../common/wreck.js";
import { Grant } from "./grant.js";
import { grantService } from "./grant-service.js";

describe("grantService", () => {
  describe("create", () => {
    it("stores the grant in the repository", async ({ mock }) => {
      const grant = {
        id: "1",
        name: "test",
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
      };

      mock.method(Grant, "create", () => grant);
      mock.method(grantRepository, "add", async () => {});

      const result = await grantService.create({
        name: "test",
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
      });

      assert.calledOnceWith(grantRepository.add, grant);
      assert.deepEqual(result, grant);
    });
  });

  describe("findAll", () => {
    it("returns all grants from the repository", async ({ mock }) => {
      const grants = [
        {
          id: "1",
          name: "test 1",
          actions: [],
        },
        {
          id: "2",
          name: "test 2",
          actions: [],
        },
      ];

      mock.method(grantRepository, "findAll", async () => grants);

      const result = await grantService.findAll();

      assert.deepEqual(result, grants);
    });
  });

  describe("findByCode", () => {
    it("returns the grant from the repository", async ({ mock }) => {
      const grant = {
        code: "1",
        name: "test 1",
        actions: [],
      };

      mock.method(Grant, "validateCode");
      mock.method(grantRepository, "findByCode", async () => grant);

      const result = await grantService.findByCode("1");

      assert.deepEqual(result, grant);
    });

    it("throws when the grant is not found", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(grantRepository, "findByCode", async () => null);

      assert.rejects(grantService.findByCode("1"), {
        message: 'Grant with code "1" not found',
      });
    });
  });

  describe("invokeGetAction", () => {
    it("invokes the GET action", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(grantRepository, "findByCode", async () => ({
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
      }));

      const response = {
        arbitrary: "response",
      };

      mock.method(wreck, "get", async () => ({
        payload: response,
      }));

      const result = await grantService.invokeGetAction({
        code: "1",
        name: "test",
      });

      assert.calledOnceWith(wreck.get, "http://localhost?code=1", {
        json: true,
      });
      assert.deepEqual(result, response);
    });

    it("throws when the grant is not found", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(grantRepository, "findByCode", async () => null);
      mock.method(wreck, "get", async () => {});

      assert.rejects(
        grantService.invokeGetAction({
          code: "1",
          name: "test",
        }),
        {
          message: 'Grant with code "1" not found',
        },
      );

      assert.notCalled(wreck.get);
    });

    it("throws when the action is not found", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(grantRepository, "findByCode", async () => ({
        id: "1",
        name: "Test",
        actions: [],
      }));
      mock.method(wreck, "get", async () => {});

      assert.rejects(
        grantService.invokeGetAction({
          code: "1",
          name: "test",
        }),
        {
          message: 'Grant with code "1" has no GET action named "test"',
        },
      );

      assert.notCalled(wreck.get);
    });
  });

  describe("invokePostAction", () => {
    it("invokes the POST action", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(Grant, "validateActionPayload");
      mock.method(grantRepository, "findByCode", async () => ({
        actions: [
          {
            method: "POST",
            name: "test",
            url: "http://localhost",
          },
        ],
      }));

      const response = {
        arbitrary: "response",
      };

      mock.method(wreck, "post", async () => ({
        payload: response,
      }));

      const result = await grantService.invokePostAction({
        code: "1",
        name: "test",
        payload: {
          code: "1",
          name: "test",
        },
      });

      assert.calledOnceWith(wreck.post, "http://localhost", {
        payload: {
          code: "1",
          name: "test",
        },
        json: true,
      });

      assert.deepEqual(result, response);
    });

    it("throws when the grant is not found", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(Grant, "validateActionPayload");
      mock.method(grantRepository, "findByCode", async () => null);
      mock.method(wreck, "post", async () => {});

      assert.rejects(
        grantService.invokePostAction({
          code: "1",
          name: "test",
          payload: {
            code: "1",
            name: "test",
          },
        }),
        {
          message: 'Grant with code "1" not found',
        },
      );

      assert.notCalled(wreck.post);
    });

    it("throws when the action is not found", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(Grant, "validateActionPayload");
      mock.method(grantRepository, "findByCode", async () => ({
        id: "1",
        name: "Test",
        actions: [],
      }));
      mock.method(wreck, "post", async () => {});

      assert.rejects(
        grantService.invokePostAction({
          code: "1",
          name: "test",
          payload: {
            code: "1",
            name: "test",
          },
        }),
        {
          message: 'Grant with code "1" has no POST action named "test"',
        },
      );

      assert.notCalled(wreck.post);
    });

    it("throws when the payload is invalid", async ({ mock }) => {
      mock.method(Grant, "validateCode");
      mock.method(Grant, "validateActionName");
      mock.method(Grant, "validateActionPayload", () => {
        throw new Error("Invalid request payload input");
      });
      mock.method(wreck, "post", async () => {});

      assert.rejects(
        grantService.invokePostAction({
          code: "1",
          name: "test",
          payload: {
            code: "1",
          },
        }),
        {
          message: "Invalid request payload input",
        },
      );

      assert.notCalled(wreck.post);
    });
  });
});
