import { beforeEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "../grants/models/inbox.js";
import { Outbox } from "../grants/models/outbox.js";
import {
  claimEvents as claimInbox,
  updateDeadEvents as deadInbox,
  updateFailedEvents as failedInbox,
  redriveById as redriveInbox,
  updateResubmittedEvents as resubmittedInbox,
} from "../grants/repositories/inbox.repository.js";
import {
  claimEvents as claimOutbox,
  updateDeadEvents as deadOutbox,
  updateFailedEvents as failedOutbox,
  redriveById as redriveOutbox,
  updateResubmittedEvents as resubmittedOutbox,
} from "../grants/repositories/outbox.repository.js";
import { config } from "./config.js";
import { REDRIVE_FROM_STATUS, redriveConflict } from "./event-redrive.js";
import { db } from "./mongo-client.js";

vi.mock("./mongo-client.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const SEGREGATION_REF = "GLD-9B2";

// ---------------------------------------------------------------------------
// A minimum viable Mongo, so the poller's REAL filters and updates - captured
// from the repositories below rather than restated here - can be run against a
// redriven document. If anyone changes the claim filter or the dead-letter
// sweep, this test fails rather than the redrive silently going nowhere.
// ---------------------------------------------------------------------------
const OPERATORS = {
  $eq: (value, operand) => value === operand,
  $ne: (value, operand) => value !== operand,
  $lt: (value, operand) => value < operand,
  $lte: (value, operand) => value <= operand,
  $gte: (value, operand) => value >= operand,
  $nin: (value, operand) => !operand.includes(value),
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

// `_id` is dropped: it is an ObjectId instance and identity-compares, and the
// document is already the one the filter selected by id.
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

const capture = async (method, run) => {
  const spy = vi.fn().mockResolvedValue(null);
  db.collection.mockReturnValue({ [method]: spy });

  await run();

  return spy.mock.calls.at(-1);
};

// The minimum a model needs to be constructible; everything the arithmetic
// cares about comes off the document under test.
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

// One real processing failure: the handler threw, and the MODEL records it.
// This is the operation that both pushes the attempt-history entry and raises
// the counter, which is the whole point - they cannot drift.
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

const BOXES = [
  {
    name: "inbox",
    maxRetries: config.inbox.inboxMaxRetries,
    redrive: () => redriveInbox(ID),
    claim: () => claimInbox("claim-token", SEGREGATION_REF, 1),
    resubmitted: resubmittedInbox,
    failed: failedInbox,
    dead: deadInbox,
    // The REAL model, so the attempt counter is incremented by the code that
    // actually increments it rather than by a restatement of it here.
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
    fail: (doc) => failWithModel(Outbox, doc, OUTBOX_PROPS),
  },
];

describe.each(BOXES)("redrive invariants ($name)", (box) => {
  // exactly what the dead-letter sweep leaves behind: attempts at the cap
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
  let failedFilter;
  let failedUpdate;

  beforeEach(async () => {
    [redriveFilter, redriveDoc] = await capture(
      "findOneAndUpdate",
      box.redrive,
    );
    [claimFilter] = await capture("findOneAndUpdate", box.claim);
    [resubmittedFilter, resubmittedUpdate] = await capture(
      "updateMany",
      box.resubmitted,
    );
    [deadFilter] = await capture("updateMany", box.dead);
    [failedFilter, failedUpdate] = await capture("updateMany", box.failed);
  });

  it("only matches a DEAD_LETTER row, so a concurrent change loses cleanly", () => {
    expect(redriveFilter.status).toBe(REDRIVE_FROM_STATUS);
    expect(matchesFilter(aDeadLetter(), redriveFilter)).toBe(true);
    expect(
      matchesFilter({ ...aDeadLetter(), status: "PROCESSING" }, redriveFilter),
    ).toBe(false);
  });

  it("leaves the row RESUBMITTED with its attempts reset to 0", () => {
    const redriven = applyUpdate(aDeadLetter(), redriveDoc);

    expect(redriven.status).toBe("RESUBMITTED");
    expect(redriven.completionAttempts).toBe(0);
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

  // THE test: a full poll tick over the redriven row, in the order the
  // subscriber actually runs the sweeps (resubmitted, then failed, then dead).
  it("survives the next poll tick and is claimable", () => {
    const redriven = applyUpdate(aDeadLetter(), redriveDoc);

    expect(matchesFilter(redriven, resubmittedFilter)).toBe(true);

    const published = applyUpdate(redriven, resubmittedUpdate);

    expect(published.status).toBe("PUBLISHED");
    // exactly the value the models give a freshly inserted event: no attempts
    // MADE yet. Nothing increments on this transition any more - the counter
    // is raised by markAsFailed, when an attempt actually fails.
    expect(published.completionAttempts).toBe(0);
    expect(matchesFilter(published, deadFilter)).toBe(false);
    expect(matchesFilter(published, claimFilter)).toBe(true);
  });

  it("would be unclaimable if the redrive left completionAttempts alone", () => {
    // the same tick, but with the attempts reset removed from the update
    const withoutReset = {
      $set: { ...redriveDoc.$set, completionAttempts: box.maxRetries },
    };
    const published = applyUpdate(
      applyUpdate(aDeadLetter(), withoutReset),
      resubmittedUpdate,
    );

    expect(published.completionAttempts).toBe(box.maxRetries);
    // re-dead-lettered in the same tick, and over the claim cap either way
    expect(matchesFilter(published, deadFilter)).toBe(true);
    expect(matchesFilter(published, claimFilter)).toBe(false);
  });

  it("gives a redriven row the same number of fresh attempts as a new one, and the counter and the history agree", () => {
    // A redriven row, walked through whole poll ticks in the order the
    // subscriber runs them: claim and process, then the resubmitted, failed
    // and dead-letter sweeps. Every transition is the repository's REAL update
    // and every failure is the model's REAL markAsFailed.
    let doc = applyUpdate(
      applyUpdate(aDeadLetter(), redriveDoc),
      resubmittedUpdate,
    );
    let attempts = 0;

    while (matchesFilter(doc, claimFilter) && attempts < 100) {
      attempts += 1;

      doc = box.fail(doc);

      expect(matchesFilter(doc, failedFilter)).toBe(true);
      doc = applyUpdate(doc, failedUpdate);
      doc = applyUpdate(doc, resubmittedUpdate);

      if (matchesFilter(doc, deadFilter)) {
        doc = { ...doc, status: "DEAD_LETTER" };
      }
    }

    expect(attempts).toBe(box.maxRetries);
    // THE reconciliation: the row is dead-lettered only after its last attempt
    // has actually RUN, so the counter and the attempt history agree. Before
    // the fix the RESUBMITTED -> PUBLISHED sweep raised the counter to the cap
    // and the dead-letter sweep killed the row in the same tick, leaving a
    // DEAD_LETTER row reading "5/5" with only four history entries.
    expect(doc.status).toBe("DEAD_LETTER");
    expect(doc.completionAttempts).toBe(box.maxRetries);
    expect(doc.attemptHistory).toHaveLength(box.maxRetries);
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

  it("names the box, the id and the required status in the message", () => {
    const { message } = redriveConflict("gas outbox", ID, "PUBLISHED").output
      .payload;

    expect(message).toContain("gas outbox");
    expect(message).toContain(ID);
    expect(message).toContain("PUBLISHED");
    expect(message).toContain(REDRIVE_FROM_STATUS);
  });
});
