import { FetchStatus } from "../fetch-status.js";

// A pipeline $set, so callers can combine it with other stages in one update.
export const buildFetchStateUpdate = ({
  path,
  fetchStatus,
  fetchError,
  at,
}) => {
  const set = {
    [`${path}.fetchStatus`]: fetchStatus,
    [`${path}.fetchError`]: { $literal: fetchError },
    [`${path}.lastFetchAttemptAt`]: at,
  };

  if (fetchStatus !== FetchStatus.Fetched) {
    return {
      ...set,
      [`${path}.fetchAttempts`]: {
        $add: [{ $ifNull: [`$${path}.fetchAttempts`, 0] }, 1],
      },
    };
  }

  // Count consecutive failures only.
  return { ...set, [`${path}.fetchedAt`]: at, [`${path}.fetchAttempts`]: 0 };
};
