import Joi from "joi";
import { action } from "./action/action.js";
import { claims } from "./claims.js";
import { code } from "./code.js";
import { entitlementTemplates } from "./entitlement-template.js";
import { externalStatusMap } from "./external-status-map.js";
import { description } from "./metadata/description.js";
import { startDate } from "./metadata/start-date.js";
import { title } from "./metadata/title.js";
import { pages } from "./pages.js";
import { phases } from "./phases.js";

const MAX_ACTIONS = 20;

// Published definitions write dates as Mongo extended JSON as often as not.
const publishedDate = Joi.alternatives(
  startDate,
  Joi.object({ $date: startDate.required() }),
);

// A published gas.json. Keys the runtime does not read are left alone, so a
// definition can carry more than this service uses.
export const grantDefinition = Joi.object({
  code: code.required(),
  metadata: Joi.object({
    title: title.optional(),
    description: description.required(),
    startDate: publishedDate.required(),
  })
    .unknown()
    .required()
    .label("Metadata"),
  actions: Joi.array()
    .items(action)
    .unique("name")
    .max(MAX_ACTIONS)
    .required()
    .label("Actions"),
  phases,
  amendablePositions: Joi.array().items(Joi.string()).optional(),
  externalStatusMap: externalStatusMap.optional(),
  entitlementTemplates: entitlementTemplates.optional(),
  pages: pages.min(0).optional(),
  claims: claims.optional(),
  admin: Joi.object({ role: Joi.string().trim().required() })
    .unknown(false)
    .optional(),
})
  .unknown()
  .label("GrantDefinition");
