import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimEvents as claimInbox,
  updateDeadEvents as deadInbox,
  processExpiredEvents as expiredInbox,
  updateFailedEvents as failedInbox,
  findNextMessage as nextInbox,
  parkById as parkInbox,
  updateResubmittedEvents as resubmittedInbox,
  unparkById as unparkInbox,
} from "../grants/repositories/inbox.repository.js";
import {
  claimEvents as claimOutbox,
  updateDeadEvents as deadOutbox,
  updateExpiredEvents as expiredOutbox,
  updateFailedEvents as failedOutbox,
  findNextMessage as nextOutbox,
  parkById as parkOutbox,
  updateResubmittedEvents as resubmittedOutbox,
  unparkById as unparkOutbox,
} from "../grants/repositories/outbox.repository.js";
import {
  PARKED_STATUS,
  PARK_FROM_STATUS,
  UNPARK_FROM_STATUS,
  parkConflict,
  parkUpdate,
  unparkUpdate,
} from "./event-park.js";
import { db } from "./mongo-client.js";

vi.mock("./mongo-client.js");

const ID = "665f1c2e9a1b2c3d4e5f6a7b";
const SEGREGATION_REF = "GLD-9B2";

// ---------------------------------------------------------------------------
// The same minimum viable Mongo the redrive invariants use, for the same
// reason: every filter below is CAPTURED from the repository that issues it,
// never restated here, so changing a poller filter fails this test rather than
// quietly un-parking poison.
// ---------------------------------------------------------------------------
const OPERATORS = {
  $eq: (value, operand) => value === operand,
  $ne: (value, operand) => value !== operand,
  $lt: (value, operand) => value < operand,
  $lte: (value, operand) => value <= operand,
  $gte: (value, operand) => value >= operand,
  $nin: (value, operand) => !operand.includes(value),
};

const isPlainCondition = (condition) =>
  condition !== null &&
  typeof condition === "object" &&
  !(condition instanceof Date);

const isOperatorObject = (condition) =>
  isPlainCondition(condition) &&
  Object.keys(condition).length > 0 &&
  Object.keys(condition).every((key) => key in OPERATORS);

const matchesCondition = (value, condition) =>
  isOperatorObject(condition)
    ? Object.entries(condition).every(([operator, operand]) =>
        OPERATORS[operator](value, operand),
      )
    : value === condition;

const matchesFilter = (doc, filter) => {
  const { _id, ...rest } = filter;

  return Object.entries(rest).every(([key, condition]) =>
    matchesCondition(doc[key], condition),
  );
};

const applyUpdate = (doc, update) => ({ ...doc, ...(update.$set ?? {}) });

const capture = async (method, run) => {
  const spy = vi.fn().mockResolvedValue(null);
  db.collection.mockReturnValue({ [method]: spy });

  await run();

  return spy.mock.calls.at(-1);
};

// A row an operator has parked: terminal, unclaimed, still carrying the
// attempts and the error that killed it.
const aParkedRow = () => ({
  status: PARKED_STATUS,
  completionAttempts: 5,
  parked: {
    at: "2026-06-16T11:00:00.000Z",
    reason: "poison payload",
    by: "donatas",
  },
  claimedBy: null,
  claimedAt: null,
  claimExpiresAt: null,
  claimExpiresAtRaw: null,
  segregationRef: SEGREGATION_REF,
  lastError: { name: "TypeError", message: "boom", at: null },
});

const BOXES = [
  {
    name: "inbox",
    park: () => parkInbox(ID, { reason: "poison payload", by: "donatas" }),
    unpark: () => unparkInbox(ID),
    claim: () => claimInbox("claim-token", SEGREGATION_REF, 1),
    next: () => nextInbox([]),
    expired: expiredInbox,
    resubmitted: resubmittedInbox,
    failed: failedInbox,
    dead: deadInbox,
  },
  {
    name: "outbox",
    park: () => parkOutbox(ID, { reason: "poison payload", by: "donatas" }),
    unpark: () => unparkOutbox(ID),
    claim: () => claimOutbox("claim-token", SEGREGATION_REF),
    next: () => nextOutbox([]),
    expired: expiredOutbox,
    resubmitted: resubmittedOutbox,
    failed: failedOutbox,
    dead: deadOutbox,
  },
];

