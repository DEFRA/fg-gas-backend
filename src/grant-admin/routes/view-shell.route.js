import { shellResponseSchema } from "../schemas/shell.schema.js";
import { readShell } from "../services/shell-cache.js";
import { safeResponseFailAction } from "../services/safe-fail-action.js";

const LABEL = "View shell";

// For a page that needs nothing else; every other page's answer carries it.
export const viewShellRoute = {
  method: "GET",
  path: "/grant-admin/shell",
  options: {
    description:
      "Admin: the catalogue the admin draws its pages around, as every tagged answer carries it in `shell`; kept for 60 seconds, a missing part for 10",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    response: {
      schema: shellResponseSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  handler: async () => ({ shell: await readShell() }),
};
