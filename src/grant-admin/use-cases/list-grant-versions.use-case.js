import { findConfigVersions } from "../../grants/services/config-version.service.js";
import { grantNotFound } from "../services/grant-not-found.js";

// Not audited: it releases only what the unaudited Grants list already shows.
export const listGrantVersionsUseCase = async ({ code }) => {
  const versions = await findConfigVersions(code);

  if (!versions) {
    throw grantNotFound();
  }

  return versions;
};
