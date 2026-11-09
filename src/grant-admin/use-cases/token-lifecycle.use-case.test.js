import Boom from "@hapi/boom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeApiTokenExpiry,
  deleteApiToken,
  rotateApiToken,
} from "../../auth/services/api-client.service.js";
import { logger } from "../../common/logger.js";
import { withTransaction } from "../../common/with-transaction.js";
import { writeAuditEvent } from "../../events/write-audit-event.js";
import {
  changeCwApiTokenExpiry,
  deleteCwApiToken,
  rotateCwApiToken,
} from "../repositories/cw-clients.repository.js";
import { changeApiTokenExpiryUseCase } from "./change-api-token-expiry.use-case.js";
import { deleteApiTokenUseCase } from "./delete-api-token.use-case.js";
import { rotateApiTokenUseCase } from "./rotate-api-token.use-case.js";

vi.mock("../../common/logger.js");
vi.mock("../../common/mongo-client.js");
vi.mock("../../common/with-transaction.js");
vi.mock("../../events/write-audit-event.js");
vi.mock("../repositories/cw-clients.repository.js");
vi.mock("../../auth/services/api-client.service.js");

const SESSION = { id: "the-transaction" };
const HASH = "d".repeat(64);
const CALLER_HASH = "c".repeat(64);
const TOKEN_ID = "6650c1f2a9e4b1d07c20bd91";
const NEW_TOKEN_ID = "6650c1f2a9e4b1d07c20bd92";
const LATER = new Date("2027-01-01T00:00:00.000Z");
const SOON = new Date("2026-11-05T10:00:00.000Z");
const ENCODED_ACTOR = "UTF-8''%C5%81ukasz";

const params = (overrides = {}) => ({
  service: "gas",
  clientId: "grants-ui",
  tokenId: TOKEN_ID,
  caller: "fg-grants-platform-admin",
  callerHash: CALLER_HASH,
  actor: "Łukasz",
  encodedActor: ENCODED_ACTOR,
  ...overrides,
});

const lastAudit = () => writeAuditEvent.mock.calls.at(-1)[0];

const nothingSecret = () => {
  const written = JSON.stringify([
    writeAuditEvent.mock.calls,
    logger.info.mock.calls,
  ]);
  expect(written).not.toContain(HASH);
  expect(written).not.toContain(CALLER_HASH);
  expect(written).not.toContain("wxyz");
};

beforeEach(() => {
  withTransaction.mockImplementation(async (callback) => callback(SESSION));
});

describe("deleteApiTokenUseCase", () => {
  it("deletes a GAS token in one transaction, auditing its id alone", async () => {
    await deleteApiTokenUseCase(params());

    expect(deleteApiToken).toHaveBeenCalledWith(
      { clientId: "grants-ui", tokenId: TOKEN_ID },
      SESSION,
    );
    expect(lastAudit()).toMatchObject({
      status: "success",
      entities: [
        {
          entity: "API_CLIENT",
          action: "DELETE_API_TOKEN",
          entityid: "grants-ui",
        },
      ],
      details: { service: "gas", tokenId: TOKEN_ID },
      security: { pmccode: "0705" },
    });
    nothingSecret();
  });

  it("audits a refusal as a FAILURE by its code", async () => {
    const refusal = Boom.conflict("active");
    refusal.output.payload.errorCode = "API_TOKEN_ACTIVE";
    deleteApiToken.mockRejectedValue(refusal);

    await expect(deleteApiTokenUseCase(params())).rejects.toBe(refusal);

    expect(lastAudit()).toMatchObject({
      status: "failure",
      details: { errorCode: "API_TOKEN_ACTIVE" },
    });
  });

  it("forwards cw with no transaction, naming the operator as sent", async () => {
    await deleteApiTokenUseCase(params({ service: "cw" }));

    expect(withTransaction).not.toHaveBeenCalled();
    expect(deleteCwApiToken).toHaveBeenCalledWith("grants-ui", TOKEN_ID, {
      actor: ENCODED_ACTOR,
    });
  });
});

