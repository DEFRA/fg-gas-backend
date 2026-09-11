// Maps an Agreement to the stable QA response DTO, shared by both endpoints.
const responseFields = [
  "agreementNumber",
  "version",
  "code",
  "clientRef",
  "configVersion",
  "correlationId",
  "identifiers",
  "schemeCode",
  "name",
  "applicant",
  "application",
  "startDate",
  "endDate",
  "parcels",
  "actions",
  "items",
  "annualAmountPence",
  "totalAmountPence",
  "paymentSchedule",
  "state",
  "createdAt",
  "updatedAt",
];

export const toTestAgreementResponse = (agreement) => {
  const response = {};

  for (const field of responseFields) {
    if (agreement[field] !== undefined) {
      response[field] = agreement[field];
    }
  }

  return response;
};
