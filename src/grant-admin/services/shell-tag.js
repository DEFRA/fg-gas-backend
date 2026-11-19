// A route answers the catalogue the admin draws its pages around as `shell`:
// "always" on every answer, "errors" only on a refusal, which the admin
// renders where it would otherwise redirect.
export const SHELL_ALWAYS = "always";
export const SHELL_ERRORS = "errors";

export const SHELL_NOTES = {
  [SHELL_ALWAYS]:
    "Every answer, a refusal or failure too, also carries `shell: { catalogue }` (as GET /grant-admin/shell answers it), or `shell: null` when the catalogue cannot be built.",
  [SHELL_ERRORS]:
    "A refusal or failure also carries `shell: { catalogue }` (as GET /grant-admin/shell answers it), or `shell: null` when the catalogue cannot be built.",
};

// A route with its own budget waits for a cold catalogue only `budgetMs`
// from when it was received, then answers the last one kept, or null.
export const shellPlugins = (mode, budgetMs = null) => ({
  grantAdmin: { shell: mode, shellBudgetMs: budgetMs },
});

export const answersShell = (mode, budgetMs = null) => ({
  notes: SHELL_NOTES[mode],
  plugins: shellPlugins(mode, budgetMs),
});
