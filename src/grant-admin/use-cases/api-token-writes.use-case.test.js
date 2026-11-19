import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueApiToken,
  revokeApiToken,
} from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  issueCwApiToken,
  revokeCwApiToken,
} from "../repositories/cw-clients.repository.js";
import { issueApiTokenUseCase } from "./issue-api-token.use-case.js";
import { listApiTokensUseCase } from "./list-api-tokens.use-case.js";
import { revokeApiTokenUseCase } from "./revoke-api-token.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/cw-clients.repository.js");
vi.mock("./list-api-tokens.use-case.js");
vi.mock("../../auth/services/api-client.service.js", async (original) => ({
  ...(await original()),
  issueApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

const SESSION = { id: "the-transaction" };
const HASH = "d".repeat(64);
const CALLER_HASH = "c".repeat(64);
const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
const ENCODED_ACTOR = "UTF-8''%C5%81ukasz";

const issued = { token: { tokenId: TOKEN_ID, inUse: false }, newClient: true };
const LISTED = [{ tokenId: TOKEN_ID, status: "ACTIVE" }];

const refusal = (boom, errorCode) => {
  boom.output.payload.errorCode = errorCode;
  return boom;
};

const lastAudit = () => writeAuditEvent.mock.calls.at(-1)[0];

const everyLogLine = () =>
  JSON.stringify(
    ["debug", "info", "warn", "error"].map((level) => logger[level].mock.calls),
  );

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
  listApiTokensUseCase.mockImplementation(async ({ service }) => ({
    service,
    tokens: LISTED,
  }));
});

describe("issueApiTokenUseCase", () => {
  const params = (overrides = {}) => ({
    service: "gas",
    clientId: "grants-ui",
    tokenHash: HASH,
    tokenHint: "wxyz",
    expiresAt: null,
    confirmed: true,
    caller: "fg-grants-platform-admin",
    callerHash: CALLER_HASH,
    actor: "Ann Operator",
    ...overrides,
  });

  it("issues a GAS token and its audit event in one transaction", async () => {
    issueApiToken.mockResolvedValue(issued);

    expect(await issueApiTokenUseCase(params())).toEqual({
      service: "gas",
      ...issued,
      tokens: LISTED,
    });
    expect(issueApiToken).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenHash: HASH,
        tokenHint: "wxyz",
        expiresAt: null,
        confirmed: true,
        by: "Ann Operator",
      },
      SESSION,
    );
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
      SESSION,
    );
    expect(lastAudit()).toMatchObject({
      entities: [
        {
          entity: "API_CLIENT",
          action: "ISSUE_API_TOKEN",
          entityid: "grants-ui",
        },
      ],
      details: {
        service: "gas",
        tokenId: TOKEN_ID,
        newClient: true,
        confirmed: true,
        caller: "fg-grants-platform-admin",
        actor: "Ann Operator",
      },
      security: { pmccode: "0705" },
    });
  });

  it("reads the list after the issue commits, as the page reads it", async () => {
    issueApiToken.mockResolvedValue(issued);

    await issueApiTokenUseCase(params());

    expect(listApiTokensUseCase).toHaveBeenCalledWith({
      service: "gas",
      caller: "fg-grants-platform-admin",
      callerHash: CALLER_HASH,
      actor: "Ann Operator",
      encodedActor: undefined,
    });
    expect(withTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      listApiTokensUseCase.mock.invocationCallOrder[0],
    );
  });

  it("answers null tokens when the list cannot be read after the issue", async () => {
    issueApiToken.mockResolvedValue(issued);
    listApiTokensUseCase.mockRejectedValue(Boom.badGateway());

    expect((await issueApiTokenUseCase(params())).tokens).toBeNull();
  });

  it("refuses an unconfirmed issue beside active tokens with HAS_ACTIVE, the count and the list", async () => {
    const hasActive = refusal(Boom.conflict("has active"), "HAS_ACTIVE");
    hasActive.output.payload.active = 2;
    issueApiToken.mockRejectedValue(hasActive);

    const error = await issueApiTokenUseCase(
      params({ confirmed: false }),
    ).catch((e) => e);

    expect(error.output.statusCode).toBe(409);
    expect(error.output.payload).toMatchObject({
      code: "HAS_ACTIVE",
      errorCode: "HAS_ACTIVE",
      active: 2,
      tokens: LISTED,
    });
    expect(lastAudit()).toMatchObject({
      status: "failure",
      details: { errorCode: "HAS_ACTIVE", confirmed: false },
    });
  });

  it("records whether Caseworking created the client, as it answers", async () => {
    issueCwApiToken.mockResolvedValue({ ...issued, newClient: false });

    await issueApiTokenUseCase(params({ service: "cw" }));

    expect(lastAudit().details.newClient).toBe(false);
  });

  it("records a refusal by its code alone, and no hash", async () => {
    issueApiToken.mockRejectedValue(
      refusal(Boom.conflict(`quotes ${HASH}`), "API_TOKEN_DUPLICATE"),
    );

    await expect(issueApiTokenUseCase(params())).rejects.toThrow();

    expect(lastAudit().status).toBe("failure");
    expect(lastAudit().details.errorCode).toBe("API_TOKEN_DUPLICATE");
    expect(JSON.stringify(writeAuditEvent.mock.calls)).not.toContain(HASH);
    expect(JSON.stringify(writeAuditEvent.mock.calls)).not.toContain(
      CALLER_HASH,
    );
    expect(everyLogLine()).not.toContain(HASH);
    expect(everyLogLine()).not.toContain(CALLER_HASH);
  });

  it("forwards a Caseworking token with no transaction", async () => {
    issueCwApiToken.mockResolvedValue(issued);

    await issueApiTokenUseCase(params({ service: "cw" }));

    expect(withTransaction).not.toHaveBeenCalled();
  });

  // A header cannot carry "Ł", so Caseworking gets the name as it was sent.
  it("names a non-ASCII operator to Caseworking encoded, and to the audit decoded", async () => {
    issueCwApiToken.mockResolvedValue(issued);

    await issueApiTokenUseCase(
      params({ service: "cw", actor: "Łukasz", encodedActor: ENCODED_ACTOR }),
    );

    expect(issueCwApiToken).toHaveBeenCalledWith(
      "grants-ui",
      { tokenHash: HASH, tokenHint: "wxyz", expiresAt: null, confirmed: true },
      { actor: ENCODED_ACTOR },
    );
    expect(lastAudit().details.actor).toBe("Łukasz");
  });

  it("leaves Caseworking's rules to Caseworking, and audits its refusal", async () => {
    issueCwApiToken.mockRejectedValue(
      refusal(Boom.badRequest("refused"), "API_CLIENT_INVALID_NAME"),
    );

    const error = await issueApiTokenUseCase(
      params({ service: "cw", clientId: "Bad Name" }),
    ).catch((e) => e);

    expect(error.output.statusCode).toBe(400);
    expect(error.output.payload).toMatchObject({
      code: "API_CLIENT_INVALID_NAME",
      tokens: LISTED,
    });
    expect(issueCwApiToken).toHaveBeenCalled();
    expect(lastAudit().details.errorCode).toBe("API_CLIENT_INVALID_NAME");
  });

  it("records an unanswered Caseworking issue as timed out", async () => {
    issueCwApiToken.mockRejectedValue(Boom.gatewayTimeout());

    await expect(
      issueApiTokenUseCase(params({ service: "cw" })),
    ).rejects.toThrow();

    expect(lastAudit().details.errorCode).toBe("TIMED_OUT");
  });

  it("answers a refusal with null tokens when the list cannot be read either", async () => {
    issueCwApiToken.mockRejectedValue(Boom.gatewayTimeout());
    listApiTokensUseCase.mockRejectedValue(Boom.gatewayTimeout());

    const error = await issueApiTokenUseCase(params({ service: "cw" })).catch(
      (e) => e,
    );

    expect(error.output.payload).toMatchObject({ code: null, tokens: null });
  });
});

