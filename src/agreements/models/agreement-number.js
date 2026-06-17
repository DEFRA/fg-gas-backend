import { randomInt as cryptoRandomInt } from "node:crypto";

const agreementNumberRandomDigits = 9;

export const generateAgreementNumber = ({
  prefix,
  randomInt = cryptoRandomInt,
}) => {
  const max = 10 ** agreementNumberRandomDigits;
  const randomNumber = randomInt(0, max);
  const randomDigits = String(randomNumber).padStart(
    agreementNumberRandomDigits,
    "0",
  );

  return `${prefix}${randomDigits}`;
};
