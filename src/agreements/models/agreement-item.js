import { randomUUID } from "node:crypto";

const snapshotFields = new Set(["acceptedAt", "supplementaryData"]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

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

const assertAcceptedAtSnapshot = (snapshot) => {
  if (!hasSnapshotField(snapshot, "acceptedAt")) {
    return;
  }

  if (typeof snapshot.acceptedAt !== "string") {
    throw new TypeError("Agreement item acceptedAt snapshot must be a string");
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

const acceptedAtPatch = (snapshot) =>
  hasSnapshotField(snapshot, "acceptedAt")
    ? { acceptedAt: snapshot.acceptedAt }
    : {};

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
    assertAcceptedAtSnapshot(snapshotPatch);
    assertSupplementaryDataSnapshot(snapshotPatch);

    return new AgreementItem({
      ...this,
      ...acceptedAtPatch(snapshotPatch),
      ...supplementaryDataPatch(this.supplementaryData, snapshotPatch),
    });
  }
}
