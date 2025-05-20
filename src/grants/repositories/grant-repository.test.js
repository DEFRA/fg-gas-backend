import { describe, it, expect, vi } from "vitest";
import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { db } from "../common/db.js";
import * as grantRepository from "./grant-repository.js";

vi.mock("../common/db.js", () => ({
  db: {
    collection: vi.fn(),
  },
}));

describe("add", () => {
  it("stores a Grant in the repository", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    db.collection.mockReturnValue({
      insertOne,
    });

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

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(insertOne).toHaveBeenCalledWith({
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

  it("throws Boom.conflict when a grant with same code already exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    const promise = grantRepository.add({
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

    await expect(promise).rejects.toThrow(
      Boom.conflict('Grant with code "1" already exists'),
    );
  });

  it("throws Boom.internal when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    const promise = grantRepository.add({
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

    await expect(promise).rejects.toThrow(Boom.internal(error));
  });
});

describe("findAll", () => {
  it("returns all Grants from the repository", async () => {
    db.collection.mockReturnValueOnce({
      find: () => ({
        toArray: vi.fn().mockResolvedValueOnce([
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
        ]),
      }),
    });

    const result = await grantRepository.findAll();

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(result).toEqual([
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
  it("returns a Grant from the repository", async () => {
    const findOne = vi.fn().mockResolvedValueOnce({
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

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await grantRepository.findByCode("adding-value");

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(findOne).toHaveBeenCalledWith({
      code: "adding-value",
    });

    expect(result).toEqual({
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
