import { describe, expect, it, vi } from "vitest";
import { paginate } from "./paginate.js";

const identity = {
  encode: (v) => v,
  decode: (v) => v,
};

const codecs = {
  name: identity,
  _id: identity,
};

const makeCursor = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");

const makeCollection = (docs) => {
  const chain = {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return {
    find: vi.fn().mockReturnValue(chain),
    countDocuments: vi.fn(),
    chain,
  };
};

describe("paginate", () => {
  const baseOpts = {
    filter: { active: true },
    sort: { name: 1 },
    codecs,
    cursor: undefined,
    pageSize: 2,
    project: { name: 1 },
  };

  describe("first page (no cursor)", () => {
    it("returns data with pagination metadata", async () => {
      const docs = [
        { name: "Alice", _id: "1" },
        { name: "Bob", _id: "2" },
      ];
      const col = makeCollection(docs);

      const result = await paginate(col, baseOpts);

      expect(result.data).toEqual(docs);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.endCursor).toBe(
        makeCursor({ name: "Bob", _id: "2" }),
      );
    });

    it("passes filter, project, sort and limit to collection", async () => {
      const col = makeCollection([]);

      await paginate(col, baseOpts);

      expect(col.find).toHaveBeenCalledWith({ active: true }, {});
      expect(col.chain.project).toHaveBeenCalledWith({ name: 1 });
      expect(col.chain.sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
      expect(col.chain.limit).toHaveBeenCalledWith(3);
    });

    it("never counts documents", async () => {
      const col = makeCollection([{ name: "Alice", _id: "1" }]);

      await paginate(col, baseOpts);

      expect(col.countDocuments).not.toHaveBeenCalled();
    });

    it("appends _id to sort using last sort direction", async () => {
      const col = makeCollection([]);

      await paginate(col, {
        ...baseOpts,
        sort: { createdAt: -1 },
        codecs: { createdAt: identity, _id: identity },
      });

      expect(col.chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    });

    it("does not append _id when sort already includes _id", async () => {
      const col = makeCollection([]);

      await paginate(col, {
        ...baseOpts,
        sort: { name: 1, _id: -1 },
        codecs: { name: identity, _id: identity },
      });

      expect(col.chain.sort).toHaveBeenCalledWith({ name: 1, _id: -1 });
    });
  });

  describe("forward pagination with cursor", () => {
    it("sets hasNextPage when there are more results", async () => {
      const docs = [
        { name: "Charlie", _id: "3" },
        { name: "Dave", _id: "4" },
        { name: "Eve", _id: "5" },
      ];
      const col = makeCollection(docs);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      const result = await paginate(col, {
        ...baseOpts,
        cursor,
      });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasNextPage).toBe(true);
    });

    it("reports no next page when the look-ahead found nothing", async () => {
      const docs = [{ name: "Charlie", _id: "3" }];
      const col = makeCollection(docs);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      const result = await paginate(col, {
        ...baseOpts,
        cursor,
      });

      expect(result.pagination.hasNextPage).toBe(false);
    });

    it("builds paging filter for ascending sort", async () => {
      const col = makeCollection([]);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      await paginate(col, { ...baseOpts, cursor });

      expect(col.find).toHaveBeenCalledWith(
        {
          $and: [
            { active: true },
            { name: { $gte: "Bob" } },
            {
              $or: [
                { name: { $gt: "Bob" } },
                { name: "Bob", _id: { $gt: "2" } },
              ],
            },
          ],
        },
        {},
      );
    });

    it("builds paging filter for descending sort", async () => {
      const col = makeCollection([]);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      await paginate(col, {
        ...baseOpts,
        sort: { name: -1 },
        cursor,
      });

      expect(col.find).toHaveBeenCalledWith(
        {
          $and: [
            { active: true },
            { name: { $lte: "Bob" } },
            {
              $or: [
                { name: { $lt: "Bob" } },
                { name: "Bob", _id: { $lt: "2" } },
              ],
            },
          ],
        },
        {},
      );
    });
  });

  describe("empty results", () => {
    it("returns null cursors and false for page flags", async () => {
      const col = makeCollection([]);

      const result = await paginate(col, baseOpts);

      expect(result.data).toEqual([]);
      expect(result.pagination.endCursor).toBeNull();
      expect(result.pagination.hasNextPage).toBe(false);
    });
  });

  describe("cursor decoding", () => {
    it("throws Boom.badRequest for invalid cursor", async () => {
      const col = makeCollection([]);

      await expect(
        paginate(col, { ...baseOpts, cursor: "not-valid-base64!" }),
      ).rejects.toThrow("Cannot decode cursor");
    });

    it("throws Boom.badRequest when a codec rejects the value", async () => {
      const col = makeCollection([]);
      const cursor = makeCursor({ name: "Bob", _id: "not-an-id" });

      await expect(
        paginate(col, {
          ...baseOpts,
          cursor,
          codecs: {
            name: identity,
            _id: {
              encode: (v) => v,
              decode: () => {
                throw new Error("bad id");
              },
            },
          },
        }),
      ).rejects.toThrow("Cannot decode cursor");
    });
  });

  describe("codecs", () => {
    it("encodes and decodes cursor values using codecs", async () => {
      const dateCodecs = {
        createdAt: {
          encode: (v) => v.toISOString(),
          decode: (v) => new Date(v),
        },
        _id: identity,
      };
      const date = new Date("2025-01-15T10:00:00Z");
      const docs = [{ createdAt: date, _id: "1" }];
      const col = makeCollection(docs);

      const result = await paginate(col, {
        ...baseOpts,
        sort: { createdAt: -1 },
        codecs: dateCodecs,
      });

      expect(result.pagination.endCursor).toBe(
        makeCursor({ createdAt: "2025-01-15T10:00:00.000Z", _id: "1" }),
      );
    });

    it("decodes cursor before building filter", async () => {
      const dateCodecs = {
        createdAt: {
          encode: (v) => v.toISOString(),
          decode: (v) => new Date(v),
        },
        _id: identity,
      };
      const col = makeCollection([]);
      const cursor = makeCursor({
        createdAt: "2025-01-15T10:00:00.000Z",
        _id: "1",
      });

      await paginate(col, {
        ...baseOpts,
        sort: { createdAt: -1 },
        codecs: dateCodecs,
        cursor,
      });

      const [, bound, keyset] = col.find.mock.calls[0][0].$and;
      expect(bound.createdAt.$lte).toEqual(
        new Date("2025-01-15T10:00:00.000Z"),
      );
      expect(keyset.$or[0].createdAt.$lt).toEqual(
        new Date("2025-01-15T10:00:00.000Z"),
      );
    });
  });

  // Both the keyset clause and a search filter are `$or`s; a spread merge dropped one.
  describe("composing a base filter that is itself an $or", () => {
    const searchFilter = {
      $or: [{ eventId: "evt-1" }, { segregationRef: "evt-1" }],
    };

    it("keeps both the search and the keyset clause on a cursor page", async () => {
      const col = makeCollection([]);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      await paginate(col, {
        ...baseOpts,
        filter: searchFilter,
        cursor,
      });

      expect(col.find).toHaveBeenCalledWith(
        {
          $and: [
            searchFilter,
            { name: { $gte: "Bob" } },
            {
              $or: [
                { name: { $gt: "Bob" } },
                { name: "Bob", _id: { $gt: "2" } },
              ],
            },
          ],
        },
        {},
      );
    });

    it("leaves the filter alone on the first page, which has no cursor", async () => {
      const col = makeCollection([]);

      await paginate(col, { ...baseOpts, filter: searchFilter });

      expect(col.find).toHaveBeenCalledWith(searchFilter, {});
    });

    it("passes a caller's time ceiling to the driver", async () => {
      const col = makeCollection([]);

      await paginate(col, { ...baseOpts, maxTimeMS: 5000 });

      expect(col.find).toHaveBeenCalledWith(expect.anything(), {
        maxTimeMS: 5000,
      });
    });

    it("composes an empty base filter without inventing one", async () => {
      const col = makeCollection([]);
      const cursor = makeCursor({ name: "Bob", _id: "2" });

      await paginate(col, {
        ...baseOpts,
        filter: {},
        cursor,
      });

      const [base] = col.find.mock.calls[0][0].$and;

      expect(base).toEqual({});
    });
  });
});
