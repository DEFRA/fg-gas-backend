import { isClientName } from "../src/auth/models/access-token.js";
import { logger } from "../src/common/logger.js";
import { ADMIN_CLIENT } from "../src/grant-admin/admin-client.js";

// FGP-1572: every token belongs to a client named by the name rule, so Grant
// Admin can manage it. A name that breaks the rule is normalised; a token with
// none is named after its id. Neither is ever given a name a privileged check
// trusts: a token named so has never passed that check.

// The platform clients: Grant Admin's on GAS, and GAS's own on Caseworking.
const PRIVILEGED = new Set([ADMIN_CLIENT, "fg-gas-backend"]);
const MAX_LENGTH = 64;
// The token id's last characters, as Grant Admin shows it.
const SHORT_ID_LENGTH = 6;

const trimHyphens = (name) => name.replace(/^-+|-+$/g, "");

export const normaliseName = (name) =>
  trimHyphens(
    trimHyphens(
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-"),
    ).slice(0, MAX_LENGTH),
  );

const unnamed = (_id) => `unnamed-${_id.toHexString().slice(-SHORT_ID_LENGTH)}`;

const isNamed = (clientId) =>
  typeof clientId === "string" && clientId.trim() !== "";

const renameOf = ({ _id, clientId }) => {
  if (!isNamed(clientId)) {
    return { name: unnamed(_id), named: true };
  }

  const name = normaliseName(clientId);

  return !isClientName(name) || PRIVILEGED.has(name)
    ? { name: unnamed(_id), named: true }
    : { name, named: false };
};

const renameRow = (row) => ({
  updateOne: {
    filter: { _id: row._id, clientId: row.clientId ?? null },
    update: {
      $set: { clientId: renameOf(row).name, client: renameOf(row).name },
    },
  },
});

const write = async (accessTokens, rows) =>
  rows.length > 0
    ? (await accessTokens.bulkWrite(rows.map(renameRow))).modifiedCount
    : 0;

export const up = async (db) => {
  const accessTokens = db.collection("access_tokens");
  const rows = (
    await accessTokens
      .find({}, { projection: { _id: 1, clientId: 1 } })
      .toArray()
  ).filter(({ clientId }) => !isClientName(clientId));

  const named = await write(
    accessTokens,
    rows.filter((row) => renameOf(row).named),
  );
  const normalised = await write(
    accessTokens,
    rows.filter((row) => !renameOf(row).named),
  );

  logger.info(
    `Named ${named} nameless access tokens, normalised ${normalised} names`,
  );
};
