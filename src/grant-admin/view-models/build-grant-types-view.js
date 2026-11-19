const toGrantType = ({ code, description }) => ({ code, name: description });

/** The Grant Types screen's view: one row per grant the operator administers. */
export const buildGrantTypesView = ({ grants }) => ({
  grantTypes: grants.map(toGrantType),
});
