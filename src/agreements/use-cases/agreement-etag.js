export const toEtag = (agreement) =>
  `"${agreement.agreementNumber}:${agreement.version}"`;
