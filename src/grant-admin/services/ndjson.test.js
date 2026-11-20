import { describe, expect, it, vi } from "vitest";
import { ndjsonOf } from "./ndjson.js";

const textOf = async (stream) => {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
};

describe("ndjsonOf", () => {
  it("writes one JSON value a line, then says it has finished", async () => {
    const finished = vi.fn();
    const values = async function* () {
      yield { a: 1 };
      yield { b: "x\ny" };
    };

    expect(await textOf(ndjsonOf(values(), finished))).toBe(
      '{"a":1}\n{"b":"x\\ny"}\n',
    );
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("stops reading the values, and says it has finished, when the caller goes", async () => {
    const finished = vi.fn();
    const stopped = vi.fn();
    const values = async function* () {
      try {
        for (let n = 0; ; n += 1) {
          yield { n };
        }
      } finally {
        stopped();
      }
    };
    const stream = ndjsonOf(values(), finished);

    stream.once("data", () => stream.destroy());

    await vi.waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("says it has finished, once, when the caller goes before its first read", async () => {
    const finished = vi.fn();
    const values = async function* () {
      yield { never: true };
    };
    const stream = ndjsonOf(values(), finished);

    stream.destroy();

    await vi.waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
