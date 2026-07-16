import Boom from "@hapi/boom";

export class CurrentAgreement {
  constructor({ reference, version }) {
    this.reference = reference;
    this.version = version;
    this.snapshot = version.snapshot;
    this.item = findCurrentItem({ reference, snapshot: this.snapshot });
    assertConfigVersion({
      agreementNumber: reference.agreementNumber,
      item: this.item,
    });

    this.agreementNumber = reference.agreementNumber;
    this.code = reference.code;
    this.configVersion = this.item.configVersion;
    this.state = this.item.state;
  }

  matchesReference(reference) {
    return this.reference.equals(reference);
  }
}

const findCurrentItem = ({ reference, snapshot }) => {
  const item = snapshot?.findItem?.(reference);

  if (!item) {
    throw Boom.badImplementation(
      `Agreement "${reference.agreementNumber}" latest version is inconsistent`,
    );
  }

  return item;
};

const assertConfigVersion = ({ agreementNumber, item }) => {
  if (!item.configVersion) {
    throw Boom.badImplementation(
      `Agreement "${agreementNumber}" latest version has no Config Version`,
    );
  }
};
