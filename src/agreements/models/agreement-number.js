import { randomInt as cryptoRandomInt } from "node:crypto";

export const generateAgreementNumber = ({
  config,
  randomInt = cryptoRandomInt,
}) => {
  const max = 10 ** config.randomDigits;
  const randomNumber = randomInt(0, max);
  const randomDigits = String(randomNumber).padStart(config.randomDigits, "0");

  return `${config.prefix}${randomDigits}`;
};
