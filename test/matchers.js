import { expect, vi } from "vitest";
import { receiveMessages } from "./helpers/sqs.js";

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

  async toHaveReceived(queueUrl, expectedMessage) {
    const messages = await vi.waitUntil(
      async () => {
        const msgs = await receiveMessages(queueUrl);
        return msgs.length > 0 ? msgs : null;
      },
      { timeout: 5000, interval: 100 },
    );

    const pass = messages.some((msg) => this.equals(msg, expectedMessage));

    if (pass) {
      return {
        pass: true,
        actual: messages,
        expected: [expectedMessage],
        message: () =>
          `Expected queue ${queueUrl} not to have received message`,
      };
    }

    return {
      pass: false,
      actual: messages,
      expected: [expectedMessage],
      message: () => `Expected queue ${queueUrl} to have received message`,
    };
  },
});
