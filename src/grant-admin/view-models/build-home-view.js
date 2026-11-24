/** The Manage grants home screen's view: how many grant types the operator administers. */
export const buildHomeView = ({ grants }) => ({
  grantTypeCount: grants.length,
});
