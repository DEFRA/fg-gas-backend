// The admin's answer as its route's schema checks it, before the shell is added.
export const withoutShell = ({ shell: _shell, ...answer }) => answer;
