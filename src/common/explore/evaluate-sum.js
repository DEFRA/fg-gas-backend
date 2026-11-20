import { Decimal128, Double, Int32, Long } from "mongodb";
import { doubleDigitsOf, isBsonValue, plainBson } from "./evaluate-read.js";

// Numbers added as Mongo's $sum adds them (its DoubleDoubleSummation): a sum
// and what it lost, the sum shown, so totals have mongosh's digits. A plain
// sum is kept beside them and shown when the compensated one overflows to
// NaN, as Mongo's is, so [1e308, 1e308, 1] adds to Infinity. The widest
// type added says the sum's type, as mongod's does (`i` Int32, `l` Int64,
// `f` Double, `m` Decimal128), and Decimal128s are added apart, as
// Decimal128 adds them.
const fast2Sum = (a, b) => {
  const s = a + b;

  return [s, b - (s - a)];
};

const twoSum = (a, b) => {
  const s = a + b;
  const aPrime = s - b;
  const bPrime = s - aPrime;

  return [s, a - aPrime + (b - bPrime)];
};

const addDouble = ([sum, addend, plain], value) => {
  const [x, lower] = fast2Sum(value, addend);
  const [total, lost] = twoSum(sum, x);

  return [total, lower + lost, plain + value];
};

const WIDTH = ["i", "l", "f", "m"];

const wider = (a, b) => WIDTH[Math.max(WIDTH.indexOf(a), WIDTH.indexOf(b))];

const INT32_MAX = 0x7fffffff;

export const isInt32 = (number) =>
  Number.isInteger(number) && number >= -INT32_MAX - 1 && number <= INT32_MAX;

// The type of a number as BSON stores it, a plain number as the driver
// would write it.
const NUMBER_KINDS = { Int32: "i", Long: "l", Double: "f", Decimal128: "m" };

const plainKindOf = (number) => (isInt32(number) ? "i" : "f");

const bsonKindOf = (value) =>
  isBsonValue(value) ? (NUMBER_KINDS[value._bsontype] ?? null) : null;

const kindOf = (value) =>
  typeof value === "number" ? plainKindOf(value) : bsonKindOf(value);

// A Long added exactly, as its nearest double and what that missed.
const doublesOf = (value) => {
  if (value?._bsontype !== "Long") {
    return [plainBson(value)];
  }

  const exact = BigInt(value.toString());
  const high = Number(exact);

  return [high, Number(exact - BigInt(high))];
};

const ZERO_DECIMAL = "0e0";

const decimalParts = (decimal) => {
  const [digits, scale = "0"] = decimal.split("e");

  return { digits: BigInt(digits), scale: Number(scale) };
};

// A Decimal128 that isn't finite is held as its text, and adds as a double's
// infinity or NaN does.
const NOT_FINITE_DECIMALS = new Set(["NaN", "Infinity", "-Infinity"]);

const isFiniteDecimal = (decimal) => !NOT_FINITE_DECIMALS.has(decimal);

const notFiniteOf = (decimal) =>
  isFiniteDecimal(decimal) ? 0 : Number(decimal);

const STORED_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:E([-+]\d+))?$/;

// A Decimal128 as its digits and exponent, trailing zeros kept, as it is
// stored.
const storedDigitsOf = (text) => {
  const [, sign, whole, fraction = "", exponent = "0"] =
    STORED_DECIMAL.exec(text);

  const digits = BigInt(whole + fraction);

  return `${sign}${digits}e${Number(exponent) - fraction.length}`;
};

const decimalTextOf = (value) => {
  const text = String(value);

  return isFiniteDecimal(text) ? storedDigitsOf(text) : text;
};

// Decimal128 holds 34 digits, up to 10^6144: each result is rounded to them,
// half to even, as IEEE 754 decimal arithmetic rounds it, past them an
// infinity.
const DECIMAL_DIGITS = 34;
const DECIMAL_MAX_EXPONENT = 6144;

const lengthOf = (digits) => String(digits).length;

const halfEven = (kept, rest, unit) => {
  const twice = rest * 2n;

  return twice > unit || (twice === unit && kept % 2n === 1n)
    ? kept + 1n
    : kept;
};

const roundedTo = (coefficient, scale, digits) => {
  const drop = lengthOf(coefficient) - digits;

  if (drop <= 0) {
    return { coefficient, scale };
  }

  const unit = 10n ** BigInt(drop);

  return roundedTo(
    halfEven(coefficient / unit, coefficient % unit, unit),
    scale + drop,
    digits,
  );
};

const isOverflow = ({ coefficient, scale }) =>
  coefficient !== 0n &&
  lengthOf(coefficient) - 1 + scale > DECIMAL_MAX_EXPONENT;

