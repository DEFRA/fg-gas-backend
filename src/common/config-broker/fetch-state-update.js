import { FetchStatus } from "../fetch-status.js";

// One definition of what a fetch outcome records, shared by the Grant and
// Agreement paths so they cannot drift on it. Returns the update fragments
// rather than applying them, so a caller writing more than one path still does
// so in a single updateOne.
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
  // Cleared on success so the counter measures consecutive failures rather than
  // every failure the version has ever had. Without this, old failures combine
  // with a much later blip to condemn a version that has been fetching fine.
  set[`${path}.fetchAttempts`] = 0;

  return { set };
};
