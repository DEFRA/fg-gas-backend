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
  }

  return id;
};
