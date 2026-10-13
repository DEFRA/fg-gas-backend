import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { GrantAllowList } from "../models/grant-allow-list.js";
import { findByGrantCode } from "../repositories/grant-allow-list.repository.js";
import { assertGrantExists } from "./assert-grant-exists.use-case.js";
import { getGrantAllowListUseCase } from "./get-grant-allow-list.use-case.js";

vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/grant-allow-list.repository.js");
vi.mock("./assert-grant-exists.use-case.js");

const session = { id: "audit-session" };

const args = {
  grantCode: "woodland",
  caller: "fg-grants-platform-admin",
};

const stored = new GrantAllowList({
  grantCode: "woodland",
  global: { sbi: ["106000033"], crn: ["1042000000"] },
});

describe("getGrantAllowListUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation((callback) => callback(session));
    writeAuditEvent.mockResolvedValue();
    assertGrantExists.mockResolvedValue();
    findByGrantCode.mockResolvedValue(stored);
  });

  it("asserts grant existence before reading and returns stored data", async () => {
    await expect(getGrantAllowListUseCase(args)).resolves.toEqual(
      stored.toJSON(),
    );

    expect(assertGrantExists).toHaveBeenCalledWith("woodland");
    expect(findByGrantCode).toHaveBeenCalledWith("woodland");
    expect(assertGrantExists.mock.invocationCallOrder[0]).toBeLessThan(
      findByGrantCode.mock.invocationCallOrder[0],
    );
  });

  it("returns an unrestricted representation when nothing is stored", async () => {
    findByGrantCode.mockResolvedValue(null);

    await expect(getGrantAllowListUseCase(args)).resolves.toEqual({
      grantCode: "woodland",
      global: { sbi: [], crn: [] },
    });
  });

  it("propagates the grant-not-found response without reading an allow list", async () => {
    const notFound = Boom.notFound('Grant with code "missing" not found');
    assertGrantExists.mockRejectedValue(notFound);

    await expect(
      getGrantAllowListUseCase({ ...args, grantCode: "missing" }),
    ).rejects.toBe(notFound);
    expect(findByGrantCode).not.toHaveBeenCalled();
  });
});

describe("allow-list read auditing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransaction.mockImplementation((callback) => callback(session));
    writeAuditEvent.mockResolvedValue();
    assertGrantExists.mockResolvedValue();
    findByGrantCode.mockResolvedValue(stored);
  });

  it("records safe success counts and protective monitoring metadata", async () => {
    await getGrantAllowListUseCase(args);

    const [event, auditSession] = writeAuditEvent.mock.calls[0];

    expect(event).toEqual({
      entities: [
        {
          entity: "GRANT",
          action: "VIEW_ALLOW_LIST",
          entityid: "woodland",
        },
      ],
      details: {
        caller: "fg-grants-platform-admin",
        sbiCount: 1,
        crnCount: 1,
      },
      accounts: { sbi: undefined, frn: undefined, crn: undefined },
      security: { pmccode: "0706" },
      segregationRef: "woodland",
      status: "SUCCESS",
    });
    expect(auditSession).toBe(session);
    expect(JSON.stringify(event)).not.toMatch(/106000033|1042000000/);
  });

  it("records a safe failed attempt without submitted identifiers", async () => {
    assertGrantExists.mockRejectedValue(Boom.notFound("missing"));

    await getGrantAllowListUseCase(args).catch(() => {});

    const [event, auditSession] = writeAuditEvent.mock.calls[0];

    expect(event.details).toEqual({ caller: "fg-grants-platform-admin" });
    expect(event.entities[0].action).toBe("VIEW_ALLOW_LIST");
    expect(event.status).toBe("FAILURE");
    expect(auditSession).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/106000033|1042000000/);
  });
});
