import { config } from "../../common/config.js";
import {
  applicationRefsOf,
  caseRefsOf,
  configRefsOf,
} from "../../events/case-refs.js";
import { INBOX, defineEventType } from "../../events/event-types.js";

export const caseStatusUpdated = defineEventType({
  name: "CaseStatusUpdated",
  sentAs: `cloud.defra.${config.cdpEnvironment}.fg-cw-backend.case.status.updated`,
  boxes: [INBOX],
  refs: ({ data }) => {
    const { workflowCode, caseRef } = data ?? {};

    return [
      ...caseRefsOf(workflowCode, caseRef),
      ...applicationRefsOf(workflowCode, caseRef),
    ];
  },
});

export const configVersionUpdated = defineEventType({
  name: "ConfigVersionUpdated",
  sentAs: "config-version.updated",
  boxes: [INBOX],
  refs: ({ data }) => configRefsOf(data?.grantCode, data?.version),
});

export const CASE_STATUS_UPDATED_EVENT_TYPE = caseStatusUpdated.sentAs;
export const CONFIG_VERSION_UPDATED_EVENT_TYPE = configVersionUpdated.sentAs;
