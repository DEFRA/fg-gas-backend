import { COUNT_CAP, readTimeoutMs } from "../buckets/engine.js";
import { EXACT_READ, WINDOWED_READ, planBox } from "./plan.js";
import { fetchPart } from "./document-fetch.js";
import {
  cellsAllowanceOf,
  costOfAll,
  fitter,
  groupCostOf,
  isWithin,
  rowCostOf,
} from "./cells-allowance.js";
import { compareRows, cutAt, keptExact, mergeGroups } from "./merge.js";
import { eachStep, meterFor, step } from "./meter.js";
import { DOCUMENTS_MODE } from "./query-schema.js";
import { refusedPathsOf } from "./query-rules.js";
import { refuseQuery } from "./refusal.js";
import { grouper, withCells } from "./rows.js";
import {
  GROUP_CAP,
  boxContext,
  chargeTo,
  checkGroups,
  countBox,
  eachDoc,
  eachUnwound,
  emptyBox,
  engineRead,
  findDocs,
  idDocs,
  isDefaultOrder,
  isUnwinding,
  positionOfBox,
  readBox,
  readEdge,
  readWindow,
  shapeCost,
  shaped,
  unwoundRows,
} from "./run-box.js";
import { runFull } from "./run-full.js";

export { FULL_CAP, GROUP_CAP, SORT_CAP, WINDOW } from "./run-box.js";

// ── Groups ──

// Every box's records, counted and refused over the cap together.
const countForGroups = async (boxes) => {
  const counts = await Promise.all(
    boxes.map(({ read }) => countBox(read, GROUP_CAP)),
  );
  const total = counts.reduce((sum, { n }) => sum + n, 0);

  if (counts.some(({ capped }) => capped) || total > GROUP_CAP) {
    throw refuseQuery("TOO_MANY_TO_COUNT");
  }

  return counts;
};

// One box's groups of the records `each` hands to `add`, unwound as the
// query asks.
const groupDocs = async (context, query, meter, each) => {
  const groups = grouper({ query, readerOf: context.readers.readerOf });

  await each(
    eachUnwound(context.unwound, query, meter, (one) => {
      groups.add(one, context.box);
      checkGroups(groups);
    }),
  );

  return groups.groups();
};

const groupBox = ({ read, context }, query, meter) =>
  groupDocs(context, query, meter, (add) =>
    eachDoc(
      findDocs(read, context, { limit: GROUP_CAP + 1 }),
      async (doc) => {
        await add(doc);

        return true;
      },
      meter,
      1,
    ),
  );

// Counted first, so a group read never streams more than the cap.
const readGroups = async (boxes, query, meter) => {
  const counts = await countForGroups(boxes);
  const lists = await Promise.all(
    boxes.map((box) => groupBox(box, query, meter)),
  );

  return {
    boxes: boxes.map(({ context }, n) => ({
      ...emptyBox(context.box),
      count: counts[n],
    })),
    groups: mergeGroups(lists),
  };
};

// ── Choosing the read ──

// A plan on one ref with facts to test is exact when the ref's records fit
// in a window, as the engine settles it.
const settled = async (planned, meter) => {
  if (!planned.settles) {
    return planned;
  }

  const edge = await readEdge(engineRead(planned, null, meter));

  return edge ? planned : { ...planned, read: EXACT_READ, why: null };
};

const planBoxes = (source, query, meter, charge) =>
  Promise.all(
    source.boxes.map(async (box) => {
      const context = boxContext(source, box, query, charge);
      const planned = planBox(source, box, query, context.readers.readerOf);

      return {
        context,
        planned: planned.none ? planned : await settled(planned, meter),
      };
    }),
  );

// Asked to read windowed, every box is: another service's box read so.
const readKindOf = (boxes, query) =>
  !query.window &&
  boxes.every(({ planned }) => planned.none || planned.read === EXACT_READ)
    ? EXACT_READ
    : WINDOWED_READ;

const whyOf = (boxes) =>
  boxes.map(({ planned }) => planned.why).find(Boolean) ?? {
    why: null,
    path: null,
  };

// Groups, a count, distinct values and unwound rows count every record: an
// exact read only.
const countsEvery = (query) =>
  Boolean(query.groupBy) || query.mode === "count" || isUnwinding(query);

const checkWindowed = (query, boxes) => {
  if (countsEvery(query)) {
    throw refuseQuery("GROUP_NEEDS_EXACT", whyOf(boxes));
  }

  if (!isDefaultOrder(query.orderBy)) {
    throw refuseQuery("ORDER_NEEDS_EXACT", whyOf(boxes));
  }
};

const isEnded = (box, positions) => positionOfBox(box, positions) === null;

