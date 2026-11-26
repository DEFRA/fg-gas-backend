// What happened to an inbox/outbox event besides its attempts, oldest first.
// Appended by the write that changes the status, never rewritten by a model
// save: `history` is in no `toDocument()`, so a `$set` of one cannot erase it.
// Every `at` is this service's clock as an ISO string, as `lastRedrive.at` is.

export const HISTORY_KINDS = {
  DEAD_LETTERED: "dead-lettered",
  REDRIVEN: "redriven",
  PURGED: "purged",
  PAYLOAD_EDITED: "payload-edited",
};

// Each before-image is a whole payload, so only the newest edits keep one;
// an older edit stays an entry, with who and why but no diff.
export const MAX_EDIT_BEFORE_IMAGES = 5;

export const deadLetteredEntry = (at = new Date().toISOString()) => ({
  kind: HISTORY_KINDS.DEAD_LETTERED,
  at,
});

const storedHistory = { $ifNull: ["$history", []] };

// For an update pipeline. `$literal`, so nothing in the entry is read as an
// expression.
export const appendHistory = (entry) => ({
  $concatArrays: [storedHistory, [{ $literal: entry }]],
});

const hasEntry = (kind, at) => ({
  $anyElementTrue: [
    {
      $map: {
        input: storedHistory,
        in: {
          $and: [{ $eq: ["$$this.kind", kind] }, { $eq: ["$$this.at", at] }],
        },
      },
    },
  ],
});

const legacyEntry = (kind, at, fields = {}) => ({
  $cond: [
    {
      $and: [
        { $ne: [{ $ifNull: [at, null] }, null] },
        { $not: [hasEntry(kind, at)] },
      ],
    },
    [{ kind, at, ...fields }],
    [],
  ],
});

const orNull = (path) => ({ $ifNull: [path, null] });

// Any string is later than "", so a row never redriven needs any death.
const hasDeathSinceRedrive = {
  $anyElementTrue: [
    {
      $map: {
        input: storedHistory,
        in: {
          $and: [
            { $eq: ["$$this.kind", HISTORY_KINDS.DEAD_LETTERED] },
            { $gt: ["$$this.at", { $ifNull: ["$lastRedrive.at", ""] }] },
          ],
        },
      },
    },
  ],
};

// Only a lone edit's before-image is the original payload, and a revision
// of 1 is an edit with nothing else since.
const legacyBefore = {
  $cond: [{ $eq: ["$payloadRevision", 1] }, "$originalPayload", "$$REMOVE"],
};

// A row from before the history, or from a pod that predates it, keeps only
// its last redrive, purge, edit and death, so a write replacing one stores it
// first. Every caller is fenced to a dead row, whose last failure is its death.
const legacyEntries = {
  $concatArrays: [
    legacyEntry(HISTORY_KINDS.REDRIVEN, "$lastRedrive.at", {
      by: orNull("$lastRedrive.by"),
    }),
    legacyEntry(HISTORY_KINDS.PURGED, "$lastPurge.at", {
      by: orNull("$lastPurge.by"),
      reasonCode: "$lastPurge.reasonCode",
      note: orNull("$lastPurge.note"),
    }),
    legacyEntry(HISTORY_KINDS.PAYLOAD_EDITED, "$lastEdit.at", {
      by: orNull("$lastEdit.by"),
      note: orNull("$lastEdit.note"),
      before: legacyBefore,
    }),
    {
      $cond: [
        hasDeathSinceRedrive,
        [],
        legacyEntry(HISTORY_KINDS.DEAD_LETTERED, "$lastResubmissionDate"),
      ],
    },
  ],
};

// Merged by `at` only when something is derived, so a row written since
// keeps its stored order untouched.
const withLegacyEntries = {
  $let: {
    vars: { legacy: legacyEntries },
    in: {
      $cond: [
        { $eq: [{ $size: "$$legacy" }, 0] },
        storedHistory,
        {
          $sortArray: {
            input: { $concatArrays: [storedHistory, "$$legacy"] },
            sortBy: { at: 1 },
          },
        },
      ],
    },
  },
};

// For an operator's redrive, purge or edit in an update pipeline.
export const appendAction = (entry) => ({
  $concatArrays: [withLegacyEntries, [{ $literal: entry }]],
});

// For a model save, which `$set`s everything else. Nothing to add adds no
// `$push`, so a save that records nothing never creates the field.
export const pushHistory = (entries) =>
  entries.length > 0 ? { $push: { history: { $each: entries } } } : {};

const isEdit = (entry) => ({ $eq: [entry, HISTORY_KINDS.PAYLOAD_EDITED] });

const editCount = (entries) => ({
  $size: { $filter: { input: entries, cond: isEdit("$$this.kind") } },
});

// Kept on an edit while fewer than MAX_EDIT_BEFORE_IMAGES edits follow it.
const withBeforeIfRecent = {
  $cond: [
    {
      $and: [
        isEdit("$$this.kind"),
        {
          $gte: [
            { $subtract: ["$$edits", "$$value.edits"] },
            MAX_EDIT_BEFORE_IMAGES + 1,
          ],
        },
      ],
    },
    { $unsetField: { field: "before", input: "$$this" } },
    "$$this",
  ],
};

const countIfEdit = {
  $add: ["$$value.edits", { $cond: [isEdit("$$this.kind"), 1, 0] }],
};

// The stored history with the edit appended, its before-image the payload as
// it stood until this write, and older edits' before-images dropped.
export const appendEdit = (entry) => ({
  $let: {
    vars: {
      entries: {
        $concatArrays: [
          withLegacyEntries,
          [{ $mergeObjects: [{ $literal: entry }, { before: "$event" }] }],
        ],
      },
    },
    in: {
      $let: {
        vars: { edits: editCount("$$entries") },
        in: {
          $getField: {
            field: "out",
            input: {
              $reduce: {
                input: "$$entries",
                initialValue: { edits: 0, out: [] },
                in: {
                  edits: countIfEdit,
                  out: { $concatArrays: ["$$value.out", [withBeforeIfRecent]] },
                },
              },
            },
          },
        },
      },
    },
  },
});
