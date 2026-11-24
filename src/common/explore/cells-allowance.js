import {
  CELLS_ALLOWANCE,
  CELLS_HELD_BYTES,
  DRAWN_CELL_LENGTH,
} from "./query-schema.js";

// What an answer's cells cost: the text a page draws of them, each cell up
// to DRAWN_CELL_LENGTH code points, and the JSON held whole, sort values
// with it. A page is held to both; a download, whose cells are written to a
// file and never drawn, to what it holds alone.

const PAGE = Object.freeze({ drawn: CELLS_ALLOWANCE, held: CELLS_HELD_BYTES });

export const NO_COST = Object.freeze({ drawn: 0, held: 0 });

// A Query's own `cellBytes` holds a download's cells; else a page's.
export const cellsAllowanceOf = (cellBytes) =>
  cellBytes === undefined ? PAGE : { drawn: Infinity, held: cellBytes };

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value ?? null));

const MAX_ONE_BYTE = 0x7f;
const MAX_TWO_BYTES = 0x7ff;
const MAX_THREE_BYTES = 0xffff;

const utf8Bytes = (point) =>
  1 +
  [MAX_ONE_BYTE, MAX_TWO_BYTES, MAX_THREE_BYTES].filter((most) => point > most)
    .length;

// Text drawn so far, stopped where a cell is drawn no further.
const isFull = (drawn) => drawn.points === DRAWN_CELL_LENGTH;

const draw = (drawn, text) => {
  for (const character of text) {
    if (isFull(drawn)) {
      return;
    }

    drawn.points += 1;
    drawn.bytes += utf8Bytes(character.codePointAt(0));
  }
};

const isList = Array.isArray;

const textOf = (cell) => (typeof cell === "object" ? cell.text : String(cell));

// A list's items drawn in turn, ", " between them, a list inside a list
// in brackets.
const drawItems = (drawn, items, depth) => {
  items.forEach((item, n) => {
    draw(drawn, n === 0 ? "" : ", ");
    drawCell(drawn, item, depth + 1);
  });
};

const drawList = (drawn, items, depth) => {
  draw(drawn, depth > 0 ? "[" : "");
  drawItems(drawn, items, depth);
  draw(drawn, depth > 0 ? "]" : "");
};

const isBlank = (cell) => cell === null || cell === undefined;

const drawCell = (drawn, cell, depth) => {
  if (isFull(drawn) || isBlank(cell)) {
    return;
  }

  if (isList(cell)) {
    drawList(drawn, cell, depth);

    return;
  }

  draw(drawn, textOf(cell));
};

// The UTF-8 bytes of a cell's text, near as GPA draws it: its number
// grouping, date text, `null` and `[]` aside.
export const drawnBytesOf = (cell) => {
  const drawn = { points: 0, bytes: 0 };

  drawCell(drawn, cell, 0);

  return drawn.bytes;
};

const drawnOfCells = (cells) =>
  Object.values(cells).reduce((sum, cell) => sum + drawnBytesOf(cell), 0);

// A row's cost: its cells drawn, and its cells and sort value held.
export const rowCostOf = (row) => ({
  drawn: drawnOfCells(row.cells),
  held: jsonBytes(row.cells) + jsonBytes(row.order),
});

// A group's values travel whole, held: what it draws is its row's.
export const groupCostOf = (group) => ({
  drawn: 0,
  held: jsonBytes(group.value) + jsonBytes(group.aggs),
});

export const plus = (a, b) => ({
  drawn: a.drawn + b.drawn,
  held: a.held + b.held,
});

export const less = (allowance, cost) => ({
  drawn: allowance.drawn - cost.drawn,
  held: allowance.held - cost.held,
});

export const costOfAll = (items, costOf) =>
  items.reduce((sum, item) => plus(sum, costOf(item)), NO_COST);

export const isWithin = (cost, allowance) =>
  cost.drawn <= allowance.drawn && cost.held <= allowance.held;

export const isSpent = (allowance) =>
  allowance.drawn <= 0 || allowance.held <= 0;

// Rows offered in turn, each taken while the rows taken so far fit in
// `allowance`: the first is always taken.
export const fitter = (allowance) => {
  let spent = NO_COST;
  let taken = 0;

  return (row) => {
    const next = plus(spent, rowCostOf(row));

    if (taken > 0 && !isWithin(next, allowance)) {
      return false;
    }

    spent = next;
    taken += 1;

    return true;
  };
};

// How many of `rows`, in order, fit in `allowance`.
export const fittingCount = (rows, allowance) => {
  const fits = fitter(allowance);
  const unfit = rows.findIndex((row) => !fits(row));

  return unfit === -1 ? rows.length : unfit;
};
