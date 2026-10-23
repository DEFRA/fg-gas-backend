export const auditEntities = {
  GRANT: "GRANT",
  APPLICATION: "APPLICATION",
  AGREEMENT: "AGREEMENT",
  ENTITLEMENT: "ENTITLEMENT",
  CLAIM: "CLAIM",
  // one inbox/outbox row, either service. Admin-only: the event list and
  // detail views are audited because the detail view returns event payloads
  // and redrive, purge and payload edits change state.
  EVENT: "EVENT",
  // A Caseworking case, as Grant Admin shows it. GAS holds none.
  CASE: "CASE",
  // A Caseworking workflow version, as Grant Admin shows it. GAS holds none.
  WORKFLOW: "WORKFLOW",
  // One list Grant Admin can show, as its owning service declares it.
  BUCKET: "BUCKET",
};

export const auditActions = {
  SUBMIT_APPLICATION: "SUBMIT_APPLICATION",
  REPLACE_APPLICATION: "REPLACE_APPLICATION",
  STATUS_TRANSITION: "STATUS_TRANSITION",
  // Written by no route; kept for the stored audit rows that carry it.
  REPLACE_GRANT: "REPLACE_GRANT",
  CANCEL_AGREEMENT: "CANCEL_AGREEMENT",
  WITHDRAW_APPLICATION: "WITHDRAW_APPLICATION",
  CREATE_AGREEMENT: "CREATE_AGREEMENT",
  CREATE_AGREEMENT_RECORD: "CREATE_AGREEMENT_RECORD",
  REQUEST_AGREEMENT_CANCELLATION: "REQUEST_AGREEMENT_CANCELLATION",
  REQUEST_AGREEMENT_TERMINATION: "REQUEST_AGREEMENT_TERMINATION",
  ADD_AGREEMENT: "ADD_AGREEMENT",
  ACCEPT_AGREEMENT: "ACCEPT_AGREEMENT",
  ACCEPT_AGREEMENT_OFFER: "ACCEPT_AGREEMENT_OFFER",
  UPDATE_AGREEMENT: "UPDATE_AGREEMENT",
  WITHDRAW_AGREEMENT: "WITHDRAW_AGREEMENT",
  APPLY_AGREEMENT_TERMINATION: "APPLY_AGREEMENT_TERMINATION",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  SUBMIT: "SUBMIT",
  VIEW_EVENT: "VIEW_EVENT",
  VIEW_AGREEMENT: "VIEW_AGREEMENT",
  REDRIVE_EVENT: "REDRIVE_EVENT",
  // Setting one dead letter aside for good: it becomes PURGED and is deleted
  // on its retention date, not now.
  PURGE_EVENT: "PURGE_EVENT",
  // Replacing one redrivable row's payload. The row keeps its status; only a
  // redrive retries it.
  EDIT_EVENT_PAYLOAD: "EDIT_EVENT_PAYLOAD",
  // Written by no route; kept for the stored audit rows that carry it.
  SEARCH_APPLICATIONS: "SEARCH_APPLICATIONS",
  // One tab of one application in Grant Admin.
  VIEW_APPLICATION: "VIEW_APPLICATION",
  SAVE_GRANT_SETTINGS: "SAVE_GRANT_SETTINGS",
  VIEW_GRANT_SETTINGS: "VIEW_GRANT_SETTINGS",
  VIEW_ALLOW_LIST: "VIEW_ALLOW_LIST",
  CHECK_ALLOW_LIST: "CHECK_ALLOW_LIST",
  REPLACE_ALLOW_LIST: "REPLACE_ALLOW_LIST",
  // Written by no route; kept for the stored audit rows that carry it.
  SEARCH_CASES: "SEARCH_CASES",
  // One tab of one case in Grant Admin.
  VIEW_CASE_DATA: "VIEW_CASE_DATA",
  // One tab of one grant version in Grant Admin.
  VIEW_GRANT_VERSION: "VIEW_GRANT_VERSION",
  // One tab of one Caseworking workflow version in Grant Admin.
  VIEW_WORKFLOW_VERSION: "VIEW_WORKFLOW_VERSION",
  // An operator storing a version's Definition Files that are not stored: a
  // grant's in GAS, or a workflow's, which Caseworking stores.
  FETCH_CONFIG_DEFINITION: "FETCH_CONFIG_DEFINITION",
  // One page of one audited bucket.
  QUERY_BUCKET: "QUERY_BUCKET",
};

// The protective-monitoring code on every Grant Admin read.
export const PMC_0706_SECURITY = { pmccode: "0706" };

export const auditStatus = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
};
