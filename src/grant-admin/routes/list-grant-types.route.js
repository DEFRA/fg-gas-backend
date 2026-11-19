import { findAdministeredGrants } from "../../grants/services/config-version.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { grantTypesViewSchema } from "../schemas/grant-types-view.schema.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { buildGrantTypesView } from "../view-models/build-grant-types-view.js";

const LABEL = "List grant types";

export const listGrantTypesRoute = {
  method: "GET",
  path: "/grant-admin/grants",
  options: {
    description: "Admin: the current grant types the operator administers",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminReadHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: grantTypesViewSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  async handler() {
    const grants = await findAdministeredGrants({
      findUserRoles: findOperatorRoles,
    });

    return buildGrantTypesView({ grants });
  },
};
