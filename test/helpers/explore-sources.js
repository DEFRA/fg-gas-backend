import { agreementsSource } from "../../src/agreements/explore/agreements.source.js";
import {
  clearExploreSources,
  registerExploreSource,
} from "../../src/common/explore-sources/registry.js";
import { eventsSource } from "../../src/events/explore/events.source.js";
import { applicationsSource } from "../../src/grants/explore/applications.source.js";
import { grantsSource } from "../../src/grants/explore/grants.source.js";
import { paymentsSource } from "../../src/payments/explore/payments.source.js";

// GAS's sources, registered as the plugins register them when they start.
export const GAS_EXPLORE_SOURCES = [
  applicationsSource,
  grantsSource,
  agreementsSource,
  paymentsSource,
  eventsSource,
];

export const registerGasExploreSources = () => {
  clearExploreSources();
  GAS_EXPLORE_SOURCES.forEach(registerExploreSource);
};
