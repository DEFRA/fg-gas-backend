import { setImmediate } from "node:timers/promises";
import { refuseQuery } from "./refusal.js";

// The value comparisons a request may make in all, about two seconds' work:
// each test costs the paths it reads, times its values, times its length.
export const WORK_BUDGET = 3_000_000;

// The longest the event loop is held before other requests get a turn.
const SLICE_MS = 15;

// The longest one record's work may hold it: a pattern on a long value is
// stopped here, as work the request can't afford.
export const HOLD_MS = 50;

// One request's limits: its deadline, and the work it may do before then.
export const meterFor = (deadline, budget = WORK_BUDGET) => ({
  deadline,
  budget,
  spent: 0,
  sliceStart: Date.now(),
});

export const timeLeftOf = ({ deadline }) => deadline - Date.now();

const checkTime = (meter) => {
  if (timeLeftOf(meter) <= 0) {
    throw refuseQuery("TOO_SLOW");
  }
};

const isOverBudget = (meter) => meter.spent > meter.budget && !meter.free;

// Work done inside one record, as a pattern charges it while it matches:
// past the budget, or holding the event loop too long, it stops there. A
// record read `free` (a window's first) may go past the budget.
export const chargeWork = (meter, units) => {
  meter.spent += units;

  if (isOverBudget(meter) || Date.now() - meter.sliceStart > HOLD_MS) {
    throw refuseQuery("TOO_COSTLY");
  }
};

// Reads `take` with the meter free of its budget, the time held aside.
export const freely = (meter, take) => {
  meter.free = true;

  try {
    return take();
  } finally {
    meter.free = false;
  }
};

// One record's work. Once a slice of time is spent, the deadline is checked
// and the event loop let go, so no read holds the service. A `free` record
// is read whatever the budget has left.
const checkBudget = (meter) => {
  if (meter.spent > meter.budget) {
    throw refuseQuery("TOO_COSTLY");
  }
};

export const step = async (meter, cost, free = false) => {
  meter.spent += cost;

  if (!free) {
    checkBudget(meter);
  }

  if (Date.now() - meter.sliceStart >= SLICE_MS) {
    checkTime(meter);
    await setImmediate();
    meter.sliceStart = Date.now();
  }
};

export const eachStep = async (items, meter, cost, take) => {
  for (const item of items) {
    await step(meter, cost);
    await take(item);
  }

  checkTime(meter);
};
