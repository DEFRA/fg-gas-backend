import { COUNT_CAP, readTimeoutMs } from "../buckets/engine.js";
import { rootsOf } from "./describe.js";
import { pathProblem } from "./paths.js";
import { EXACT_READ, WINDOWED_READ, planBox } from "./plan.js";
import { mergeGroups } from "./merge.js";
import { meterFor } from "./meter.js";
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
  isDefaultOrder,
  isUnwinding,
  positionOfBox,
  readBox,
  readEdge,
  readWindow,
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

const groupBox = async ({ read, context }, query, meter) => {
  const groups = grouper({ query, readerOf: context.readers.readerOf });
  const addUnwound = eachUnwound(context.unwound, query, meter, (one) => {
    groups.add(one, context.box);
    checkGroups(groups);
  });

  await eachDoc(
    findDocs(read, context, { limit: GROUP_CAP + 1 }),
    async (doc) => {
      await addUnwound(doc);

      return true;
    },
    meter,
    1,
  );

  return groups.groups();
};

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

const planBoxes = (source, query, meter, lens) =>
  Promise.all(
    source.boxes.map(async (box) => {
      const context = boxContext(source, box, query, lens);
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

const runBig = async (source, query, meter, lens) => {
  const boxes = await planBoxes(source, query, meter, lens);

  return readKindOf(boxes, query) === EXACT_READ
    ? runExact(boxes, query, meter)
    : runWindowed(boxes, query, meter);
};

// What a source may read: its roots, less the deny list.
const checkedLists = (source, query) => {
  const lists = { roots: rootsOf(source) };

  if (refusedPathsOf(query, lists) > 0) {
    throw refuseQuery("PATH_NOT_ALLOWED");
  }

  return lists;
};

// What a read may see below a path it reads, so objects are compared and
// keyed only by that. An unwinding read also charges every list element it
// walks.
const lensOf = (query, meter, lists) => {
  const seen = new Map();
  const readable = (path) => {
    if (!seen.has(path)) {
      seen.set(path, pathProblem(path, lists) === null);
    }

    return seen.get(path);
  };

  return {
    readable,
    charge: isUnwinding(query) ? chargeTo(meter) : undefined,
  };
};

// One service's part of a Query on one of its sources: rows per box, or the
// groups it counted. `source` carries its buckets, resolved; `meter` the
// request's deadline and work budget. A Query that reads any path the source
// may not is refused here, before any read, whoever checked it first.
export const runPart = async (
  source,
  query,
  meter = meterFor(Date.now() + readTimeoutMs()),
) => {
  const lens = lensOf(query, meter, checkedLists(source, query));

  return source.size === "small"
    ? runFull(source, query, meter, lens)
    : runBig(source, query, meter, lens);
};
