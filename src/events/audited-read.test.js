import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRequestContext,
  withRequestContext,
} from "../common/get-request-context.js";
import { logger } from "../common/logger.js";
import {
  transactionOptions,
  withTransaction,
} from "../common/with-transaction.js";
import { auditStatus } from "./audit-constants.js";
import { AUDIT_COMMIT_MS, auditedRead, auditedStream } from "./audited-read.js";
import { writeAuditEvent } from "./write-audit-event.js";

vi.mock("../common/logger.js");
vi.mock("./write-audit-event.js");
vi.mock("../common/with-transaction.js", async (importOriginal) => ({
  ...(await importOriginal()),
  withTransaction: vi.fn(),
}));

const SESSION = { id: "session" };

const audit = (args, result, error) => ({
  entities: [{ entity: "APPLICATION", action: "VIEW_APPLICATION" }],
  details: { args, rows: result?.rows ?? null, failed: Boolean(error) },
  segregationRef: "admin-view-application",
});

describe("auditedRead", () => {
  beforeEach(() => {
    withTransaction.mockImplementation((callback) => callback(SESSION));
    writeAuditEvent.mockResolvedValue();
  });

  it("commits the SUCCESS audit before the data is returned", async () => {
    const order = [];
    const read = vi.fn(async () => {
      order.push("read");
      return { rows: 2 };
    });
    writeAuditEvent.mockImplementation(async () => order.push("audit"));

    const result = await auditedRead(read, audit)({ tab: "raw" });

    expect(result).toEqual({ rows: 2 });
    expect(order).toEqual(["read", "audit"]);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      {
        ...audit({ tab: "raw" }, { rows: 2 }),
        status: auditStatus.SUCCESS,
      },
      SESSION,
    );
  });

  it("reads outside the audit's transaction", async () => {
    const read = vi.fn(async () => {
      expect(withTransaction).not.toHaveBeenCalled();
      return {};
    });

    await auditedRead(read, audit)({});

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("bounds the audit commit, and nothing more without a deadline", async () => {
    await auditedRead(async () => ({}), audit)({});

    expect(withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      ...transactionOptions,
      maxCommitTimeMS: AUDIT_COMMIT_MS,
    });
  });

  it("takes a caller's commit bound", async () => {
    await auditedRead(async () => ({}), audit, { maxCommitTimeMS: 250 })({});

    expect(withTransaction.mock.calls[0][1].maxCommitTimeMS).toBe(250);
  });

  it("releases no data when the audit cannot be committed", async () => {
    withTransaction.mockRejectedValue(new Error("commit failed"));

    await expect(
      auditedRead(async () => ({ rows: 2 }), audit)({}),
    ).rejects.toMatchObject({
      message: "commit failed",
      auditNotWritten: true,
    });
  });

  it("writes no audit for a read that releases nothing", async () => {
    const releases = ({ rows }) => rows > 0;

    const result = await auditedRead(async () => ({ rows: 0 }), audit, {
      releases,
    })({});

    expect(result).toEqual({ rows: 0 });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("audits a failed read as a FAILURE, outside any session, and rethrows it", async () => {
    const error = new Error("not found");

    await expect(
      auditedRead(async () => Promise.reject(error), audit)({ tab: "raw" }),
    ).rejects.toBe(error);

    expect(writeAuditEvent).toHaveBeenCalledWith({
      ...audit({ tab: "raw" }, null, error),
      status: auditStatus.FAILURE,
    });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("still throws the read's own error when the FAILURE audit cannot be written", async () => {
    const error = new Error("not found");
    writeAuditEvent.mockRejectedValue(new Error("audit down"));

    await expect(
      auditedRead(async () => Promise.reject(error), audit)({}),
    ).rejects.toBe(error);

    expect(logger.error).toHaveBeenCalledWith("Read FAILURE audit not written");
  });

  describe("by a deadline", () => {
    const DEADLINE = 1_000;
    const options = { deadlineOf: ({ deadline }) => deadline };

    beforeEach(() => {
      vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("audits a read still running at the deadline as a FAILURE, out of time", async () => {
      const answer = auditedRead(
        () => new Promise(() => {}),
        audit,
        options,
      )({ deadline: DEADLINE });
      const failed = expect(answer).rejects.toMatchObject({ outOfTime: true });

      await vi.advanceTimersByTimeAsync(DEADLINE);

      await failed;
      expect(writeAuditEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: auditStatus.FAILURE }),
      );
    });

    it("never audits as viewed what a read answers after the deadline", async () => {
      const read = () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ rows: 2 }), DEADLINE + 10);
        });
      const answer = auditedRead(read, audit, options)({ deadline: DEADLINE });
      const failed = expect(answer).rejects.toMatchObject({ outOfTime: true });

      await vi.advanceTimersByTimeAsync(DEADLINE + 10);

      await failed;
      expect(withTransaction).not.toHaveBeenCalled();
      expect(writeAuditEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: auditStatus.SUCCESS }),
        expect.anything(),
      );
    });

    it("bounds the commit by the time left", async () => {
      await vi.advanceTimersByTimeAsync(DEADLINE - 300);

      await auditedRead(
        async () => ({}),
        audit,
        options,
      )({ deadline: DEADLINE });

      expect(withTransaction.mock.calls[0][1]).toMatchObject({
        maxCommitTimeMS: 300,
        timeoutMS: 300,
      });
    });

    it("bounds the commit by its own limit when that is sooner", async () => {
      await auditedRead(async () => ({}), audit, {
        ...options,
        maxCommitTimeMS: 250,
      })({ deadline: DEADLINE });

      expect(withTransaction.mock.calls[0][1]).toMatchObject({
        maxCommitTimeMS: 250,
        timeoutMS: DEADLINE,
      });
    });

    it("says an audit cut short by the deadline ran out of time", async () => {
      withTransaction.mockImplementation(
        (_, { timeoutMS }) =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("timed out")), timeoutMS);
          }),
      );
      const answer = auditedRead(
        async () => ({}),
        audit,
        options,
      )({ deadline: DEADLINE });
      const failed = expect(answer).rejects.toMatchObject({
        outOfTime: true,
        auditNotWritten: true,
      });

      await vi.advanceTimersByTimeAsync(DEADLINE);

      await failed;
    });

    const after = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    // As the driver does: a failed write is aborted with a fresh timeout,
    // retried once.
    const stallingTransaction = async (callback, { timeoutMS }) => {
      writeAuditEvent.mockImplementation(async () => {
        await after(timeoutMS);
        throw new Error("write timed out");
      });

      try {
        await callback(SESSION);
      } catch (error) {
        await after(timeoutMS);
        await after(timeoutMS);
        throw error;
      }
    };

    it("gives up at the deadline when the audit's write and then its abort stall", async () => {
      withTransaction.mockImplementation(stallingTransaction);
      const answer = auditedRead(
        async () => ({}),
        audit,
        options,
      )({ deadline: DEADLINE });
      const settled = vi.fn();
      answer.then(settled, settled);

      await vi.advanceTimersByTimeAsync(DEADLINE);

      expect(settled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ outOfTime: true, auditNotWritten: true }),
      );
      await vi.advanceTimersByTimeAsync(2 * DEADLINE);
    });

    it("never releases what a commit landing after the deadline audited", async () => {
      withTransaction.mockImplementation(async (callback) => {
        await callback(SESSION);
        await after(DEADLINE + 10);
      });
      const answer = auditedRead(
        async () => ({ rows: 2 }),
        audit,
        options,
      )({ deadline: DEADLINE });
      const failed = expect(answer).rejects.toMatchObject({
        outOfTime: true,
        auditNotWritten: true,
      });

      await vi.advanceTimersByTimeAsync(DEADLINE + 10);

      await failed;
    });

    it("does not wait past the deadline for a FAILURE audit still writing", async () => {
      writeAuditEvent.mockReturnValue(new Promise(() => {}));
      const answer = auditedRead(
        () => new Promise(() => {}),
        audit,
        options,
      )({ deadline: DEADLINE });
      const failed = expect(answer).rejects.toMatchObject({ outOfTime: true });

      await vi.advanceTimersByTimeAsync(DEADLINE + 1);

      await failed;
    });

    it("writes no SUCCESS audit once the deadline has passed", async () => {
      await vi.advanceTimersByTimeAsync(DEADLINE);

      await expect(
        auditedRead(async () => ({}), audit, options)({ deadline: DEADLINE }),
      ).rejects.toMatchObject({ outOfTime: true, auditNotWritten: true });
      expect(writeAuditEvent).not.toHaveBeenCalled();
    });
  });
});

