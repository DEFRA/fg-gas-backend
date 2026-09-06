// eslint-disable-next-line complexity
export const getMessageGroupId = (id, data) => {
  if (!id) {
    if (data.clientRef && data.grantCode) {
      return `${data.clientRef}-${data.grantCode}`;
    }
    if (data.clientRef && data.code) {
      return `${data.clientRef}-${data.code}`;
    }
    if (data.caseRef) {
      return `${data.caseRef}-${data.workflowCode}`;
    }
    // Config broker messages are grant-level (no clientRef), so grantCode alone
    // is the correct grouping key to preserve per-grant ordering in FIFO queues.
    if (data.grantCode) {
      return data.grantCode;
    }
  }

  return id;
};
