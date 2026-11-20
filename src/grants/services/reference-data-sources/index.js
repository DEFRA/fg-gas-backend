import { ReferenceDataSourceType } from "../../models/reference-data-declaration.js";
import { loadDbReferenceData } from "./db.source.js";
import { loadEndpointReferenceData } from "./endpoint.source.js";
import { loadInlineReferenceData } from "./inline.source.js";

const sources = {
  [ReferenceDataSourceType.Inline]: loadInlineReferenceData,
  [ReferenceDataSourceType.Db]: loadDbReferenceData,
  [ReferenceDataSourceType.Endpoint]: loadEndpointReferenceData,
};

// Every source answers with a ReferenceDataSet, so callers never branch on
// where the items live.
export const loadReferenceDataSet = (grant, declaration) =>
  sources[declaration.type]({ grant, declaration });
