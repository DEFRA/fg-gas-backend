// A claimable entitlement as the API answers it: the template's fields filled
// in from the entitlement that exists, with decimals back in the units a case
// officer entered rather than the scaled integers they are stored as.
const dataValue = (field, value) => value ?? field.value ?? null;

const unscaleDecimalAsText = (value, decimalPlaces) => {
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value)).padStart(decimalPlaces + 1, "0");
  const point = digits.length - decimalPlaces;

  return Number(`${sign}${digits.slice(0, point)}.${digits.slice(point)}`);
};

const unscaled = (value, decimalPlaces) =>
  typeof value === "number"
    ? unscaleDecimalAsText(value, decimalPlaces)
    : value;

const decimalDataField = (field, value) => ({
  value: unscaled(dataValue(field, value), field.decimalPlaces),
  decimalPlaces: field.decimalPlaces,
  minValue: field.minValue ?? null,
  maxValue: field.maxValue ?? null,
});

const dataField = (field, value) => {
  if (field.unitType === "decimal") {
    return decimalDataField(field, value);
  }
  return { value: dataValue(field, value) };
};

const claimData = (claimable) =>
  Object.fromEntries(
    Object.entries(claimable.fields ?? {}).map(([name, field]) => [
      name,
      dataField(field, claimable.entitlement?.data?.[name]),
    ]),
  );

const entitlementDetails = (entitlement) =>
  entitlement
    ? {
        entitlementId: entitlement.id,
        instanceNumber: entitlement.instanceNumber,
      }
    : { entitlementId: null, instanceNumber: null };

export const toClaimableDto = (claimable) => ({
  source: claimable.type,
  claimCode: claimable.claimCode,
  name: claimable.name,
  description: claimable.description ?? null,
  data: claimData(claimable),
  ...entitlementDetails(claimable.entitlement),
  claim: structuredClone(claimable.claim),
});
