import { safeFailAction, safeResponseFailAction } from "./safe-fail-action.js";

// What every record page tab route shares: never cached, and refusals logged
// by path and type only.
export const recordPageRouteOptions = ({
  description,
  label,
  params,
  headers,
  response,
}) => ({
  description,
  tags: ["api"],
  cache: { otherwise: "no-store" },
  validate: { params, headers, failAction: safeFailAction(label) },
  response: { schema: response, failAction: safeResponseFailAction(label) },
});
