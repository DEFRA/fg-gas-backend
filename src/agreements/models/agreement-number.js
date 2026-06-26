import { randomInt } from "node:crypto";

const validatePrefix = (prefix) => {
  if (!prefix || typeof prefix !== "string") {
    throw new Error("Agreement number prefix is required");
  }
};

const validateSuffixLength = (suffixLength) => {
  if (
    !Number.isInteger(suffixLength) ||
    suffixLength < 1 ||
    suffixLength > 14
  ) {
    throw new Error("suffixLength must be an integer between 1 and 14");
  }
};

export const generateAgreementNumber = ({ prefix, suffixLength = 9 }) => {
  validatePrefix(prefix);
  validateSuffixLength(suffixLength);
  const min = 10 ** (suffixLength - 1); // 10^8
  const max = 10 ** suffixLength; // 10^9
  const suffix = randomInt(min, max);

  return `${prefix}${suffix}`;
};
