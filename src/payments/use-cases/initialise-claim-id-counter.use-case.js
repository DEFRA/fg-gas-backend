import Boom from "@hapi/boom";
import {
  CLAIM_ID_SEED,
  readClaimIdCounter,
  readPrimaryClaimIdCounter,
  setClaimIdCounterSequence,
} from "../repositories/counter.repository.js";
import {
  countPayments,
  countPrimaryPayments,
} from "../repositories/payment.repository.js";

const conflict = (reason) =>
  Boom.conflict(`Claim ID counter initialisation blocked: ${reason}`);

const claimIdSequenceFrom = (counter) => counter?.seq ?? null;

const isValidPersistedSequence = (persistedSeq) =>
  Number.isSafeInteger(persistedSeq) &&
  persistedSeq >= 999 &&
  persistedSeq < CLAIM_ID_SEED &&
  persistedSeq % 1000 === 999;

const assertValidPersistedSequence = (persistedSeq) => {
  if (!isValidPersistedSequence(persistedSeq)) {
    throw conflict("invalid-target");
  }
};

const decideCounterAction = (currentSeq, persistedSeq, payments) => {
  if (currentSeq === persistedSeq) {
    return { action: "noop", currentSeq, payments };
  }
  if (currentSeq === CLAIM_ID_SEED) {
    return { action: "lower", currentSeq, payments };
  }
  throw conflict("unexpected-counter-state");
};

// Read-only. Decides what apply may do, or throws. Safe to call before the
// transaction (fail fast) and again inside it (close the race).
export const assertClaimIdCounterInitialisable = async (
  { persistedSeq },
  session,
) => {
  assertValidPersistedSequence(persistedSeq);

  const payments = await countPayments(session);
  if (payments !== 0) {
    throw conflict("payments-present");
  }

  const current = await readClaimIdCounter(session);
  return decideCounterAction(
    claimIdSequenceFrom(current),
    persistedSeq,
    payments,
  );
};

export const applyClaimIdCounterInitialisation = async (
  { persistedSeq },
  session,
) => {
  const decision = await assertClaimIdCounterInitialisable(
    { persistedSeq },
    session,
  );
  if (decision.action === "lower") {
    const result = await setClaimIdCounterSequence(persistedSeq, session);
    if (result.matchedCount !== 1) {
      throw conflict("counter-document-missing");
    }
  }
  return { ...decision, persistedSeq };
};

// Post-commit primary read. Throws Boom.internal on any drift.
export const reconcileClaimIdCounterInitialisation = async ({
  persistedSeq,
}) => {
  assertValidPersistedSequence(persistedSeq);

  const current = await readPrimaryClaimIdCounter();
  const payments = await countPrimaryPayments();
  if (claimIdSequenceFrom(current) !== persistedSeq || payments !== 0) {
    throw Boom.internal("Claim ID counter reconciliation failed");
  }
};
