import { randomUUID } from "node:crypto";
import { isPlainObject } from "../../common/is-plain-object.js";

const stringSnapshotFields = new Set([
  "acceptedAt",
  "claimId",
  "correlationId",
  "originalInvoiceNumber",
]);
const objectSnapshotFields = new Set(["payment"]);
const snapshotFields = new Set([
  ...stringSnapshotFields,
  ...objectSnapshotFields,
  "supplementaryData",
]);

const hasSnapshotField = (snapshot, field) => Object.hasOwn(snapshot, field);

const assertSnapshotFields = (snapshot) => {
  const unsupportedField = Object.keys(snapshot).find(
    (field) => !snapshotFields.has(field),
  );

  if (unsupportedField) {
    throw new Error(
      `Unsupported Agreement item snapshot field: "${unsupportedField}"`,
    );
  }
};

const assertStringSnapshots = (snapshot) => {
  for (const field of stringSnapshotFields) {
    if (
      hasSnapshotField(snapshot, field) &&
      typeof snapshot[field] !== "string"
    ) {
      throw new TypeError(`Agreement item ${field} snapshot must be a string`);
    }
  }
};

const assertObjectSnapshots = (snapshot) => {
  for (const field of objectSnapshotFields) {
    if (hasSnapshotField(snapshot, field) && !isPlainObject(snapshot[field])) {
      throw new TypeError(`Agreement item ${field} snapshot must be an object`);
    }
  }
};

const assertSupplementaryDataSnapshot = (snapshot) => {
  if (!hasSnapshotField(snapshot, "supplementaryData")) {
    return;
  }

  if (!isPlainObject(snapshot.supplementaryData)) {
    throw new TypeError(
      "Agreement item supplementaryData snapshot must be an object",
    );
  }
};

const firstClassSnapshotPatch = (snapshot) =>
  Object.fromEntries(
    [...stringSnapshotFields, ...objectSnapshotFields]
      .filter((field) => hasSnapshotField(snapshot, field))
      .map((field) => [field, snapshot[field]]),
  );

const supplementaryDataPatch = (existing, snapshot) => {
  if (!hasSnapshotField(snapshot, "supplementaryData")) {
    return {};
  }

  return {
    supplementaryData: {
      ...(isPlainObject(existing) ? existing : {}),
      ...snapshot.supplementaryData,
    },
  };
};

export class AgreementItem {
  constructor({
    agreementItemId,
    agreementCode,
    clientRef,
    sourceSystem,
    configVersion,
    identifiers,
    payload,
    createdAt,
    acceptedAt,
    claimId,
    correlationId,
    originalInvoiceNumber,
    payment,
    state,
    supplementaryData,
  }) {
    this.agreementItemId = agreementItemId;
    this.agreementCode = agreementCode;
    this.clientRef = clientRef;
    this.sourceSystem = sourceSystem;
    this.configVersion = configVersion;
    this.identifiers = identifiers;
    this.payload = payload;
    this.createdAt = createdAt;
    this.acceptedAt = acceptedAt;
    this.claimId = claimId;
    this.correlationId = correlationId;
    this.originalInvoiceNumber = originalInvoiceNumber;
    this.payment = payment;
    this.state = state;
    this.supplementaryData = supplementaryData;
  }

  static create({
    agreementCode,
    clientRef,
    sourceSystem,
    configVersion,
    identifiers,
    payload,
    state,
  }) {
    return new AgreementItem({
      agreementItemId: randomUUID(),
      agreementCode,
      clientRef,
      sourceSystem,
      configVersion,
      identifiers,
      payload,
      createdAt: new Date().toISOString(),
      state,
    });
  }

  applySnapshotPatch(snapshotPatch = {}) {
    assertSnapshotFields(snapshotPatch);
    assertStringSnapshots(snapshotPatch);
    assertObjectSnapshots(snapshotPatch);
    assertSupplementaryDataSnapshot(snapshotPatch);

    return new AgreementItem({
      ...this,
      ...firstClassSnapshotPatch(snapshotPatch),
      ...supplementaryDataPatch(this.supplementaryData, snapshotPatch),
    });
  }
}
