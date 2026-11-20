import { DbReferenceData } from "../../models/db-reference-data.js";
import { findByGrantCodeAndName } from "../../repositories/reference-data.repository.js";

// A db set nobody has added items to yet is empty, not missing: the grant
// declares it, so it exists.
export const loadDbReferenceData = async ({ grant, declaration }) => {
  const referenceData =
    (await findByGrantCodeAndName(grant.code, declaration.name)) ??
    DbReferenceData.empty(grant.code, declaration.name);

  return referenceData.toSet();
};
