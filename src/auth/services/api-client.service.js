import Boom from "@hapi/boom";
import { AccessToken, KEEP_OLD, refusal } from "../models/access-token.js";
import { ApiClient } from "../models/api-client.js";
import {
  changeTokenExpiry,
  deleteToken,
  findAllTokens,
  findCallerTokenId,
  findClientToken,
  findClientTokens,
  insertToken,
  revokeToken,
  shortenRotatedToken,
} from "../repositories/access-token.repository.js";

export { HASH_RUN, MASKED_HASH } from "../models/masked-hash.js";

const tokenNotFound = () =>
  refusal(Boom.notFound("No such token"), "API_TOKEN_NOT_FOUND");

const isSameRow = (id, token) => Boolean(id?.equals(token._id));

// Every row, nameless ones included, so the page shows every token that can
// call GAS, each with the row as stored and its hash masked.
export const listApiTokens = async ({ callerHash }) => {
  const [listed, callerTokenId] = await Promise.all([
    findAllTokens(),
    findCallerTokenId(callerHash),
  ]);

  return {
    tokens: listed.map(({ token, stored }) => ({
      ...token.toView({ inUse: isSameRow(callerTokenId, token) }),
      stored,
    })),
  };
};

export const issueApiToken = async (
  { clientId, tokenHash, tokenHint, expiresAt, newClient, by },
  session,
) => {
  const client = ApiClient.fromTokens(
    clientId,
    await findClientTokens(clientId, session),
  );
  const token = client.issueToken({
    tokenHash,
    tokenHint,
    expiresAt,
    newClient,
    by,
    now: new Date(),
  });

  token._id = await insertToken(token.toDocument(), session);

  return { token: token.toView({ inUse: false }) };
};

// A row is reached only under the name it holds by the name rule, so no
// nameless row can be revoked here.
const readToken = async (clientId, tokenId, session) => {
  const document = await findClientToken(clientId, tokenId, session);
  const token = document && AccessToken.fromDocument(document);

  if (token?.clientId !== clientId) {
    throw tokenNotFound();
  }

  return token;
};

export const revokeApiToken = async (
  { clientId, tokenId, callerHash, by },
  session,
) => {
  const token = await readToken(clientId, tokenId, session);
  const callerTokenId = await findCallerTokenId(callerHash, session);
  const loadedExpiresAt = token.expiresAt;

  token.revoke({
    by,
    now: new Date(),
    callerToken: isSameRow(callerTokenId, token),
  });

  const revoked = await revokeToken(
    { clientId, tokenId, callerHash, loadedExpiresAt, token },
    session,
  );

  if (!revoked) {
    throw refusal(
      Boom.conflict("The token changed before it could be revoked"),
      "API_TOKEN_NOT_ACTIVE",
    );
  }
};

const loadedOf = ({ expiresAt, revokedAt }) => ({ expiresAt, revokedAt });

// The token, and whether it is the one the request calls with.
const readOwnToken = async ({ clientId, tokenId, callerHash }, session) => {
  const token = await readToken(clientId, tokenId, session);
  const callerTokenId = await findCallerTokenId(callerHash, session);

  return { token, callerToken: isSameRow(callerTokenId, token) };
};

export const changeApiTokenExpiry = async (
  { clientId, tokenId, callerHash, expiresAt },
  session,
) => {
  const { token, callerToken } = await readOwnToken(
    { clientId, tokenId, callerHash },
    session,
  );
  const loaded = loadedOf(token);
  const change = token.changeExpiry({
    expiresAt,
    now: new Date(),
    callerToken,
  });

  if (
    !(await changeTokenExpiry({ clientId, tokenId, loaded, token }, session))
  ) {
    throw refusal(
      Boom.conflict("The token changed before its expiry could be set"),
      "API_TOKEN_NOT_ACTIVE",
    );
  }

  return { token: token.toView({ inUse: callerToken }), ...change };
};

// The old token is shortened before the new one is written, so a rotate that
// loses a race with a revoke writes nothing.
export const rotateApiToken = async (
  { clientId, tokenId, callerHash, tokenHash, tokenHint, keepOld, by },
  session,
) => {
  const { token, callerToken } = await readOwnToken(
    { clientId, tokenId, callerHash },
    session,
  );
  const loaded = loadedOf(token);
  const successor = token.rotate({
    tokenHash,
    tokenHint,
    keepOld,
    by,
    now: new Date(),
    callerToken,
  });

  const shortened = await shortenRotatedToken(
    {
      clientId,
      tokenId,
      loaded,
      token,
      callerHash,
      immediately: KEEP_OLD[keepOld] === 0,
    },
    session,
  );

  if (!shortened) {
    throw refusal(
      Boom.conflict("The token changed before it could be rotated"),
      "API_TOKEN_NOT_ACTIVE",
    );
  }

  successor._id = await insertToken(successor.toDocument(), session);

  return {
    token: successor.toView({ inUse: false }),
    oldExpiresAt: token.expiresAt,
  };
};

// A client whose last row goes simply stops existing, so its name is free.
export const deleteApiToken = async ({ clientId, tokenId }, session) => {
  const now = new Date();
  const token = await readToken(clientId, tokenId, session);
  token.assertDeletable(now);

  if (!(await deleteToken({ clientId, tokenId, now }, session))) {
    (await readToken(clientId, tokenId, session)).assertDeletable(now);
    throw refusal(
      Boom.conflict("The token changed before it could be deleted"),
      "API_TOKEN_ACTIVE",
    );
  }
};
