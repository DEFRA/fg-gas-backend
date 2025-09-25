import { expect, vi } from "vitest";

expect.extend({
  /* queries collection until it finds a record matching the query or times out */
  async toHaveRecord(collection, query) {
    const record = await vi.waitUntil(
      () => {
        return collection.findOne(query);
      },
      { timeout: 5000, interval: 100 },
    );

    if (record) {
      return {
        pass: true,
        message: () =>
          `Expected collection not to have record matching ${this.utils.printExpected(
            query,
          )}, but found ${this.utils.printReceived(record)}`,
      };
    }

    return {
      pass: false,
      message: () =>
        `Expected collection to have record matching ${this.utils.printExpected(
          query,
        )}, but none was found`,
    };
  },
});
