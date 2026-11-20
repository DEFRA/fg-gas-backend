import { DbReferenceData } from "../models/db-reference-data.js";
import { findByGrantCode } from "../repositories/reference-data.repository.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

const byName = (items) => new Map(items.map((item) => [item.name, item]));

// Every set the grant's current version declares, and for a db one how many
// items GAS holds - the only kind an operator can change.
export const listGrantReferenceDataUseCase = async (args) => {
  await resolveGrantAdministration(args);
  const { grantCode } = args;
  const { grant } = await resolveAndFetchGrant(grantCode);
  const held = byName(await findByGrantCode(grantCode));

  return {
    grantCode,
    referenceData: grant.referenceData.map((declaration) => ({
      name: declaration.name,
      source: declaration.type,
      editable: declaration.isHeldInDb,
      ...(declaration.isHeldInDb && {
        itemCount: (
          held.get(declaration.name) ??
          DbReferenceData.empty(grantCode, declaration.name)
        ).items.length,
      }),
    })),
  };
};
