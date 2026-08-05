const isNumeric = (value) =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "");

const poundsNoDecimals = (value) => {
  const amount = isNumeric(value) ? Number(value) : Number.NaN;

  if (Number.isNaN(amount)) {
    throw new TypeError(`Cannot format "${value}" as poundsNoDecimals`);
  }

  return `£${Math.round(amount).toLocaleString("en-GB")}`;
};

const poundsFromPence = (value) => {
  const amount = isNumeric(value) ? Number(value) : Number.NaN;

  if (Number.isNaN(amount)) {
    throw new TypeError(`Cannot format "${value}" as poundsFromPence`);
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
};

const isIsoDate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseDate = (value) =>
  new Date(isIsoDate(value) ? `${value}T00:00:00.000Z` : value);

const dateLong = (value) => {
  const date = parseDate(value);

  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new TypeError(`Cannot format "${value}" as dateLong`);
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const formatters = { dateLong, poundsFromPence, poundsNoDecimals };

export const applyFormat = (value, formatName) => {
  const formatter = formatters[formatName];

  if (!formatter) {
    throw new Error(`Unsupported format "${formatName}"`);
  }

  return formatter(value);
};
