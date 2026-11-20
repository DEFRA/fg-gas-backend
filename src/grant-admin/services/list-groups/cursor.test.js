import { beforeEach, describe, expect, it } from "vitest";
import { encodePositions } from "../../../common/explore/merge.js";
import {
  clearListGroups,
  registerListGroup,
} from "../../../common/list-groups/registry.js";
import { eventListGroups } from "../../../events/lists/event-list-groups.js";
import { decodeGroupCursor, encodeGroupCursor } from "./cursor.js";
import { eventViews } from "./test-groups.js";

let gas;
let both;

const T = "2026-10-15T10:00:00.000Z";
const I = "665f1c2e9a1b2c3d4e5f0001";

const text = (value) =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");

const reasonOf = (run) => {
  try {
    run();

    return null;
  } catch (error) {
    return error.output.payload.reason;
  }
};

beforeEach(() => {
  clearListGroups();
  eventListGroups().forEach(registerListGroup);
  gas = eventViews().get("gas.events");
  both = gas.members;
});

describe("group cursor", () => {
  it("round-trips each member's position, Explore's own text nested inside", () => {
    const cursor = {
      positions: { "gas.outbox": { t: T, i: I }, "gas.inbox": null },
      bounded: ["gas.outbox"],
    };
    const encoded = encodeGroupCursor(cursor);
    const outer = JSON.parse(Buffer.from(encoded, "base64url").toString());

    expect(outer).toEqual({
      p: encodePositions(cursor.positions),
      b: ["gas.outbox"],
    });
    expect(decodeGroupCursor(encoded, gas, both)).toEqual(cursor);
  });

  it("stays under the 512 characters both services take, at its longest", () => {
    const longest = encodeGroupCursor({
      positions: {
        "gas.outbox": { t: "2026-10-15T10:00:00.000Z", i: "f".repeat(24) },
        "gas.inbox": { t: "2026-10-15T10:00:00.000Z", i: "f".repeat(24) },
      },
      bounded: ["gas.outbox", "gas.inbox"],
    });

    expect(longest.length).toBeLessThan(512);
  });

  it("leaves out the position of a member the address doesn't read", () => {
    const encoded = encodeGroupCursor({
      positions: { "gas.outbox": { t: T, i: I }, "gas.inbox": null },
      bounded: [],
    });

    expect(decodeGroupCursor(encoded, gas, [both[0]])).toEqual({
      positions: { "gas.outbox": { t: T, i: I } },
      bounded: [],
    });
  });

  it.each([
    ["no text it wrote", "not-a-cursor"],
    ["a list", text([])],
    ["no positions", text({ b: [] })],
    ["positions it can't read", text({ p: "x", b: [] })],
    [
      "an upper-case id",
      encodeGroupCursor({
        positions: {
          "gas.outbox": { t: T, i: I.toUpperCase() },
          "gas.inbox": null,
        },
        bounded: [],
      }),
    ],
    ...["2026-10-15T11:00:00+01:00", "2026-10-15T10:00:00Z"].map((t) => [
      `a time spelt ${t}`,
      encodeGroupCursor({
        positions: { "gas.outbox": { t, i: I }, "gas.inbox": null },
        bounded: [],
      }),
    ]),
    [
      "a bounded box that isn't a member",
      encodeGroupCursor({
        positions: { "gas.outbox": null, "gas.inbox": null },
        bounded: ["cw.outbox"],
      }),
    ],
    [
      "a position of a box that isn't a member",
      encodeGroupCursor({
        positions: { "gas.outbox": null, "gas.inbox": null, "cw.inbox": null },
        bounded: [],
      }),
    ],
    [
      "no position for a member the address reads",
      encodeGroupCursor({ positions: { "gas.outbox": null }, bounded: [] }),
    ],
    [
      "an inherited key",
      text(`{"p":"${encodePositions({})}","b":[],"__proto__":{}}`),
    ],
  ])("refuses %s as INVALID_CURSOR", (_, cursor) => {
    expect(reasonOf(() => decodeGroupCursor(cursor, gas, both))).toBe(
      "INVALID_CURSOR",
    );
  });
});
