import { COUNT_CAP, readTimeoutMs } from "../buckets/engine.js";
import { EXACT_READ, WINDOWED_READ, planBox } from "./plan.js";
import { compareRows, mergeGroups } from "./merge.js";
import { eachStep, meterFor } from "./meter.js";
import { refusedPathsOf } from "./query-rules.js";
import { refuseQuery } from "./refusal.js";
import { grouper } from "./rows.js";
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
    eachUnwound(context.unwound, query, meter, (one) =>
      found.take(one, context.box),
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

// One service's part of a Query on one of its sources: rows per box, or the
// groups it counted. `source` carries its buckets, resolved; `meter` the
// request's deadline and work budget. A Query that reads a malformed path is
// refused here, before any read, whoever checked it first. An unwinding
// read charges every list element it walks.
export const runPart = async (
  source,
  query,
  meter = meterFor(Date.now() + readTimeoutMs()),
) => {
  if (refusedPathsOf(query) > 0) {
    throw refuseQuery("PATH_NOT_ALLOWED");
  }

  const charge = chargeOf(query, meter);

  return source.size === "small"
    ? runFull(source, query, meter, charge)
    : runBig(source, query, meter, charge);
};
