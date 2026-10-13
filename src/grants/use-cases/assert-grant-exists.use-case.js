import Boom from "@hapi/boom";
import { existsByGrantCode } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";

const findLegacyGrant = (grantCode, session) =>
  session ? findByCode(grantCode, "0.0.0", session) : findByCode(grantCode);

const existsAsConfigVersion = (grantCode, session) =>
  session
    ? existsByGrantCode(grantCode, session)
    : existsByGrantCode(grantCode);

export const assertGrantExists = async (grantCode, session) => {
  const legacyGrant = await findLegacyGrant(grantCode, session);

  if (legacyGrant || (await existsAsConfigVersion(grantCode, session))) {
    return;
  }

  throw Boom.notFound(`Grant with code "${grantCode}" not found`);
};
