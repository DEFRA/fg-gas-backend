export const toEtag = (agreement, resolvedConfigVersion) =>
  `"${agreement.agreementNumber}:${agreement.version}:${resolvedConfigVersion}"`;
