const MARKS = /\p{M}/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;

// Letters NFKD leaves whole, as they are written without their mark.
const FOLDS = { ß: "ss", æ: "ae", ø: "o", ł: "l", đ: "d", þ: "th", œ: "oe" };
const FOLDED = new RegExp(`[${Object.keys(FOLDS).join("")}]`, "gu");

// Stored and searched values both pass through this, so they compare equal
// however they are cased, accented, spaced or punctuated.
export const normalise = (value) =>
  String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(MARKS, "")
    .replace(FOLDED, (letter) => FOLDS[letter])
    .replace(NOT_LETTER_OR_DIGIT, "");
