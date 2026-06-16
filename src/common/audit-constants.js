export const buildAuditEvent = ({
  entity,
  action,
  entityid,
  details = {},
  messageGroupId,
  security,
}) => ({
  entities: [{ entity, action, entityid }],
  details,
  messageGroupId: messageGroupId ?? entityid,
  ...(security && { security }),
});

export const auditEntities = {
  APPLICATION: "Application",
  AGREEMENT: "Agreement",
  GRANT: "Grant",
};

export const auditActions = {
  CREATE_APPLICATION: "CREATE_APPLICATION",
  SUBMIT_APPLICATION: "SUBMIT_APPLICATION",
  REPLACE_APPLICATION: "REPLACE_APPLICATION",
  APPROVE_APPLICATION: "APPROVE_APPLICATION",
  CANCEL_AGREEMENT: "CANCEL_AGREEMENT",
  REPLACE_GRANT: "REPLACE_GRANT",
};
