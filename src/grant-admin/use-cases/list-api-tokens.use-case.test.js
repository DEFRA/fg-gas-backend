import { beforeEach, describe, expect, it, vi } from "vitest";
import { listApiTokens } from "../../auth/services/api-client.service.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import { findCwApiTokens } from "../repositories/cw-clients.repository.js";
import { listApiTokensUseCase } from "./list-api-tokens.use-case.js";

vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/cw-clients.repository.js");
vi.mock("../../auth/services/api-client.service.js");

const CALLER_HASH = "c".repeat(64);
const ENCODED_ACTOR = "UTF-8''%C5%81ukasz";

const reader = {
  caller: "fg-grants-platform-admin",
  callerHash: CALLER_HASH,
  actor: "Łukasz",
  encodedActor: ENCODED_ACTOR,
};

const lastAudit = () => writeAuditEvent.mock.calls.at(-1)[0];

beforeEach(() => {
  withTransaction.mockImplementation(async (operation) => operation({}));
});

describe("listApiTokensUseCase", () => {
  it("answers GAS's rows for gas, marking the caller's, and audits the read", async () => {
    listApiTokens.mockResolvedValue({ tokens: [] });

    expect(await listApiTokensUseCase({ service: "gas", ...reader })).toEqual({
      service: "gas",
      tokens: [],
    });
    expect(listApiTokens).toHaveBeenCalledWith({ callerHash: CALLER_HASH });
    expect(lastAudit()).toMatchObject({
      status: "success",
      entities: [
        { entity: "API_CLIENT", action: "VIEW_API_CLIENT", entityid: "gas" },
      ],
      details: { service: "gas", actor: "Łukasz" },
      security: { pmccode: "0706" },
    });
    expect(JSON.stringify(writeAuditEvent.mock.calls)).not.toContain(
      CALLER_HASH,
    );
  });

  it("forwards cw to Caseworking, naming the operator as sent", async () => {
    const tokens = [
      {
        tokenId: "6650c1f2a9e4b1d07c20bd91",
        status: "REVOKED",
        expiresAt: null,
        inUse: true,
      },
    ];
    findCwApiTokens.mockResolvedValue({ tokens });

    expect(await listApiTokensUseCase({ service: "cw", ...reader })).toEqual({
      service: "cw",
      tokens: [{ ...tokens[0], expiringSoon: false }],
    });
    expect(findCwApiTokens).toHaveBeenCalledWith({ actor: ENCODED_ACTOR });
    expect(listApiTokens).not.toHaveBeenCalled();
    expect(lastAudit().entities[0].entityid).toBe("cw");
  });

  it("says which active tokens expire within 30 days, as the Overview does", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T12:00:00.000Z") });
    const tokenOf = (status, expiresAt) => ({
      tokenId: "6650c1f2a9e4b1d07c20bd91",
      status,
      expiresAt: expiresAt && new Date(expiresAt),
    });
    listApiTokens.mockResolvedValue({
      tokens: [
        tokenOf("ACTIVE", "2026-12-18T11:59:59.999Z"),
        tokenOf("ACTIVE", "2026-12-18T12:00:00.000Z"),
        tokenOf("ACTIVE", "2026-11-17T12:00:00.000Z"),
        tokenOf("ACTIVE", null),
        tokenOf("EXPIRED", "2026-11-17T12:00:00.000Z"),
        tokenOf("REVOKED", "2026-11-20T12:00:00.000Z"),
      ],
    });

    const { tokens } = await listApiTokensUseCase({
      service: "gas",
      ...reader,
    });

    vi.useRealTimers();
    expect(tokens.map(({ expiringSoon }) => expiringSoon)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });
});
