import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../common/config.js";
import { db } from "../common/mongo-client.js";
import { Inbox } from "./models/inbox.js";
import { Outbox } from "./models/outbox.js";
import {
  claimEvents as claimInbox,
  updateDeadEvents as deadInbox,
  processExpiredEvents as expiredInbox,
  updateFailedEvents as failedInbox,
  redriveById as redriveInbox,
  updateResubmittedEvents as resubmittedInbox,
} from "./repositories/inbox.repository.js";
import {
  claimEvents as claimOutbox,
  updateDeadEvents as deadOutbox,
  updateExpiredEvents as expiredOutbox,
  updateFailedEvents as failedOutbox,
  redriveById as redriveOutbox,
  updateResubmittedEvents as resubmittedOutbox,
} from "./repositories/outbox.repository.js";
import {
  DEAD_LETTER,
  REDRIVABLE_DESCRIPTION,
  REDRIVABLE_STATUSES,
  redriveConflict,
} from "./event-redrive.js";

vi.mock("../common/mongo-client.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const SEGREGATION_REF = "GLD-9B2";

// A minimal Mongo, so the repositories' real poller updates run against the row.
const OPERATORS = {
  $eq: (value, operand) => value === operand,
  $ne: (value, operand) => value !== operand,
  $lt: (value, operand) => value < operand,
  $lte: (value, operand) => value <= operand,
  $gte: (value, operand) => value >= operand,
  $nin: (value, operand) => !operand.includes(value),
  $in: (value, operand) => operand.includes(value),
};

const isOperatorObject = (condition) =>
  condition !== null &&
  typeof condition === "object" &&
  Object.keys(condition).length > 0 &&
  Object.keys(condition).every((key) => key in OPERATORS);

const matchesCondition = (value, condition) =>
  isOperatorObject(condition)
    ? Object.entries(condition).every(([operator, operand]) =>
        OPERATORS[operator](value, operand),
      )
    : value === condition;

// `_id` is an ObjectId and identity-compares; the filter already selected by id.
const matchesFilter = (doc, filter) => {
  const { _id, ...rest } = filter;

  return Object.entries(rest).every(([key, condition]) =>
    matchesCondition(doc[key], condition),
  );
};

const applyInc = (doc, increments) => {
  const result = { ...doc };

  for (const [key, delta] of Object.entries(increments ?? {})) {
    result[key] = (result[key] ?? 0) + delta;
  }

  return result;
};

const applyUpdate = (doc, update) =>
  applyInc({ ...doc, ...(update.$set ?? {}) }, update.$inc);

const capture = async (method, run, answer = null) => {
  const spy = vi.fn().mockResolvedValue(answer);
  db.collection.mockReturnValue({ [method]: spy });

  await run();

  return spy.mock.calls.at(-1);
};

const INBOX_PROPS = {
  source: "GAS",
  event: { time: "2026-06-16T10:00:00.000Z" },
  segregationRef: SEGREGATION_REF,
};

const OUTBOX_PROPS = {
  target: "arn:aws:sns:eu-west-2:000000000000:topic.fifo",
  event: { time: "2026-06-16T10:00:00.000Z" },
  segregationRef: SEGREGATION_REF,
};

const failWithModel = (Model, doc, props) => {
  const model = Model.fromDocument({
    ...props,
    ...doc,
    attemptHistory: doc.attemptHistory ?? [],
  });

  model.markAsFailed(new Error("boom"));

  const next = model.toDocument();

  return {
    ...doc,
    status: next.status,
    completionAttempts: next.completionAttempts,
    attemptHistory: next.attemptHistory,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
  };
};

const pastAttempts = (count, message = "before the redrive") =>
  Array.from({ length: count }, (_, n) => ({
    at: `2026-06-16T10:0${n}:00.000Z`,
    name: "Error",
    message,
    stack: null,
  }));

const BOXES = [
  {
    name: "inbox",
    maxRetries: config.inbox.inboxMaxRetries,
    redrive: () => redriveInbox(ID),
    claim: () => claimInbox("claim-token", SEGREGATION_REF, 1),
    resubmitted: resubmittedInbox,
    failed: failedInbox,
    dead: deadInbox,
    expired: expiredInbox,
    fail: (doc) => failWithModel(Inbox, doc, INBOX_PROPS),
  },
  {
    name: "outbox",
    maxRetries: config.outbox.outboxMaxRetries,
    redrive: () => redriveOutbox(ID),
    claim: () => claimOutbox("claim-token", SEGREGATION_REF),
    resubmitted: resubmittedOutbox,
    failed: failedOutbox,
    dead: deadOutbox,
    expired: expiredOutbox,
    fail: (doc) => failWithModel(Outbox, doc, OUTBOX_PROPS),
  },
];

describe.each(BOXES)("redrive invariants ($name)", (box) => {
  const aDeadLetter = () => ({
    status: "DEAD_LETTER",
    completionAttempts: box.maxRetries,
    claimedBy: null,
    claimedAt: null,
    claimExpiresAt: null,
    segregationRef: SEGREGATION_REF,
  });

  let redriveFilter;
  let redriveDoc;
  let claimFilter;
  let resubmittedFilter;
  let resubmittedUpdate;
  let deadFilter;
  let expiredFilter;
  let failedFilter;
  let failedUpdate;

  beforeEach(async () => {
    [redriveFilter, redriveDoc] = await capture("updateOne", box.redrive, {
      matchedCount: 0,
    });
    [claimFilter] = await capture("findOneAndUpdate", box.claim);
    [resubmittedFilter, resubmittedUpdate] = await capture(
      "updateMany",
      box.resubmitted,
    );
    [deadFilter] = await capture("updateMany", box.dead);
    [expiredFilter] = await capture("updateMany", box.expired);
    [failedFilter, failedUpdate] = await capture("updateMany", box.failed);
  });

  it("only matches a redrivable row, so a concurrent change loses cleanly", () => {
    expect(redriveFilter.status).toEqual({ $in: REDRIVABLE_STATUSES });
    expect(matchesFilter(aDeadLetter(), redriveFilter)).toBe(true);
    expect(
      matchesFilter({ ...aDeadLetter(), status: "PROCESSING" }, redriveFilter),
    ).toBe(false);
  });

  // The promise the purge confirm makes: "You can redrive it until then."
  it("matches a purged row too, so a purge can be undone until it is deleted", () => {
    expect(
      matchesFilter({ ...aDeadLetter(), status: "PURGED" }, redriveFilter),
    ).toBe(true);
  });

  it("keeps lastPurge, so a redriven row still says it was purged once", () => {
    const lastPurge = {
      at: "2026-09-21T09:00:00.000Z",
      by: "donatas",
      reasonCode: "BROKEN_PAYLOAD",
      note: null,
    };
    const redriven = applyUpdate(
      { ...aDeadLetter(), status: "PURGED", lastPurge },
      redriveDoc,
    );

    expect(redriven.lastPurge).toEqual(lastPurge);
    expect(redriveDoc.$set).not.toHaveProperty("lastPurge");
  });

  it("moves the payload revision on, so an editor opened before it is stale", () => {
    expect(applyUpdate(aDeadLetter(), redriveDoc).payloadRevision).toBe(1);
    expect(
      applyUpdate({ ...aDeadLetter(), payloadRevision: 2 }, redriveDoc)
        .payloadRevision,
    ).toBe(3);
  });

  it("leaves the row RESUBMITTED with its attempts reset to 0", () => {
    const redriven = applyUpdate(aDeadLetter(), redriveDoc);

    expect(redriven.status).toBe("RESUBMITTED");
    expect(redriven.completionAttempts).toBe(0);
  });

  it("clears the attempt history along with the count", () => {
    const redriven = applyUpdate(
      { ...aDeadLetter(), attemptHistory: pastAttempts(box.maxRetries) },
      redriveDoc,
    );

    expect(redriven.completionAttempts).toBe(0);
    expect(redriven.attemptHistory).toEqual([]);
  });

  // Storage keeps a null actor; only the display layer names it `System`.
  it("records no actor where none was given, and never a display name", () => {
    expect(redriveDoc.$set.lastRedrive.by).toBeNull();
    expect(JSON.stringify(redriveDoc)).not.toContain("System");
  });

  // A deadline left behind would let the TTL index delete a row mid-retry.
  it("clears any deletion deadline", () => {
    const redriven = applyUpdate(
      { ...aDeadLetter(), expireAt: new Date("2026-09-14T10:00:00.000Z") },
      redriveDoc,
    );

    expect(redriveDoc.$set.expireAt).toBeNull();
    expect(redriven.expireAt).toBeNull();
  });

  // A purged row sits at the cap with a stale claim - the exact shape both
  // sweeps match on, so only the status exclusion keeps it PURGED.
  it("leaves a PURGED row alone in both sweeps, whatever its attempts", () => {
    const purged = {
      ...aDeadLetter(),
      status: "PURGED",
      claimExpiresAt: new Date("2026-06-16T10:00:00.000Z"),
      expireAt: new Date("2026-12-16T10:00:00.000Z"),
    };

    expect(matchesFilter(purged, deadFilter)).toBe(false);
    expect(matchesFilter(purged, expiredFilter)).toBe(false);
  });

  it("would re-kill that PURGED row if only its status did not say so", () => {
    const { status: _dropped, ...withoutStatus } = deadFilter;

    expect(
      matchesFilter({ ...aDeadLetter(), status: "PURGED" }, withoutStatus),
    ).toBe(true);
  });

  it("releases any claim", () => {
    const redriven = applyUpdate(aDeadLetter(), redriveDoc);

    expect(redriven.claimedBy).toBeNull();
    expect(redriven.claimedAt).toBeNull();
    expect(redriven.claimExpiresAt).toBeNull();
  });

  it("keeps lastError and lastResubmissionDate - the record of why it died", () => {
    const lastError = { name: "TypeError", message: "boom", at: null };
    const redriven = applyUpdate(
      {
        ...aDeadLetter(),
        lastError,
        lastResubmissionDate: "2026-06-16T10:00:00.000Z",
      },
      redriveDoc,
    );

    expect(redriven.lastError).toEqual(lastError);
    expect(redriven.lastResubmissionDate).toBe("2026-06-16T10:00:00.000Z");
  });

  // Sweeps run in the subscriber's order: resubmitted, failed, dead.
  it("survives the next poll tick and is claimable", () => {
    const redriven = applyUpdate(aDeadLetter(), redriveDoc);

    expect(matchesFilter(redriven, resubmittedFilter)).toBe(true);

    const published = applyUpdate(redriven, resubmittedUpdate);

    expect(published.status).toBe("PUBLISHED");
    expect(published.completionAttempts).toBe(0);
    expect(matchesFilter(published, deadFilter)).toBe(false);
    expect(matchesFilter(published, claimFilter)).toBe(true);
  });

  it("would be unclaimable if the redrive left completionAttempts alone", () => {
    const withoutReset = {
      $set: { ...redriveDoc.$set, completionAttempts: box.maxRetries },
    };
    const published = applyUpdate(
      applyUpdate(aDeadLetter(), withoutReset),
      resubmittedUpdate,
    );

    expect(published.completionAttempts).toBe(box.maxRetries);
    expect(matchesFilter(published, deadFilter)).toBe(true);
    expect(matchesFilter(published, claimFilter)).toBe(false);
  });

  // Redrives a dead letter with this history, then fails it on every poll tick until it dies.
  const redriveAndRunUntilDead = (attemptHistory) => {
    let doc = applyUpdate(
      applyUpdate({ ...aDeadLetter(), attemptHistory }, redriveDoc),
      resubmittedUpdate,
    );
    let attempts = 0;

    while (matchesFilter(doc, claimFilter) && attempts < 100) {
      attempts += 1;
      doc = box.fail(doc);
      expect(matchesFilter(doc, failedFilter)).toBe(true);
      doc = applyUpdate(applyUpdate(doc, failedUpdate), resubmittedUpdate);

      if (matchesFilter(doc, deadFilter)) {
        doc = { ...doc, status: "DEAD_LETTER" };
      }
    }

    return { doc, attempts };
  };

  it("gives a redriven row the same number of fresh attempts as a new one, and the counter and the history agree", () => {
    const { doc, attempts } = redriveAndRunUntilDead(
      pastAttempts(box.maxRetries),
    );

    expect(attempts).toBe(box.maxRetries);
    // Guards the "5/5 with four history entries" regression.
    expect(doc.status).toBe("DEAD_LETTER");
    expect(doc.completionAttempts).toBe(box.maxRetries);
    expect(doc.attemptHistory).toHaveLength(box.maxRetries);
    expect(doc.attemptHistory.every((entry) => entry.message === "boom")).toBe(
      true,
    );
  });

  // The admin's futile-redrive warning compares the last two history entries.
  it("leaves a redriven row that died the same way again with two identical post-redrive attempts", () => {
    const { doc } = redriveAndRunUntilDead(
      pastAttempts(box.maxRetries, "an earlier cause"),
    );
    const [previous, last] = doc.attemptHistory.slice(-2);

    expect(doc.status).toBe("DEAD_LETTER");
    expect(previous.message).toBe(last.message);
    expect(JSON.stringify(doc.attemptHistory)).not.toContain(
      "an earlier cause",
    );
  });
});

describe("REDRIVABLE_STATUSES", () => {
  it("is the dead letter and the purged row, in that order", () => {
    expect(REDRIVABLE_STATUSES).toEqual(["DEAD_LETTER", "PURGED"]);
  });

  it("is what the fence matches on, and DEAD_LETTER stays its own constant", () => {
    expect(DEAD_LETTER).toBe("DEAD_LETTER");
    expect(REDRIVABLE_STATUSES).toContain(DEAD_LETTER);
  });

  // The 409 the admin turns into "this event can't be redriven".
  it("is spelled out for a refusal to read", () => {
    expect(REDRIVABLE_DESCRIPTION).toBe("redrivable (DEAD_LETTER or PURGED)");
  });
});

describe("redriveConflict", () => {
  it("is a 409", () => {
    expect(
      redriveConflict("gas inbox", ID, "COMPLETED").output.statusCode,
    ).toBe(409);
  });

  it("puts the current status in the body", () => {
    expect(
      redriveConflict("gas inbox", ID, "COMPLETED").output.payload.status,
    ).toBe("COMPLETED");
  });

  it("puts the words that status is spelled in beside it", () => {
    expect(
      redriveConflict("gas inbox", ID, "DEAD_LETTER", "Dead letter").output
        .payload.statusLabel,
    ).toBe("Dead letter");
  });

  it("names the box, the id and every status it would have taken", () => {
    const { message } = redriveConflict("gas outbox", ID, "PUBLISHED").output
      .payload;

    expect(message).toContain("gas outbox");
    expect(message).toContain(ID);
    expect(message).toContain("PUBLISHED");
    expect(message).toContain(REDRIVABLE_DESCRIPTION);
  });

  // A purged row is redrivable, so a refusal must not tell an operator that
  // only a dead letter can be redriven.
  it("does not claim a dead letter is the only thing a redrive takes", () => {
    const { message } = redriveConflict("gas inbox", ID, "COMPLETED").output
      .payload;

    expect(message).toBe(
      `gas inbox event "${ID}" is COMPLETED, not redrivable (DEAD_LETTER or PURGED)`,
    );
  });
});
