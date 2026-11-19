import { SHELL_ALWAYS, answersShell } from "./shell-tag.js";
import { safeFailAction, safeResponseFailAction } from "./safe-fail-action.js";

// What every record page tab route shares: never cached, and refusals logged
// by path and type only, and the catalogue answered beside them.
export const recordPageRouteOptions = ({
  description,
  label,
  params,
  headers,
  response,
  shell = SHELL_ALWAYS,
}) => ({
  description,
  ...answersShell(shell),
  tags: ["api"],
  cache: { otherwise: "no-store" },
  validate: { params, headers, failAction: safeFailAction(label) },
  response: { schema: response, failAction: safeResponseFailAction(label) },
});
