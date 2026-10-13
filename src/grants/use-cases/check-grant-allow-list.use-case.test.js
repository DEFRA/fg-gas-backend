import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, mongoClient } from "../../common/mongo-client.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { checkGrantAllowListUseCase } from "./check-grant-allow-list.use-case.js";

vi.mock("../../common/mongo-client.js", () => ({
  db: { collection: vi.fn() },
  mongoClient: { startSession: vi.fn() },
}));
vi.mock("../../events/write-audit-event.js");

const args = {
  grantCode: "woodland",
  sbi: "106000033",
  crn: "1042000000",
  caller: "grants-ui",
};
const populated = {
  grantCode: "woodland",
  global: { sbi: ["106000033"], crn: ["1042000000"] },
};

describe("checkGrantAllowListUseCase", () => {
  let legacy;
  let catalogue;
  let lists;
  let session;
  beforeEach(() => {
    legacy = { findOne: vi.fn().mockResolvedValue({ code: "woodland" }) };
    catalogue = { findOne: vi.fn().mockResolvedValue(null) };
    lists = { findOne: vi.fn().mockResolvedValue(populated) };
    db.collection.mockImplementation(
      (name) =>
        ({ grants: legacy, config_versions: catalogue, allow_lists: lists })[
          name
        ],
    );
    session = {
      withTransaction: vi.fn(async (callback) => callback(session)),
      endSession: vi.fn(),
    };
    mongoClient.startSession.mockReturnValue(session);
    writeAuditEvent.mockResolvedValue();
  });

  it.each([
    [args, true],
    [{ ...args, sbi: "106000099" }, false],
    [{ ...args, crn: "1042000099" }, false],
  ])(
    "returns the domain decision and audits queried identifiers: %j",
    async (input, allowed) => {
      await expect(checkGrantAllowListUseCase(input)).resolves.toEqual({
        allowed,
      });
      expect(writeAuditEvent).toHaveBeenCalledWith(
        {
          entities: [
            {
              entity: "GRANT",
              action: "CHECK_ALLOW_LIST",
              entityid: "woodland",
            },
          ],
          details: { caller: "grants-ui", allowed },
          accounts: { sbi: input.sbi, crn: input.crn, frn: undefined },
          segregationRef: "woodland",
          security: { pmccode: "0706" },
          status: "SUCCESS",
        },
        session,
      );
    },
  );

  it("defaults a known grant without a stored list to unrestricted", async () => {
    lists.findOne.mockResolvedValue(null);
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
  });

  it("rejects an unknown grant even when an orphan list exists", async () => {
    legacy.findOne.mockResolvedValue(null);
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      status: "FAILURE",
      details: { caller: "grants-ui" },
      accounts: { sbi: args.sbi, crn: args.crn },
    });
    expect(writeAuditEvent.mock.calls[0][0].details).not.toHaveProperty(
      "allowed",
    );
  });

  it("fails closed on malformed persisted state", async () => {
    lists.findOne.mockResolvedValue({
      grantCode: "woodland",
      global: { sbi: ["bad"], crn: [] },
    });
    await expect(checkGrantAllowListUseCase(args)).rejects.toMatchObject({
      output: { statusCode: 500 },
    });
  });

  it("propagates storage failures", async () => {
    lists.findOne.mockRejectedValue(new Error("storage unavailable"));
    await expect(checkGrantAllowListUseCase(args)).rejects.toThrow(
      "storage unavailable",
    );
    expect(writeAuditEvent.mock.calls[0][0].status).toBe("FAILURE");
  });

  it("reads the current list for every query", async () => {
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: true,
    });
    lists.findOne.mockResolvedValue({
      grantCode: "woodland",
      global: { sbi: ["106000099"], crn: [] },
    });
    await expect(checkGrantAllowListUseCase(args)).resolves.toEqual({
      allowed: false,
    });
  });

  it.each(["106000033", "106000099"])(
    "withholds a true or false decision if success auditing fails: %s",
    async (sbi) => {
      writeAuditEvent.mockRejectedValue(new Error("audit unavailable"));
      await expect(
        checkGrantAllowListUseCase({ ...args, sbi }),
      ).rejects.toThrow("audit unavailable");
    },
  );

  it("withholds a decision if the audit transaction cannot commit", async () => {
    session.withTransaction.mockImplementation(async (callback) => {
      await callback(session);
      throw new Error("commit failed");
    });
    await expect(checkGrantAllowListUseCase(args)).rejects.toThrow(
      "commit failed",
    );
  });

  it("waits for the audit commit before releasing the decision", async () => {
    let commit;
    const committed = new Promise((resolve) => {
      commit = resolve;
    });
    session.withTransaction.mockImplementation(async (callback) => {
      await callback(session);
      await committed;
    });
    let released = false;
    const pending = checkGrantAllowListUseCase(args).then((result) => {
      released = true;
      return result;
    });
    await vi.waitFor(() => expect(writeAuditEvent).toHaveBeenCalled());
    expect(released).toBe(false);
    commit();
    await expect(pending).resolves.toEqual({ allowed: true });
  });
});
