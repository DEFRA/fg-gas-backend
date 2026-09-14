// The authenticated service client behind a request, recorded on the audit
// event alongside the service/box/id. Null only if the strategy ever stops
// populating credentials. Shared by every grant-admin route that attributes a
// read or a mutation, so they can never derive the caller differently.
export const callerOf = (request) => request.auth?.credentials?.service ?? null;
