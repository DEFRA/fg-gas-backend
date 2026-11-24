import { findAdministeredGrants } from "../../grants/services/config-version.service.js";
import { adminReadHeadersSchema } from "../schemas/actor-header.schema.js";
import { homeViewSchema } from "../schemas/home-view.schema.js";
import { findOperatorRoles } from "../services/operator-roles.js";
import {
  safeFailAction,
  safeResponseFailAction,
} from "../services/safe-fail-action.js";
import { buildHomeView } from "../view-models/build-home-view.js";

const LABEL = "View home";

export const viewHomeRoute = {
  method: "GET",
  path: "/grant-admin/home",
  options: {
    description:
      "Admin: the Manage grants home page, with how many grant types the operator administers",
    tags: ["api"],
    cache: { otherwise: "no-store" },
    validate: {
      headers: adminReadHeadersSchema,
      failAction: safeFailAction(LABEL),
    },
    response: {
      schema: homeViewSchema,
      failAction: safeResponseFailAction(LABEL),
    },
  },
  async handler() {
    const grants = await findAdministeredGrants({
      findUserRoles: findOperatorRoles,
    });

    return buildHomeView({ grants });
  },
};
