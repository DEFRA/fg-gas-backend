import { describe, expect, it } from "vitest";
import { unwinder } from "./rows.js";

describe("unwinder", () => {
  it("keeps a record once when it unwinds a value the source works out, as $unwind keeps a scalar", () => {
    const doc = { _id: "e1", eventType: "CreateCase" };
    const readerOf = () => ({ read: () => ["GAS"] });
    const unwound = unwinder({
      query: { unwind: [{ path: "service", preserve: false }] },
      readerOf,
    });

    expect([...unwound(doc)]).toEqual([doc]);
  });
});
