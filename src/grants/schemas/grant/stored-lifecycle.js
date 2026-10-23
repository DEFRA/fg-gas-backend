import Joi from "joi";
import { externalStatusMap } from "./external-status-map.js";
import { phases } from "./phases.js";

// The shape the lifecycle lookups read from a stored grant.
export const storedLifecycle = Joi.object({
  phases,
  externalStatusMap: externalStatusMap.allow(null),
}).label("Stored Lifecycle");
