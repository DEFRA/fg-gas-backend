export const recordAgreementPaymentClaimPublicationIntent = ({
  paymentClaim,
  publication = {},
}) => ({
  ...publication,
  paymentClaim,
});

export const recordAgreementLifecyclePublicationIntent = ({
  publication = {},
}) => ({
  ...publication,
  lifecycleEvent: true,
});
