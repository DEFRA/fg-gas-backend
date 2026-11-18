import { refuseQuery } from "./refusal.js";

// Explore queries an instance runs at once, of all its operators.
export const MAX_RUNNING = 2;

const operators = new Set();
const pools = new Map();

const enter = (pool) => {
  const count = pools.get(pool) ?? 0;

  if (count >= MAX_RUNNING) {
    throw Object.assign(refuseQuery("FULL"), { service: pool });
  }

  pools.set(pool, count + 1);
};

// At most MAX_RUNNING queries at once in each pool, released however each
// ends: GAS counts its own reads and Caseworking's apart, so a full one
// never refuses the other's.
export const withRoom = async (pool, run) => {
  enter(pool);

  try {
    return await run();
  } finally {
    pools.set(pool, pools.get(pool) - 1);
  }
};

// One query at a time per operator, however it ends.
export const oneOperatorAtATime = async (actorId, run) => {
  if (operators.has(actorId)) {
    throw refuseQuery("BUSY");
  }

  operators.add(actorId);

  try {
    return await run();
  } finally {
    operators.delete(actorId);
  }
};

// One query at a time per operator, and only a few per instance.
export const oneAtATime = (actorId, run) =>
  oneOperatorAtATime(actorId, () => withRoom("here", run));
