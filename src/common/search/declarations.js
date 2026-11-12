import { fieldsOf } from "./declaration.js";
import { sig, stampOf } from "./signature.js";

export const DECLARATIONS_TTL_MS = 30_000;

// `change` is the lead value's count of config changes, which orders it among
// the declarations that value has had.
export const declarationOf = (search, change = 0) => {
  const fields = fieldsOf(search);

  return { fields, sig: sig(fields), stamp: stampOf(change) };
};

export const NO_DECLARATION = declarationOf(null);

// A document built from a later declaration than this one is never replaced
// from it.
export const isBuiltLater = (stored, { stamp }) =>
  Boolean(stored) && (stored.stamp ?? "") > stamp;

const load = async (list) =>
  new Map(
    (await list()).map(({ value, search, change }) => [
      value,
      declarationOf(search, change),
    ]),
  );

// `list` answers each lead value with the `search` of its current definition
// and its count of config changes. A failed load is not kept, so the next
// call tries again; `fresh` loads again whatever the age of the last, unless
// a load is still running, which every caller meanwhile shares.
export const createDeclarationCache = (list, ttlMs = DECLARATIONS_TTL_MS) => {
  let cached = null;

  const isStale = () => cached === null || Date.now() - cached.at >= ttlMs;

  const reload = () => {
    const loading = load(list);
    const entry = { at: Date.now(), loading, running: true };

    cached = entry;
    loading.then(
      () => {
        entry.running = false;
      },
      () => {
        entry.running = false;

        if (cached === entry) {
          cached = null;
        }
      },
    );
  };

  const isReloaded = (options) =>
    isStale() || (Boolean(options?.fresh) && !cached.running);

  const current = (options) => {
    if (isReloaded(options)) {
      reload();
    }

    return cached.loading;
  };

  const forValue = async (value, options) =>
    (await current(options)).get(value) ?? NO_DECLARATION;

  return { current, forValue };
};
