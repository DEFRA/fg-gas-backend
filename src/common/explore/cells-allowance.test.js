import { describe, expect, it } from "vitest";
import {
  cellsAllowanceOf,
  drawnBytesOf,
  fitter,
  fittingCount,
  rowCostOf,
} from "./cells-allowance.js";

const MIB = 1024 * 1024;

describe("drawnBytesOf", () => {
  it.each([
    ["text", "abc", 3],
    ["a number", 1234.5, 6],
    ["an object, as its text", { text: "{ a: 1 }" }, 8],
    ["a list, its items apart", ["a", "b", ["c", "d"]], 12],
    ["nothing", null, 0],
  ])("counts %s by its text, near as GPA draws it", (_, cell, bytes) => {
    expect(drawnBytesOf(cell)).toBe(bytes);
  });

  it("draws no more than 1,000 code points of a value, in its UTF-8 bytes", () => {
    expect(drawnBytesOf("x".repeat(4 * MIB))).toBe(1000);
    expect(drawnBytesOf("é".repeat(2000))).toBe(2000);
    expect(drawnBytesOf("😀".repeat(1500))).toBe(4000);
    expect(drawnBytesOf(["x".repeat(600), "y".repeat(600)])).toBe(1000);
  });
});

describe("fittingCount", () => {
  const row = (text) => ({ cells: { c0: text }, order: null });

  it("holds a page to what it draws, a long value counted by its start", () => {
    const long = Array.from({ length: 3000 }, () => row("x".repeat(1200)));

    expect(fittingCount(long, cellsAllowanceOf(undefined))).toBe(
      Math.floor((2 * MIB) / 1000),
    );
    expect(rowCostOf(long[0])).toEqual({
      drawn: 1000,
      held: Buffer.byteLength(JSON.stringify({ c0: "x".repeat(1200) })) + 4,
    });
  });

  it("holds a page to what it holds whole, beside what it draws", () => {
    const huge = Array.from({ length: 10 }, () => row("x".repeat(MIB)));

    expect(fittingCount(huge, cellsAllowanceOf(undefined))).toBe(7);
  });

  it("holds a download to its own bytes whole, never to what is drawn", () => {
    const long = Array.from({ length: 3000 }, () => row("x".repeat(5000)));

    expect(fittingCount(long, cellsAllowanceOf(256 * MIB))).toBe(3000);
    expect(fittingCount(long, cellsAllowanceOf(10))).toBe(1);
  });
});

describe("fitter", () => {
  const row = (text) => ({ cells: { c0: text }, order: null });
  const held = rowCostOf(row("x".repeat(10))).held;

  it("takes the first row however large, then each while the rows taken fit", () => {
    const fits = fitter(cellsAllowanceOf(2 * held));

    expect(fits(row("x".repeat(5000)))).toBe(true);
    expect(fits(row("x".repeat(10)))).toBe(false);
  });

  it("takes rows until they no longer fit together", () => {
    const fits = fitter(cellsAllowanceOf(2 * held));

    expect(
      [row("x".repeat(10)), row("x".repeat(10)), row("x".repeat(10))].map(fits),
    ).toEqual([true, true, false]);
  });
});
