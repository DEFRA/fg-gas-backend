const keyedEntries = (value) =>
  value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});

export const entries = (value) => keyedEntries(value).map(([, entry]) => entry);

export const isKeyedCollection = (value) =>
  value instanceof Map ||
  (value !== null && typeof value === "object" && !Array.isArray(value));

const paymentItemEntries = (version) =>
  keyedEntries(version.payment?.agreementLevelItems);

const applicationItemEntries = (version) =>
  (version.application?.agreement ?? []).map((item, index) => [
    String(index + 1),
    item,
  ]);

export const sourceItemEntries = (version) => {
  const paymentItems = paymentItemEntries(version);
  return paymentItems.length > 0
    ? paymentItems
    : applicationItemEntries(version);
};

export const sourceItems = (version) =>
  sourceItemEntries(version).map(([, item]) => item);

// eslint-disable-next-line complexity
const normaliseDecimal = (value) => {
  const [, sign, integer, fraction = "", sourceExponent = "0"] =
    value.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i) ?? [];

  if (integer === undefined) {
    return undefined;
  }

  let digits = `${integer}${fraction}`.replace(/^0+/, "") || "0";
  let exponent = Number(sourceExponent) - fraction.length;

  if (digits === "0") {
    return digits;
  }

  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }

  return `${sign}${digits}e${exponent}`;
};

export const toExactNumber = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const source = value.toString();
  const number = Number(source);
  return normaliseDecimal(source) === normaliseDecimal(number.toString())
    ? number
    : Number.NaN;
};

export const sourceActionApplications = (version) =>
  (version.actionApplications ?? []).map((action, index) => ({
    action,
    path: `actionApplications.${index}`,
  }));

export const sourceApplicationParcelActions = (version) =>
  (version.application?.parcel ?? []).flatMap((parcel, parcelIndex) =>
    (parcel.actions ?? []).map((action, actionIndex) => ({
      action,
      path: `application.parcel.${parcelIndex}.actions.${actionIndex}`,
    })),
  );

export const sourceActions = (version) => [
  ...sourceActionApplications(version),
  ...sourceApplicationParcelActions(version),
];

// Current producer parcel actions carry agreement-item values, whereas
// actionApplications carry parcel areas. Older records may only have the latter.
const sourceItemActions = (version, item) => {
  const parcelActions = sourceApplicationParcelActions(version).filter(
    ({ action }) => action.code === item.code,
  );
  return parcelActions.length > 0
    ? parcelActions
    : sourceActionApplications(version).filter(
        ({ action }) => action.code === item.code,
      );
};

export const sourceItemActionValues = (version, item, field) =>
  sourceItemActions(version, item)
    .map(({ action }) => action.appliedFor?.[field])
    .filter((value) => value !== undefined && value !== null);
