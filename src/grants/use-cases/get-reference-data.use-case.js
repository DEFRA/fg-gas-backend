import Boom from "@hapi/boom";
import { loadReferenceDataSet } from "../services/reference-data-sources/index.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";

export const findReferenceDataDeclaration = (grant, name) => {
  const declaration = grant.findReferenceData(name);

  if (!declaration) {
    throw Boom.notFound(
      `Grant "${grant.code}" has no reference data named "${name}"`,
    );
  }

  return declaration;
};

// The set as the grant's current version declares it, from whichever source
// that declaration names.
export const getReferenceDataUseCase = async ({ code, name }) => {
  const { grant } = await resolveAndFetchGrant(code);
  const declaration = findReferenceDataDeclaration(grant, name);
  const set = await loadReferenceDataSet(grant, declaration);

  return { ...set.toJSON(), source: declaration.type };
};
