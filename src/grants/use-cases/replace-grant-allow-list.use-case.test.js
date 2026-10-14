import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import {
  findByGrantCode,
  replace,
} from "../repositories/grant-allow-list.repository.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";
import { replaceGrantAllowListUseCase } from "./replace-grant-allow-list.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/grant-allow-list.repository.js");
vi.mock("./resolve-grant-administration.use-case.js");

const session = { id: "active-session" };
const args = {
  grantCode: "woodland",
  global: {
    sbi: ["106000033", "106000041"],
    crn: ["1042000000"],
  },
  caller: "fg-grants-platform-admin",
};

describe("replaceGrantAllowListUseCase", () => {
  beforeEach(() => {
    withTransaction.mockImplementation((callback) => callback(session));
    resolveGrantAdministration.mockResolvedValue({
      admin: { role: "ROLE_WOODLAND_ADMIN" },
    });
    findByGrantCode.mockResolvedValue(null);
    replace.mockResolvedValue();
    writeAuditEvent.mockResolvedValue();
  });

  it("does not read or replace identifiers when grant administration is denied", async () => {
    resolveGrantAdministration.mockRejectedValue(Boom.forbidden());
    await expect(
      replaceGrantAllowListUseCase({ ...args, userRoles: [] }),
    ).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(findByGrantCode).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(writeAuditEvent.mock.calls[0][0]).toMatchObject({
      status: "FAILURE",
      details: { errorCode: "GRANT_ADMIN_ACCESS_DENIED" },
    });
  });

  it("checks the grant before opening or saving its allow list", async () => {
    await replaceGrantAllowListUseCase(args);

    expect(resolveGrantAdministration).toHaveBeenCalledWith(args);
    expect(resolveGrantAdministration.mock.invocationCallOrder[0]).toBeLessThan(
      findByGrantCode.mock.invocationCallOrder[0],
    );
    expect(findByGrantCode.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0],
    );
  });

  it("waits for definition resolution before starting the replacement transaction", async () => {
    let finishResolution;
    resolveGrantAdministration.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishResolution = resolve;
        }),
    );

    const pending = replaceGrantAllowListUseCase(args);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(findByGrantCode).not.toHaveBeenCalled();

    finishResolution({ admin: { role: "ROLE_WOODLAND_ADMIN" } });
    await pending;

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(expect.any(GrantAllowList), session);
    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      session,
    );
  });

  it("audits a definition fetch failure without starting a transaction", async () => {
    const failure = Boom.serverUnavailable("S3 included 106000033");
    resolveGrantAdministration.mockRejectedValue(failure);

    await expect(replaceGrantAllowListUseCase(args)).rejects.toBe(failure);

    expect(withTransaction).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(writeAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILURE",
        details: {
          caller: "fg-grants-platform-admin",
          errorCode: "UNEXPECTED_FAILURE",
        },
      }),
      null,
    );
  });

  it("creates, validates and persists a complete replacement in the active session", async () => {
    const result = await replaceGrantAllowListUseCase({
      ...args,
      global: {
        sbi: [" 106000033 ", "106000041"],
        crn: ["1042000000"],
      },
    });

    expect(findByGrantCode).toHaveBeenCalledWith("woodland", session);
    expect(replace).toHaveBeenCalledWith(expect.any(GrantAllowList), session);
    expect(result).toEqual({
      grantCode: "woodland",
      global: args.global,
    });
  });

  it("replaces populated data with empty collections", async () => {
    findByGrantCode.mockResolvedValue(
      new GrantAllowList({
        grantCode: "woodland",
        global: args.global,
      }),
    );

    const result = await replaceGrantAllowListUseCase({
      ...args,
      global: { sbi: [], crn: [] },
    });

    expect(result.global).toEqual({ sbi: [], crn: [] });
    expect(replace.mock.calls[0][0].toJSON().global).toEqual({
      sbi: [],
      crn: [],
    });
  });

  it("does not persist when the aggregate refuses a replacement", async () => {
    await expect(
      replaceGrantAllowListUseCase({
        ...args,
        global: { sbi: ["106000033", "106000033"], crn: [] },
      }),
    ).rejects.toMatchObject({
      output: {
        payload: { errorCode: "ALLOW_LIST_VALIDATION_FAILED" },
      },
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("uses one session for the replacement and successful audit", async () => {
    await replaceGrantAllowListUseCase(args);

    expect(replace).toHaveBeenCalledWith(expect.any(GrantAllowList), session);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS" }),
      session,
    );
  });

  it("audits the complete previous and replacement lists plus caller", async () => {
    findByGrantCode.mockResolvedValue(
      new GrantAllowList({
        grantCode: "woodland",
        global: { sbi: ["106000099"], crn: ["1042000099"] },
      }),
    );

    await replaceGrantAllowListUseCase(args);

    const [event] = writeAuditEvent.mock.calls[0];
    expect(event).toMatchObject({
      entities: [
        {
          entity: "GRANT",
          action: "REPLACE_ALLOW_LIST",
          entityid: "woodland",
        },
      ],
      details: {
        caller: "fg-grants-platform-admin",
        oldSbiCount: 1,
        oldCrnCount: 1,
        newSbiCount: 2,
        newCrnCount: 1,
        oldGlobal: { sbi: ["106000099"], crn: ["1042000099"] },
        newGlobal: args.global,
      },
      status: "SUCCESS",
    });
  });

  it("audits the removed identifiers when clearing the list", async () => {
    findByGrantCode.mockResolvedValue(
      new GrantAllowList({
        grantCode: "woodland",
        global: args.global,
      }),
    );

    await replaceGrantAllowListUseCase({
      ...args,
      global: { sbi: [], crn: [] },
    });

    expect(writeAuditEvent.mock.calls[0][0].details).toMatchObject({
      oldGlobal: args.global,
      newGlobal: { sbi: [], crn: [] },
    });
  });

  it.each([
    ["duplicate", { sbi: ["106000033", "106000033"], crn: [] }],
    ["invalid", { sbi: ["not-an-sbi"], crn: [] }],
  ])(
    "audits a safe refusal without the submitted values (%s)",
    async (_, global) => {
      await replaceGrantAllowListUseCase({ ...args, global }).catch(() => {});

      const [event, auditSession] = writeAuditEvent.mock.calls[0];
      expect(event).toMatchObject({
        details: {
          caller: "fg-grants-platform-admin",
          errorCode: "ALLOW_LIST_VALIDATION_FAILED",
        },
        status: "FAILURE",
      });
      expect(auditSession).toBeNull();
      expect(JSON.stringify(event)).not.toMatch(/106000033|not-an-sbi/);
    },
  );

  it("audits a missing grant with a categorical reason", async () => {
    resolveGrantAdministration.mockRejectedValue(Boom.notFound("missing"));

    await replaceGrantAllowListUseCase(args).catch(() => {});

    expect(writeAuditEvent.mock.calls[0][0].details).toEqual({
      caller: "fg-grants-platform-admin",
      errorCode: "GRANT_NOT_FOUND",
    });
    expect(withTransaction).not.toHaveBeenCalled();
    expect(findByGrantCode).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("audits unexpected failures without copying their message", async () => {
    replace.mockRejectedValue(new Error("database included 106000033"));

    await replaceGrantAllowListUseCase(args).catch(() => {});

    const [event] = writeAuditEvent.mock.calls[0];
    expect(event.details).toEqual({
      caller: "fg-grants-platform-admin",
      errorCode: "UNEXPECTED_FAILURE",
    });
    expect(JSON.stringify(event)).not.toContain("106000033");
  });
});
