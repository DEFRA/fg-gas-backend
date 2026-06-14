export const agreementActionCommandFromRequest = ({
  actionName,
  agreementNumber,
  payload = {},
}) => ({
  actionName,
  agreementNumber,
  acceptedBy: payload.acceptedBy ?? "applicant",
  clientRef: payload.clientRef,
  code: payload.code,
});
