import Boom from "@hapi/boom";
import { existsByGrantCode } from "../repositories/config-version.repository.js";
import { findByCode } from "../repositories/grant.repository.js";

export const assertGrantExists = async (grantCode) => {
  const legacyGrant = await findByCode(grantCode);

  if (legacyGrant || (await existsByGrantCode(grantCode))) {
    return;
  }

  throw Boom.notFound(`Grant with code "${grantCode}" not found`);
};
