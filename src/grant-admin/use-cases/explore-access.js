import { mayQuery, rolesOf } from "../explore/access.js";

// Whether the caller may query a source: asked by a query and by the
// vocabulary alike, by the roles GPA names for its user.
export const callerMayQuery = ({ roles }) => {
  const named = rolesOf(roles);

  return (source) => mayQuery(source, named);
};
