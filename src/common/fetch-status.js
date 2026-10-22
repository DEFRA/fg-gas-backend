export const FetchStatus = {
  Pending: "pending",
  Fetched: "fetched",
  TransientError: "transient_error",
  PermanentError: "permanent_error",
};

// Best first: a Config Version reads as its worst Definition File.
export const fetchStatusRank = Object.freeze([
  FetchStatus.Fetched,
  FetchStatus.Pending,
  FetchStatus.TransientError,
  FetchStatus.PermanentError,
]);
