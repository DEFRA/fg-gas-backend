import { config } from "../../common/config.js";

// FGP-1307: derive the caller's agreement identity (source/code/sbi/clientRef).
//
// When enforcement is on and the forwarded caller token verified (see the auth
// plugin's onPostAuth hook, which stores the result on request.app.callerToken),
// identity comes from the signed token claims. This means forged or omitted
// x-agreement-* headers cannot be used to access another caller's data. When
// enforcement is off (warn-only rollout), or no verified token is present, the
// x-agreement-* headers are used as before for backwards compatibility.

const accessFromToken = (payload = {}) => ({
  source: payload.source,
  code: payload.grantCode,
  sbi: payload.sbi,
  clientRef: payload.clientRef,
});

const accessFromHeaders = (headers) => ({
  source: headers["x-agreement-source"],
  code: headers["x-agreement-code"],
  sbi: headers["x-agreement-sbi"],
  clientRef: headers["x-agreement-client-ref"],
});

export const resolveAgreementAccess = (request) => {
  const result = request.app.callerToken;
  const verified = Boolean(result?.verified);
  if (config.callerToken.enforce && verified) {
    return accessFromToken(result.payload);
  }
  return accessFromHeaders(request.headers);
};
