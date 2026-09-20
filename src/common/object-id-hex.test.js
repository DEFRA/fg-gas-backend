import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { OBJECT_ID_HEX, isObjectIdHex } from "./object-id-hex.js";

describe("isObjectIdHex", () => {
  it.each(["665f1c2e9a1b2c3d4e5f6a7b", "665F1C2E9A1B2C3D4E5F6A7B"])(
    "accepts %s, which ObjectId parses",
    (value) => {
      expect(isObjectIdHex(value)).toBe(true);
      expect(() => ObjectId.createFromHexString(value)).not.toThrow();
    },
  );

  it.each([
    ["too short", "665f1c2e9a1b2c3d4e5f6a7"],
    ["too long", "665f1c2e9a1b2c3d4e5f6a7bc"],
    ["not hex", "665f1c2e9a1b2c3d4e5f6a7z"],
    ["a 12-character string ObjectId.isValid accepts", "aaaaaaaaaaaa"],
    ["a path", "../../etc/passwd"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])("rejects %s", (_name, value) => {
    expect(isObjectIdHex(value)).toBe(false);
  });

  it("gives the same answer on repeated calls with the shared pattern", () => {
    const id = "665f1c2e9a1b2c3d4e5f6a7b";

    expect([
      isObjectIdHex(id),
      isObjectIdHex(id),
      OBJECT_ID_HEX.test(id),
    ]).toEqual([true, true, true]);
  });
});
