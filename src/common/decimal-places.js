// Counted from the digits, so float noise counts: 0.1 + 0.2 has 17. 1e-7 has 7.
export const decimalPlaces = (value) => {
  const [coefficient, exponent] = value.toString().toLowerCase().split("e");
  const decimals = (coefficient.split(".")[1] ?? "").length;

  return Math.max(0, decimals - Number(exponent ?? 0));
};
