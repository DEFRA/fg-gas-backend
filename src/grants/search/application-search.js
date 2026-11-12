import { defineSearchSource } from "../../common/search/source.js";
import { findCurrentSearches } from "../repositories/grant.repository.js";
import { applicationViewOf } from "./application-view.js";

export const APPLICATION_SEARCH = "application_search";

export const applicationSearch = defineSearchSource({
  collection: APPLICATION_SEARCH,
  records: "applications",
  lead: "code",
  projection: { phases: 1 },
  viewOf: applicationViewOf,
  listDeclarations: findCurrentSearches,
});
