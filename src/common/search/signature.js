import { createHash } from "node:crypto";

// Bumped whenever the keys or the stamp built from the same declaration
// change, such as a change to `normalise`, so every search document is rebuilt.
export const ALGORITHM = 3;

const SIG_LENGTH = 12;

// Labels are left out: they change no key.
export const sig = (fields) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        ALGORITHM,
        fields.map(({ key, path, match }) => [key, path, match]),
      ]),
    )
    .digest("hex")
    .slice(0, SIG_LENGTH);

const ALGORITHM_WIDTH = 4;
const CHANGE_WIDTH = 12;

// Orders the declarations a lead value has had: by algorithm, then by its
// count of config changes, which the database keeps. Compared as text.
export const stampOf = (change) =>
  `${String(ALGORITHM).padStart(ALGORITHM_WIDTH, "0")}:${String(change).padStart(CHANGE_WIDTH, "0")}`;
