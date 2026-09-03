import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../common/config.js";
import { resolveAgreementAccess } from "./resolve-agreement-access.js";

describe("resolveAgreementAccess (FGP-1307)", () => {
  let savedEnforce;

  const headers = {
    "x-agreement-source": "defra",
    "x-agreement-code": "pigs-might-fly",
    "x-agreement-sbi": "300000000",
    "x-agreement-client-ref": "header-client-ref",
  };

  const buildRequest = (callerToken) => ({
    app: callerToken ? { callerToken } : {},
    headers,
  });

  beforeEach(() => {
    savedEnforce = config.callerToken.enforce;
  });

  afterEach(() => {
    config.callerToken.enforce = savedEnforce;
  });

  it("uses the verified caller token claims when enforcing", () => {
    config.callerToken.enforce = true;
    const request = buildRequest({
      verified: true,
      payload: {
        source: "entra",
        grantCode: "token-grant-code",
        sbi: "111111111",
        clientRef: "token-client-ref",
      },
    });

    expect(resolveAgreementAccess(request)).toEqual({
      source: "entra",
      code: "token-grant-code",
      sbi: "111111111",
      clientRef: "token-client-ref",
    });
  });

  it("falls back to x-agreement-* headers when enforcing but the token is not verified", () => {
    config.callerToken.enforce = true;
    const request = buildRequest({ verified: false, reason: "no-secret" });

    expect(resolveAgreementAccess(request)).toEqual({
      source: "defra",
      code: "pigs-might-fly",
      sbi: "300000000",
      clientRef: "header-client-ref",
    });
  });

  it("uses x-agreement-* headers in warn-only mode even with a verified token", () => {
    config.callerToken.enforce = false;
    const request = buildRequest({
      verified: true,
      payload: { source: "entra", grantCode: "token-grant-code" },
    });

    expect(resolveAgreementAccess(request)).toEqual({
      source: "defra",
      code: "pigs-might-fly",
      sbi: "300000000",
      clientRef: "header-client-ref",
    });
  });

  it("falls back to headers when no caller token is present", () => {
    config.callerToken.enforce = true;
    const request = buildRequest(undefined);

    expect(resolveAgreementAccess(request)).toEqual({
      source: "defra",
      code: "pigs-might-fly",
      sbi: "300000000",
      clientRef: "header-client-ref",
    });
  });
});
