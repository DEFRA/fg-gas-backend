export const REFUSALS = [
  "INVALID",
  "BAD_POSITION",
  "TOO_MANY_TO_COUNT",
  "TOO_MANY_TO_SORT",
  "TOO_BIG",
  "GROUP_NEEDS_EXACT",
  "ORDER_NEEDS_EXACT",
  "TOO_SLOW",
  "TOO_COSTLY",
  "BUSY",
  "FULL",
  "PATH_NOT_ALLOWED",
];

// Why a query was not answered, as a code each service turns into its own
// answer. The message names the code only, never anything asked.
// `detail` says why, where the code alone doesn't: { why, path }.
export const refuseQuery = (code, detail = null) =>
  Object.assign(new Error(`Explore query refused: ${code}`), {
    refusal: code,
    detail,
  });

export const refusalOf = (error) =>
  REFUSALS.includes(error?.refusal) ? error.refusal : null;
