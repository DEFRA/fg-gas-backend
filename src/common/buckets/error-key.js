// What failed, as a key Top errors can group by and an index can hold: the
// error's name and its message with everything that varies between two
// failures of the same kind taken out: ids, refs, numbers, values, paths,
// addresses and documents, which are also what names a record or a person.
// Free text the message holds unquoted, with no digit, stays as it is.
//
// The shapes come from the messages this code throws and the libraries it
// calls: interpolated ids, refs and codes, Joi's quoted paths and values,
// MongoDB's duplicate-key documents, HTTP statuses and URLs.
const MAX_KEY_LENGTH = 120;

const VALUE = "<v>";

// A quoted path such as "data.clientRef" or "workflowCode" names a field, not
// a record, and is what tells two validation failures apart. It is kept only
// where Joi puts a label, before what it says of it; a quoted value anywhere
// else, the one after "with value" included, is taken out.
const FIELD_PATH = /^[a-z][A-Za-z]*(?:\.[A-Za-z]+|\[\d{1,3}\])*$/;

const LABELLED = /^ (?:is|must|with|length|does|contains|not)\b/;

const isFieldPath = (text) =>
  FIELD_PATH.test(text) && (text.includes(".") || /[A-Z]/.test(text));

const isLabel = (text, after) => isFieldPath(text) && LABELLED.test(after);

const quoted = (match, text, offset, whole) => {
  const after = whole.slice(offset + match.length);

  return isLabel(text, after) ? `"${text}"` : VALUE;
};

// Innermost first, so a nested document collapses one level at a time.
const INNER_BRACES = /\{[^{}]*\}|\[[^[\]]*\]/g;

const withoutDocuments = (text) => {
  let previous;
  let current = text;

  do {
    previous = current;
    current = current.replace(INNER_BRACES, (match) =>
      /^\[\d{1,3}\]$/.test(match) ? match : VALUE,
    );
  } while (current !== previous);

  return current;
};

// Read without a pattern: one that walks back over a long word is slow.
const isEmail = (word) => {
  const at = word.indexOf("@");

  return at > 0 && word.indexOf(".", at) > at + 1;
};

// A file or route path can hold a person's name or a ref as a segment.
const toWord = (word) => {
  if (isEmail(word)) {
    return "<email>";
  }

  return word.includes("/") ? "<path>" : word;
};

const STEPS = [
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>"],
  [/\?\S+/g, (query) => (query.includes("=") ? "" : query)],
  [/\S+/g, toWord],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>"],
  [/\bv?\d+(?:\.\d+)+(?:-[\w.]+)?\b/g, "<version>"],
  [/"((?:[^"\\]|\\.)*)"/g, quoted],
  // An apostrophe inside a word is not a quote.
  [/(?<!\w)'((?:[^'\\]|\\.)*)'(?!\w)/g, quoted],
  [/`([^`]*)`/g, quoted],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<id>",
  ],
  [/\b[0-9a-f]{12,}\b/gi, "<id>"],
  // A token of letters and digits, hyphens or underscores between: a client
  // ref, an agreement or claim number, an SBI with a prefix, a hash.
  [/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]+\b/g, "<ref>"],
  [/\d{4,}/g, "<n>"],
];

const normalise = (message) =>
  STEPS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    withoutDocuments(String(message)),
  )
    .replace(/\s+/g, " ")
    .trim();

const keyOf = ({ name, message }) => {
  const words = normalise(message ?? "");
  const named = String(name ?? "Error");

  // By code point, so the cut never splits a character in two.
  return Array.from(words ? `${named}: ${words}` : named)
    .slice(0, MAX_KEY_LENGTH)
    .join("")
    .trimEnd();
};

// Null for a row with no recorded error: no filter can ask for a missing
// value, so those rows are one entry of their own.
export const toErrorKey = (lastError) => (lastError ? keyOf(lastError) : null);
