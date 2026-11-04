import Boom from "@hapi/boom";
import { BSON, ObjectId } from "mongodb";
import { config } from "../../common/config.js";
import { db } from "../../common/mongo-client.js";
import { AccessToken, refusal } from "../models/access-token.js";
import { HASH_EDGE, HASH_LENGTH, HASH_MASK } from "../models/masked-hash.js";

const DUPLICATE_KEY = 11000;

const accessTokens = () => db.collection("access_tokens");

// The hash is never loaded on a read path. The primary, so a page read after
// a write shows it.
const readOptions = (session) => ({
  projection: { id: 0 },
  readPreference: "primary",
  maxTimeMS: config.adminReadTimeoutMs,
  session,
});

// Masked by Mongo, so the list loads no more of a hash than it shows.
const maskedHash = {
  $concat: [
    { $substrCP: ["$id", 0, HASH_EDGE] },
    HASH_MASK,
    { $substrCP: ["$id", HASH_LENGTH - HASH_EDGE, HASH_EDGE] },
  ],
};

// Each token with its row as stored, in relaxed Extended JSON as mongosh
// prints it: an ObjectId is `{ $oid }` and a date `{ $date }`. The token never
// holds the masked hash.
export const findAllTokens = async () => {
  const documents = await accessTokens()
    .aggregate([{ $set: { id: maskedHash } }], {
      readPreference: "primary",
      maxTimeMS: config.adminReadTimeoutMs,
    })
    .toArray();

  return documents.map((document) => {
    const { id, ...fields } = document;

    return {
      token: AccessToken.fromDocument(fields),
      stored: BSON.EJSON.serialize(document, { relaxed: true }),
    };
  });
};

export const findClientTokens = (clientId, session) =>
  accessTokens().find({ clientId }, readOptions(session)).toArray();

export const findClientToken = (clientId, tokenId, session) =>
  accessTokens().findOne(
    { _id: new ObjectId(tokenId), clientId },
    readOptions(session),
  );

export const findCallerTokenId = async (callerHash, session) => {
  const row = await accessTokens().findOne(
    { id: callerHash },
    { projection: { _id: 1 }, readPreference: "primary", session },
  );

  return row?._id ?? null;
};

// A duplicate-key message quotes the hash, so none of it is kept.
export const insertToken = async (document, session) => {
  try {
    const { insertedId } = await accessTokens().insertOne(document, {
      session,
    });
    return insertedId;
  } catch (error) {
    if (error.code !== DUPLICATE_KEY) {
      throw error;
    }

    throw refusal(
      Boom.conflict("This token already exists"),
      "API_TOKEN_DUPLICATE",
    );
  }
};

// Only while it can't call, so a concurrent revive or change of expiry is
// never lost.
export const deleteToken = async ({ clientId, tokenId, now }, session) => {
  const { deletedCount } = await accessTokens().deleteOne(
    {
      _id: new ObjectId(tokenId),
      clientId,
      $or: [
        { revokedAt: { $ne: null } },
        { expiresAt: { $type: "date", $lte: now } },
      ],
    },
    { session },
  );

  return deletedCount > 0;
};

// The caller's own token never matches, and the row must still be as it was
// read, so the refusal holds even against a concurrent change.
export const revokeToken = async (
  { clientId, tokenId, callerHash, loadedExpiresAt, token },
  session,
) => {
  const { modifiedCount } = await accessTokens().updateOne(
    {
      _id: new ObjectId(tokenId),
      clientId,
      id: { $ne: callerHash },
      revokedAt: null,
      expiresAt: loadedExpiresAt,
    },
    {
      $set: {
        revokedAt: token.revokedAt,
        revokedBy: token.revokedBy,
        expiresAt: token.expiresAt,
      },
    },
    { session },
  );

  return modifiedCount > 0;
};

// Guarded on the row as it was read, so a concurrent change is refused. A
// write that changes nothing still matched.
const asLoaded = ({ clientId, tokenId, loaded }) => ({
  _id: new ObjectId(tokenId),
  clientId,
  revokedAt: loaded.revokedAt,
  expiresAt: loaded.expiresAt,
});

export const changeTokenExpiry = async (
  { clientId, tokenId, loaded, token },
  session,
) => {
  const { matchedCount } = await accessTokens().updateOne(
    asLoaded({ clientId, tokenId, loaded }),
    {
      $set: { expiresAt: token.expiresAt },
      $unset: { revokedAt: "", revokedBy: "" },
    },
    { session },
  );

  return matchedCount > 0;
};

// The caller's own token never matches when it would stop at once.
export const shortenRotatedToken = async (
  { clientId, tokenId, loaded, token, callerHash, immediately },
  session,
) => {
  const { matchedCount } = await accessTokens().updateOne(
    {
      ...asLoaded({ clientId, tokenId, loaded }),
      ...(immediately && { id: { $ne: callerHash } }),
    },
    { $set: { expiresAt: token.expiresAt } },
    { session },
  );

  return matchedCount > 0;
};
