import { compileWhere } from "../../common/explore/evaluate.js";
import { readersFor } from "../../common/explore/fields.js";
import { topLevelOf } from "../../common/explore/index-tests.js";
import { runPart } from "../../common/explore/run.js";
import { EVENT_BOXES, EVENT_SERVICES } from "../../events/event-boxes.js";

// Events are read in both services' boxes: GAS reads its own, Caseworking
// its own, through `run.cwPart`, and their parts are merged by the answer.

const prefixOf = (service) => `${service.toLowerCase()}.`;

const positionsOf = (positions, service) =>
  positions &&
  Object.fromEntries(
    Object.entries(positions).filter(([id]) =>
      id.startsWith(prefixOf(service)),
    ),
  );

const hasEnded = (positions) =>
  positions !== null &&
  Object.keys(positions).length > 0 &&
  Object.values(positions).every((position) => position === null);

const ADDED = new Set(["service", "box"]);

const boxTestsOf = (where) =>
  topLevelOf(where).filter(({ path }) => ADDED.has(path));

// The services whose boxes a query's top-level service and box tests leave,
// with any operator, decided before reading.
export const servicesAsked = (source, where) => {
  const tests = boxTestsOf(where).map((test) =>
    compileWhere(test, readersFor(source).readerOf),
  );

  return EVENT_SERVICES.map(({ value }) => value).filter((service) =>
    EVENT_BOXES.some(({ value: box }) =>
      tests.every((test) => test({}, { service, box })),
    ),
  );
};

const ownPart = (query, run) => runPart(run.own, query, run.meter);

const partOf = (service, run) => (service === "CW" ? run.cwPart : ownPart);

// A service whose boxes have all read to their oldest record is not asked
// again; its boxes stay ended.
const endedPart = (positions) => ({
  read: "windowed",
  groups: null,
  boxes: Object.keys(positions).map((id) => ({
    id,
    rows: [],
    to: null,
    end: true,
    count: null,
  })),
});

const servicePart =
  (query, run) =>
  ([service, positions]) =>
    hasEnded(positions)
      ? endedPart(positions)
      : partOf(service, run)({ ...query, positions }, run);

const isMixed = (parts) => new Set(parts.map(({ read }) => read)).size > 1;

// Where one service reads windowed and another exact, the exact one reads
// windowed too, so Keep looking goes on from one place in every box.
const windowedAgain = (query, run, asked) => (part, n) =>
  part.read === "windowed"
    ? part
    : servicePart({ ...query, window: true }, run)(asked[n]);

const eventParts = async (query, run) => {
  const asked = servicesAsked(run.own, query.where).map((service) => [
    service,
    positionsOf(query.positions, service),
  ]);
  const parts = await Promise.all(asked.map(servicePart(query, run)));

  return isMixed(parts)
    ? Promise.all(parts.map(windowedAgain(query, run, asked)))
    : parts;
};

// Each service's part: GAS reads its own sources, Caseworking its own, and
// both read their boxes for events. `run` carries the source, GAS's own
// definition of it, the meter and Caseworking's part.
export const partsOf = async (query, run) => {
  if (run.source.service === "CW") {
    return [await run.cwPart(query, run)];
  }

  return run.source.name === "events"
    ? eventParts(query, run)
    : [await ownPart(query, run)];
};
