import { describe, expect, it } from "vitest";
import { oneAtATime } from "./busy.js";
import { refusalOf } from "./refusal.js";

describe("oneAtATime", () => {
  it("refuses an operator's second query while the first runs, and lets another operator's run", async () => {
    let finish;
    const first = oneAtATime(
      "a",
      () => new Promise((resolve) => (finish = resolve)),
    );

    await expect(oneAtATime("a", async () => 1)).rejects.toSatisfy(
      (error) => refusalOf(error) === "BUSY",
    );
    await expect(oneAtATime("b", async () => 2)).resolves.toBe(2);

    finish(3);
    await expect(first).resolves.toBe(3);
    await expect(oneAtATime("a", async () => 4)).resolves.toBe(4);
  });

  it("is released when the query fails", async () => {
    await expect(
      oneAtATime("c", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(oneAtATime("c", async () => 5)).resolves.toBe(5);
  });

  it("refuses a query past the instance's limit, whoever asks, until one ends", async () => {
    const finishes = [];
    const hold = (actor) =>
      oneAtATime(actor, () => new Promise((resolve) => finishes.push(resolve)));
    const held = [hold("d"), hold("e")];

    await expect(oneAtATime("f", async () => 1)).rejects.toSatisfy(
      (error) => refusalOf(error) === "FULL",
    );

    finishes.forEach((finish) => finish());
    await Promise.all(held);
    await expect(oneAtATime("f", async () => 2)).resolves.toBe(2);
  });
});
