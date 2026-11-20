import { DbReferenceData } from "../models/db-reference-data.js";
import { ReferenceDataSourceType } from "../models/reference-data-declaration.js";
import { findByGrantCode } from "../repositories/reference-data.repository.js";
import { loadReferenceDataSet } from "../services/reference-data-sources/index.js";
import { resolveAndFetchGrant } from "../services/resolve-config-version.service.js";
import { findReferenceDataDeclaration } from "./get-reference-data.use-case.js";
import { resolveGrantAdministration } from "./resolve-grant-administration.use-case.js";

const byName = (items) => new Map(items.map((item) => [item.name, item]));

const itemsOf = (set) => set.items.map((item) => item.toJSON());

const summaryOf = (declaration) => ({
  name: declaration.name,
  source: declaration.type,
  editable: declaration.isHeldInDb,
});

const resolveAdministeredGrant = async (args) => {
  await resolveGrantAdministration(args);
  const { grant } = await resolveAndFetchGrant(args.grantCode);

  return grant;
};

// What the admin page shows of one set without calling another service: the
// items GAS already has, or for an endpoint set only which service it names.
const listedSet = (grant, held) => (declaration) => {
  if (declaration.type === ReferenceDataSourceType.Endpoint) {
    const { endpoint } = grant.referenceDataCallFor(declaration);
    return { ...summaryOf(declaration), service: endpoint.service };
  }

  const set =
    declaration.type === ReferenceDataSourceType.Inline
      ? declaration.inlineSet
      : (held.get(declaration.name) ??
        DbReferenceData.empty(grant.code, declaration.name));

  return { ...summaryOf(declaration), items: itemsOf(set) };
};

// Every set the grant's current version declares. An endpoint set's items are
// fetched only when someone asks for that set, so this page never waits on, or
// fails with, another service.
export const listGrantReferenceDataUseCase = async (args) => {
  const grant = await resolveAdministeredGrant(args);
  const held = byName(await findByGrantCode(grant.code));

  return {
    grantCode: grant.code,
    referenceData: grant.referenceData.map(listedSet(grant, held)),
  };
};

// One set's current items, from whichever source it names - for an endpoint
// set, fetched now.
export const viewGrantReferenceDataUseCase = async (args) => {
  const grant = await resolveAdministeredGrant(args);
  const declaration = findReferenceDataDeclaration(grant, args.name);
  const set = await loadReferenceDataSet(grant, declaration);

  return {
    ...summaryOf(declaration),
    ...(declaration.isFromEndpoint && {
      service: grant.referenceDataCallFor(declaration).endpoint.service,
    }),
    items: itemsOf(set),
  };
};
