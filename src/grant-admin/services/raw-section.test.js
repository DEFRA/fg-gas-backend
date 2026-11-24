import { BSON } from "mongodb";
import { describe, expect, it } from "vitest";
import { valuesOf } from "../../common/explore/bson-bytes.js";
import { rawSectionOf } from "./raw-section.js";

const MIB = 1024 * 1024;
const LETTERS = [..."abcdefghijklmnopqrstuvwxyz"];

const base64Of = (doc) => BSON.serialize(doc).toString("base64");

const DOCUMENT = base64Of({ ref: "ref-1", n: 1 });

// Null elements in one-letter keys, 27 values an object: near as many
// values as 1 MiB can hold.
const denseOf = (objects) => ({
  l: Array.from({ length: objects }, () =>
    Object.fromEntries(LETTERS.map((letter) => [letter, null])),
  ),
});

const unreadable = (read) => {
  try {
    rawSectionOf(read);
  } catch (error) {
    return error.output.payload.message;
  }

  return null;
};

describe("rawSectionOf", () => {
  it("shows a document within the cap as it came, beside its size", () => {
    expect(rawSectionOf({ document: DOCUMENT, storedBytes: 30 })).toEqual({
      content: { document: DOCUMENT, storedBytes: 30 },
      tooLarge: false,
    });
  });

  it.each([
    ["sent as its size alone", null],
    ["sent whole all the same", DOCUMENT],
  ])("is too large past 1 MiB stored, %s", (_, document) => {
    expect(rawSectionOf({ document, storedBytes: MIB + 1 })).toEqual({
      content: { document: null, storedBytes: MIB + 1 },
      tooLarge: true,
    });
  });

  it("is too large when sent whole past the cap with its own size", () => {
    const big = BSON.serialize({ pad: "x".repeat(MIB) });

    expect(
      rawSectionOf({
        document: big.toString("base64"),
        storedBytes: big.length,
      }),
    ).toEqual({
      content: { document: null, storedBytes: big.length },
      tooLarge: true,
    });
  });

  it.each([
    ["sent as its size alone", null],
    ["sent whole all the same", DOCUMENT],
  ])("is too large past the provider's read limit, %s", (_, document) => {
    expect(rawSectionOf({ document, storedBytes: 30, tooLarge: true })).toEqual(
      {
        content: { document: null, storedBytes: 30 },
        tooLarge: true,
      },
    );
  });

  it("is too large past 250,000 values, though within 1 MiB", () => {
    const dense = BSON.serialize(denseOf(11_772));

    expect(dense.length).toBe(1_048_383);
    expect(valuesOf(dense)).toBe(317_845);
    expect(
      rawSectionOf({
        document: dense.toString("base64"),
        storedBytes: dense.length,
      }),
    ).toEqual({
      content: { document: null, storedBytes: dense.length },
      tooLarge: true,
    });
  });

  it("shows a document of just under 250,000 values", () => {
    const dense = BSON.serialize(denseOf(9_259));

    expect(valuesOf(dense)).toBe(249_994);
    expect(
      rawSectionOf({
        document: dense.toString("base64"),
        storedBytes: dense.length,
      }).tooLarge,
    ).toBe(false);
  });

  it.each([
    ["no document within the cap", { document: null, storedBytes: MIB }],
    ["a document as an object", { document: { ref: 1 }, storedBytes: 30 }],
    ["text that isn't base64", { document: "{ref}", storedBytes: 30 }],
    [
      "bytes that aren't BSON",
      { document: Buffer.from("not bson").toString("base64"), storedBytes: 8 },
    ],
    [
      "BSON cut short",
      {
        document: BSON.serialize({ ref: "ref-1" })
          .subarray(0, 9)
          .toString("base64"),
        storedBytes: 30,
      },
    ],
    [
      "bytes past the cap",
      {
        document: BSON.serialize({ pad: "x".repeat(MIB) }).toString("base64"),
        storedBytes: MIB,
      },
    ],
    ["no size", { document: DOCUMENT, storedBytes: null }],
    ["a size that isn't one", { document: DOCUMENT, storedBytes: "30" }],
  ])("can't read %s", (_, read) => {
    expect(unreadable(read)).toBe("The stored document can't be read");
  });
});
