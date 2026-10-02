import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../common/logger.js";
import {
  transactionOptions,
  withTransaction,
} from "../common/with-transaction.js";
import { auditStatus } from "./audit-constants.js";
import { AUDIT_COMMIT_MS, auditedRead } from "./audited-read.js";
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

  it("bounds the audit commit", async () => {
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
    ).rejects.toThrow("commit failed");
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
});