describe("changeApiTokenExpiryUseCase", () => {
  it("audits the previous and new expiry and the revive", async () => {
    changeApiTokenExpiry.mockResolvedValue({
      token: { tokenId: TOKEN_ID },
      previousExpiresAt: null,
      revived: true,
    });

    expect(
      await changeApiTokenExpiryUseCase(params({ expiresAt: LATER })),
    ).toMatchObject({ service: "gas", token: { tokenId: TOKEN_ID } });
    expect(changeApiTokenExpiry).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenId: TOKEN_ID,
        callerHash: CALLER_HASH,
        expiresAt: LATER,
      },
      SESSION,
    );
    expect(lastAudit()).toMatchObject({
      entities: [{ action: "CHANGE_API_TOKEN_EXPIRY" }],
      details: {
        tokenId: TOKEN_ID,
        expiresAt: LATER.toISOString(),
        previousExpiresAt: "never",
        revived: true,
      },
      security: { pmccode: "0705" },
    });
    nothingSecret();
  });

  it("forwards cw, auditing what Caseworking says it replaced", async () => {
    changeCwApiTokenExpiry.mockResolvedValue({
      token: { tokenId: TOKEN_ID },
      previousExpiresAt: SOON,
      revived: true,
    });

    await changeApiTokenExpiryUseCase(
      params({ service: "cw", expiresAt: null }),
    );

    expect(changeCwApiTokenExpiry).toHaveBeenCalledWith(
      "grants-ui",
      TOKEN_ID,
      { expiresAt: null },
      { actor: ENCODED_ACTOR },
    );
    expect(lastAudit().details).toMatchObject({
      expiresAt: "never",
      previousExpiresAt: SOON.toISOString(),
      revived: true,
    });
  });
});

describe("auditing a refused expiry", () => {
  it("records an expiry that is not a date as it was sent", async () => {
    const refusal = Boom.badRequest("invalid");
    refusal.output.payload.errorCode = "API_TOKEN_INVALID_EXPIRY";
    changeApiTokenExpiry.mockRejectedValue(refusal);

    await expect(
      changeApiTokenExpiryUseCase(params({ expiresAt: "soon" })),
    ).rejects.toBe(refusal);

    expect(lastAudit()).toMatchObject({
      status: "failure",
      entities: [{ action: "CHANGE_API_TOKEN_EXPIRY" }],
      details: { expiresAt: "soon", errorCode: "API_TOKEN_INVALID_EXPIRY" },
    });
  });
});

describe("rotateApiTokenUseCase", () => {
  const rotation = (overrides = {}) =>
    params({
      tokenHash: HASH,
      tokenHint: "wxyz",
      keepOld: "24h",
      ...overrides,
    });

  it("audits the old and new token, the overlap and when the old one stops", async () => {
    rotateApiToken.mockResolvedValue({
      token: { tokenId: NEW_TOKEN_ID },
      oldExpiresAt: SOON,
    });

    expect(await rotateApiTokenUseCase(rotation())).toMatchObject({
      service: "gas",
      token: { tokenId: NEW_TOKEN_ID },
    });
    expect(rotateApiToken).toHaveBeenCalledWith(
      {
        clientId: "grants-ui",
        tokenId: TOKEN_ID,
        callerHash: CALLER_HASH,
        tokenHash: HASH,
        tokenHint: "wxyz",
        keepOld: "24h",
        by: "Łukasz",
      },
      SESSION,
    );
    expect(lastAudit()).toMatchObject({
      entities: [{ action: "ROTATE_API_TOKEN", entityid: "grants-ui" }],
      details: {
        tokenId: TOKEN_ID,
        newTokenId: NEW_TOKEN_ID,
        keepOld: "24h",
        oldExpiresAt: SOON.toISOString(),
      },
      security: { pmccode: "0705" },
    });
    nothingSecret();
  });

  it("audits a refused rotate as a FAILURE, with no hash", async () => {
    const refusal = Boom.conflict("in use");
    refusal.output.payload.errorCode = "API_TOKEN_IN_USE";
    rotateApiToken.mockRejectedValue(refusal);

    await expect(
      rotateApiTokenUseCase(rotation({ keepOld: "none" })),
    ).rejects.toBe(refusal);

    expect(lastAudit()).toMatchObject({
      status: "failure",
      details: { keepOld: "none", errorCode: "API_TOKEN_IN_USE" },
    });
    nothingSecret();
  });

  it("forwards cw with no transaction, auditing when Caseworking says the old one stops", async () => {
    rotateCwApiToken.mockResolvedValue({
      token: { tokenId: NEW_TOKEN_ID },
      oldExpiresAt: SOON,
    });

    await rotateApiTokenUseCase(rotation({ service: "cw" }));

    expect(withTransaction).not.toHaveBeenCalled();
    expect(rotateCwApiToken).toHaveBeenCalledWith(
      "grants-ui",
      TOKEN_ID,
      { tokenHash: HASH, tokenHint: "wxyz", keepOld: "24h" },
      { actor: ENCODED_ACTOR },
    );
    expect(lastAudit().details).toMatchObject({
      newTokenId: NEW_TOKEN_ID,
      oldExpiresAt: SOON.toISOString(),
    });
  });
});
