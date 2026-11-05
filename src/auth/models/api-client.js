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

const clientExists = () =>
  refusal(
    Boom.conflict("A client with this name already exists"),
    "API_CLIENT_EXISTS",
  );

const clientNotFound = () =>
  refusal(Boom.notFound("No such client"), "API_CLIENT_NOT_FOUND");

// A view over the token rows that share a name. It is never stored, so a rule
// across rows (an existing name) is checked, not guaranteed.
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

  issueToken({ tokenHash, tokenHint, expiresAt, newClient, by, now }) {
    assertClientName(this.clientId);
    this.assertExistence(newClient);

    return AccessToken.issue({
      clientId: this.clientId,
      tokenHash,
      tokenHint,
      expiresAt,
      by,
      now,
    });
  }

  // Any row names a client, a revoked one included. Issuing to an existing
  // client needs one, and creating a client needs none.
  assertExistence(newClient) {
    if (Boolean(newClient) === this.tokens.length > 0) {
      throw newClient ? clientExists() : clientNotFound();
    }
  }
}
