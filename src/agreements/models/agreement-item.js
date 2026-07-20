import { randomUUID } from "node:crypto";
import { isPlainObject } from "../../common/is-plain-object.js";

const stringSnapshotField = {
  isValid: (value) => typeof value === "string",
  expectedType: "a string",
};
const objectSnapshotField = {
  isValid: isPlainObject,
  expectedType: "an object",
};

const snapshotFields = {
  acceptedAt: stringSnapshotField,
  supplementaryData: objectSnapshotField,
};

const assertSnapshotField = ([name, value]) => {
  const field = snapshotFields[name];

  if (!field) {
    throw new Error(`Unsupported Agreement item snapshot field: "${name}"`);
  }

  if (!field.isValid(value)) {
    throw new TypeError(
      `Agreement item ${name} snapshot must be ${field.expectedType}`,
    );
  }
};

const assertSnapshotPatch = (snapshot) =>
  Object.entries(snapshot).forEach(assertSnapshotField);

const firstClassSnapshotPatch = (snapshot) =>
  Object.fromEntries(
    Object.entries(snapshot).filter(([field]) => field !== "supplementaryData"),
  );

const supplementaryDataPatch = (existing, snapshot) => {
  if (!Object.hasOwn(snapshot, "supplementaryData")) {
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
    assertSnapshotPatch(snapshotPatch);

    return new AgreementItem({
      ...this,
      ...firstClassSnapshotPatch(snapshotPatch),
      ...supplementaryDataPatch(this.supplementaryData, snapshotPatch),
    });
  }
}
