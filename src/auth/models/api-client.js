import Boom from "@hapi/boom";
import { AccessToken, isClientName, refusal } from "./access-token.js";

const assertClientName = (clientId) => {
  if (!isClientName(clientId)) {
    throw refusal(
      Boom.badRequest(
        "A client name is up to 64 lowercase letters, digits and hyphens",
      ),
      "API_CLIENT_INVALID_NAME",
    );
  }
};

const hasActive = (active) => {
  const error = refusal(
    Boom.conflict("The client already has active tokens"),
    "HAS_ACTIVE",
  );

  error.output.payload.active = active;

  return error;
};

// A view over the token rows that share a name. It is never stored, so a rule
// across rows (an existing name, an active token) is checked, not guaranteed.
export class ApiClient {
  constructor(clientId, tokens) {
    this.clientId = clientId;
    this.tokens = tokens;
  }

  // Only rows that name this client by the name rule are its own.
  static fromTokens(clientId, documents) {
    return new ApiClient(
      clientId,
      documents
        .map(AccessToken.fromDocument)
        .filter((token) => token.clientId === clientId),
    );
  }

  // Any row names a client, a revoked one included, so a name with none is a
  // new client. Issuing beside an active token is a choice the operator
  // confirms.
  issueToken({ tokenHash, tokenHint, expiresAt, confirmed = true, by, now }) {
    assertClientName(this.clientId);
    this.assertNoneActive(confirmed, now);

    return {
      newClient: this.tokens.length === 0,
      token: AccessToken.issue({
        clientId: this.clientId,
        tokenHash,
        tokenHint,
        expiresAt,
        by,
        now,
      }),
    };
  }

  assertNoneActive(confirmed, now) {
    const active = this.tokens.filter((token) => token.isActive(now)).length;

    if (active > 0 && !confirmed) {
      throw hasActive(active);
    }
  }
}
