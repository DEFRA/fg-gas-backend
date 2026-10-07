export const toEntitlementDto = (entitlement) => ({
  id: entitlement.id,
  clientRef: entitlement.clientRef,
  code: entitlement.code,
  claimCode: entitlement.claimCode,
  instanceNumber: entitlement.instanceNumber,
  configVersion: entitlement.configVersion,
  data: structuredClone(entitlement.data),
  createdAt: entitlement.createdAt,
  updatedAt: entitlement.updatedAt,
});
