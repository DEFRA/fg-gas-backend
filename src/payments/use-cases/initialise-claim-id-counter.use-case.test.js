import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readClaimIdCounter,
  readPrimaryClaimIdCounter,
  setClaimIdCounterSequence,
} from "../repositories/counter.repository.js";
import {
  countPayments,
  countPrimaryPayments,
} from "../repositories/payment.repository.js";
import {
  applyClaimIdCounterInitialisation,
  assertClaimIdCounterInitialisable,
  reconcileClaimIdCounterInitialisation,
} from "./initialise-claim-id-counter.use-case.js";

vi.mock("../repositories/counter.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  readClaimIdCounter: vi.fn(),
  readPrimaryClaimIdCounter: vi.fn(),
  setClaimIdCounterSequence: vi.fn(),
}));
vi.mock("../repositories/payment.repository.js", async (importOriginal) => ({
  ...(await importOriginal()),
  countPayments: vi.fn(),
  countPrimaryPayments: vi.fn(),
}));

const preparedCounter = { persistedSeq: 4999 };
const session = {};

const expectConflict = async (promise, reason) => {
  await expect(promise).rejects.toMatchObject({
    isBoom: true,
    output: {
      statusCode: 409,
      payload: {
        message: `Claim ID counter initialisation blocked: ${reason}`,
      },
    },
  });
};

describe("initialise claim ID counter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countPayments.mockResolvedValue(0);
    countPrimaryPayments.mockResolvedValue(0);
    readClaimIdCounter.mockResolvedValue({ _id: "claimIds", seq: 9_999_999 });
    readPrimaryClaimIdCounter.mockResolvedValue({
      _id: "claimIds",
      seq: 9_999_999,
    });
    setClaimIdCounterSequence.mockResolvedValue({ matchedCount: 1 });
  });

  describe("assertClaimIdCounterInitialisable", () => {
    it("allows the expected seed to be lowered when there are zero payments", async () => {
      await expect(
        assertClaimIdCounterInitialisable(preparedCounter, session),
      ).resolves.toEqual({
        action: "lower",
        currentSeq: 9_999_999,
        payments: 0,
      });

      expect(countPayments).toHaveBeenCalledWith(session);
      expect(readClaimIdCounter).toHaveBeenCalledWith(session);
    });

    it("treats an exact target as a rerun no-op", async () => {
      readClaimIdCounter.mockResolvedValue({ _id: "claimIds", seq: 4999 });

      await expect(
        assertClaimIdCounterInitialisable(preparedCounter, session),
      ).resolves.toEqual({ action: "noop", currentSeq: 4999, payments: 0 });
    });

    it("fails closed when any payment exists", async () => {
      countPayments.mockResolvedValue(1);

      await expectConflict(
        assertClaimIdCounterInitialisable(preparedCounter, session),
        "payments-present",
      );

      expect(readClaimIdCounter).not.toHaveBeenCalled();
    });

    it.each([
      { current: { _id: "claimIds", seq: 5_000_000 }, label: "another value" },
      { current: null, label: "a missing counter" },
    ])("fails closed for $label", async ({ current }) => {
      readClaimIdCounter.mockResolvedValue(current);

      await expectConflict(
        assertClaimIdCounterInitialisable(preparedCounter, session),
        "unexpected-counter-state",
      );
    });

    it.each([
      -1,
      998,
      4999.5,
      Number.MAX_SAFE_INTEGER + 1,
      5000,
      9_999_999,
      10_000_000,
    ])(
      "rejects invalid derived target %s before repository I/O",
      async (persistedSeq) => {
        await expectConflict(
          assertClaimIdCounterInitialisable({ persistedSeq }, session),
          "invalid-target",
        );

        expect(countPayments).not.toHaveBeenCalled();
        expect(readClaimIdCounter).not.toHaveBeenCalled();
        expect(setClaimIdCounterSequence).not.toHaveBeenCalled();
      },
    );
  });

  describe("applyClaimIdCounterInitialisation", () => {
    it("lowers the seed on the caller's session", async () => {
      await expect(
        applyClaimIdCounterInitialisation(preparedCounter, session),
      ).resolves.toEqual({
        action: "lower",
        currentSeq: 9_999_999,
        payments: 0,
        persistedSeq: 4999,
      });

      expect(setClaimIdCounterSequence).toHaveBeenCalledOnce();
      expect(setClaimIdCounterSequence).toHaveBeenCalledWith(4999, session);
    });

    it("does not write when the counter is already at the exact target", async () => {
      readClaimIdCounter.mockResolvedValue({ _id: "claimIds", seq: 4999 });

      await expect(
        applyClaimIdCounterInitialisation(preparedCounter, session),
      ).resolves.toMatchObject({ action: "noop", persistedSeq: 4999 });

      expect(setClaimIdCounterSequence).not.toHaveBeenCalled();
    });

    it("does not write when payments are present", async () => {
      countPayments.mockResolvedValue(1);

      await expectConflict(
        applyClaimIdCounterInitialisation(preparedCounter, session),
        "payments-present",
      );

      expect(setClaimIdCounterSequence).not.toHaveBeenCalled();
    });

    it("fails when the counter document disappears before the update", async () => {
      setClaimIdCounterSequence.mockResolvedValue({ matchedCount: 0 });

      await expectConflict(
        applyClaimIdCounterInitialisation(preparedCounter, session),
        "counter-document-missing",
      );
    });
  });

  describe("reconcileClaimIdCounterInitialisation", () => {
    it("rejects an invalid target before primary repository I/O", async () => {
      await expectConflict(
        reconcileClaimIdCounterInitialisation({ persistedSeq: 5000 }),
        "invalid-target",
      );

      expect(readPrimaryClaimIdCounter).not.toHaveBeenCalled();
      expect(countPrimaryPayments).not.toHaveBeenCalled();
    });

    it("accepts the persisted target with zero payments", async () => {
      readPrimaryClaimIdCounter.mockResolvedValue({
        _id: "claimIds",
        seq: 4999,
      });

      await expect(
        reconcileClaimIdCounterInitialisation(preparedCounter),
      ).resolves.toBeUndefined();

      expect(readPrimaryClaimIdCounter).toHaveBeenCalledWith();
      expect(countPrimaryPayments).toHaveBeenCalledWith();
      expect(readClaimIdCounter).not.toHaveBeenCalled();
      expect(countPayments).not.toHaveBeenCalled();
    });

    it.each([
      {
        current: { _id: "claimIds", seq: 5000 },
        payments: 0,
        label: "counter drift",
      },
      {
        current: { _id: "claimIds", seq: 4999 },
        payments: 1,
        label: "payments",
      },
      { current: null, payments: 0, label: "a missing counter" },
    ])("fails reconciliation for $label", async ({ current, payments }) => {
      readPrimaryClaimIdCounter.mockResolvedValue(current);
      countPrimaryPayments.mockResolvedValue(payments);

      await expect(
        reconcileClaimIdCounterInitialisation(preparedCounter),
      ).rejects.toMatchObject({
        isBoom: true,
        message: "Claim ID counter reconciliation failed",
        output: { statusCode: 500 },
      });
    });
  });
});
