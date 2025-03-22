import { describe, it } from "node:test";
import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { assert } from "../common/assert.js";
import { db } from "../common/db.js";
import { grantRepository } from "./grant-repository.js";

describe("grantRepository", () => {
  describe("add", () => {
    it("stores a Grant in the repository", async ({ mock }) => {
      const insertOne = mock.fn(async () => ({
        insertedId: "1",
      }));

      mock.method(db, "collection", () => ({
        insertOne,
      }));

      await grantRepository.add({
        code: "1",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: [],
      });

      assert.calledOnceWith(db.collection, "grants");
      assert.calledOnceWith(insertOne, {
        code: "1",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: [],
      });
    });

    it("throws Boom.conflict when a grant with same code already exists", async ({
      mock,
    }) => {
      const insertOne = mock.fn(async () => {
        const error = new MongoServerError(
          "E11000 duplicate key error collection",
        );
        error.code = 11000;
        throw error;
      });

      mock.method(db, "collection", () => ({
        insertOne,
      }));

      await assert.rejects(
        grantRepository.add({
          code: "1",
          metadata: {
            description: "test",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        }),
        Boom.conflict('Grant with code "1" already exists'),
      );
    });

    it("throws Boom.internal when an error occurs", async ({ mock }) => {
      const insertOne = mock.fn(async () => {
        throw new Error("test");
      });

      mock.method(db, "collection", () => ({
        insertOne,
      }));

      await assert.rejects(
        grantRepository.add({
          code: "1",
          metadata: {
            description: "test",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        }),
        Boom.internal(new Error("test")),
      );
    });
  });

  describe("findAll", () => {
    it("returns all Grants from the repository", async ({ mock }) => {
      const toArray = mock.fn(async () => [
        {
          code: "1",
          metadata: {
            description: "test 1",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        },
        {
          code: "2",
          metadata: {
            description: "test 2",
            startDate: "2021-01-02T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        },
      ]);

      mock.method(db, "collection", () => ({
        find: () => ({
          toArray,
        }),
      }));

      const result = await grantRepository.findAll();

      assert.calledOnceWith(db.collection, "grants");
      assert.calledOnce(toArray);
      assert.deepEqual(result, [
        {
          code: "1",
          metadata: {
            description: "test 1",
            startDate: "2021-01-01T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        },
        {
          code: "2",
          metadata: {
            description: "test 2",
            startDate: "2021-01-02T00:00:00.000Z",
          },
          actions: [
            {
              method: "GET",
              name: "test",
              url: "http://localhost",
            },
          ],
          questions: [],
        },
      ]);
    });
  });

  describe("findByCode", () => {
    it("returns a Grant from the repository", async ({ mock }) => {
      const findOne = mock.fn(async () => ({
        code: "adding-value",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: [],
      }));

      mock.method(db, "collection", () => ({
        findOne,
      }));

      const result = await grantRepository.findByCode("adding-value");

      assert.calledOnceWith(db.collection, "grants");
      assert.calledOnceWith(findOne, {
        code: "adding-value",
      });
      assert.deepEqual(result, {
        code: "adding-value",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test",
            url: "http://localhost",
          },
        ],
        questions: [],
      });
    });
  });
});