const asDecimal = (digits, scale) => {
  const sign = digits < 0n ? "-" : "";
  const rounded = roundedTo(sign ? -digits : digits, scale, DECIMAL_DIGITS);

  return isOverflow(rounded)
    ? `${sign}Infinity`
    : `${sign}${rounded.coefficient}e${rounded.scale}`;
};

const addFiniteDecimals = (a, b) => {
  const [x, y] = [decimalParts(a), decimalParts(b)];
  const scale = Math.min(x.scale, y.scale);
  const digits =
    x.digits * 10n ** BigInt(x.scale - scale) +
    y.digits * 10n ** BigInt(y.scale - scale);

  return asDecimal(digits, scale);
};

const addDecimals = (a, b) =>
  isFiniteDecimal(a) && isFiniteDecimal(b)
    ? addFiniteDecimals(a, b)
    : String(notFiniteOf(a) + notFiniteOf(b));

export const NO_SUM = [0, 0, 0, "i", null];

export const added = (state, value) => {
  const kind = kindOf(value);

  if (kind === null) {
    return state;
  }

  const [sum, addend, plain, type, decimal] = state;

  if (kind === "m") {
    return [
      sum,
      addend,
      plain,
      "m",
      addDecimals(decimal ?? ZERO_DECIMAL, decimalTextOf(value)),
    ];
  }

  return [
    ...doublesOf(value).reduce(
      (sofar, double) => addDouble(sofar, double),
      [sum, addend, plain],
    ),
    wider(type, kind),
    decimal,
  ];
};

const shownOfDoubles = ([sum, , plain]) => (Number.isNaN(sum) ? plain : sum);

const exactInteger = ([sum, addend]) =>
  Number.isInteger(sum) && Number.isInteger(addend)
    ? BigInt(sum) + BigInt(addend)
    : null;

const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

const fitsLong = (exact) =>
  exact !== null && exact >= LONG_MIN && exact <= LONG_MAX;

const intOrLong = (exact) =>
  exact >= -(2n ** 31n) && exact <= 2n ** 31n - 1n
    ? new Int32(Number(exact))
    : Long.fromBigInt(exact);

// A double as a Decimal128 of 34 digits, as mongod converts it.
const decimalOfDouble = (number) => {
  if (!Number.isFinite(number)) {
    return String(number);
  }

  const { digits, scale } = decimalParts(doubleDigitsOf(number));

  return asDecimal(digits, scale);
};

// The doubles added in as mongod's getDecimal() gives them, the sum and what
// it lost each as a Decimal128 and then added, or the sum shown once it
// isn't finite; then added to the Decimal128s' total.
const decimalTotal = (state) => {
  const [sum, addend, , , decimal] = state;
  const doubles = Number.isFinite(sum)
    ? [sum, addend]
    : [shownOfDoubles(state)];

  const [first, ...rest] = doubles.map(decimalOfDouble);

  return addDecimals(
    decimal ?? ZERO_DECIMAL,
    rest.reduce((sofar, next) => addDecimals(sofar, next), first),
  );
};

const asDecimal128 = (decimal) => {
  if (!isFiniteDecimal(decimal)) {
    return Decimal128.fromString(decimal);
  }

  const { digits, scale } = decimalParts(decimal);

  return Decimal128.fromString(`${digits}E${scale}`);
};

// A sum as mongod's $sum gives it: an Int32 while Int32s fit, then an Int64,
// a Double past it or once one is added, a Decimal128 once one is added.
const SUM_VALUES = {
  i: (exact) => (fitsLong(exact) ? intOrLong(exact) : null),
  l: (exact) => (fitsLong(exact) ? Long.fromBigInt(exact) : null),
  f: () => null,
};

export const typedSum = (state) => {
  const [, , , type] = state;

  if (type === "m") {
    return asDecimal128(decimalTotal(state));
  }

  return (
    SUM_VALUES[type](exactInteger(state)) ?? new Double(shownOfDoubles(state))
  );
};

export const sumOf = (values) => typedSum(values.reduce(added, NO_SUM));

const orZero = (decimal) => decimal ?? ZERO_DECIMAL;

const addedDecimals = (a, b) =>
  a === null && b === null ? null : addDecimals(orZero(a), orZero(b));

// A part that overflowed, to NaN or to an infinity, leaves the merged sum
// NaN, so its plain sum shows.
export const mergedSum = (
  [sumA, addendA, plainA, typeA, decimalA],
  [sumB, addendB, plainB, typeB, decimalB],
) => {
  const [total, lost] = addDouble(addDouble([sumA, addendA, 0], sumB), addendB);

  return [
    Number.isFinite(sumB) ? total : Number.NaN,
    lost,
    plainA + plainB,
    wider(typeA, typeB),
    addedDecimals(decimalA, decimalB),
  ];
};
