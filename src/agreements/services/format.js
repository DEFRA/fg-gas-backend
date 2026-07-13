const isNumeric = (value) =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "");

const poundsNoDecimals = (value) => {
  const amount = isNumeric(value) ? Number(value) : NaN;

  if (Number.isNaN(amount)) {
    throw new Error(`Cannot format "${value}" as poundsNoDecimals`);
  }

  return `£${Math.round(amount).toLocaleString("en-GB")}`;
};

const formatters = { poundsNoDecimals };

export const applyFormat = (value, formatName) => {
  const formatter = formatters[formatName];

  if (!formatter) {
    throw new Error(`Unsupported format "${formatName}"`);
  }

  return formatter(value);
};
