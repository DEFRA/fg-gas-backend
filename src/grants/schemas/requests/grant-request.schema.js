import Joi from "joi";
import { action } from "../grant/action/action.js";
import { externalStatusMap } from "../grant/external-status-map.js";
import { description } from "../grant/metadata/description.js";
import { startDate } from "../grant/metadata/start-date.js";
import { phases } from "../grant/phases.js";

export const grantRequestSchema = Joi.object({
  metadata: Joi.object({
    description,
    startDate,
  }).label("Metadata"),
  actions: Joi.array().items(action).unique("name").max(20).label("Actions"),
  phases,
  amendablePositions: Joi.array().items(Joi.string()),
  externalStatusMap: externalStatusMap.optional(),
});