describe("revokeApiTokenUseCase", () => {
  const params = (overrides = {}) => ({
    service: "gas",
    clientId: "fg-grants-platform-admin",
    tokenId: TOKEN_ID,
    caller: "fg-grants-platform-admin",
    callerHash: CALLER_HASH,
    actor: "Ann Operator",
    ...overrides,
  });

  it("revokes a GAS token with the caller's hash, in one transaction", async () => {
    revokeApiToken.mockResolvedValue(undefined);

    await revokeApiTokenUseCase(params());

    expect(revokeApiToken).toHaveBeenCalledWith(
      {
        clientId: "fg-grants-platform-admin",
        tokenId: TOKEN_ID,
        callerHash: CALLER_HASH,
        by: "Ann Operator",
      },
      SESSION,
    );
    expect(lastAudit()).toMatchObject({
      status: "success",
      entities: [{ action: "REVOKE_API_TOKEN" }],
      details: { service: "gas", tokenId: TOKEN_ID },
      security: { pmccode: "0705" },
    });
  });

  it.each([
    ["gas", revokeApiToken],
    ["cw", revokeCwApiToken],
  ])(
    "audits the %s caller-token refusal as a FAILURE, with no hash",
    async (service, revoke) => {
      revoke.mockRejectedValue(
        refusal(Boom.conflict("in use"), "API_TOKEN_IN_USE"),
      );

      const error = await revokeApiTokenUseCase(params({ service })).catch(
        (e) => e,
      );

      expect(error.output.statusCode).toBe(409);
      expect(error.output.payload).toMatchObject({
        code: "API_TOKEN_IN_USE",
        tokens: LISTED,
      });
      expect(lastAudit()).toMatchObject({
        status: "failure",
        details: { service, tokenId: TOKEN_ID, errorCode: "API_TOKEN_IN_USE" },
      });
      expect(JSON.stringify(writeAuditEvent.mock.calls)).not.toContain(
        CALLER_HASH,
      );
    },
  );

  it("never sends the caller's hash to Caseworking, and names the operator encoded", async () => {
    await revokeApiTokenUseCase(
      params({ service: "cw", actor: "Łukasz", encodedActor: ENCODED_ACTOR }),
    );

    expect(revokeCwApiToken).toHaveBeenCalledWith(
      "fg-grants-platform-admin",
      TOKEN_ID,
      { actor: ENCODED_ACTOR },
    );
    expect(lastAudit().details.actor).toBe("Łukasz");
  });
});