const runWindowed = async (boxes, query, meter) => {
  checkWindowed(query, boxes);

  return {
    read: WINDOWED_READ,
    groups: null,
    boxes: await Promise.all(
      boxes.map(({ context, planned }) =>
        planned.none || isEnded(context.box, query.positions)
          ? { ...emptyBox(context.box), count: null }
          : readWindow(context, planned, query, meter),
      ),
    ),
  };
};

const countBoxes = async (boxes, meter) => ({
  read: EXACT_READ,
  groups: null,
  boxes: await Promise.all(
    boxes.map(async ({ context, planned }) => ({
      ...emptyBox(context.box),
      count: planned.none
        ? { n: 0, capped: false }
        : await countBox(engineRead(planned, null, meter), COUNT_CAP),
    })),
  ),
});

const runExact = async (boxes, query, meter) => {
  const reading = boxes.filter(({ planned }) => !planned.none);

  if (query.mode === "count") {
    return countBoxes(boxes, meter);
  }

  if (query.groupBy) {
    return {
      read: EXACT_READ,
      ...(await readGroups(
        reading.map(({ context, planned }) => ({
          context,
          read: engineRead(planned, null, meter),
        })),
        query,
        meter,
      )),
    };
  }

  if (isUnwinding(query)) {
    await countForGroups(
      reading.map(({ planned }) => ({
        read: engineRead(planned, null, meter),
      })),
    );
  }

  return {
    read: EXACT_READ,
    groups: null,
    boxes: await Promise.all(
      boxes.map(({ context, planned }) =>
        planned.none
          ? emptyBox(context.box)
          : readBox(context, planned, query, meter),
      ),
    ),
  };
};

// ── By id ──

// One box's rows of an id read, in the Query's order: newest first by
// default, a record with no time last.
const idRows = async (context, docs, query, meter) => {
  if (!isUnwinding(query)) {
    const rows = await shaped(
      docs,
      context.make,
      context.box,
      meter,
      shapeCost(query),
    );

    return {
      rows: rows.toSorted(compareRows(query.orderBy)).slice(0, query.limit),
      count: { n: docs.length, capped: false },
    };
  }

  const found = unwoundRows(query, context.make, false);

  await eachStep(
    docs,
    meter,
    shapeCost(query),
    eachUnwound(context.unwound, query, meter, (one, at) =>
      found.take(one, context.box, at),
    ),
  );

  return found.answer();
};

const idGroups = (boxes, query, meter) =>
  Promise.all(
    boxes.map(({ context, docs }) =>
      groupDocs(context, query, meter, (add) =>
        eachStep(docs, meter, shapeCost(query), add),
      ),
    ),
  );

const idBox = (context, docs) => ({
  ...emptyBox(context.box),
  count: { n: docs.length, capped: false },
});

// An id read is exact whatever was asked: a window or positions are no read
// of its own, and it counts, groups and unwinds only what it read.
const runIds = async (planned, query, meter) => {
  const boxes = await Promise.all(
    planned.map(async ({ context, planned: plan }) => ({
      context,
      docs: plan.none ? [] : await idDocs(context, plan, meter),
    })),
  );
  const counted = boxes.map(({ context, docs }) => idBox(context, docs));

  if (query.mode === "count") {
    return { read: EXACT_READ, groups: null, boxes: counted };
  }

  if (query.groupBy) {
    return {
      read: EXACT_READ,
      boxes: counted,
      groups: mergeGroups(await idGroups(boxes, query, meter)),
    };
  }

  return {
    read: EXACT_READ,
    groups: null,
    boxes: await Promise.all(
      boxes.map(async ({ context, docs }) => ({
        id: context.box.id,
        to: null,
        end: true,
        ...(await idRows(context, docs, query, meter)),
      })),
    ),
  };
};

const chargeOf = (query, meter) =>
  isUnwinding(query) ? chargeTo(meter) : undefined;

const readsByIds = (boxes) => boxes.every(({ planned }) => planned.ids);

const runBig = async (source, query, meter, charge) => {
  const boxes = await planBoxes(source, query, meter, charge);

  if (readsByIds(boxes)) {
    return runIds(boxes, query, meter);
  }

  return readKindOf(boxes, query) === EXACT_READ
    ? runExact(boxes, query, meter)
    : runWindowed(boxes, query, meter);
};

// ── The cells allowance ──

const tooLarge = () => refuseQuery("CELLS_TOO_LARGE");

const checkCost = (cost, query) => {
  if (!isWithin(cost, cellsAllowanceOf(query.cellBytes))) {
    throw tooLarge();
  }
};