describe("auditedStream", () => {
  beforeEach(() => {
    withTransaction.mockImplementation((callback) => callback(SESSION));
    writeAuditEvent.mockResolvedValue();
  });

  it("writes no audit for a read it hands on, then one when the stream ends", async () => {
    const streamed = auditedStream(
      async () => ({ rows: 2 }),
      audit,
    )({
      tab: "raw",
    });

    expect(await streamed.read()).toEqual({ rows: 2 });
    expect(writeAuditEvent).not.toHaveBeenCalled();

    await streamed.ended({ rows: 1 }, null);

    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      status: auditStatus.SUCCESS,
      details: { rows: 1, failed: false },
    });
  });

  it("writes FAILURE for a refused read, and for a stream that failed", async () => {
    const streamed = auditedStream(async () => {
      throw new Error("refused");
    }, audit)({});

    await expect(streamed.read()).rejects.toThrow("refused");
    await streamed.ended({ rows: 1 }, new Error("broke"));

    expect(writeAuditEvent.mock.calls.map(([event]) => event.status)).toEqual([
      auditStatus.FAILURE,
      auditStatus.FAILURE,
    ]);
  });

  it("audits a stream that ends after its request as that request's user", async () => {
    const users = [];
    writeAuditEvent.mockImplementation(async () =>
      users.push(getRequestContext()?.user ?? null),
    );
    const streamed = withRequestContext({ user: "operator-1" }, () =>
      auditedStream(async () => ({ rows: 2 }), audit)({}),
    );

    await withRequestContext({ user: "operator-1" }, () => streamed.read());
    await streamed.ended({ rows: 2 }, null);

    expect(getRequestContext()).toBeNull();
    expect(users).toEqual(["operator-1"]);
  });

  it("logs, never throws, when the stream's audit isn't written", async () => {
    writeAuditEvent.mockRejectedValue(new Error("mongo down"));

    await auditedStream(vi.fn(), audit)({}).ended({ rows: 0 }, null);

    expect(logger.error).toHaveBeenCalledWith(
      "Streamed read audit not written",
    );
  });
});
