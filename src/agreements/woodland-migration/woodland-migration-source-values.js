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
