import Boom from "@hapi/boom";
import { MongoServerError } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../common/mongo-client.js";
import { GrantDocument } from "../models/grant-document.js";
import { Grant } from "../models/grant.js";
import { findAll, findByCode, replace, save } from "./grant.repository.js";

vi.mock("../../common/mongo-client.js");

describe("save", () => {
  it("stores a Grant in the repository", async () => {
    const insertOne = vi.fn().mockResolvedValueOnce({
      insertedId: "1",
    });

    db.collection.mockReturnValue({
      insertOne,
    });

    await save(
      new Grant({
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
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(insertOne).toHaveBeenCalledWith(
      new GrantDocument({
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
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
  });

  it("throws Boom.conflict when a grant with same code already exists", async () => {
    const error = new MongoServerError("E11000 duplicate key error collection");
    error.code = 11000;

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Grant({
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
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        }),
      ),
    ).rejects.toThrow(Boom.conflict('Grant with code "1" already exists'));
  });

  it("throws when an error occurs", async () => {
    const error = new Error("test");

    db.collection.mockReturnValue({
      insertOne: vi.fn().mockRejectedValueOnce(error),
    });

    await expect(
      save(
        new Grant({
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
          questions: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
          },
        }),
      ),
    ).rejects.toThrow(error);
  });
});

describe("replace", () => {
  it("replaces a Grant in the repository", async () => {
    const replaceOne = vi.fn().mockResolvedValueOnce({
      insertedId: "code-1",
    });

    db.collection.mockReturnValue({
      replaceOne,
    });

    await replace(
      new Grant({
        code: "code-1",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test-action",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(replaceOne).toHaveBeenCalledWith(
      { code: "code-1" },
      new GrantDocument({
        code: "code-1",
        metadata: {
          description: "test",
          startDate: "2021-01-01T00:00:00.000Z",
        },
        actions: [
          {
            method: "GET",
            name: "test-action",
            url: "http://localhost",
          },
        ],
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
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
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
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
            questions: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "object",
            },
          },
        ]),
      }),
    });

    const result = await findAll();

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(result).toStrictEqual([
      new Grant({
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
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
      new Grant({
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
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
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
      questions: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
    });

    db.collection.mockReturnValue({
      findOne,
    });

    const result = await findByCode("adding-value");

    expect(db.collection).toHaveBeenCalledWith("grants");

    expect(findOne).toHaveBeenCalledWith({
      code: "adding-value",
    });

    expect(result).toStrictEqual(
      new Grant({
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
        questions: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
        },
      }),
    );
  });
});