describe.each(BOXES)("park invariants ($name)", (box) => {
  let parkFilter;
  let parkDoc;
  let unparkFilter;
  let unparkDoc;
  let claimFilter;
  let nextFilter;
  let expiredFilter;
  let resubmittedFilter;
  let failedFilter;
  let deadFilter;

  beforeEach(async () => {
    [parkFilter, parkDoc] = await capture("findOneAndUpdate", box.park);
    [unparkFilter, unparkDoc] = await capture("findOneAndUpdate", box.unpark);
    [claimFilter] = await capture("findOneAndUpdate", box.claim);
    [nextFilter] = await capture("findOne", box.next);
    [expiredFilter] = await capture("updateMany", box.expired);
    [resubmittedFilter] = await capture("updateMany", box.resubmitted);
    [failedFilter] = await capture("updateMany", box.failed);
    [deadFilter] = await capture("updateMany", box.dead);
  });

  it("only parks a DEAD_LETTER row, so a concurrent change loses cleanly", () => {
    expect(parkFilter.status).toBe(PARK_FROM_STATUS);
    expect(
      matchesFilter({ ...aParkedRow(), status: "DEAD_LETTER" }, parkFilter),
    ).toBe(true);
    expect(
      matchesFilter({ ...aParkedRow(), status: "COMPLETED" }, parkFilter),
    ).toBe(false);
  });

  it("records the reason and the actor on the row", () => {
    const parked = applyUpdate({ status: "DEAD_LETTER" }, parkDoc);

    expect(parked.status).toBe(PARKED_STATUS);
    expect(parked.parked).toEqual({
      at: expect.any(String),
      reason: "poison payload",
      by: "donatas",
    });
  });

  it("releases any claim, so a parked row holds nothing", () => {
    const parked = applyUpdate({ status: "DEAD_LETTER" }, parkDoc);

    expect(parked.claimedBy).toBeNull();
    expect(parked.claimedAt).toBeNull();
    expect(parked.claimExpiresAt).toBeNull();
  });

  it("only unparks a PARKED row, back to DEAD_LETTER, clearing the record", () => {
    expect(unparkFilter.status).toBe(UNPARK_FROM_STATUS);

    const unparked = applyUpdate(aParkedRow(), unparkDoc);

    expect(unparked.status).toBe(PARK_FROM_STATUS);
    expect(unparked.parked).toBeNull();
  });

  it("leaves the attempts and the error alone - an unparked row is a dead letter again, not a fresh one", () => {
    const unparked = applyUpdate(aParkedRow(), unparkDoc);

    expect(unparked.completionAttempts).toBe(5);
    expect(unparked.lastError).toEqual({
      name: "TypeError",
      message: "boom",
      at: null,
    });
  });

  // ---- THE proofs: no poller sweep may ever select a parked row ----

  it("can never be claimed", () => {
    expect(matchesFilter(aParkedRow(), claimFilter)).toBe(false);
    expect(matchesFilter(aParkedRow(), nextFilter)).toBe(false);
  });

  it("can never be resubmitted or re-failed", () => {
    expect(matchesFilter(aParkedRow(), resubmittedFilter)).toBe(false);
    expect(matchesFilter(aParkedRow(), failedFilter)).toBe(false);
  });

  it("can never be dragged back to DEAD_LETTER by the dead-letter sweep", () => {
    // This is the one that would have bitten: the sweep selected
    // `status: { $ne: DEAD_LETTER }` with the attempts at the cap, and a
    // parked row is exactly that.
    expect(matchesFilter(aParkedRow(), deadFilter)).toBe(false);
    expect(
      matchesFilter({ ...aParkedRow(), status: "PUBLISHED" }, deadFilter),
    ).toBe(true);
  });

  it("can never be swept by the claim-expiry sweep", () => {
    const withExpiredClaim = {
      ...aParkedRow(),
      claimExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
    };

    expect(matchesFilter(withExpiredClaim, expiredFilter)).toBe(false);
    expect(
      matchesFilter(
        { ...withExpiredClaim, status: "PROCESSING" },
        expiredFilter,
      ),
    ).toBe(true);
  });

  it("survives a whole poll tick untouched", () => {
    const parked = aParkedRow();

    for (const filter of [
      claimFilter,
      nextFilter,
      expiredFilter,
      resubmittedFilter,
      failedFilter,
      deadFilter,
    ]) {
      expect(matchesFilter(parked, filter)).toBe(false);
    }
  });
});

describe("parkUpdate", () => {
  it("defaults `by` to null rather than undefined, so the stored key is always present", () => {
    expect(parkUpdate({ reason: "poison" }).$set.parked.by).toBeNull();
  });

  it("stamps `at` as an ISO string", () => {
    const at = new Date("2026-06-16T11:00:00.000Z");

    expect(parkUpdate({ reason: "poison", at }).$set.parked.at).toBe(
      "2026-06-16T11:00:00.000Z",
    );
  });
});

describe("unparkUpdate", () => {
  it("clears the parking record rather than archiving it", () => {
    expect(unparkUpdate().$set).toEqual({
      status: PARK_FROM_STATUS,
      parked: null,
    });
  });
});

describe("parkConflict", () => {
  it("is a 409 naming the status that blocked it", () => {
    const error = parkConflict("gas inbox", ID, "COMPLETED", PARK_FROM_STATUS);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload.status).toBe("COMPLETED");
    expect(error.message).toContain("is COMPLETED, not DEAD_LETTER");
  });

  it("names the expected status it was given, so unpark reads correctly too", () => {
    expect(
      parkConflict("gas inbox", ID, "DEAD_LETTER", UNPARK_FROM_STATUS).message,
    ).toContain("is DEAD_LETTER, not PARKED");
  });
});
