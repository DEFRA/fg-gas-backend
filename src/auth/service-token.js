export const GRANT_ADMIN_CLIENT = "fg-grants-platform-admin";

export const getServiceIdentity = (record) => {
  if (record.identityMigrationPending === true) return record.clientId;

  // Old writers and replica lag can expose records before the backfill.
  return typeof record.client === "string" && record.client.trim() !== ""
    ? record.client
    : record.clientId;
};

export const hasGrantAdminAccess = (record) =>
  // Older instances can still issue records without the permission snapshot
  // during rollout. Preserve their exact guard until those writers are gone.
  typeof record.grantAdminAccess === "boolean"
    ? record.grantAdminAccess
    : record.clientId === GRANT_ADMIN_CLIENT;
