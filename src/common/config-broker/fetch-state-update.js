import { FetchStatus } from "../fetch-status.js";

// Returns fragments so callers can combine them in one update.
export const buildFetchStateUpdate = ({
  path,
  fetchStatus,
  fetchError,
  at,
}) => {
  const set = {
    [`${path}.fetchStatus`]: fetchStatus,
    [`${path}.fetchError`]: fetchError,
    [`${path}.lastFetchAttemptAt`]: at,
  };

  if (fetchStatus !== FetchStatus.Fetched) {
    return { set, inc: { [`${path}.fetchAttempts`]: 1 } };
  }

  set[`${path}.fetchedAt`] = at;
  // Count consecutive failures only.
  set[`${path}.fetchAttempts`] = 0;

  return { set };
};