// Their work was charged as the rows were read, so making them only lets
// other requests in as it goes. A row's cells are made once.
const cellsMaker = (meter) => {
  const made = new Map();

  return async (row) => {
    if (!made.has(row)) {
      await step(meter, 0, true);
      made.set(row, withCells(row));
    }

    return made.get(row);
  };
};

const madeRows = async (rows, make) => {
  const made = [];

  for (const row of rows) {
    made.push(await make(row));
  }

  return made;
};

const madeBoxes = async (boxes, make) => {
  const made = [];

  for (const box of boxes) {
    made.push({ ...box, rows: await madeRows(box.rows, make) });
  }

  return made;
};

const finishedGroups = (part, query) => {
  checkCost(costOfAll(part.groups, groupCostOf), query);

  return part;
};

// Rows across the boxes in the Query's order, each with where it stands
// in it, as the answer merges them.
const inMergeOrder = (boxes, orderBy) => {
  const order = compareRows(orderBy);

  return boxes
    .flatMap((box) =>
      box.rows.map((row) => ({
        row,
        at: { key: { ...row.key, box: box.id }, order: row.order },
      })),
    )
    .sort((a, b) => order(a.at, b.at));
};

// How many of `listed`, in turn, fit the allowance. Cells are made in that
// order and no further, so what is made follows the allowance, not the
// rows read.
const fittingOf = async (listed, query, make) => {
  const fits = fitter(cellsAllowanceOf(query.cellBytes));

  for (const [n, { row }] of listed.entries()) {
    if (!fits(await make(row))) {
      return n;
    }
  }

  return listed.length;
};

const finishedWindowed = async (part, query, meter) => {
  const make = cellsMaker(meter);
  const listed = inMergeOrder(part.boxes, query.orderBy);
  const n = await fittingOf(listed, query, make);
  const kept =
    n === listed.length ? part.boxes : cutAt(part.boxes, listed[n - 1].at.key);

  return { ...part, boxes: await madeBoxes(kept, make) };
};

// A Query with cells of its own is a download's.
const isDownload = (query) => query.cellBytes !== undefined;

const keptOf = (boxes, rows) => {
  const kept = new Set(rows);

  return boxes.map((box) => ({
    ...box,
    rows: box.rows.filter((row) => kept.has(row)),
  }));
};

// A download's exact read ends at its last whole row that fits, in the
// answer's order, and says where it stands (`cutAfter`), so the answer
// ends every part's rows there.
const cutExact = async (boxes, query, make) => {
  const listed = inMergeOrder(boxes, query.orderBy);
  const n = await fittingOf(listed, query, make);

  return n === listed.length
    ? { boxes }
    : {
        boxes: keptOf(
          boxes,
          listed.slice(0, n).map(({ row }) => row),
        ),
        cutAfter: listed[n - 1].at,
      };
};

const finishedExact = async (part, query, meter) => {
  const make = cellsMaker(meter);
  const kept = keptExact(part.boxes, query);

  if (isDownload(query)) {
    const cut = await cutExact(kept, query, make);

    return { ...part, ...cut, boxes: await madeBoxes(cut.boxes, make) };
  }

  const boxes = await madeBoxes(kept, make);

  checkCost(
    costOfAll(
      boxes.flatMap(({ rows }) => rows),
      rowCostOf,
    ),
    query,
  );

  return { ...part, boxes };
};

// The cells of the rows a part keeps, made only now, as mongod works out a
// projection only for what it returns, then held to the cells allowance:
// a windowed read ends early within it, an exact one is refused past it,
// or, for a download, ends at its last whole row. Groups travel whole,
// within it too.
const finished = (part, query, meter) => {
  if (part.groups) {
    return finishedGroups(part, query);
  }

  return part.read === WINDOWED_READ
    ? finishedWindowed(part, query, meter)
    : finishedExact(part, query, meter);
};

const readPart = (source, query, meter, charge) =>
  source.size === "small"
    ? runFull(source, query, meter, charge)
    : runBig(source, query, meter, charge);

// One service's part of a Query on one of its sources: rows per box, or the
// groups it counted; or, in the `documents` mode, the documents of the rows
// asked for. `source` carries its buckets, resolved; `meter` the request's
// deadline and work budget. A Query that reads a malformed path is refused
// here, before any read, whoever checked it first. An unwinding read
// charges every list element it walks.
export const runPart = async (
  source,
  query,
  meter = meterFor(Date.now() + readTimeoutMs()),
) => {
  if (refusedPathsOf(query) > 0) {
    throw refuseQuery("PATH_NOT_ALLOWED");
  }

  if (query.mode === DOCUMENTS_MODE) {
    return fetchPart(source, query, meter);
  }

  const charge = chargeOf(query, meter);

  return finished(await readPart(source, query, meter, charge), query, meter);
};
