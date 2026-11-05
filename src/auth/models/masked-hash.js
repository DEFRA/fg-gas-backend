// All a token listing shows of a hash: its first and last three characters.
export const HASH_LENGTH = 64;
export const HASH_EDGE = 3;
const MASK_LENGTH = 6;
export const HASH_MASK = "•".repeat(MASK_LENGTH);
export const MASKED_HASH = new RegExp(
  `^[0-9a-f]{${HASH_EDGE}}${HASH_MASK}[0-9a-f]{${HASH_EDGE}}$`,
);

// What a whole hash looks like inside any string, in either case.
export const HASH_RUN = new RegExp(`[0-9a-f]{${HASH_LENGTH}}`, "i");
