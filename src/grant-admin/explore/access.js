// A source that needs a role is read only for a caller who names it; with no
// roles named, only a source open to any admin caller is.
export const mayQuery = ({ requires = null }, roles) =>
  requires === null || (roles !== null && roles.includes(requires));

// The roles a header names, or null for none.
export const rolesOf = (header) =>
  typeof header === "string"
    ? header
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean)
    : null;
